-- Step 7: estimates created by the wizard carry source='wizard', so the
-- review queue and the W5 proving-window calibration can find them.
-- 'trade_wizard' is reserved now for the trade-account channel (business
-- inputs §5) so this constraint is touched once, not twice.
--
-- Until this runs, the wizard submit route degrades gracefully: it retries
-- with the old tags ('ai_floorplan' / 'manual') and warns the staff user.

alter table public.estimates drop constraint if exists estimates_source_check;
alter table public.estimates add constraint estimates_source_check
  check (source in ('manual', 'ai_floorplan', 'customer_intake', 'wizard', 'trade_wizard'));
