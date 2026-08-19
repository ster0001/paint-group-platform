-- =============================================================================
-- Two-way live chat on an estimate (feature #3).
--
-- estimate_questions was customer->staff only. estimate_messages carries both
-- directions so staff and customer can hold a conversation on the estimate.
-- Staff read/write directly (RLS). The customer has no direct table access;
-- they read the thread and post through SECURITY DEFINER anon RPCs keyed by
-- the share token, exactly like get_estimate_by_token / ask_estimate_question.
-- =============================================================================

create table if not exists public.estimate_messages (
  id          uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  direction   text not null check (direction in ('staff', 'customer')),
  body        text not null,
  author_name text,                       -- staff display name; null for the customer
  created_at  timestamptz not null default now()
);

create index if not exists estimate_messages_estimate_idx
  on public.estimate_messages (estimate_id, created_at);

alter table public.estimate_messages enable row level security;

drop policy if exists estimate_messages_staff on public.estimate_messages;
create policy estimate_messages_staff on public.estimate_messages
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---- customer read: the whole thread for their token -----------------------
create or replace function public.get_estimate_thread_by_token(p_token text)
returns table (id uuid, direction text, body text, author_name text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select e.id into v_id from public.estimates e where e.share_token = p_token;
  if v_id is null then return; end if;
  return query
    select m.id, m.direction, m.body, m.author_name, m.created_at
      from public.estimate_messages m
     where m.estimate_id = v_id
     order by m.created_at;
end; $$;

-- ---- customer write: post a message, capped and trimmed --------------------
create or replace function public.post_estimate_message_by_token(p_token text, p_body text)
returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_body text;
begin
  v_body := btrim(coalesce(p_body, ''));
  if v_body = '' then return 'empty'; end if;
  if length(v_body) > 4000 then v_body := left(v_body, 4000); end if;

  select id into v_id from public.estimates where share_token = p_token;
  if v_id is null then return 'not_found'; end if;

  insert into public.estimate_messages (estimate_id, direction, body)
    values (v_id, 'customer', v_body);
  -- Keep the activity feed honest: a customer message is an event too.
  insert into public.estimate_events (estimate_id, type, payload)
    values (v_id, 'customer_message', jsonb_build_object('body', v_body));
  return 'ok';
end; $$;

grant execute on function public.get_estimate_thread_by_token(text)   to anon, authenticated;
grant execute on function public.post_estimate_message_by_token(text, text) to anon, authenticated;

-- ---- Verification -----------------------------------------------------------
-- select public.post_estimate_message_by_token('<token>', 'Hi, one question…'); -> 'ok'
-- select * from public.get_estimate_thread_by_token('<token>');                 -> the row
-- As a NON-staff signed-in user: select * from estimate_messages;               -> 0 (RLS)
