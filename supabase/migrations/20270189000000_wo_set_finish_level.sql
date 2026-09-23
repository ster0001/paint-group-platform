-- =============================================================================
-- Correcting the level of finish on an issued job sheet (Tom, 23 Sep 2026)
--
-- "I am trying to schedule and have updated the level in the revise working
-- scope - but it is still coming up as a level 3, even though its a level 2."
--
-- It was still coming up as Level 3 because nothing could ever have changed it.
-- work_orders.wo_snapshot is written from the accepted estimate's
-- builder_state->'woDoc' in exactly two places — 20260901 when acceptance
-- creates the work order, 20260904 when staff issue it — and that estimate is
-- frozen by estimate_frozen_guard (20261116). The revision builder writes
-- wo_working_scopes.working_state, and NO variation RPC has ever written
-- wo_snapshot. So the money moved through a variation and the painter's sheet
-- went on saying PG-3: full prep, filled, sanded, sealed and caulked, on a job
-- sold as PG-2 light sand and spot prime.
--
-- Same shape as wo_set_material (20261231), and for the same reason: the
-- contractor reads the SNAPSHOT, so an office correction has to land there or
-- it may as well not have happened.
--
-- Deliberately NOT in this function:
--   * money. The level multiplier is priced through the revision builder and
--     signed as a variation — that is what keeps "accepted + Σ signed
--     variations" reconciling to the cent. This changes the DOCUMENT: what the
--     painter is held to. Two different questions, two different doors.
--   * estimates.level_of_finish / builder_state. The accepted estimate is the
--     signed record of what was priced, and it stays frozen.
--
-- Idempotent and safe to re-run; converges on a second paste.
-- =============================================================================

set lock_timeout = '15s';

create or replace function public.wo_set_finish_level(
  p_work_order_id uuid,
  p_modifier_code text          -- FIN-2 | FIN-3 | FIN-4
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_wo    public.work_orders%rowtype;
  v_code  text;
  v_pg    text;
  v_label text;
  v_areas jsonb;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;

  select * into v_wo from public.work_orders where id = p_work_order_id for update;
  if not found then return 'error:not_found'; end if;
  if v_wo.stage = 'closed' then return 'error:closed'; end if;
  if v_wo.wo_snapshot is null then return 'error:not_issued'; end if;

  v_code := upper(coalesce(trim(p_modifier_code), ''));

  -- FIN-1 is refused, not mapped. It has no PG equivalent on purpose
  -- (lib/workorder/finish.ts, note 2): calling a FIN-1 job "PG-2" would hold a
  -- contractor to more prep than the customer paid for. A guard that cannot
  -- name its target refuses.
  if v_code not in ('FIN-2', 'FIN-3', 'FIN-4') then return 'error:bad_level'; end if;
  v_pg := 'PG-' || split_part(v_code, '-', 2);

  -- The human label comes off the rate card, never off the wire, so the sheet
  -- reads exactly what the estimator's own dropdown reads. modifiers.code is
  -- globally unique (20260813010000).
  select regexp_replace(coalesce(label, ''), '\s*\(×[^)]*\)\s*$', '')
    into v_label
    from public.modifiers where code = v_code;
  if coalesce(trim(v_label), '') = '' then return 'error:no_such_level'; end if;

  -- Every area that never carried an override of its own follows the job down.
  -- An overridden area keeps its code, but `finishOverridden` is recomputed
  -- against the NEW job level, so an override that now agrees with the job
  -- stops being flagged as a difference. Mirrors applyFinishLevelEdit() and
  -- computeWorkOrderParts()'s own expression.
  select coalesce(jsonb_agg(
    a || jsonb_build_object(
      'finishCode',
      case when coalesce((a ->> 'finishOverridden')::boolean, false)
           then coalesce(a ->> 'finishCode', v_pg) else v_pg end,
      'finishOverridden',
      coalesce((a ->> 'finishOverridden')::boolean, false)
        and coalesce(a ->> 'finishCode', v_pg) <> v_pg)
    order by ord), '[]'::jsonb)
  into v_areas
  from jsonb_array_elements(coalesce(v_wo.wo_snapshot -> 'areas', '[]'::jsonb))
       with ordinality as t(a, ord);

  update public.work_orders
     set wo_snapshot = jsonb_set(
           jsonb_set(
             jsonb_set(wo_snapshot, '{levelOfFinish}', to_jsonb(v_label), true),
             '{finishCode}', to_jsonb(v_pg), true),
           '{areas}', v_areas, true)
   where id = p_work_order_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'finish_level_edited', auth.uid(), 'staff',
            jsonb_build_object(
              'from_code', v_wo.wo_snapshot ->> 'finishCode',
              'from_label', v_wo.wo_snapshot ->> 'levelOfFinish',
              'to_modifier', v_code, 'to_code', v_pg, 'to_label', v_label));

  return 'ok';
end $$;

revoke execute on function public.wo_set_finish_level(uuid, text) from public, anon;
grant execute on function public.wo_set_finish_level(uuid, text) to authenticated;

-- ---- Read-back (compare to the _expect_ values before calling this live) ----
select
  (select count(*) from pg_proc
    where proname = 'wo_set_finish_level' and pronamespace = 'public'::regnamespace) as fn_present,
  1 as _expect_fn_present,
  (select pg_get_function_identity_arguments(oid) from pg_proc
    where proname = 'wo_set_finish_level' and pronamespace = 'public'::regnamespace) as args,
  'p_work_order_id uuid, p_modifier_code text' as _expect_args,
  (select prosecdef from pg_proc
    where proname = 'wo_set_finish_level' and pronamespace = 'public'::regnamespace) as security_definer,
  true as _expect_security_definer,
  (select has_function_privilege('authenticated', oid, 'execute') from pg_proc
    where proname = 'wo_set_finish_level' and pronamespace = 'public'::regnamespace) as authenticated_may_execute,
  true as _expect_authenticated_may_execute,
  (select has_function_privilege('anon', oid, 'execute') from pg_proc
    where proname = 'wo_set_finish_level' and pronamespace = 'public'::regnamespace) as anon_may_execute,
  false as _expect_anon_may_execute,
  (select count(*) from public.modifiers where code in ('FIN-2', 'FIN-3', 'FIN-4')) as levels_on_rate_card,
  3 as _expect_levels_on_rate_card;

insert into public._prod_migrations(name) values ('20270189000000_wo_set_finish_level.sql') on conflict (name) do nothing;
