-- =============================================================================
-- The walkthrough can start before the quality check, from either side (Tom, 23 Oct 2026).
-- 20270284 let a job parked at qa be walked; the office still saw no Start button at
-- completion_prep or in_progress and the painter none at completion_prep. Now
-- wo_start_walkthrough_mode takes a job from in_progress (office only — the stage table
-- lets staff move a job straight to the walkthrough), completion_prep (both, once the prep
-- list is ticked) or qa, delivers the pack and opens the session. A gate refusal (prep items
-- still to tick, a colour match outstanding) comes back in its words. Re-emitted from
-- 20270284 with that one condition; converging.
-- =============================================================================
set lock_timeout = '15s';

create or replace function public.wo_start_walkthrough_mode(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_w public.work_orders%rowtype; v_cid uuid; v_token text; v_r text; v_open integer;
begin
  select * into v_w from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;

  v_cid := public.current_contractor_id();
  if not (public.is_staff() or (v_cid is not null and v_cid = v_w.contractor_id)) then
    return 'error:not_yours';
  end if;

  -- Tom, 21 Oct 2026: a job waiting at qa for a check that has not passed can
  -- still be walked. The pack goes out the way a passed check sends it (stage
  -- to walkthrough, sign-off row, customer token); the check stays open for
  -- the office. A gate refusal (colour-match codes) comes back in its words.
  -- Tom, 23 Oct 2026: the same from completion_prep (the painter has finished
  -- and ticked the prep list) and, for the office, from in_progress — the
  -- stage table lets staff move a job straight to the walkthrough; a painter
  -- ticks every surface first, as before.
  if v_w.stage = 'in_progress' and not public.is_staff() then return 'error:surfaces_first'; end if;
  if v_w.stage in ('in_progress', 'completion_prep', 'qa') then
    v_open := public.wo_qa_open_count(p_work_order_id);
    v_r := public.wo_deliver_evidence_pack(p_work_order_id);
    if v_r not like 'ok:%' then return v_r; end if;
    insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
      values (p_work_order_id, 'walkthrough_before_qa', auth.uid(),
              case when public.is_staff() then 'staff' else 'contractor' end,
              jsonb_build_object('open_checks', v_open, 'from_stage', v_w.stage::text));
    select * into v_w from public.work_orders where id = p_work_order_id;
  end if;
  if v_w.stage is distinct from 'walkthrough' then return 'error:not_at_walkthrough'; end if;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  update public.wo_signoff
     set walkthrough_session_token = v_token,
         walkthrough_session_expires_at = now() + interval '2 hours'
   where work_order_id = p_work_order_id and signed_at is null;
  if not found then return 'error:no_signoff_row'; end if;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'walkthrough_mode_started', auth.uid(),
            case when public.is_staff() then 'staff' else 'contractor' end,
            jsonb_build_object('expires_at', now() + interval '2 hours'));
  return 'ok:' || v_token;
end $$;
revoke execute on function public.wo_start_walkthrough_mode(uuid) from public, anon;
grant execute on function public.wo_start_walkthrough_mode(uuid) to authenticated;

-- ---- read-back: compare to the _expect_ values before calling this live ------------------
select
  (select prosrc like '%if v_w.stage in (''in_progress'', ''completion_prep'', ''qa'') then%' from pg_proc where proname = 'wo_start_walkthrough_mode' limit 1) as starts_from_three_stages, true as _expect_starts_from_three_stages,
  (select prosrc like '%error:surfaces_first%' from pg_proc where proname = 'wo_start_walkthrough_mode' limit 1) as painter_ticks_first, true as _expect_painter_ticks_first,
  has_function_privilege('authenticated', 'public.wo_start_walkthrough_mode(uuid)', 'execute') as granted, true as _expect_granted;

insert into public._prod_migrations(name) values ('20270295000000_walkthrough_start_from_any_stage.sql') on conflict (name) do nothing;
