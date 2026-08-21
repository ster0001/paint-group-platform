-- =============================================================================
-- WO loop — correction to 20260926: derived status must respect issued_at
--
-- Found by verifying the live backfill rather than trusting it. Two gaps:
--
-- 1. wo_derive_status returned 'issued' for pre_start unconditionally. A work
--    order can reach pre_start without ever having been issued (a booking was
--    accepted before the estimate had a saved document), and calling that
--    'issued' would state something untrue on the contractor's own screen.
--    pre_start now reads issued_at exactly as offered does.
--
-- 2. The backfill set `stage` but left `status` alone, so existing rows only
--    became consistent at their next transition. Live check after 20260926 ran:
--    one row sitting at pre_start / draft. Backfilled here, and the invariant
--    (status = wo_derive_status(stage, issued_at)) now holds for every row from
--    the moment this migration lands.
-- =============================================================================

create or replace function public.wo_derive_status(p_stage public.wo_stage, p_issued_at timestamptz)
returns public.wo_status language sql immutable set search_path = public as $$
  select case
    when p_stage = 'closed' then 'complete'::public.wo_status
    -- Not started yet: the document decides whether it is a draft or issued.
    when p_stage in ('offered', 'pre_start') then
      case when p_issued_at is null then 'draft'::public.wo_status
           else 'issued'::public.wo_status end
    else 'in_progress'::public.wo_status   -- in_progress | qa | completion_prep | walkthrough
  end;
$$;

update public.work_orders
   set status = public.wo_derive_status(stage, issued_at)
 where status is distinct from public.wo_derive_status(stage, issued_at);

-- ---- Verification -----------------------------------------------------------
--   select count(*) from work_orders
--    where status is distinct from public.wo_derive_status(stage, issued_at);
--     -> 0, now and after every future transition
