-- =============================================================================
-- WO completion loop, step 1 — the §2 business decisions, as settings
--
-- Every value the brief flagged ⚑ lands here with its stated default, so none of
-- them is ever hard-coded into a screen and none of them ships as an invented
-- answer. One key holding an object, the wizard_policy convention.
--
-- TWO OF THESE DEFAULTS DIFFER FROM THE BRIEF, on Tom's instruction (21 Aug):
--
--   signoff.clockEnabled  = true   — the clock and the nudge ladder may run.
--   signoff.deemedEnabled = FALSE  — deemed sign-off does NOT execute. The
--     brief defaults it on at 72h; the same brief flags the clause for legal
--     review (ACL / unfair contract terms). Until that review passes, a job
--     waits at walkthrough for a human signature, and — this is the part that
--     matters — while deemedEnabled is false the nudge copy is a plain reminder
--     and must not mention deemed signing or automatic payment-due. Step 5
--     enforces that in the copy, and its test asserts it.
--
-- Ranking (⚑8) is deliberately NOT here: severity order is behaviour, not a
-- business value, and a console that ranks by a settings key nobody ever edits
-- is just indirection.
-- =============================================================================

insert into public.settings (key, value) values ('wo_loop', jsonb_build_object(
  -- ⚑1 QA cadence for new contractors
  'qaCadence', jsonb_build_object(
    'newContractorJobs', 3,
    'checks', jsonb_build_array('day_one', 'final'),
    'establishedContractors', false),

  -- ⚑2 who releases the adjusted offer once the customer approves a variation
  'variationRelease', 'pc',                 -- 'pc' | 'auto'

  -- ⚑3 rubbish + equipment courier
  'rubbish', jsonb_build_object('organisedBy', 'pc', 'costedToJob', true),

  -- ⚑4 warranty starts on the sign-off date, deemed included
  'warrantyStart', 'signoff_date',

  -- ⚑5 photo minimums. A thin record does not BLOCK a QA pass, it flags it.
  'photoMinimums', jsonb_build_object(
    'beforePerArea', 1,
    'perQaCheck', 3,
    'thinRecordBlocksQa', false),

  -- ⚑6 the sign-off clock, split into two switches
  'signoff', jsonb_build_object(
    'clockEnabled', true,
    'deemedEnabled', false,
    'residentialHours', 72,
    'commercialHours', 120,
    'nudgeHours', jsonb_build_array(0, 24, 48)),

  -- ⚑7 what a breached offer SLA offers the console
  'offerSla', jsonb_build_object('breachAction', 'reoffer', 'notifyLapsedContractor', true),

  -- console thresholds (§6.1)
  'coloursWarnDays', 5,
  'variationCustomerSilentHours', 24,

  -- ⚑9 where the deposit tile reads from until invoicing exists
  'depositSource', 'estimate_acceptance'
))
on conflict (key) do nothing;

-- ---- Verification -----------------------------------------------------------
--   select value->'signoff' from settings where key = 'wo_loop';
--     -> {"clockEnabled": true, "deemedEnabled": false, "residentialHours": 72, …}
