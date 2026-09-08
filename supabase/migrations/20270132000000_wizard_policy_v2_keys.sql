-- One ladder (PR 1 of docs/briefs/reward-tiers-plan.md, 8 Sep 2026).
--
-- Two settings rows carried keys nothing reads any more:
--   · wizard_policy still held the v1 ladder (minAccuracyPctToAccept,
--     smallJobMinAccuracyPct, smallJobThresholdCents, walkthroughAlwaysAboveCents)
--     — policy.ts v2 (19 Aug) ignores them and falls back to its defaults;
--   · scope_editor carried selfServeInteriorCapCents / selfServeExteriorCapCents /
--     selfServeMinAccuracy — a second copy of the caps that three call sites
--     re-applied on top of evaluateGuardrails. lib/wizard/ladder.ts is now the
--     only reader of the decision, and reads wizard_policy alone.
-- This strips the dead keys so the new Settings screen shows what is real.
-- Nothing is added: absent v2 keys mean the defaults, exactly as before.

update public.settings
   set value = value - 'minAccuracyPctToAccept' - 'smallJobMinAccuracyPct'
                     - 'smallJobThresholdCents' - 'walkthroughAlwaysAboveCents',
       updated_at = now()
 where key = 'wizard_policy';

update public.settings
   set value = value - 'selfServeInteriorCapCents' - 'selfServeExteriorCapCents' - 'selfServeMinAccuracy',
       updated_at = now()
 where key = 'scope_editor';

-- Read-back — expect no row to still carry any of the seven keys.
select key, value
  from public.settings
 where key in ('wizard_policy', 'scope_editor')
   and (value ?| array['minAccuracyPctToAccept','smallJobMinAccuracyPct','smallJobThresholdCents','walkthroughAlwaysAboveCents',
                       'selfServeInteriorCapCents','selfServeExteriorCapCents','selfServeMinAccuracy']);
