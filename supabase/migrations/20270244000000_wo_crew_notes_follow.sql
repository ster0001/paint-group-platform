-- =============================================================================
-- Further instructions for the crew, from PC Command (Tom, 8 Oct 2026)
--
-- "Please add the 'further instructions for the crew' into the PC Command, to
-- write and save instructions for the crew which are updated in the work
-- order."
--
-- The instructions live in ONE column: work_orders.crew_notes (20260820). The
-- estimate builder writes it directly (patchWorkOrder). But the painter never
-- reads that column — every contractor surface (/w/[token], /crew/[token], the
-- portal job page, the offer card, the employee view) renders the frozen
-- wo_snapshot, whose crewNotes was copied once, at acceptance / issue. So an
-- instruction written after the job went out reached nobody (the gap noted on
-- 23 Sep beside the finish-level fix).
--
-- One rule, enforced at the row so no writer can recreate the gap:
--   the sheet's crewNotes FOLLOWS the column.
--   1. a BEFORE trigger copies crew_notes into wo_snapshot.crewNotes whenever
--      the column changes (any door: this RPC, the builder's direct write), and
--      whenever a snapshot is (re)written while the column holds something —
--      so an issue from the frozen estimate's stale woDoc cannot undo it. A
--      blank column never blanks an imported sheet's own note on a rewrite;
--      only a deliberate change of the column (including clearing it) does.
--   2. wo_set_crew_notes — the PC Command door: staff only, closed refused,
--      length capped, one wo_events row per save.
--
-- No backfill. Where the column and an issued sheet already disagree (an edit
-- made in the builder after issue), the read-back COUNTS them; the PC card
-- shows staff both texts and the next save settles it. Note the trigger means
-- the next REWRITE of such a sheet (a material or finish-level edit) also
-- carries the column across — the column is the source from here on.
--
-- Converges on a re-run.
-- =============================================================================
set lock_timeout = '15s';

-- ---- 1. the sheet follows the column -----------------------------------------
-- Trigger function: no grant (runs as part of the writer's own statement).
create or replace function public.wo_crew_notes_to_snapshot()
returns trigger language plpgsql set search_path = public as $$
begin
  if jsonb_typeof(new.wo_snapshot) <> 'object' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.crew_notes is distinct from old.crew_notes then
    new.wo_snapshot := jsonb_set(new.wo_snapshot, '{crewNotes}', to_jsonb(coalesce(new.crew_notes, '')), true);
  elsif coalesce(new.crew_notes, '') <> ''
        and (new.wo_snapshot ->> 'crewNotes') is distinct from new.crew_notes then
    new.wo_snapshot := jsonb_set(new.wo_snapshot, '{crewNotes}', to_jsonb(new.crew_notes), true);
  end if;
  return new;
end $$;
revoke all on function public.wo_crew_notes_to_snapshot() from public, anon, authenticated;

drop trigger if exists t_wo_crew_notes_to_snapshot on public.work_orders;
create trigger t_wo_crew_notes_to_snapshot
  before insert or update of crew_notes, wo_snapshot on public.work_orders
  for each row execute function public.wo_crew_notes_to_snapshot();

-- ---- 2. the PC Command door --------------------------------------------------
create or replace function public.wo_set_crew_notes(
  p_work_order_id uuid,
  p_notes text
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_wo    public.work_orders%rowtype;
  v_notes text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;

  v_notes := btrim(coalesce(p_notes, ''));
  if length(v_notes) > 4000 then return 'error:too_long'; end if;

  select * into v_wo from public.work_orders where id = p_work_order_id for update;
  if not found then return 'error:not_found'; end if;
  if v_wo.stage = 'closed' then return 'error:closed'; end if;

  if v_wo.crew_notes is not distinct from v_notes
     and (jsonb_typeof(v_wo.wo_snapshot) is distinct from 'object'
          or (v_wo.wo_snapshot ->> 'crewNotes') is not distinct from v_notes) then
    return 'ok:unchanged';
  end if;

  -- The trigger above would carry a CHANGED column onto the sheet by itself;
  -- the sheet is set here too so that a save of unchanged text still settles
  -- a sheet that disagrees with the column (the card offers exactly that).
  update public.work_orders
     set crew_notes = v_notes,
         wo_snapshot = case when jsonb_typeof(wo_snapshot) = 'object'
                            then jsonb_set(wo_snapshot, '{crewNotes}', to_jsonb(v_notes), true)
                            else wo_snapshot end
   where id = p_work_order_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'crew_notes_edited', auth.uid(), 'staff',
            jsonb_build_object('from_length', length(coalesce(v_wo.crew_notes, '')),
                               'to_length', length(v_notes)));
  return 'ok';
end $$;

revoke execute on function public.wo_set_crew_notes(uuid, text) from public, anon;
grant execute on function public.wo_set_crew_notes(uuid, text) to authenticated;

-- ---- Read-back (compare to the _expect_ values before calling this live) ----
select
  (select count(*) from pg_proc
    where proname = 'wo_set_crew_notes' and pronamespace = 'public'::regnamespace) as fn_present,
  1 as _expect_fn_present,
  (select pg_get_function_identity_arguments(oid) from pg_proc
    where proname = 'wo_set_crew_notes' and pronamespace = 'public'::regnamespace) as args,
  'p_work_order_id uuid, p_notes text' as _expect_args,
  (select prosecdef from pg_proc
    where proname = 'wo_set_crew_notes' and pronamespace = 'public'::regnamespace) as security_definer,
  true as _expect_security_definer,
  has_function_privilege('authenticated', 'public.wo_set_crew_notes(uuid, text)', 'execute') as authenticated_may_execute,
  true as _expect_authenticated_may_execute,
  has_function_privilege('anon', 'public.wo_set_crew_notes(uuid, text)', 'execute') as anon_may_execute,
  false as _expect_anon_may_execute,
  (select count(*) from pg_trigger
    where tgname = 't_wo_crew_notes_to_snapshot' and tgrelid = 'public.work_orders'::regclass) as trigger_present,
  1 as _expect_trigger_present,
  has_function_privilege('authenticated', 'public.wo_crew_notes_to_snapshot()', 'execute') as trigger_fn_callable,
  false as _expect_trigger_fn_callable,
  (select count(*) from public.work_orders
    where jsonb_typeof(wo_snapshot) = 'object'
      and coalesce(crew_notes, '') <> ''
      and (wo_snapshot ->> 'crewNotes') is distinct from crew_notes) as sheets_disagreeing_with_column,
  'informational — settled by the next save or sheet rewrite on each job' as _expect_sheets_disagreeing_with_column;

insert into public._prod_migrations(name) values ('20270244000000_wo_crew_notes_follow.sql') on conflict (name) do nothing;
