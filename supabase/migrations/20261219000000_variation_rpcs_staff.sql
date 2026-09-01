-- Tom's 1 Sep batch: "Painter's view doesn't work" — half of it was the two
-- contractor variation RPCs refusing staff. The as-contractor mirror page
-- (/pc/wo/[id]/as-contractor) renders the painter's own Variations component,
-- whose accept/acknowledge actions call these; for a staff session
-- current_contractor_id() is null so every press answered 'error:not_yours'
-- ("That job isn't yours."). Every sibling RPC (wo_tick_surface,
-- wo_tick_checklist_item, wo_raise_variation…) branches on is_staff() first —
-- these two now do the same, recording the actor honestly as 'staff'.
--
-- Bodies copied faithfully from their newest definitions —
-- wo_contractor_accept_variation from 20261002000000_wo_variations_flow.sql,
-- wo_contractor_acknowledge_variation from
-- 20261116000000_variation_signature_working_scope.sql — with ONLY the
-- actor branch added.

create or replace function public.wo_contractor_accept_variation(p_variation_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_v public.wo_variations%rowtype; v_wo public.work_orders%rowtype; v_cid uuid; v_kind text;
begin
  select * into v_v from public.wo_variations where id = p_variation_id for update;
  if not found then return 'error:not_found'; end if;
  select * into v_wo from public.work_orders where id = v_v.work_order_id;

  if public.is_staff() then
    v_kind := 'staff';
  else
    v_cid := public.current_contractor_id();
    if v_cid is null or v_wo.contractor_id is distinct from v_cid then return 'error:not_yours'; end if;
    v_kind := 'contractor';
  end if;

  -- Both approvals, in order, or nothing.
  if v_v.status <> 'customer_approved' or v_v.customer_responded_at is null then
    return 'error:customer_not_approved';
  end if;
  if v_v.released_at is null then return 'error:not_released'; end if;

  update public.wo_variations
     set status = 'contractor_accepted', contractor_accepted_at = now()
   where id = p_variation_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_v.work_order_id, 'variation_contractor_accepted', auth.uid(), v_kind,
            jsonb_build_object('variation_id', p_variation_id,
                               'contractor_delta_cents', v_v.contractor_delta_cents,
                               'hours', v_v.est_hours));

  return 'ok:accepted';
end $$;
grant execute on function public.wo_contractor_accept_variation(uuid) to authenticated;

create or replace function public.wo_contractor_acknowledge_variation(p_variation_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_v public.wo_variations%rowtype; v_wo public.work_orders%rowtype; v_cid uuid; v_kind text;
begin
  select * into v_v from public.wo_variations where id = p_variation_id for update;
  if not found then return 'error:not_found'; end if;
  select * into v_wo from public.work_orders where id = v_v.work_order_id;

  if public.is_staff() then
    v_kind := 'staff';
  else
    v_cid := public.current_contractor_id();
    if v_cid is null or v_wo.contractor_id is distinct from v_cid then return 'error:not_yours'; end if;
    v_kind := 'contractor';
  end if;

  if not v_v.credit then return 'error:not_a_credit'; end if;
  if v_v.status <> 'customer_approved' or v_v.customer_responded_at is null then
    return 'error:customer_not_approved';
  end if;
  if v_v.needs_manual_deduction and v_v.deduction_cents is null then
    return 'error:awaiting_pc_deduction';
  end if;

  update public.wo_variations
     set status = 'contractor_accepted',
         contractor_accepted_at = now(),
         contractor_acknowledged_at = now()
   where id = p_variation_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_v.work_order_id, 'variation_contractor_acknowledged', auth.uid(), v_kind,
            jsonb_build_object('variation_id', p_variation_id,
                               'contractor_delta_cents', v_v.contractor_delta_cents,
                               'deduction_cents', v_v.deduction_cents,
                               'hours', v_v.est_hours));
  return 'ok:acknowledged';
end $$;
grant execute on function public.wo_contractor_acknowledge_variation(uuid) to authenticated;

-- ---- readback -------------------------------------------------------------
-- Expect 2 rows, both secdef, both mentioning is_staff in their source.
select p.proname, p.prosecdef as security_definer,
       position('is_staff' in pg_get_functiondef(p.oid)) > 0 as staff_branch
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('wo_contractor_accept_variation', 'wo_contractor_acknowledge_variation')
 order by p.proname;
