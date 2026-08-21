# Pricing cross-check — PaintScout live quotes vs paint-group-platform v7 model

**Prepared:** 20 August 2026
**Sources:** 50 most recently updated PaintScout quotes (live, via Zapier MCP) · `paint-group-platform` on your MacBook — `lib/pricing/engine.ts`, `lib/pricing/estimate.ts`, `supabase/seed/ratecard_v7.sql`
**All money AUD. Ex-GST unless stated.**

---

## The headline

Your exterior rate is right. Your interior rate is set below what you have actually been charging, and because the contractor is paid a flat $60/hr regardless, that difference comes almost entirely out of your margin.

| | v7 model | What PaintScout shows you doing | Gap |
|---|---|---|---|
| Interior charge-out | **$85/hr** | median **$90/hr** on interior-labelled quotes; **$100/hr on 29 of 50 quotes** overall | $5–15/hr low |
| Exterior charge-out | **$100/hr** | median **$100/hr** | matched |
| Contractor | $60/hr × all estimated hours | $60/hr (verified against jobs 3140 and 3108) | matched |
| Materials markup | 10% | materials run 14.3% of job value (range 2.3–25.4%) | consistent |
| GST | 10%, always applied | 10% on 49 of 50 — **one accepted quote went out at 0%** | see Decision 3 |

**Repricing your last 36 costed quotes at v7 rates: $312,025 → $275,669. A gap of $36,356, or −11.7%.**

That figure assumes every generically-labelled "Painting Quote" (33 of 50) is interior work. It is the single biggest assumption in this document, and it swings the answer hard:

| If generic quotes price at | Portfolio effect |
|---|---|
| $85/hr (all interior) | **−11.7%** (−$36,356) |
| $90/hr | −8.8% (−$27,611) |
| $95/hr | −6.0% (−$18,867) |
| $100/hr | −3.2% (−$10,122) |

---

## 1. Rate consistency

PaintScout has your hourly rate set to **seven different values** across 50 quotes:

| Rate | Quotes |
|---|---|
| $100/hr | 29 |
| $85/hr | 7 |
| $90/hr | 6 |
| $95/hr | 5 |
| $110/hr | 1 |
| $98/hr | 1 |
| $87/hr | 1 |

$100 is what you actually do — 58% of quotes, and it holds on the big ones. The v7 model replaces this spread with exactly two numbers (interior $85, exterior $100) set per rate item in `rate_items.charge_out_cents`, so a mixed job blends automatically. That is a real improvement: the spread above is not strategy, it is drift.

The problem is which two numbers. Setting interior at $85 makes the most common thing you quote cheaper than you have been selling it.

## 2. Realised rate vs charge rate

What you actually achieve per hour, including materials:

- **Median realised: $113.11/hr** (mean $115.99, range $92–$201)
- Median implied labour charge-out: **$96.89/hr**

Split by job-size band — the same bands the v7 SIZE modifier uses:

| Band | n | Median implied charge-out | Margin over $60 contractor |
|---|---|---|---|
| Under $10k | 24 | $95.60/hr | 37.2% |
| $10–20k | 10 | $94.08/hr | 36.2% |
| Over $20k | 2 | $116.38/hr | 48.4% |

**The structural point.** Because the contractor offer is $60 × *all* estimated hours, your gross labour margin is fixed by the charge-out rate alone:

| | Contractor share | Gross labour margin | Less $10.83 overhead |
|---|---|---|---|
| v7 interior $85 | 70.6% | 29.4% ($25/hr) | **$14.17/hr** |
| v7 exterior $100 | 60.0% | 40.0% ($40/hr) | **$29.17/hr** |
| Your current ~$96 median | 37.5% | | ~$25/hr |

The SIZE, FINISH, CONDITION and ACCESS modifiers **cannot fix this**. They multiply hours, and hours drive both your revenue and the contractor's pay in lockstep. A 1.17× size modifier on a large job scales the dollars but leaves the ratio at 29.4%. Only the charge-out rate moves the ratio.

Worked example — 100 base hours, interior, Level 3 finish, $10–20k job (SIZE-M 1.05):

| Rate | Hours | Labour | Contractor | Gross | After overhead |
|---|---|---|---|---|---|
| v7 $85 | 105 | $8,925 | $6,300 | $2,625 | **$1,488** |
| Your interior median $90 | 105 | $9,450 | $6,300 | $3,150 | $2,013 |
| Your most-used $100 | 105 | $10,500 | $6,300 | $4,200 | $3,063 |

At $85 interior you keep $14.17 of every hour after overhead. Break-even is $70.83. You are running on a $14 buffer per hour on your highest-volume work.

## 3. Win rate by price point

This is the part that changes the argument, and the sample is small enough that I want to be plain about it: **14 decided quotes** (8 accepted, 6 declined).

| Rate set | Accepted | Declined | Win rate |
|---|---|---|---|
| $100/hr | 4 | 3 | 57% |
| $95/hr | 1 | 0 | 100% |
| $90/hr | 1 | 2 | 33% |
| $87/hr | 1 | 0 | 100% |
| $85/hr | 1 | 1 | 50% |

Median realised rate on **accepted** quotes: **$113.31/hr**. On **declined** quotes: **$113.84/hr**.

Those two numbers are the same. In this sample there is no evidence that price is what loses you the job — the declines sit at the same rate as the wins, and your highest win rates are at the *upper* rates, not the lower. Fourteen decisions cannot prove much, but they certainly do not support cutting interior to $85. If anything they suggest $100 is not near your ceiling.

## 4. Materials and GST

**Materials.** Median 14.3% of job value, range 2.3–25.4%. The 10% markup in v7 is consistent with what you have been doing. The engine costs materials properly — coverage → litres → wastage → cost → markup — which is better than the flat approach the v3 card used.

**Sundries.** The v7 seed sets interior $275/job and exterior $175/job, so these are covered. Worth knowing what they are worth: across the 36 costed quotes, sundries at those rates total **$13,609**, a median $376 per job. Exterior's $175 is still marked PROPOSED in the seed — confirm it against supplier dockets.

**GST.** `lib/pricing/estimate.ts` applies GST as a setting (default 0.1) to the ex-GST subtotal on every estimate, with a test asserting `gstCents === Math.round(netSubtotal × 0.1)`. It cannot produce a 0% quote by accident. PaintScout can, and did:

> **Quote #3156 — Jayne Tsinanis, 12A Cavell Court Beaumaris — $8,954.55, ACCEPTED, tax rate 0%.**

Every other accepted quote carries 10%. If you are registered for GST — and the rest of your quoting says you are — that job was quoted GST-free and accepted at that price. The GST liability on $8,954.55 is roughly $814, and on the face of it, it comes out of your margin unless the customer agrees to a corrected invoice. This is the one item here that costs you money today rather than next quarter.

## 5. Two things I noticed while reading

**The rate card on your machine is out of date.** `~/Documents/Paint_Group_Rate_Card_v3.csv` still has every condition, access and staging multiplier set to 1 with the note "my proposal, not your data", and shows sundries and minimum job value as NOT SUPPLIED. The v7 seed in the repo has all of that filled in with real measured values from 381 jobs. If you or anyone else is still working from the v3 CSV, they are working from a card that does nothing. Archive it.

**Five current quotes sit under your $2,000 self-serve floor**, which is now a live setting:

| Quote | Status | Value | Job |
|---|---|---|---|
| #3157 | accepted | $968.50 | 12A Cavell Ct Interior |
| #3582 | viewed | $1,858.50 | 16 Leslie Street |
| #3162 | viewed | $1,548.00 | 2/10 Capon Street |
| #3146 | viewed | $1,401.00 | 4 East Court Deck |
| #3055 | viewed | $1,265.00 | 6/1174 Malvern Road |

Worth deciding whether the floor blocks these, warns on them, or routes them to self-serve — the setting exists but I have not traced whether anything enforces it.

---

## Decisions for you — I have not made these

1. **Interior charge-out.** $85 is a deliberate choice in the seed with a "Your figure" note against it, so I am treating it as intentional rather than a bug. But your own quoting says $90–100 and your win data does not punish the higher rate. Do you want interior at $85, $95, or $100? *This is the whole ballgame — a $15/hr move on interior work is the difference between $14.17 and $29.17 per hour after overhead.*

2. **What "Painting Quote" means.** 33 of 50 PaintScout quotes carry the generic type, and the repricing swings from −3.2% to −11.7% depending on whether those are interior or exterior. In v7 this resolves itself, since charge-out is per rate item. But I could not tell from the data which side of the house those 33 jobs were, so treat the −11.7% as the pessimistic bound, not the estimate.

3. **Quote #3156's missing GST.** Wear it, or issue a corrected invoice to Jayne Tsinanis. Your call, and it is a customer-relationship call more than an accounting one — she also has a second quote (#3157) accepted the same morning, correctly at 10%.

4. **Exterior sundries at $175.** Still marked PROPOSED in the seed. Confirm against dockets.

5. **The $2,000 floor.** Enforce, warn, or leave advisory.

---

## If you want any of this changed in code

**Reference files**

- `supabase/seed/ratecard_v7.sql` — settings block, lines 9–33; rate items and their `charge_out_cents` from line 171
- `lib/pricing/engine.ts` — order of operations, contractor offer (step 14), margin (step 15)
- `lib/pricing/estimate.ts` — `resolveRates()` line 158, GST at line 407
- `lib/pricing/types.ts` — `RateItem.charge_out_cents`, `QuoteInput` modifiers
- `lib/pricing/__fixtures__/golden-estimates.json` and `golden.test.ts` — the golden set that will need regenerating if rates move
- `CLAUDE.md` — "Estimate pricing math lives in ONE module"; all money integer cents

**Acceptance criteria for a rate change**

1. Interior charge-out changes in **one place** — `rate_items.charge_out_cents` via a numbered migration in `supabase/migrations/`, not in engine code, not in a component.
2. `lib/pricing/golden.test.ts` is regenerated deliberately, with the diff reviewed line by line — a silently-updated golden file is how a rate change hides.
3. A test asserts the margin identity holds at the new rate: `marginCents === totalCents − contractorOfferCents − ownStaffCents − materialCostCents − passthroughCostCents`.
4. A test asserts contractor pay is unchanged by the rate change — the $60 × all-hours calibration against jobs 3140 and 3108 must still produce $4,155 and $5,070 exactly.
5. Existing sent estimates are untouched: customers see snapshots, and a rate change must not reprice a quote already with a customer. Verify against a token route (`/e/[token]`) in the e2e customer-journey suite.
6. `docs/ARCHITECTURE.md` gets its paragraph.
