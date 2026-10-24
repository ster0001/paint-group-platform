-- =============================================================================
-- Pre-start gates tick themselves (Tom, 24 Oct 2026 - 6 Fleet St Laverton, 43 Keith St):
--   1. A paint or materials chip counts for the Materials ordered gate once it is OFF the tray -
--      planned on the Supplier lane is enough. Ordered tick is the painter text, not the gate.
--      Materials chips join the gate (they were paint only). Mirrors lib/movements/evaluate.ts gates().
--   2. movements_autotick(job): when a gate is open and there is something behind it (a live chip
--      or a decision), the pre-start item ticks itself (done_by null, event checklist_ticked with
--      auto true). Materials waits for the colours answer, as the tick RPC does. Never unticks.
--   3. Triggers call it: every movement insert, status or job change or delete; every logistics
--      decision; the colours item being answered. A backfill runs it over every offered and
--      pre-start job in the read-back.
-- Converging: or replace, drop trigger if exists, idempotent backfill.
-- =============================================================================
set lock_timeout = '15s';

create or replace function public.movements_gate_paint(p_work_order_id uuid)
returns boolean language sql stable set search_path = public as $$
  select exists (select 1 from public.wo_logistics_decisions d where d.work_order_id = p_work_order_id and d.line = 'paint')
      or not exists (select 1 from public.movements m where m.work_order_id = p_work_order_id and m.kind in ('paint', 'materials')
                        and m.status in ('tray', 'problem'))
$$;
revoke all on function public.movements_gate_paint(uuid) from public, authenticated, anon;

create or replace function public.movements_autotick(p_work_order_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer := 0; v_i record;
begin
  if p_work_order_id is null then return 0; end if;

  if public.movements_gate_paint(p_work_order_id)
     and (exists (select 1 from public.movements m where m.work_order_id = p_work_order_id and m.kind in ('paint', 'materials') and m.status <> 'cancelled')
          or exists (select 1 from public.wo_logistics_decisions d where d.work_order_id = p_work_order_id and d.line = 'paint'))
     and exists (select 1 from public.wo_checklist_items c where c.work_order_id = p_work_order_id and c.phase = 'pre_start'
                   and (c.item_key = 'colours' or c.label = 'Colour schedule finalised') and c.done_at is not null) then
    for v_i in update public.wo_checklist_items set done_at = now(), done_by = null
                where work_order_id = p_work_order_id and phase = 'pre_start' and done_at is null and kind = 'tick' and auto_key is null
                  and (item_key = 'materials' or label = 'Materials ordered')
                returning id, label loop
      insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
        values (p_work_order_id, 'checklist_ticked', auth.uid(), 'system',
                jsonb_build_object('item_id', v_i.id, 'label', v_i.label, 'phase', 'pre_start', 'done', true, 'auto', true,
                                   'why', 'every paint and materials chip is on the board'));
      v_n := v_n + 1;
    end loop;
  end if;

  if public.movements_gate_gear(p_work_order_id)
     and (exists (select 1 from public.movements m where m.work_order_id = p_work_order_id and m.kind in ('equipment_out', 'hire_on') and m.status <> 'cancelled')
          or exists (select 1 from public.wo_logistics_decisions d where d.work_order_id = p_work_order_id and d.line = 'equipment')) then
    for v_i in update public.wo_checklist_items set done_at = now(), done_by = null
                where work_order_id = p_work_order_id and phase = 'pre_start' and done_at is null and kind = 'tick' and auto_key is null
                  and (item_key = 'equipment' or label = 'Equipment movements booked')
                returning id, label loop
      insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
        values (p_work_order_id, 'checklist_ticked', auth.uid(), 'system',
                jsonb_build_object('item_id', v_i.id, 'label', v_i.label, 'phase', 'pre_start', 'done', true, 'auto', true,
                                   'why', 'every gear chip is booked'));
      v_n := v_n + 1;
    end loop;
  end if;
  return v_n;
end $$;
revoke all on function public.movements_autotick(uuid) from public, authenticated, anon;

create or replace function public.movements_autotick_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then perform public.movements_autotick(old.work_order_id); return old; end if;
  perform public.movements_autotick(new.work_order_id);
  if tg_op = 'UPDATE' and old.work_order_id is distinct from new.work_order_id then perform public.movements_autotick(old.work_order_id); end if;
  return new;
end $$;

drop trigger if exists t_movements_autotick on public.movements;
create trigger t_movements_autotick after insert or update of status, kind, work_order_id or delete on public.movements
  for each row execute function public.movements_autotick_trg();
drop trigger if exists t_decisions_autotick on public.wo_logistics_decisions;
create trigger t_decisions_autotick after insert or update or delete on public.wo_logistics_decisions
  for each row execute function public.movements_autotick_trg();

create or replace function public.wo_checklist_colours_autotick_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.phase = 'pre_start' and (new.item_key = 'colours' or new.label = 'Colour schedule finalised')
     and new.done_at is not null and old.done_at is null then
    perform public.movements_autotick(new.work_order_id);
  end if;
  return new;
end $$;
drop trigger if exists t_checklist_colours_autotick on public.wo_checklist_items;
create trigger t_checklist_colours_autotick after update of done_at on public.wo_checklist_items
  for each row execute function public.wo_checklist_colours_autotick_trg();

-- ---- read-back (the backfill runs here): compare to the _expect_ values ------------------
with backfill as (
  select public.movements_autotick(w.id) as n from public.work_orders w where w.stage in ('offered', 'pre_start')
)
select
  (select prosrc like '%''tray''%' from pg_proc where proname = 'movements_gate_paint' limit 1) as gate_off_tray, true as _expect_gate_off_tray,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'movements_autotick') as autotick_fn, 1 as _expect_autotick_fn,
  (select count(*) from pg_trigger where tgname in ('t_movements_autotick', 't_decisions_autotick', 't_checklist_colours_autotick')) as triggers, 3 as _expect_triggers,
  (select coalesce(sum(n), 0) from backfill) as items_ticked_now;

insert into public._prod_migrations(name) values ('20270298000000_prestart_gate_autotick.sql') on conflict (name) do nothing;
