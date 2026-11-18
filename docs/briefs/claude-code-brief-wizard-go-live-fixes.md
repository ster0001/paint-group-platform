# Build brief — wizard go-live fixes, with prep and cleaning by job size

**Project:** paint-group-platform (Next.js 16 / Supabase)
**Date:** 18 Nov 2026
**Fixes:** every item in `wizard-go-live-audit-18nov.md` (C1–C4, H1–H7, M1–M14)
**Adds:** set-up/prep hours, sundries and cleaning that scale with job size, priced by the one engine so the wizard, the staff builder, the quote, the work order and the contractor offer all agree.

---

## 1. The data this is built on

Read on 18 Nov from every estimate on the platform's Estimates list (275), through the staff builder. Five test estimates removed, one with no scope.

| Group | Count | What it is |
|---|---|---|
| Built in-house | 166 | Priced by staff in the builder (55 accepted, 83 viewed) |
| PaintScout imports | 44 | Signed jobs, original PaintScout prices and hours |
| From the wizard | 59 | 43 interior, 15 exterior, 1 both |

"Staff-priced" below means in-house + PaintScout: **210 estimates**, 105 interior, 84 exterior, the rest mixed.

### 1.1 What staff charge for prep and cleaning today

Staff already scale these by hand. The wizard does not.

**Interior — by painting hours on the job**

| Painting hours | Jobs | Typical job value (ex GST) | Prep hours (median, jobs with it) | Cleaning hours (median, jobs with it) | Sundries $ (median) |
|---|---|---|---|---|---|
| Under 12 | 31 | $690 | 2.0 (16 jobs) | 1.3 (6) | $105 |
| 12–35 | 26 | $3,230 | 3.5 (18) | 2.0 (14) | $145 |
| 35–60 | 20 | $6,290 | 4.5 (17) | 3.5 (9) | $180 |
| 60–100 | 12 | $9,440 | 8.0 (9) | 4.0 (5) | $245 |
| 100–180 | 8 | $15,860 | 10.0 (7) | 5.0 (4) | $269 |
| Over 180 | 8 | $26,070 | 8.0 (6) | 6.0 (3) | $335 |

**Exterior**

| Painting hours | Jobs | Prep hours (median) | Sundries $ (median) |
|---|---|---|---|
| Under 12 | 2 | none recorded | $138 |
| 12–35 | 10 | 4.0 (7 jobs) | $175 |
| 35–60 | 17 | 3.8 (10) | $186 |
| 60–100 | 16 | 4.0 (7) | $175 |
| 100–180 | 29 | 8.0 (18) | $175 |
| Over 180 | 10 | 4.0 (4) | $270 |

Other facts from the same set:
- **Cleaning is an interior charge.** 41 of 105 interior jobs carry it; 2 of 84 exterior jobs do.
- **Cleaning is charged below the painting rate.** 45 hourly cleaning lines: median **$65/hr** (middle half $60–$80). Painting charge-out is $95.
- Prep hours on interiors rise with job size: about 3 hours plus 3 minutes for every painting hour (3.0 + 0.054 × hours, 72 jobs, a loose fit). Cleaning follows size more closely: about 2 hours plus 1½ minutes per painting hour (2.1 + 0.023 × hours, 41 jobs).
- **The wizard charges a flat $275 and nothing else.** Median Preparation line on the 59 wizard estimates is exactly $275; only 13 have prep hours or cleaning, added by staff afterwards.

**What that means on the audit's test job** (3-bed, 65.55 painting hours):

| | Today (wizard) | With the scale |
|---|---|---|
| Sundries | $275 | $245 |
| Prep / set-up | — | 8 h × $95 = $760 |
| Cleaning | — | 4 h × $65 = $260 |
| Subtotal ex GST | $7,532.45 | **$8,522.45** (+13.1%) |
| Total inc GST | $8,285.70 | **$9,374.70** |
| Hours | 65.55 | 77.55 |
| Contractor offer (× $60) | $3,933 | $4,653 |

The wizard is currently about 13% under what staff would quote for the same house. 77.55 hours also sits where staff-priced $7–12k interiors actually land (median 74 hours).

### 1.2 Other numbers used in the fixes

| Question | Data |
|---|---|
| Ceiling heights | 874 interior rooms: 64% at 2.4 m or under, 13% 2.5–2.7 m, 14% 2.8–3.0 m, 9% over 3 m |
| Room sizes | Longest side: median 3.8 m, 90% under 7.5 m, 95% under 10 m. Bedrooms (214): 95% under 5 m, largest 8 m |
| Doors | Flat 259, panelled 122 (68% / 32%) |
| Interior windows staff price | Awning/casement 50, colonial/bay 39, fixed 20. No sash code used by staff |
| Staging loadings | Staff applied one on about 2 of 210 estimates. The wizard applied one on 24 of 59 (Empty ×1.02 on 12, Furnished ×1.04 on 6, Occupied ×1.1 on 4, Mostly empty ×1.02 on 2) |
| Sales rate | $113–$116 per hour ex GST across all three groups |
| Guide range vs where the estimate ended up | 31 wizard estimates still hold their first range. 14 ended inside it, 11 below, 6 above. Of the 15 that were sent or accepted: 6 inside, 8 below, 1 above |

**Caution on the last row:** it is a small set and includes your own test runs and jobs whose scope changed after the range. It is enough to say the range is not proven; it is not enough to set tight bands from.

---

## 2. Fix for every audit item

### Critical

| # | Issue | Fix | Why this value |
|---|---|---|---|
| C1 | Quote stage never tightens the range | Quote-stage answers feed the one accuracy function: a room confirmed on its measure card counts as confirmed; typed sizes count as customer-stated; a ceiling height picked on the general card clears the assumed-height flag on every room and drops the 3 m top. Range half-width by state: nothing confirmed 15%, all rooms confirmed at typical size 12%, all measured 8%, never under 8% | The range has only 14 of 31 inside it so far, so nothing tighter than 8% is defensible yet. ⚑ D1 |
| C2 | Laptop still on the old design | Remove the "within N%" badge and the three-row ladder from the laptop range screen; add the phone's small-print line; ship the 18 Nov door change; port the listed specs then switch one-press on | Your 27 Oct and 5 Nov rulings |
| C3 | Typed sizes accept anything | Letters or blanks: message, no advance. A side over **10 m**, or over **6 m in a bedroom, bathroom, laundry or WC**, asks "That's larger than most rooms — is it right?" before saving. Under 1 m asks too. No silent clamp | 95% of all rooms are under 10 m; 95% of bedrooms under 5 m, largest 8 m |
| C4 | Public path unproven | Session 6: you walk it signed-out on your phone; the switch is flipped only after | Staff skip the text code |

### High

| # | Issue | Fix | Why |
|---|---|---|---|
| H1 | Quote lines don't add to the Subtotal | Every dollar gets a line: rooms, **Set-up and preparation**, **Cleaning**, any loading, repairs. All lines and totals on one GST basis, labelled | Section 3 creates the two missing lines |
| H2 | Exterior dead end | Pre-tick walls, fascias, gutters, eaves, windows and doors as the inside does; Continue on the first screen says "Tick at least one part" instead of a greyed button three screens later | — |
| H3 | Ceilings copy contradicts its coat badge | Copy is chosen from the same colour answer and coat count as the badge; table test over every combination | — |
| H4 | Staff and customer see different ranges | Estimates list and staff strip read the live range the customer sees | — |
| H5 | Plain answers push the price up | "Rooms cleared / empty" applies no loading. Furnished and Occupied stay ⚑ D4. Window default stays casement | Staff applied a staging loading on ~2 of 210 jobs; the wizard on 24 of 59. Casement is what staff price most |
| H6 | Small-job screen re-asks the mobile | Carry the mobile through; one sentence; no "exact" | — |
| H7 | "Nothing to measure" | Replace with "Room by room, about 10 minutes. A tape helps, pacing it out is fine." | Your 29 Oct ruling that sizes are typed |

### Medium and minor

| # | Fix |
|---|---|
| M1 | Address suggestions overlay; suburb/postcode fields don't push the cards |
| M2 | Details step says what is wrong ("That looks like a landline — we need a mobile to text your code") |
| M3 | Consent line always above the sticky button |
| M4 | One "Get my quote range" button visible at a time |
| M5 | Outside path skips "What kind of place" (the home-type screen covers it); wall material pre-selected from the home type |
| M6 | Outside promise reads "About two minutes"; progress bar scaled to the real number of screens |
| M7 | Basis line lists only ticked parts |
| M8 | ⚑ D7 — add "Going much lighter, or a bold colour?" to the phone colours screen, as the laptop has |
| M9 | ⚑ D7 — hall carries the hall side of every door opening onto it, plus the inside of the front door |
| M10 | Step counter never exceeds its total; "Online now" only inside the idle window |
| M11 | Laptop rail gets the room grid from the brief; 100% reads "All settled" |
| M12 | Done-screen line: "Tap a room to measure it" and only lists rooms left unmeasured |
| M13 | Option cards get accessible names |
| M14 | Service-area check runs before the small-job check; test added |

---

## 3. Prep, sundries and cleaning by job size

### 3.1 The scale (starting values, all editable in Settings)

Banded by **painting hours**, which the engine already knows before these are added. Dollar bands would shift every time a rate changes.

**Interior**

| Painting hours | Set-up and prep hours | Cleaning hours | Sundries |
|---|---|---|---|
| Under 12 | 2.0 | 1.5 | $105 |
| 12–35 | 3.5 | 2.0 | $145 |
| 35–60 | 4.5 | 3.5 | $180 |
| 60–100 | 8.0 | 4.0 | $245 |
| 100–180 | 10.0 | 5.0 | $270 |
| Over 180 | 10.0 ⚑ | 6.0 | $335 |

**Exterior**

| Painting hours | Set-up and prep hours | Cleaning hours | Sundries |
|---|---|---|---|
| Under 12 | 2.0 ⚑ | 0 | $140 |
| 12–35 | 4.0 | 0 | $175 |
| 35–60 | 4.0 | 0 | $185 |
| 60–100 | 4.0 | 0 | $175 |
| 100–180 | 8.0 | 0 | $175 |
| Over 180 | 8.0 ⚑ | 0 | $270 |

Values are the medians in section 1.1, rounded to the half hour and $5. Three are my adjustments, marked ⚑:
- Interior over 180 h: data median is 8.0 from 6 jobs, lower than the band below it. Held at 10.0 so a bigger job never gets less.
- Exterior under 12 h: no job in the set has prep hours. 2.0 matches the interior.
- Exterior over 180 h: data median is 4.0 from 4 jobs (one at 28). Held at 8.0, same reason.

Rates:
- Prep hours at the job's painting charge-out (as the engine does today).
- Cleaning at its own Settings rate, **$65/hr** to start (the staff median). ⚑ D9: at $65 against $60 contractor pay the margin on cleaning is $5/hr; at charge-out it is $35/hr.

A "both" job takes the interior row for its inside hours and the exterior row for its outside hours.

### 3.2 How it links to the estimator

One pure function in `lib/pricing/` returns `{ prepHours, cleaningHours, sundriesCents }` from painting hours per side and the Settings scale. `priceEstimateTotals` calls it. Nothing else computes these.

| Where | Change |
|---|---|
| `lib/pricing/estimate.ts` | `preparationHours` and `preparationOverrideCents`: **null = the scale**, a number = the estimator's own figure (today null = 0 hours / flat Settings sundries). New `cleaningHours` (null = scale, number = override) priced at the cleaning rate, added to the subtotal and the contractor hours. Allowances are added after the multiplier chain and are not themselves multiplied |
| `lib/pricing/context.ts` | Maps `cleaningHours` from `builder_state` |
| Settings → Pricing | New "Site allowances" table (bands × interior/exterior) + cleaning rate. Versioned with the rate card. The two "Sundries per job" rows are retired into it |
| `app/quote/QuoteBuilder.tsx` | Preparation row shows the scale's hours and sundries as the default with "from the job-size scale" beside it; a new Cleaning row the same. Typing a figure overrides for that estimate only |
| Wizard (`/api/wizard/submit`, `wizard-edit`, `lib/wizard/view.ts`) | No new maths: they already price through the engine, so the range moves with the scale. The customer payload gains the two lines for the quote |
| Quote document (`lib/quote/quote.ts`) | Lines "Set-up and preparation" and "Cleaning" (fixes H1) |
| Work order | Preparation area carries the scale's hours (already built for staff-entered hours); Cleaning rides as its own area so the painter's sheet and pay carry it |
| Contractor offer | Hours × $60 includes prep and cleaning hours, as staff-entered prep hours do today |
| Home dashboard | Hours and sales rate read the engine totals, so nothing to change; check the sales-rate tile still reconciles |

### 3.3 The one real risk — existing estimates must not move

Changing what "null" means would reprice every saved estimate, including 109 accepted ones and the 44 PaintScout imports that must match to the cent.

- A migration writes **explicit** values on every existing estimate before the engine change ships: `preparationHours` = its current value or 0, `preparationOverrideCents` = the figure it prices at today, `cleaningHours` = 0.
- The 40 in-house estimates with a hand-typed "Cleaning" line keep that line and get `cleaningHours` = 0.
- The PaintScout import builder sets all three to 0 explicitly.
- Proof: total of every estimate before and after the migration, compared to the cent, zero differences, report committed.

Only estimates created after the switch use the scale.

---

## 4. Decisions for Tom ⚑

**Ruled by Tom, 18 Nov 2026 (binding — Session 1 is unblocked):**
- **D6 — the section 3.1 scale is adopted as the starting values**, including the three adjusted cells. D10 follows from it: wizard prices rise to match.
- **D9 — cleaning is charged at $65/hr.**
- **D11 — exterior cleaning is none by default.**

Still open: D1, D2, D3, D4, D5, D7, D8.

| # | Decision | My recommendation, and the data |
|---|---|---|
| D1 | Range half-width in the quote stage | 15% → 12% (all rooms confirmed) → 8% (all measured), floor 8%. Revisit after 50 wizard jobs have real hours. Only 14 of 31 guide ranges held |
| D2 | Top of the range drops as soon as a ceiling height is picked | Yes. 64% of rooms are 2.4 m or under, so most customers should see the top fall on that tap |
| D3 | Estimator named in the wizard | Live says Tom Roman. Set in Settings → Estimator; no build needed |
| D4 | Staging loadings from wizard answers | Empty / cleared: none. Furnished ×1.04 and Occupied ×1.1: your call — staff almost never apply them (about 2 of 210) |
| D5 | Quote validity | "Valid 30 days" is typed into the code. Read it from Settings instead; you set the number |
| D6 | Adopt the scale in section 3.1 as the starting values | Yes — it is your own team's median practice. Confirm the three ⚑ cells |
| D7 | Bold-colour question on the phone; hall-side door count | Add both. Not costed from data — I could not measure either from the estimates |
| D8 | Room-size check thresholds | 10 m any room, 6 m small rooms, under 1 m |
| D9 | Cleaning rate | $65/hr (staff median) or painting charge-out |
| D10 | Do the wizard's prices rise 13% on a typical interior at launch | That is the effect of D6. It brings the wizard level with staff quotes; say no and the wizard stays under them |
| D11 | Exterior cleaning | None by default (2 of 84 jobs). Staff can type hours on any job |

---

## 5. Build plan

**Order matters:** Session 1 changes prices, so it goes first and everything after is tested against the new numbers.

### Read first (missing file = stop and report)
- `wizard-go-live-audit-18nov.md` (project docs) — the findings and how each was reproduced
- `docs/briefs/claude-code-brief-quote-stage-v10.md`, `docs/briefs/quote-stage-v10-progress.md`
- `docs/briefs/claude-code-brief-wizard-mobile-v5.md`, `docs/briefs/claude-code-brief-wizard-desktop-onepress-addendum.md`
- `docs/briefs/claude-code-brief-exterior-wizard-v2.md`, `docs/briefs/build-plan-exterior-mobile-v5.md`
- `docs/briefs/claude-code-brief-ratecard-v8.md`, and `wizard-project-allowances-spec.md` from the project docs (commit it to `docs/briefs/` if it is not there; superseded by section 3 here for set-up, clean-up and sundries; its colour-coordination and single-coat sections are not part of this build)
- `lib/pricing/estimate.ts`, `lib/pricing/context.ts`, `lib/pricing/golden.test.ts`, `lib/pricing/__fixtures__/`
- `lib/wizard/view.ts`, `lib/wizard/accuracy.ts`, `lib/wizard/envelope.ts`, `lib/wizard/policy.ts`, `lib/wizard/rooms-loop.ts`
- `lib/quote/quote.ts`, `lib/quote/cards.ts`, `app/estimate/quote/QuoteStage.tsx`
- `app/wizard/Reveal.tsx`, `WizardApp.tsx`, `MobileGate.tsx`, `MobileQuickLook.tsx`, `ExteriorPaint.tsx`, `HardStop.tsx`, `AddressField.tsx`
- `app/quote/QuoteBuilder.tsx`, `app/(app)/settings/PricingSettings.tsx`
- `lib/import/booked/build.ts`, `lib/workorder/contractorPay.ts`, `lib/estimate/listRows.ts`

### Rulings that bind (do not reopen)
No tolerance figure a customer can see · no Guide → Narrowed → Fixed ladder · never "exact" · sizes are typed · nothing asked twice · money in integer cents, computed server-side · one engine: no price maths outside `lib/pricing` · migrations run between gate runs · e2e as an anonymous customer.

### Session 0 — orientation (no code)
Map section 3.2 and every audit item to files and tests; list what each session will reuse, extend and remove. Stop and report.

### Session 1 — site allowances by job size (needs D6, D9, D10, D11)
Builds section 3.

Acceptance:
- [ ] One function in `lib/pricing` returns prep hours, cleaning hours and sundries from painting hours per side and the Settings scale; unit test covers every band edge (11.99 / 12 / 35 / 60 / 100 / 180) for both sides and a "both" job.
- [ ] Golden: the audit's 3-bed (65.55 painting hours, areas $7,257.45) prices at **$8,522.45 ex GST, $9,374.70 inc GST, 77.55 hours, contractor offer $4,653.00** with the section 3.1 values.
- [ ] Allowance hours are identical for a 2-coat and a 3-coat version of the same job, and under any job modifier.
- [ ] Before/after report over **every** existing estimate: zero cents of difference. The 44 PaintScout imports still pass the import check.
- [ ] Builder: a new estimate shows the scale's figures labelled as defaults; typing a figure overrides it; clearing it returns to the scale.
- [ ] Wizard and builder give the same total for the same scope (parity test).
- [ ] Work order shows Preparation and Cleaning areas with their hours; contractor offer = total hours × the contractor rate.
- [ ] Every scale value and the cleaning rate edit in Settings without a deploy and are versioned.

### Session 2 — the range closes (C1, H4; needs D1, D2)
Acceptance:
- [ ] 3-bed interior: range half-width is 15% at the gate, 12% after all rooms are confirmed at typical size, 8% after all are measured; never one number.
- [ ] Picking 2.4 m lowers the top of the range on that tap.
- [ ] Bar and numbers never disagree.
- [ ] Staff strip reads "8 of 8 rooms confirmed"; Estimates list range equals the customer's to the dollar.
- [ ] Band values live in Settings.

### Session 3 — the laptop catches up (C2)
Acceptance:
- [ ] At 1470 px no customer page contains "±", "within" followed by a number, or "exact" (grep over rendered text).
- [ ] The laptop's tighten button lands on `/estimate/quote`; nothing a customer can press opens `/estimate/scope`.
- [ ] Specs listed in the one-press ledger entry are ported; the flag is Tom's to flip.

### Session 4 — inputs and dead ends (C3, H2, H6, H7, M1–M7, M13, M14; needs D8)
Acceptance:
- [ ] Typing 35 or abc in any size field cannot change the range without a confirmation tap.
- [ ] Every disabled primary button has its reason on screen.
- [ ] Outside path: usual parts pre-ticked; property type asked once; wall material asked at most once.
- [ ] Small-job screen shows the mobile already filled; out-of-area address gets the out-of-area screen first.
- [ ] 390 × 780 screenshots of every screen: nothing overlaps text.

### Session 5 — the quote adds up, and copy (H1, H3, H5, M8–M12; needs D4, D5, D7)
Acceptance:
- [ ] Sum of quote lines = Subtotal, low and high, to the dollar (unit test on the quote model), with Set-up and preparation and Cleaning as lines.
- [ ] No "What we'll do" line states a coat count different from its badge.
- [ ] "Rooms cleared" changes the price by $0.
- [ ] Validity text comes from Settings.

### Session 6 — proof and switch-on (C4)
- Full-loop e2e, anonymous: interior, exterior, small job; phone and laptop.
- Tom's phone walk on new.paintgroup.com.au, signed out: text code arrives, range shows, quote stage narrows, quote adds up.
- Ten real past jobs re-entered through the wizard and compared with what was quoted — your "calibration before customers" rule. ⚑ Pick the ten.
- Then flip Settings → Estimates → Online estimates.

### Out of scope
Colour-coordination and single-coat rules from the Aug allowances spec · commercial paths · exterior per-side access hours (already built) · any change to painting rates.

---

## 6. Limits of the data
- Prep and cleaning figures come from what staff **quoted**, not hours painters actually worked. The platform's "Hours vs estimate" tile is where that correction comes from once jobs finish.
- Medians are over the jobs that carry the charge. About a third of staff-priced interiors have no prep hours at all; the scale would charge them all.
- Bands above 100 painting hours rest on 4–18 jobs each.
- Wizard estimates include your own test runs; I removed the five marked as tests but could not identify the rest.
