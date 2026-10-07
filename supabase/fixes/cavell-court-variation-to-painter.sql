-- 12A Cavell Court (PS-3156), 7 Oct 2026 — put the signed change in front of Qudrat.
--
-- Jayne signed the revision change at 09:02 on 7 Oct (Melbourne). Migration
-- 20270220 — "a painter on the job is asked, not told" — went live on
-- production at 19:45 the same day, so the row took the old path and landed
-- contractor_accepted with no answer from him. His own request (de5b7641)
-- was never joined to it and still reads "with the office".
--
-- This puts the signed row back to customer_approved + released (what the
-- sign RPC does now), so his portal shows "Variation approved by the client"
-- with Accept / Decline; and retires his duplicate request against it so the
-- console stops asking for a price. Then press "Remind the painter" on the
-- variation card of PS-3156 — it emails him (he has no mobile on file).
--
-- Converges on a re-run (every statement is guarded by the state it expects).
set lock_timeout = '15s';

update public.wo_variations
   set status = 'customer_approved', contractor_accepted_at = null
 where id = '53f53032-8f0c-4aab-9243-0d6922f09a4f'
   and status = 'contractor_accepted' and contractor_declined_at is null;

insert into public.wo_events (work_order_id, type, actor_kind, meta)
select '5c9df5c9-d3e6-4f89-b5f5-53cff88dcae2', 'variation_sent_to_painter', 'system',
       jsonb_build_object('variation_id', '53f53032-8f0c-4aab-9243-0d6922f09a4f', 'hours', 3.5,
                          'contractor_delta_cents', 24500, 'repair', 'cavell-court-variation-to-painter.sql')
where not exists (
  select 1 from public.wo_events
   where work_order_id = '5c9df5c9-d3e6-4f89-b5f5-53cff88dcae2' and type = 'variation_sent_to_painter'
     and meta->>'variation_id' = '53f53032-8f0c-4aab-9243-0d6922f09a4f');

-- His raised request is the same ask, priced as the row above (the office
-- opened the builder before the link existed). Retire it against that row.
update public.wo_variations
   set status = 'cancelled',
       declined_reason = 'Priced in the working scope as variation 53f53032 (Front Side — added Render)'
 where id = 'de5b7641-7af5-4e99-8145-5724132d41b4' and status = 'raised';

-- read-back: expect customer_approved / released / not accepted, and the request cancelled
select id, status, released_at is not null as released, contractor_accepted_at, declined_reason
  from public.wo_variations
 where id in ('53f53032-8f0c-4aab-9243-0d6922f09a4f', 'de5b7641-7af5-4e99-8145-5724132d41b4');
