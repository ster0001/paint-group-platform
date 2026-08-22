-- A note from site. It lands on the job's own event log rather than a separate
-- inbox, so the office reads it beside the ticks and photos that surround it —
-- and the completion report already renders from that log.
create or replace function public.wo_add_note(
  p_work_order_id uuid, p_note text, p_area text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_kind text; v_cid uuid;
begin
  if coalesce(trim(p_note), '') = '' then return 'error:empty'; end if;

  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;

  if public.is_staff() then
    v_kind := 'staff';
  else
    v_cid := public.current_contractor_id();
    if v_cid is null or v_wo.contractor_id is distinct from v_cid then return 'error:not_yours'; end if;
    v_kind := 'contractor';
  end if;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'note', auth.uid(), v_kind,
            jsonb_build_object('note', trim(p_note), 'area', coalesce(p_area, '')));

  return 'ok:noted';
end $$;
grant execute on function public.wo_add_note(uuid, text, text) to authenticated;
