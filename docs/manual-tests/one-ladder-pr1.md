# Manual test — C1, one ladder (11 Sep 2026)

Run after migrations `20270135` (the ledger) and `20270132` (the dead-key strip) are live.

## The confidence card, in both editors

1. Build an interior estimate from the wizard without a floorplan.
   - The confidence card reads **Confidence score · GUIDE** and *"One step to Detailed: Confirm 6 more rooms · Upload your floorplan or paste the listing"* (or similar).
   - It never says "to Confirmed" on a no-plan job.
2. Confirm every room. The chip turns **DETAILED**; the line reads *"One step to Confirmed: Upload your floorplan or paste the listing"*.
3. Build an exterior estimate. The chip reaches **DETAILED** at most and the line never mentions Confirmed — an estimator signs every exterior job off.

The three tiers are accuracy labels — how much we know about the job. They are not a
status the customer earns and nothing is given away at any of them (ruling G).

## Settings → Estimates → Accuracy tiers & online cap (new)

- **Detailed from / Confirmed from (%)** and the three band widths — these ARE the tiers.
- Interior/exterior cap ($) and bar (%), plus the minimum job.
- Save writes two rows: `wizard_bands` and `wizard_policy`. It must NOT write `wizard_rewards` —
  that key was removed with the reward tiers.

## The point of the chunk — audit 9.2

Change **Interior cap ($)** to `5000` and save. Open a **$5,500** interior estimate as a customer:

- the accept button is gone on the **scope page**,
- and gone in the **assistant** (ask it "can I accept this online?"),
- and the **edit route** agrees.

Before C1 those three re-derived the cap from `scope_editor.selfServe*` with their own
hard-coded fallbacks, so the Settings change moved one and left two behind. Put the cap
back to `6000` afterwards.

## Audit 9.5 — the same site, asked two ways

As a **trade** account, build a commercial estimate two ways: answer the *kind* question
with "strata", then answer the *segment* question with "strata". Both must give the same
outcome — the visit tier, not a hard hand-off. Repeat with healthcare.

A gate the customer answers themselves (working at height, access equipment, out of hours,
staged work) still hands off for everyone — a boom lift costs the same on a trade account.
