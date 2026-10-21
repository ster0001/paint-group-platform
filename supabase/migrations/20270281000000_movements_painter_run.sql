-- =============================================================================
-- Movements, Session 5 (build plan docs/briefs/movements-build-plan.md): Day run plans,
-- the texts, the painter side. Brief docs/briefs/claude-code-brief-pc-movements.md §3.4
-- (Day), §3.5 (order step → painter alert, run plan send).
--
-- Two small things the screens need from the database:
--
--   1. movements_for_painter gains from_branch_id / to_branch_id. The painter job sheet
--      shows the shops address and phone (Navigate + Call) and the order reference; the
--      rendered from_text carries the address but not the phone, and matching on text is
--      not a key. The branch columns a painter may see are still only those
--      supplier_branches_for_painter returns (id, brand, branch, address, suburb, phone,
--      opens_weekday, map_place_id) — never the account table.
--
--   2. movement_record_alert: the server marks WHEN the painter (or the client) was told,
--      after the text actually went out through the automations dispatcher. The columns
--      exist since 20270279 (painter_alerted_at, client_notified_at) and were left null
--      because the alerts are Session 5. No client grant: the sweep and the server
--      actions call it with the service role, which is the only role with EXECUTE by
--      default since 20270201.
--
-- Converges on a re-run: the function is dropped before it is re-created (its return
-- table changes shape, which create or replace refuses), the other is or replace.
-- =============================================================================
set lock_timeout = '15s';

-- ---- 1. the painter read carries the branch ids ----------------------------------------
drop function if exists public.movements_for_painter(uuid, date);
create or replace function public.movements_for_painter(p_work_order_id uuid default null, p_day date default null)
returns table (id uuid, work_order_id uuid, kind public.movement_kind, source_key text, title text, detail text, status public.movement_status,
               due_date date, half text, "time" time, sequence integer, from_kind public.place_kind, from_branch_id uuid, from_text text,
               to_kind public.place_kind, to_branch_id uuid, to_text text,
               order_ref text, note text, lines jsonb, ordered_at timestamptz, painter_confirmed_at timestamptz, run_plan_sent_at timestamptz, mine boolean)
language sql stable security definer set search_path = public as $$
  select m.id, m.work_order_id, m.kind, m.source_key, m.title, m.detail, m.status, m.due_date, m.half, m.time, m.sequence,
         m.from_kind, m.from_branch_id, m.from_text, m.to_kind, m.to_branch_id, m.to_text, m.order_ref,
         case when m.painter_visible then m.note else '' end as note,
         m.lines, m.ordered_at, m.painter_confirmed_at, m.run_plan_sent_at,
         (m.assignee_kind = 'person' and m.assignee_table = 'contractors' and m.assignee_id = public.current_contractor_id()) as mine
    from public.movements m
   where public.current_contractor_id() is not null
     and m.status not in ('cancelled')
     and ((m.assignee_kind = 'person' and m.assignee_table = 'contractors' and m.assignee_id = public.current_contractor_id())
          or (m.work_order_id is not null and public.wo_is_my_job_as_contractor(m.work_order_id)))
     and (p_work_order_id is null or m.work_order_id = p_work_order_id)
     and (p_day is null or m.due_date = p_day)
   order by m.due_date nulls last, m.sequence nulls last, m.time nulls last, m.created_at
$$;
revoke all on function public.movements_for_painter(uuid, date) from public, anon;
grant execute on function public.movements_for_painter(uuid, date) to authenticated;

-- ---- 2. the server records that an alert went out ----------------------------------------
-- p_target: painter (pickup ready / delivery booked) or client (the per-movement
-- delivery notice, ruling 11). Service role only — no grant.
create or replace function public.movement_record_alert(p_id uuid, p_target text)
returns text language plpgsql security definer set search_path = public as $$
declare m public.movements%rowtype;
begin
  if p_target not in ('painter', 'client') then return 'error:bad_target'; end if;
  select * into m from public.movements where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if p_target = 'painter' then
    update public.movements set painter_alerted_at = coalesce(painter_alerted_at, now()) where id = p_id;
  else
    update public.movements set client_notified_at = coalesce(client_notified_at, now()) where id = p_id;
  end if;
  perform public.movements_event(m.work_order_id, 'movement_alerted', jsonb_build_object('movement_id', p_id, 'target', p_target, 'kind', m.kind::text));
  return 'ok:' || p_target;
end $$;
revoke all on function public.movement_record_alert(uuid, text) from public, authenticated, anon;

-- ---- read-back: compare to the _expect_ values before calling this live ------------------
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'movements_for_painter'
      and pg_get_function_result(p.oid) like '%from_branch_id uuid%' and pg_get_function_result(p.oid) like '%run_plan_sent_at%') as painter_read_with_branches, 1 as _expect_painter_read_with_branches,
  has_function_privilege('authenticated', 'public.movements_for_painter(uuid, date)', 'execute') as painter_read_granted, true as _expect_painter_read_granted,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'movement_record_alert') as record_alert, 1 as _expect_record_alert,
  has_function_privilege('authenticated', 'public.movement_record_alert(uuid, text)', 'execute') as record_alert_client_callable, false as _expect_record_alert_client_callable,
  has_function_privilege('service_role', 'public.movement_record_alert(uuid, text)', 'execute') as record_alert_service_callable, true as _expect_record_alert_service_callable;

insert into public._prod_migrations(name) values ('20270281000000_movements_painter_run.sql') on conflict (name) do nothing;
