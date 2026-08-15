-- =============================================================================
-- Customer Estimate View
-- Public, token-based read of a SENT estimate's snapshot, plus the customer's
-- three responses (accept / decline / ask) and view tracking.
--
-- Access is via SECURITY DEFINER functions granted to `anon` — the anon key
-- never gets a `select * from estimates` path. The functions only ever return
-- the customer-safe snapshot (built at send time), never the live builder_state,
-- margin, costs or hidden items.
-- =============================================================================

-- ---- estimates: send/snapshot + response columns ---------------------------
alter table public.estimates
  add column if not exists share_token     text unique,
  add column if not exists sent_snapshot   jsonb,        -- customer-safe document, frozen at send
  add column if not exists sent_at         timestamptz,
  add column if not exists valid_until     date,
  add column if not exists viewed_at       timestamptz,  -- first customer open ("viewed")
  add column if not exists accepted_at     timestamptz,
  add column if not exists accepted_name   text,
  add column if not exists selected_options jsonb,
  add column if not exists declined_at     timestamptz,
  add column if not exists declined_reason text;

create index if not exists estimates_share_token_idx on public.estimates (share_token);

-- link a deposit invoice back to its estimate
alter table public.invoices add column if not exists estimate_id uuid references public.estimates (id) on delete set null;

-- ---- event / view / question logs ------------------------------------------
create table if not exists public.estimate_events (
  id          uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  type        text not null,          -- viewed | accepted | declined | question
  payload     jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index if not exists estimate_events_estimate_idx on public.estimate_events (estimate_id);

create table if not exists public.estimate_views (
  id          uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  session_id  uuid not null,          -- client-generated, one row per open session
  user_agent  text,
  dwell_ms    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (estimate_id, session_id)
);

create table if not exists public.estimate_questions (
  id          uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  message     text not null,
  handled     boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ---- RLS: staff can read the logs; the customer never touches them directly -
alter table public.estimate_events    enable row level security;
alter table public.estimate_views     enable row level security;
alter table public.estimate_questions enable row level security;

create policy estimate_events_staff    on public.estimate_events    for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy estimate_views_staff     on public.estimate_views     for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy estimate_questions_staff on public.estimate_questions for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- =============================================================================
-- Public RPCs (SECURITY DEFINER, granted to anon)
-- =============================================================================

-- Read a sent estimate by its token — customer-safe fields only.
create or replace function public.get_estimate_by_token(p_token text)
returns table (
  id uuid, status public.estimate_status, snapshot jsonb, accepted_name text,
  accepted_at timestamptz, declined_reason text, valid_until date,
  sent_at timestamptz, viewed_at timestamptz, selected_options jsonb
)
language sql security definer set search_path = public as $$
  select e.id, e.status, e.sent_snapshot, e.accepted_name, e.accepted_at,
         e.declined_reason, e.valid_until, e.sent_at, e.viewed_at, e.selected_options
  from public.estimates e
  where e.share_token = p_token and e.sent_snapshot is not null
  limit 1;
$$;

-- Record an open / dwell heartbeat, and flag first view.
create or replace function public.record_estimate_view(p_token text, p_session uuid, p_ua text, p_ms integer default 0)
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_first boolean;
begin
  select id, viewed_at is null into v_id, v_first from public.estimates where share_token = p_token;
  if v_id is null then return; end if;
  insert into public.estimate_views (estimate_id, session_id, user_agent, dwell_ms)
    values (v_id, p_session, p_ua, greatest(p_ms, 0))
    on conflict (estimate_id, session_id) do update set dwell_ms = greatest(excluded.dwell_ms, public.estimate_views.dwell_ms), updated_at = now();
  if v_first then
    update public.estimates set viewed_at = now() where id = v_id and viewed_at is null;
    insert into public.estimate_events (estimate_id, type, payload) values (v_id, 'viewed', '{}');
  end if;
end; $$;

-- Accept: idempotent. Records name + selected options, creates a draft deposit invoice.
create or replace function public.accept_estimate(p_token text, p_name text, p_options jsonb, p_total_cents integer, p_deposit_cents integer)
returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_status public.estimate_status;
begin
  select id, status into v_id, v_status from public.estimates where share_token = p_token;
  if v_id is null then return 'not_found'; end if;
  if v_status = 'accepted' then return 'already'; end if;
  update public.estimates
    set status = 'accepted', accepted_at = now(), accepted_name = p_name,
        selected_options = p_options, total_cents = coalesce(p_total_cents, total_cents)
    where id = v_id;
  insert into public.estimate_events (estimate_id, type, payload)
    values (v_id, 'accepted', jsonb_build_object('name', p_name, 'options', p_options, 'total_cents', p_total_cents));
  insert into public.invoices (estimate_id, status, amount_cents, issued_on)
    values (v_id, 'draft', coalesce(p_deposit_cents, 0), current_date);
  return 'accepted';
end; $$;

-- Decline: stores a reason for the CRM follow-up engine.
create or replace function public.decline_estimate(p_token text, p_reason text)
returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_status public.estimate_status;
begin
  select id, status into v_id, v_status from public.estimates where share_token = p_token;
  if v_id is null then return 'not_found'; end if;
  if v_status = 'accepted' then return 'already_accepted'; end if;
  update public.estimates set status = 'declined', declined_at = now(), declined_reason = p_reason where id = v_id;
  insert into public.estimate_events (estimate_id, type, payload) values (v_id, 'declined', jsonb_build_object('reason', p_reason));
  return 'declined';
end; $$;

-- Ask a question: stores it for staff (no status change).
create or replace function public.ask_estimate_question(p_token text, p_message text)
returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from public.estimates where share_token = p_token;
  if v_id is null then return 'not_found'; end if;
  insert into public.estimate_questions (estimate_id, message) values (v_id, p_message);
  insert into public.estimate_events (estimate_id, type, payload) values (v_id, 'question', jsonb_build_object('message', p_message));
  return 'ok';
end; $$;

grant execute on function public.get_estimate_by_token(text)                          to anon, authenticated;
grant execute on function public.record_estimate_view(text, uuid, text, integer)      to anon, authenticated;
grant execute on function public.accept_estimate(text, text, jsonb, integer, integer) to anon, authenticated;
grant execute on function public.decline_estimate(text, text)                         to anon, authenticated;
grant execute on function public.ask_estimate_question(text, text)                    to anon, authenticated;
