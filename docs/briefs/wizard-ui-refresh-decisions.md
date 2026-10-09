# Wizard UI refresh — decisions sheet

**Tom: write your answer on the "Ruling" line of any item you want to change. Leave a line blank and the default stands.** Nothing here blocks the build. Anything that would state a business fact ships switched off until you rule.

Claude Code: read this in every preflight. A blank ruling means the default. Never infer a ruling from the mockup.

Switches live in `lib/wizard/ui-flags.ts` (typed constants, no Settings row, no migration).

---

## A. Needs your ruling (ships off, or on a safe default, until then)

### ⚑ 1 · Colour try-on swatches on the room picture
The mockup lets a customer tap five colours and see the walls change. It is a preview only.
- **Why it matters:** it is engaging, but it could read as us offering those colours, and named supplier colours raise accuracy and trademark questions.
- **Default:** OFF (`colourTryOn: false`). Walls show one neutral fresh tone.
- **Used in:** Session 2.
- **Ruling:** ______________________ (off / on with the five generic colours / on with named colours from: ______)

### ⚑ 2 · "A job like yours" card on the range screen (homes)
Shows one finished job with its real price range.
- **Why it matters:** it publishes a real price next to the customer's own range. If the example is cheaper than their range, it may invite a challenge.
- **Default:** OFF (`similarJobCard: false`). The row shows two cards.
- **Used in:** Session 3.
- **Ruling:** ______________________ (off / on) · Matching rule if on: ______________________

### ⚑ 5 · Trust card wording on the range screen
The mockup shows "5.0 from 93 Google reviews", "2-year workmanship warranty", "$20M public liability".
- **Why it matters:** these are claims. The warranty wording was awaiting legal review.
- **Default:** ON, using exactly the claims and wording the homepage already shows, with the review score and count read from the same source the homepage uses. If the homepage wording changes, this follows it.
- **Used in:** Session 3.
- **Ruling:** ______________________

### ⚑ 14 · Commercial version of those two cards
- **Default:** the commercial "job like yours" card is OFF. The trust card swaps the warranty line for "Certificates and SWMS with every quote", which is the promise the commercial booking screen already makes.
- **Used in:** Session 3.
- **Ruling:** ______________________ · Commercial job that may be shown with its price, if any: ______________________

### ⚑ 13 · Who is named on commercial jobs
The mockup shows you on every path.
- **Default:** whoever the wizard already resolves as the estimator (`EstimatorStrip`). Nothing is typed into a screen.
- **Used in:** Session 7.
- **Ruling:** ______________________

### ⚑ 10 · Chat moves into the header
The floating "Chat with us" bubble becomes an icon button in the header, because the bubble covers content.
- **Default:** YES.
- **Used in:** Session 1.
- **Ruling:** ______________________

---

## B. Scope calls (default is "not now")

### ⚑ 20 · Trade lane in the portal ("New quote" and the spec sheet)
- **Default:** not in this plan. A short follow-up brief after Session 9.
- **Ruling:** ______________________

### ⚑ 21 · Staff mode
Staff still see the older five-page version. It picks up the new colours, type and buttons, but not the two-column layout or pictures.
- **Default:** leave it.
- **Ruling:** ______________________

### ⚑ 22 · Assistant page (`/estimate/assist`)
- **Default:** new colours, type and buttons only. No layout change.
- **Ruling:** ______________________

---

## C. Defaults you can leave alone

| ⚑ | What | Default |
|---|---|---|
| 3 | Estimator photo | Initials until a photo is added in Settings. |
| 4 | "Got it. We paint in your area." under the address | Shown only for addresses inside a bookable zone. Pre-arranged and out-of-area addresses behave as they do today. |
| 6 | Time claims ("About a minute to go", "About 4 minutes") | Ship without numbers. Add them once real medians are known from the wizard session records. |
| 7 | Wording changes in the mockup | Use the mockup's wording: "Are these the rooms we're painting?", "Check this room" / "Checked", "Within 30%", "Show my guide range". Each changed string is listed in the PR. |
| 8 | Prices on the extras chips ("Air vent $180") | As live today. |
| 9 | Promise on the details step | Only "We save your estimate and email you a link". No promise about calls. |
| 11 | Ladder bars on the range screen | The Guide bar uses the live band width. The others are illustrative, with no numbers. |
| 12 | "Imported · Custom surface · $105" chip in the live editor | Treated as a bug. Raised separately, not fixed in this plan. |
| 15 | Colour on the outside picture | Three set tones, one per colour answer. No swatch picker outside. |
| 16 | "Not sure" on a side's size | A third button beside Looks right and Adjust it. |
| 17 | Rail label for commercial checking | "Area by area". |
| 18 | Time slots on the commercial booking screen | Whatever that screen receives today. No rule changes. |
| 19 | "What happens next" on the Booked screen | As mocked: four steps, using the booking screen's own three points. |
| 23 | Estimator's name | Whatever the wizard resolves. Never typed in. |

To change any of these, write the number and your ruling here:

______________________________________________________________

---

## D. Rulings log

Claude Code appends one line per ruling: date, ⚑ number, the ruling in Tom's words, the session it landed in.

| Date | ⚑ | Ruling | Session |
|---|---|---|---|
| 7 Oct 2026 | — | First mockup "looks good". | — |
| 8 Oct 2026 | — | Apply the redesign across all steps for each job type, commercial included. | — |
| 9 Oct 2026 | — | Build plan and documentation requested. | — |
| 9 Oct 2026 | — | Screenshots stay in `ui-refresh-shots/before/`; run sheet and ledger point there; S9 runs in the same worktree as S0. | S0 |
| 9 Oct 2026 | — | Push `fix/customer-journey-gate-9oct` as its own PR, separate from the refresh. S1 waits until it is merged and the existing wizard tests pass on `main`; the before screenshots are re-taken after that merge. | S0 → S1 |
| 9 Oct 2026 | — | The three unreachable screens are parked for S8. S8 first says whether a customer can reach the "can't price this online" screen at all; if not, it is logged as a finding and not redesigned. The floorplan-being-read shot uses a sample plan from the test files. | S8 |
| 9 Oct 2026 | — | Segment kickers in capitals: fixed on screen only, in S1/S7. The seed/row wording fix is a separate change for Tom to approve. | S1, S7 |
| 9 Oct 2026 | — | "mockup approved" — all six job types, phone check done. | S0 |
| 9 Oct 2026 | — | S1 diff approved, incl. `vitest.config.mts` running `app/wizard/**/*.test.ts`, page colour kept `#F4F6F8`, new `--onpaint`. Phone check: "s1 looks good". | S1 |
| 9 Oct 2026 | 12 | "Imported · Custom surface" chip: its own small fix, written up separately, to land before go-live; not in this plan. | — (`docs/briefs/fix-imported-custom-surface-chip.md`) |
