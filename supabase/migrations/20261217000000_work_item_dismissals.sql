-- =============================================================================
-- Phase 2A session 2A.5 · work item dismissals (shell brief §3.7)
--
-- Work items are DERIVED, never stored — there is no work_items table, and
-- this migration must not become the excuse to add one. But some items
-- legitimately need to go away: you rang and they said call back next month;
-- the callback was a duplicate; a rule fired on something that doesn't apply.
-- A dismissal suppresses ONE deterministic item key, optionally until a date.
--
-- Reason is REQUIRED. Repeated dismissals of the same kind are the evidence
-- that a threshold is wrong, and you can only see that if reasons exist.
--
-- A3 tenancy ruling applies: tenant_id not null defaulting to current_tenant(),
-- policies tenant-aware, no switching UI.
--
-- Idempotent; read-backs at the end.
-- =============================================================================

create table if not exists public.work_item_dismissals (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) default public.current_tenant(),

  -- The deterministic key from lib/crm/work-queue.ts —
  -- kind:subjectType:subjectId:discriminator. Suppressing a key does not
  -- suppress a re-fire under a NEW discriminator: "quote quiet at 4 days"
  -- dismissed does not silence "quote quiet at 10 days".
  item_key     text not null
    constraint work_item_dismissals_key_shape check (item_key ~ '^[a-z_]+:[a-z_]+:[^:]+:[a-zA-Z0-9_-]+$'),

  account_id   uuid references public.accounts (id) on delete cascade,
  dismissed_by uuid references public.profiles (id) on delete set null,
  dismissed_at timestamptz not null default now(),

  -- Null = permanent for this instance of the fact.
  until        timestamptz,

  reason       text not null
    constraint work_item_dismissals_reason_present check (length(trim(reason)) > 0),

  created_at   timestamptz not null default now()
);

comment on table public.work_item_dismissals is
  'Shell brief §3.7. Suppresses one derived work-item key until `until` (null = permanently). Reason required — repeated dismissals of a kind are evidence its threshold is wrong. Written only through crm_dismiss_work_item().';

-- The queue asks "which keys are suppressed right now" on every build.
create index if not exists work_item_dismissals_active_idx
  on public.work_item_dismissals (item_key, until);

alter table public.work_item_dismissals enable row level security;

drop policy if exists wid_staff_select on public.work_item_dismissals;
create policy wid_staff_select on public.work_item_dismissals
  for select to authenticated
  using (public.is_staff() and tenant_id = public.current_tenant());

-- No INSERT/UPDATE/DELETE policy for client roles: the RPC below is the only
-- write path, same law as crm_events.
revoke all on public.work_item_dismissals from anon;
grant select on public.work_item_dismissals to authenticated;

-- ---- the one write path ----------------------------------------------------

create or replace function public.crm_dismiss_work_item(
  p_item_key   text,
  p_reason     text,
  p_account_id uuid        default null,
  p_until      timestamptz default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not public.is_staff() then
    raise exception 'crm_dismiss_work_item: staff only' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'crm_dismiss_work_item: a reason is required';
  end if;
  if p_item_key !~ '^[a-z_]+:[a-z_]+:[^:]+:[a-zA-Z0-9_-]+$' then
    raise exception 'crm_dismiss_work_item: that is not a work item key';
  end if;

  insert into public.work_item_dismissals (item_key, account_id, dismissed_by, until, reason)
  values (p_item_key, p_account_id, auth.uid(), p_until, trim(p_reason))
  returning id into v_id;

  -- Every dismissal shows on the timeline (§3.7) — but only when there is an
  -- account to show it on; a null-account item (a campaign approval) has no
  -- timeline to appear in.
  if p_account_id is not null then
    perform public.crm_log_event(
      'work_item_dismissed', p_account_id,
      jsonb_build_object('itemKey', p_item_key, 'reason', trim(p_reason),
                         'until', to_jsonb(p_until)),
      'staff');
  end if;

  return v_id;
end $$;

revoke all on function public.crm_dismiss_work_item(text, text, uuid, timestamptz) from public, anon;
grant execute on function public.crm_dismiss_work_item(text, text, uuid, timestamptz) to authenticated;

-- ---- read-backs ------------------------------------------------------------

do $$
begin
  if not exists (select 1 from information_schema.tables
                 where table_schema = 'public' and table_name = 'work_item_dismissals') then
    raise exception 'read-back: work_item_dismissals missing';
  end if;
  if not exists (select 1 from pg_proc where proname = 'crm_dismiss_work_item') then
    raise exception 'read-back: crm_dismiss_work_item missing';
  end if;
end $$;
