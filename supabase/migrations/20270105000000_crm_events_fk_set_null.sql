-- =============================================================================
-- crm_events · let a deleted estimate/property unlink from its events
-- (5 Sep 2026, found while chasing the CI cleanup timeout)
--
-- crm_events is append-only: t_crm_events_no_update (20261205) raises on
-- EVERY update. But two of its foreign keys are declared
--
--   property_id uuid references properties (id) on delete set null
--   estimate_id uuid references estimates  (id) on delete set null
--
-- and "set null" IS an update, fired by Postgres's own RI trigger. So the
-- moment an estimate (or property) has one CRM event, it can never be
-- deleted again:
--
--   delete from estimates where id = '…';
--   -> ERROR: crm_events is append-only: UPDATE on crm_events is not allowed
--
-- Measured on the test project: 75 e2e estimates (and their 75 logins and
-- accounts) that e2e/customer-journey/assistant-trade.spec.ts tried to
-- clean up after itself every run since 1 Sep, each delete refused this
-- way. Production has the same trigger and the same keys, so the same holds
-- there for any estimate the CRM has logged against.
--
-- The rule stays: nobody edits an event. The one thing now permitted is the
-- exact change the RI trigger makes — estimate_id and/or property_id going
-- from a value to NULL, with every other column byte-identical. The event
-- keeps its payload, type, timestamps and actor; it only loses a pointer to
-- a row that no longer exists, which is what "on delete set null" promised
-- when the table was created. Any other update still raises.
-- =============================================================================

create or replace function public.crm_events_no_update()
returns trigger language plpgsql as $$
declare
  changed jsonb;
begin
  -- Everything except the two nullable links must be untouched …
  changed := (to_jsonb(new) - 'estimate_id' - 'property_id');
  if changed = (to_jsonb(old) - 'estimate_id' - 'property_id')
     -- … and each link is either unchanged or cleared (never re-pointed).
     and (new.estimate_id is not distinct from old.estimate_id or new.estimate_id is null)
     and (new.property_id is not distinct from old.property_id or new.property_id is null)
  then
    return new;
  end if;
  raise exception 'crm_events is append-only: % on % is not allowed', tg_op, tg_table_name
    using hint = 'Record a correcting event instead of editing the original.';
end $$;

-- The trigger itself is unchanged (before update, for each row); re-assert
-- it so a project where it was dropped converges.
drop trigger if exists t_crm_events_no_update on public.crm_events;
create trigger t_crm_events_no_update before update on public.crm_events
  for each row execute function public.crm_events_no_update();

-- ---- read-back: the law still holds, and the FK path now works ----------
do $$
declare
  ev uuid;
  est uuid;
  ok boolean := false;
begin
  -- A throwaway event linked to any existing estimate (null on an empty
  -- project — the clearing update is then a no-op, which is also allowed),
  -- then an ordinary edit must still be refused …
  select id into est from public.estimates limit 1;
  insert into public.crm_events (type, source, payload, estimate_id)
    values ('note_added', 'staff', '{"body":"20270105 probe"}'::jsonb, est)
    returning id into ev;
  begin
    update public.crm_events set payload = '{}'::jsonb where id = ev;
  exception when others then
    ok := true;
  end;
  if not ok then
    raise exception 'read-back: an ordinary update on crm_events was ALLOWED';
  end if;
  -- … while clearing the estimate link (what the RI trigger does) is allowed.
  update public.crm_events set estimate_id = null where id = ev;
  if exists (select 1 from public.crm_events where id = ev and estimate_id is not null) then
    raise exception 'read-back: the estimate link was not cleared';
  end if;
  delete from public.crm_events where id = ev;
end $$;

-- Paste the result in chat: expect one row, t_crm_events_no_update.
select tgname from pg_trigger where tgrelid = 'public.crm_events'::regclass and tgname = 't_crm_events_no_update';
