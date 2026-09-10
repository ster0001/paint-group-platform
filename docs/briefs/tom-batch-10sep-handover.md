# Tom's 10 Sep batch — handover

**Written:** 10 September 2026, on `fix/tom-batch-10sep`.
**Why:** Tom is switching models for the last three items. This is what I know
that would otherwise cost an hour each to rediscover.

---

## Done and pushed (5 of 8)

| # | Item | Where |
|---|---|---|
| 1 | Login: no self-signup, Name box gone | `app/login/page.tsx`, `app/auth/actions.ts` |
| 2 | Estimates page fits the screen | `app/(app)/estimates/EstimatesTable.tsx`, `WizardPill.tsx` |
| 3 | Capture button works on a NEW estimate | `app/quote/QuoteBuilder.tsx` |
| 4 | Adding a substrate no longer opens its folder / raises the iPad keyboard | `app/quote/QuoteBuilder.tsx` |
| 5 | Capture: every substrate in every area; per-item tiles are countable | `lib/capture/presets.ts` |

Two of those were one cause each — see the commit messages, which carry the
reasoning rather than the diff.

---

## Done and pushed (6–8), 10 Sep evening — see docs/manual-tests/tom-batch-10sep-part2.md

| # | Item | Where |
|---|---|---|
| 6 | Estimate line photos: parallel upload + 2048 px screen-size downscale | `app/quote/QuoteBuilder.tsx` (MediaUploader), `lib/uploads/downscale.ts` (lifted from the showcase) |
| 7 | Staff alerts: six office events, routed per staff member by email/text; Automations page split Customers / Contractors / Staff; mobile on Staff logins | `lib/staff/notifyEvents.ts` (client), `lib/staff/notify.ts` (server), `app/(app)/settings/StaffAlertsMatrix.tsx`, `staffActions.ts`, migration `20270134` |
| 8 | Phone view: tables scroll inside their card, builder toolbar wraps; hold-for-a-second drag on touch | `EstimatesTable`, `invoices/page`, `contacts/page`, `WizardSessionsTable`, `QuoteBuilder.tsx` (grip pointer handlers) |

**Tom's rulings that shaped these (his reply, 10 Sep):** A = "photo uploads are slow when adding them in the
estimate (the ones visible for the client)" → the line-item uploader only; B = "add it to our existing
notifications page and break up into staff and contractor"; C = the black screen was NOT the issue — "the software
isn't mobile friendly, you can't scroll left to right in phone view", plus hold-to-drag on mobile/tablet.

**Where the hooks are.** Accepted → `lib/estimate/acceptedNotify.ts` (extended). Job accepted/declined → the painter's
browser calls `respond_to_offer` directly (no server seam), so `OfferCard`/`OfferBar` ping
`app/portal/offerNotifyAction.ts` after the RPC. Invoice paid → next to `sendReceiptEmail` in
`app/invoicing/actions.ts` and the Stripe webhook. Variation raised → `raiseVariationAction`. Contractor invoice →
`submitContractorInvoiceAction` + `requestClaimAction`. All behind `after()`, all once-only via `staff_notifications`.

**Three more traps found on the way:**
- `auth.admin.listUsers` paging (20 × 200) stopped finding the staff login on C1 — the wizard's anon sessions pushed
  it past 4,000 users. `emailsById` in staffActions now does one `getUserById` per staff id; e2e resolves the id by
  signing the creds in (`userIdFor` in e2e/helpers.ts). `settings-staff.spec` was red for this reason, not the code.
- A Tailwind `sr-only` span is `position:absolute`; inside an `overflow-x-auto` card that is NOT positioned it
  escapes the card and widens the page on a phone (that is why /estimates zoomed out). Scroll wrappers are `relative`.
- Playwright's `touchscreen` only taps; the hold-to-drag spec drives real touches through CDP
  (`Input.dispatchTouchEvent`) — and must keep both rows on screen, because a fast slide scrolls.

## ⚑ Traps that will cost you an hour each

1. **Never free port 3101 while an e2e run holds it.** `scripts/c1/run-e2e.sh`
   now refuses to start if the port is held — that guard exists because a stale
   server made every spec assert against the PREVIOUS build, twice. I also
   invalidated a 71-spec run by killing the port for another run: it reported 59
   failures that were all the same missing server.
2. **C1's `wizard_public` flag gets left OFF.** `holding-and-honest-defaults`
   toggles it to test the holding page and restores it in `afterAll`; kill that
   run and every wizard spec then hits "Opening on 28 September". Check
   `settings.wizard_public` before believing a mass wizard failure.
3. **Long C1 runs fail LATE for environmental reasons** — the anon-session
   limit, plus ~800 accumulated leads. A spec that fails in a 45-minute suite and
   passes alone in 6 seconds is telling you about the stack, not the code.
4. **Do not `npm run build` before `run-e2e.sh`** — a production-env build can
   leave the client bundle pointed at PRODUCTION Supabase.
5. **`AGENT_MODEL_STUB=1`** is what CI sets; the assistant specs need it and
   there is no `ANTHROPIC_API_KEY` in `.env.test.local`.
6. **eslint is ratcheted at 4 warnings** in `.github/workflows/ci.yml`. Lower it
   when you clear some; never raise it.

---

## Where things are

Branch `fix/tom-batch-10sep`, off `main` at `ba191a2`. 2,065 unit tests green,
tsc and eslint clean (4 warnings, the ratchet), production build green.
Migration `20270134` applied on C1, **queued for production**.

Everything from estimator journey v2 phase 2 is already merged (PRs #53, #54,
#56, #57) — see `docs/briefs/estimator-journey-v2-phase2.md`.
