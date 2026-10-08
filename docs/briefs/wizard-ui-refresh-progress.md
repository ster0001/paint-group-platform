# Wizard UI refresh — progress ledger

**Read this first in every session. Update it last.** One row per session from `wizard-ui-refresh-runsheet.md` §4. The row is the truth about what has shipped; the brief is the truth about what to build. If they disagree, stop and report.

Preflight is run sheet §3. Postflight is run sheet §6.

| Session | What | Status | Date | Merge SHA | Units before → after | Specs added or edited | ⚑ touched (value shipped) | Next session should know |
|---|---|---|---|---|---|---|---|---|
| S0 | Commit the pack; baseline screenshots | DONE (awaiting merge) | 9 Oct 2026 | | 3375 → 3375 (332 files) | Added `e2e/customer-journey/ui-refresh-baseline.spec.ts` — 11 journeys × 390/1440, 43 shots each width, 22/22 on C1 (3.1 min, teardown 26 → 0). No spec edited. | none | Built on `main` `964a1dd`; nothing in app/wizard, app/estimate, lib/wizard or e2e/customer-journey changed since `ed5a94c`, hooks list identical. **customer-journey is RED on main** (36 failed, S6 details-first gate) — fix is the unmerged `fix/customer-journey-gate-9oct`; S1's gate "existing wizard e2e pass unchanged" needs that merged first. Shots are in `ui-refresh-shots/before/` (gitignored), NOT `test-results/` (ruling 9 Oct). **S9 must run in this same worktree** (`../paint-group-platform-uirefresh`). **Re-take the before set after the gate fix merges** (ruling 9 Oct), then S1. |
| S1 | The shell, on every path | TODO | | | | | 10, 21 | |
| S2 | Live picture and "Your job so far" (home, inside) | TODO | | | | | 1 | |
| S3 | The range screen, every path | TODO | | | | | 2, 5, 14 | |
| S4 | Room by room, area by area | TODO | | | | | 7, 17 | |
| S5 | Home, outside | TODO | | | | | 15, 16 | |
| S6 | Home, both (stacked) | TODO | | | | | | |
| S7 | Commercial | TODO | | | | | 13, 18, 19 | |
| S8 | Supporting screens and pieces | TODO | | | | | 22 | |
| S9 | Finalise, visit, clean-up, help | TODO | | | | | | |

## Tom's phone checks

| Session | Checked on | Result |
|---|---|---|
| S0 (mockup, all six job types) | | |
| S1 | | |
| S2 | | |
| S3 | | |
| S4 | | |
| S5 | | |
| S6 | | |
| S7 | | |
| S8 | | |
| S9 (final sign-off, phone and laptop) | | |

## Differences found between the brief and the repo

One line each: what the brief says, what the repo does, which one was followed and why.

- **Screenshot folder — RESOLVED 9 Oct (Tom).** The run sheet said `test-results/ui-refresh/before/`; Playwright empties `test-results/` on every run. Now `ui-refresh-shots/<set>/<width>/` (gitignored, set chosen by `UI_REFRESH_SET`), run sheet updated, and S9 runs in the S0 worktree (`../paint-group-platform-uirefresh`).
- **Commercial "both".** Brief §7.7 lists commercial visit-only as Address → Place → Space → Questions → Book. `stepsFor("both", "commercial")` also walks the choice screen: start → both → place → segment → com_brief → com_book. Code wins (run sheet §1); the rail in S1 shows the choice screen as uncounted, as on home "both".
- **Gate order.** §7.7's home and commercial-ranged lists end in Details because the live order is "details first" (`stepsFor(…, gate=true)`). Under "range first" the gate step drops out; S1's rail must follow `stepsFor()` either way.
- **Rows the baseline cannot reach** (parked for S8 by Tom, 9 Oct; listed in the parking lot): the guardrail outcome (`HardStop` / `CustomerResult` — no quick-look path), the "From what you told us" tag (`wz-assumed-tag`), the trade lane (⚑ 20, out of scope), the staff page list (⚑ 21, staff only). The real floorplan read (`ql-plan-done`) needs the gitignored regression plan, so the shot is the upload state with a non-plan image.
- **Segment kickers in capitals.** `lib/wizard/segments.ts` rows store "OFFICE", "HOSPITAL"…; the brief bans capitals but rows are read-only here. S1/S7 sentence-case in CSS; `commercial-segments.spec.ts` asserts the text `HOSPITAL` exactly, which CSS text-transform does not change.
- **Stale spec.** `reveal-book-link.spec.ts:24` expects `door-book` → `/estimate/book`; `WizardApp.tsx:1735` sends it to `/estimate/visit`. Already edited on `fix/customer-journey-gate-9oct`.
