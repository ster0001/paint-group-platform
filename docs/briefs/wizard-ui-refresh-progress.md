# Wizard UI refresh — progress ledger

**Read this first in every session. Update it last.** One row per session from `wizard-ui-refresh-runsheet.md` §4. The row is the truth about what has shipped; the brief is the truth about what to build. If they disagree, stop and report.

Preflight is run sheet §3. Postflight is run sheet §6.

| Session | What | Status | Date | Merge SHA | Units before → after | Specs added or edited | ⚑ touched (value shipped) | Next session should know |
|---|---|---|---|---|---|---|---|---|
| S0 | Commit the pack; baseline screenshots | DONE | 9 Oct 2026 | `6cddf09` (PR #221) | 3375 → 3375 (332 files) | Added `e2e/customer-journey/ui-refresh-baseline.spec.ts` — 11 journeys × 390/1440, 43 shots each width, 22/22 on C1 (3.1 min, teardown 26 → 0). No spec edited. | none | Built on `main` `964a1dd`; nothing in app/wizard, app/estimate, lib/wizard or e2e/customer-journey changed since `ed5a94c`, hooks list identical. **customer-journey is RED on main** (36 failed, S6 details-first gate) — fix is the unmerged `fix/customer-journey-gate-9oct`; S1's gate "existing wizard e2e pass unchanged" needs that merged first. Shots are in `ui-refresh-shots/before/` (gitignored), NOT `test-results/` (ruling 9 Oct). **S9 must run in this same worktree** (`../paint-group-platform-uirefresh`). **Re-take the before set after the gate fix merges** (ruling 9 Oct), then S1. |
| S1 | The shell, on every path | DONE | 9 Oct 2026 | PR from `feat/wizard-ui-refresh-s1` (head `adac147`; SHA on merge) | 3375 → 3413 (+38 `app/wizard/stepRail.test.ts`; 3416 with main) | Added `e2e/customer-journey/ui-refresh-steps.spec.ts` (rail = `stepsFor()` on 8 paths; 64px header, 560–640px column, fixed phone bar). No spec edited. Spec FIX shipped separately: `staff-wizard-new-editor.spec.ts` (#224 — exact "+ New estimate" name; walks /estimate). | 10 ON (chat in header); 21 default (page list untouched); capitals: CSS only | S2 fills `.wz-side` (aside `ql-side`, sticky, 430px) and moves `ql-talk` into it. Keep motion on `.wz-pane > *` children only — a transform on any ancestor of `.wz-nav--col` un-fixes the phone bar. Rail names live in `app/wizard/stepRail.ts`. S1 screenshots: `ui-refresh-shots/s1/`. Inside/Outside/Both picture cards and the Job surface order (Walls first) are S2's. |
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
| S0 (mockup, all six job types) | 9 Oct 2026 | **"mockup approved"** (Tom, all six job types, on the published page; Switzer was blocked by the viewer, so the type is judged in S1) |
| S1 | 9 Oct 2026 | **"s1 looks good"** (Tom, phone + laptop, on the C1 test server) |
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
- **S1 · text on the primary button.** Brief §5 sets `--oncyan` to `#03272D` "on `--paint`". `--oncyan` is already the WHITE text on the dark cyan across the editors, so redefining it would put dark text on dark cyan there. Followed: a new `--onpaint: #03272D`; `--oncyan` stays white.
- **S1 · page colour.** Brief §5 says page `#F2F5F6`; `exterior-quick-look.spec.ts:51` pins the 5 Oct light theme at `rgb(244, 246, 248)` and a spec may only change for ⚑ 7 wording. Followed: the page stays `#F4F6F8` (indistinguishable); every other §5 token is in.
- **S1 · where the rail's unit test lives.** Brief §10 asks for a unit test that walks every path; Vitest only ran `lib/**`, and the run sheet closes `lib/wizard` to this plan except `ui-flags.ts`. Followed: `app/wizard/stepRail.ts` + `stepRail.test.ts`, and `vitest.config.mts` includes `app/wizard/**/*.test.ts` — **a one-line config change outside the allowed list; needs Tom's OK in the S1 diff.**
- **S1 · staff and the new shell.** ⚑ 21 says staff see the older five-page list. Since 6 Sep (6ac528dd) staff "New estimate → Start with the wizard" opens the CUSTOMER estimator at `/estimate`, so staff running it get the new shell too; only `/wizard` and `?entry=upload` still show the page list, which keeps its own header and single column.
- **S1 · left for later sessions.** Inside / Outside / Both stay a segmented control until S2 draws their pictures; the Job step's surface order (Window frames first) comes from `exclusionOptions()` in `lib` (S2 orders it in the UI); "The lot ✓" carries its tick in its words; the gate button still reads "Show my guide price" (`gate.spec.ts` asserts it — a ⚑ 7 wording change for the session that takes ⚑ 7); `ConditionBox` (page list) and `WhatWeDo` (range, S3) keep their capitals.
