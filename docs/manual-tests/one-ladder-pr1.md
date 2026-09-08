# One ladder — PR 1 of the tiers plan (8 Sep 2026)

Nothing a customer does changes. What they see: a tier chip on the range card and a
"next step" line that only ever names a target their road can reach.

## The chip and the next line
1. Build a no-plan interior estimate (three taps) and open the editor.
   - The confidence card reads **Confidence score · BRONZE** and *"One step to Silver: Confirm 6 more rooms · Upload your floorplan or paste the listing"* (or similar).
   - It never says "to Gold" on a no-plan job.
2. Confirm every room. The chip turns **SILVER**; the line reads *"One step to Gold: Upload your floorplan or paste the listing"*.
3. Build an exterior estimate. The chip reaches **SILVER** at most and the line never mentions Gold — an estimator signs every exterior job off.
4. Add "Something else on this side → security bars". The line says the item needs a person: remove it, or a person confirms it.

## Settings → Estimates → Tiers & rewards (new)
- Silver from / Gold from (%) and the four band widths — these ARE the tiers.
- Interior / exterior online caps and bars, minimum job.
- Silver and Gold reward lines (Tom's list is the default), and the **Gold "book straight in"** switch — leave it OFF until ~20 Gold desk checks have held in range.
- Save writes three rows: `wizard_bands`, `wizard_policy`, `wizard_rewards`.

## Migration `20270132_wizard_policy_v2_keys`
Strips the dead v1 keys from `wizard_policy` and the duplicate `selfServe*` keys from `scope_editor`. Read-back must return no rows.

## Run
```
npx vitest run lib/wizard/ladder.test.ts
./scripts/c1/run-e2e.sh e2e/customer-journey/ladder.spec.ts e2e/tiers-settings.spec.ts e2e/customer-journey/interior-loop.spec.ts e2e/customer-journey/sides-editor.spec.ts
```
