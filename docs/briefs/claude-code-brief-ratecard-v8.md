# Claude Code brief — rate card v8 migration

**For:** `paint-group-platform`
**Prepared:** 20 August 2026
**Evidence:** `docs/briefs/pricing-model-v8-brief.md` (revision 4) — read it before starting
**Type:** data migration + three small code fixes. No new features, no schema changes.

---

## Objective

Move pricing from rate card v7 to v8: raise the two charge-out rates, double the materials markup, raise sundries, correct one production rate, and update the overhead settings to measured values. Ship it as **one numbered migration** so a single event explains any price movement.

## Explicitly out of scope

- **Real estate.** Not a segment. Those jobs stay in the interior/exterior buckets and take the interior rate. Tom has accepted the consequence: real-estate quotes rise about 21%. Do not add a job-type column, a segment selector, or a real-estate rate.
- **Exterior hours.** Measured at 0.979 of actual across 59 jobs. Do not change the exterior correction factor and do not scale exterior production rates.
- **The other four production rates** from an earlier revision (Weatherboards, Standard Cornices, Picture Rails, Flat Door). Withdrawn — they made accuracy worse against real timesheets. Change soffits only.
- **Correction factors** (1.069 / 1.085). Leave as they are.
- **Contractor rate and offer %.** $60 at 100% of estimated hours. Confirmed exact on 531 jobs.

---

## The change

### Settings

| Key | v7 | **v8** | Basis |
|---|---|---|---|
| `Charge-out rate — INTERIOR` | 85 | **95** | realised labour $95.52/hr, 151 jobs |
| `Charge-out rate — EXTERIOR` | 100 | **108** | realised labour $111.11/hr, 59 jobs |
| `Materials markup` | 0.1 | **0.2** | materials 10.5% of revenue, running under budget |
| `Sundries per job — interior` | 275 | **350** | ⚠️ see Decision 1 |
| `Sundries per job — exterior` | 175 | **250** | ⚠️ see Decision 1 |
| `Billable hours per week` | 480 | **445** | measured across 398 accepted jobs, 12 months |
| `Overhead per billable hour` | 10.8333333333333 | **11.69** | 5200 ÷ 445 |
| `Break-even charge-out rate` | 70.8333333333333 | **71.69** | 60 + 11.69 |
| `Labour spread — interior` | 25 | **35** | 95 − 60 |
| `Labour spread — exterior` | 40 | **48** | 108 − 60 |
| `Contribution per hour — INTERIOR` | 14.1666666666667 | **23.31** | 95 − 60 − 11.69 |
| `Contribution per hour — EXTERIOR` | 29.1666666666667 | **36.31** | 108 − 60 − 11.69 |

Every other settings row carries forward unchanged.

### Rate items

**Charge-out**, applied to all rows by category:

- `category = 'Interior'` → `charge_out_cents` 8500 → **9500** (12 rows)
- `category = 'Exterior'` → `charge_out_cents` 10000 → **10800** (26 rows)

⚠️ **Except the Extras/Allowances rows.** `chargeOutCents()` in `lib/pricing/estimate.ts:211` deliberately filters those out of the category lookup because they carry per-item charge-outs (price ÷ hours, set by migration `20260922000000_real_extras_prices.sql`). Do not blanket-update them — confirm which rows are Extras/Allowances and carry their charge-outs forward as they are. If the correct treatment is not obvious from the data, **stop and ask**.

**One production rate**, the only row whose hours change:

| Code | Unit | `rate_1_coat` | `rate_2_coat` | `rate_3_coat` |
|---|---|---|---|---|
| `Soffits / Exterior Ceilings` | M2 | 17.74 → **7.80** | 10.14 → **4.46** | 7.10 → **3.12** |

These follow the card's own marginal-coat rule for quantity-per-hour rows (`r1 = r2 × 1.75`, `r3 = r2 × 0.70`) — the same relationship every other row already satisfies. Basis: 39 work-order lines showing 5.00 m²/hr against the card's 10.14, and it is the only single-row change that moves exterior accuracy toward 1.000 (0.896 → 0.917 on the job-level check).

---

## How to build it

**Versioned, not edited.** `supabase/seed/ratecard_v7.sql` is generated and marked "do not hand-edit", and `CLAUDE.md` says reference data comes from API/seed scripts, never hand-edited SQL inserts. So:

1. Produce **rate card version 8** as a new row in `rate_cards`, with its own `rate_items` copied from v7 and modified as above.
2. `is_active` moves from v7 to v8 **in the same transaction**. v7's rows are never updated or deleted — existing quotes must still resolve their own card.
3. Settings are upserted by key (they are global, not versioned).
4. One numbered file in `supabase/migrations/`, committed even though Tom pastes SQL manually.

If the project's convention is to regenerate the seed from a source workbook rather than write a migration, **stop and report** before writing SQL by hand — that is a real conflict with the repo rules and Tom should choose.

---

## Code fixes to include

**1. `invalidatePricingContext()` is defined and never called** (`lib/pricing/context.ts:39`). Its own comment says "call after writing rates or settings". Wire it into the settings write path (`app/(app)/settings/PricingSettings.tsx:24`) and the rate-item write path (`app/(app)/settings/EditableTable.tsx` via `page.tsx:159`). Without it a rate change rolls out unevenly across serverless instances for up to the 20-second TTL.

**2. Override audit.** Write a script (`scripts/audit-rate-overrides.ts`) that lists every estimate whose `builder_state` carries a non-null `hourlyRateOverride` or `contractorRateOverride`, with estimate id, status, the override value and the estimate total. **Report only — do not mutate anything.** This matters: the largest job in the golden set carries `hourlyRateOverride: 100` and moves 2.6% under v8 while comparable jobs move 14–18%. Tom decides what to do with the list.

**3. Do not fix `rate_card_id` this time.** `estimates.rate_card_id` and `rate_card_version` are written (`app/quote/QuoteBuilder.tsx:645`) but never read — `loadPricingContext()` always loads the active card, so unsent drafts will reprice when v8 goes live. That is a separate decision (Decision 3) and a separate change. Note it in the PR description; do not implement it.

---

## Tests — write these first

Per the repo's testing law, start with the failing specs.

**e2e, as an anonymous customer** (`e2e/customer-journey/`):

1. An estimate sent under v7 and opened at `/e/[token]` **after** v8 is active still shows its v7 prices, from `sent_snapshot`. This is the one that must not break.
2. An issued work order's `wo_snapshot` and `contractor_payment_cents` are unchanged by the migration.

**Unit (Vitest):**

3. `contractorOfferCents === round(contractorHours × 6000 × offerPct)` at v8 rates — and the calibration jobs still land exactly: 69.25 hrs → $4,155 and 84.5 hrs → $5,070.
4. `marginCents === totalCents − contractorOfferCents − ownStaffCents − materialCostCents − passthroughCostCents` at v8 rates.
5. `gstCents === Math.round(netSubtotalCents × 0.1)` and `totalCents === netSubtotalCents + gstCents`.
6. **New, and worth keeping forever:** an estimate with `hourlyRateOverride` set produces the *same* total under v7 and v8 reference data. Pins the behaviour so it can never surprise anyone again.
7. Every returned money field is an integer number of cents (extend the existing check to the v8 fixture).

---

## Expected golden-fixture movement

`lib/pricing/golden.test.ts` **will fail — that is the point.** Regenerate with `scripts/capture-pricing-fixtures.ts` in the same commit and check the diff against these values, which I produced by running `lib/pricing` directly with v8 reference data:

| Case | v7 total (cents) | **v8 total (cents)** | Change |
|---|---|---|---|
| `est-2ba147ef` | 70,283 | **82,990** | +18.1% |
| `est-53c6b411` | 30,250 | **38,500** | +27.3% |
| `est-0dbd7187` | 30,250 | **38,500** | +27.3% |
| `est-428a2af4` | 120,943 | **137,735** | +13.9% |
| `est-bf3b058f` | 323,485 | **371,570** | +14.9% |
| `est-7354be3d` | 1,048,731 | **1,076,216** | +2.6% ← the `hourlyRateOverride` case |

**If a regenerated figure differs from the table above, stop and report it rather than recording the new number.** The two small cases move most because the sundries rise is fixed per job; that is intended. The last case barely moves because it carries a rate override; that is the behaviour test 6 pins.

Verified alongside those totals: integer cents hold, the GST identity holds, no case produces a negative margin, and the contractor offer stays exactly $60.00 per estimated hour.

---

## Acceptance criteria

1. Rate card **v8** inserted; **no `update` or `delete` touches any v7 rate item**; `is_active` flips in the same transaction.
2. Charge-out changes live only in `rate_items.charge_out_cents`. No rate literal appears in engine code, a component, or a script.
3. Extras/Allowances rows keep their per-item charge-outs.
4. Soffits is the **only** row whose `rate_*_coat` values change, and its three columns satisfy `r1 = r2 × 1.75` and `r3 = r2 × 0.70`.
5. All seven tests above pass. The customer-journey suite is green.
6. Golden fixtures regenerated in the same commit, diff matching the table above, with the intended movement stated in the commit message.
7. `invalidatePricingContext()` called from both write paths.
8. `scripts/audit-rate-overrides.ts` runs read-only and produces the list.
9. `docs/ARCHITECTURE.md` gets its paragraph; the migration comment links to `docs/briefs/pricing-model-v8-brief.md`.
10. A manual test script left for Tom: build one interior and one exterior estimate, confirm the totals move roughly +9% and +14%, and confirm a previously sent quote is unchanged.

## Rollback

Flip `is_active` back to v7 and revert the settings upsert. Because v7's rows are untouched, rollback is one transaction. Estimates priced under v8 in the meantime will reprice on next edit unless already sent — call that out in the PR.

---

## Decisions Tom must make — do not invent these

1. **Sundries $350 / $250.** Proposed from the itemised list, not measured against supplier dockets. If Tom has not confirmed them, ship the charge-out and markup changes and leave sundries at $275/$175 — worth about $25,000 a year less.
2. **Billable hours per week 480 → 445.** Changing it makes the settings internally consistent with the measured $11.69 overhead. Keeping 480 as an aspirational target means the overhead figure and the hours figure no longer agree. Tom's call.
3. **Unsent drafts repricing.** Every draft not yet sent will pick up v8 the moment it goes active. Acceptable, or should drafts honour the card version stamped on them? Separate change either way.
4. **What to do with the rate-override list** once the audit script produces it.

## Reference files

- `docs/briefs/pricing-model-v8-brief.md` — revision 4, the evidence for every number here
- `supabase/seed/ratecard_v7.sql` — settings block lines 9–33; rate items from line 171
- `supabase/migrations/20260922000000_real_extras_prices.sql` — how Extras got per-item charge-outs
- `lib/pricing/engine.ts` — order of operations; contractor offer step 14; margin step 15
- `lib/pricing/estimate.ts` — `resolveRates()` line 157; `chargeOutCents()` line 211; GST line 407
- `lib/pricing/context.ts` — `loadPricingContext()`, 20s cache, `invalidatePricingContext()` line 39
- `lib/pricing/__fixtures__/golden-estimates.json` · `golden.test.ts`
- `scripts/capture-pricing-fixtures.ts` — fixture regeneration
- `app/(app)/settings/PricingSettings.tsx` · `page.tsx` — the settings and rate-item write paths
- `CLAUDE.md` — one pricing module; integer cents; one numbered migration per change; testing law
