# Finish standards, painter status, call backs — Step 6 report (the painter's traffic light)

**Date:** 8 October 2026 · **Branch:** `feat/painter-traffic-light` (Steps 1–5 merged to main in PR #201) · **Brief:** §10 Step 6 · **Before:** `standards-status-callbacks-s5-report.md`

## What was built

| Brief asked | Built |
|---|---|
| Home status card and My status per the mockup, five statuses, contractors and employed leads, light and dark | `app/portal/StatusCard.tsx`, `app/portal/status/page.tsx` (+ `JobDots.tsx`), `app/components/status/TrafficLight.tsx`; tokens and the light in `portal.css` |
| Everything read from `painter_status` and `painter_job_results` | `lib/painterStatus/mine.ts` through the painter's own session; no computation in the portal |
| Tips from a small copy table keyed by weakest measure and status | `lib/painterStatus/copy.ts` — `weakestMeasure` + `tipsFor(colour, weakest, lead)` |
| Status tokens per §7 in the portal's token file | Five lamp colours (same both themes), five text-safe per theme, housing/track; amber, clay, emerald untouched |
| Message 6 on a colour change | `contractor_status_changed` (three templates; lead variant without priority/payment), sent from the evaluator run when the writer reports a real change |
| Green wording of the third reminder text | `contractorJobUpdateSms3Green`, chosen per painter from `painter_status.colour` at send time |
| Honour `status_visible_to_painters` | Migration 20270229: `painter_status_visible()` inside the two own-row policies — off = no rows for painters, no card, 404, no text |
| E2e as a painter in each of the five statuses and as an employed lead | `e2e/painter-status-screens.spec.ts` |

## Acceptance (brief Step 6)
- No bonus amount anywhere in the painter's app — the counter is "n of 4"; the spec asserts no "$" on My status for every colour and for the lead.
- Status shown in words on every screen that shows a lamp — the word sits beside the light on both screens and in the light's `aria-label`.
- A non-lead employed painter sees no status UI at all — no row (Step 5) → no card, `/portal/status` 404; in the spec.
- Pulse stops under reduced motion — `@media (prefers-reduced-motion)` kills both animations; the spec reads `animationName` under `reducedMotion: "reduce"`.
- Visual match with the mockup on a phone in both themes — built to the mockup's layout and labels with the portal's tokens; **phone screenshots in both themes are for Tom's eyes on the deployed build** (the brief's "send Tom a screenshot" rule).

## Decisions taken
1. **⚑21 lives in the database**, not in the page: a policy helper, so a painter cannot reach the rows by any route while the switch is off, and message 6 checks the same switch.
2. **Message 6 never fires for a painter's first colour** (New at launch) — the writer reports an empty previous colour and the sender requires a real one.
3. **Lamp colours are my own picks** (brief R22: do not copy the mockup's values): green `#2fd07a`, yellow `#f2d23c`, orange `#f58a2d`, red `#ea4b45`, blue `#5c9bf7`; text-safe light-theme shades are darker versions.
4. **"A quality check on your first jobs"** rather than a number — `newJobs` (4) and `newContractorJobs` (3) are still two settings (Step 5 decision 3).
5. **Tips wording is mine**, seeded from the mockup's examples, three per colour, the first two from the weakest measure on Yellow/Orange.

## Open for Tom
- Paste `20270229000000_painter_status_visible.sql`.
- Launch painter-facing (default) or staff-only first (⚑21).
- The tips wording.

## Not in this step
Offers picker order, the Red block, Green payment terms, bonus approval (Step 7); the Contractors section (Step 8).
