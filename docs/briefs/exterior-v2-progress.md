# Exterior wizard v2 — progress ledger

**Read this first in every session. Update it last.** One row per session from `claude-code-brief-exterior-wizard-v2.md` §9. The row is the truth about what has shipped; the brief is the truth about what to build. If they disagree, stop and report.

Gates (brief §9): `npm run build`, `npx tsc --noEmit`, `npx eslint --max-warnings 4 .`, `npm test`, the named Playwright specs with `E2E_BASE_URL` set via `./scripts/c1/run-e2e.sh` (one worktree runs e2e at a time; if the lock is held, wait once and report). Every session ends WAITING FOR GO with Tom's phone-check line.

## Sessions

| Session | What | Status | Date | Branch / PR / merge SHA | Specs added or edited | ⚑ touched | Next session should know |
|---|---|---|---|---|---|---|---|
| S0 | Pack committed, ledger started, "before" screenshots, spec state recorded | DONE — WAITING FOR GO | 19 Oct 2026 | `feat/exterior-wizard-v2-s0` from `origin/main` `5e24bcf7` (worktree `../paint-group-platform-exteriorv2`); PR link in the S0 PR | None added, none edited. The six current exterior specs were RUN, not changed (state below). | none | The brief was written against `837f6115`; nothing in `lib/wizard`, `app/wizard`, `app/estimate/scope` or the six exterior specs changed between `837f6115` and `5e24bcf7` (the only touches were `lib/wizard/journey.ts` and `lib/pricing/labour.ts` for booked labour — unrelated). §2 row 9's "Where" is stale (below). Shots: `ui-refresh-shots/exterior-before/390/` in this worktree, gitignored. The worktree has no `node_modules` or `.env.test.local`; S0 ran the server and the specs from the main checkout, whose exterior code is identical — S1 onward should `npm ci` and copy `.env.test.local` into the worktree first. |
| S1 | Data and model: `exterior_typicals` migration + seed, `v2` state schema, `lib/wizard/exterior-model.ts`, golden bungalow unit tests, envelope narrowing | TODO | | | | 2, 7, 8, 11, 12, 13, 18 | |
| S2 | Your home + the picture: `Elevation.tsx`, `typeThumb`, the `home` step, `stepsFor` behind `exteriorV2` | TODO | | | `exterior-v2-home.spec.ts` (new) | 3, 10 | |
| S3 | Painting + About it | TODO | | | `exterior-v2-paint.spec.ts`, `exterior-v2-about.spec.ts` (new) | 5, 9 | |
| S4 | Each side + gate + the guide range | TODO | | | `exterior-v2-sides.spec.ts`, `exterior-v2-range.spec.ts` (new); `exterior-path.spec.ts` updated | 0, 14 | |
| S5 | Tighten + the detailed range + both | TODO | | | `exterior-v2-tighten.spec.ts` (new); `sides-editor.spec.ts`, `both-stacked.spec.ts` updated; `outside-commercial.spec.ts` unchanged and green | 1, 4 | |
| S6 | Finish: old steps behind the flag, specs rewritten, help, "after" shots, ARCHITECTURE, parking lot | TODO | | | `exterior-quick-look.spec.ts`, `exterior-batch-15sep.spec.ts` rewritten to v2 | 17 | |

## Tom's phone checks

| Session | Checked on | Result |
|---|---|---|
| S0 (the mockup: all three Try presets — Bungalow, Townhouse, Terrace — and one full walk-around) | | |
| S1 (golden bungalow quantities match how he measures — ⚑ 7, ⚑ 8) | | |
| S2 (each shape: "does it look like that house?") | | |
| S3 (tick a bungalow fully; walls → render and watch the picture) | | |
| S4 (a whole quick path; gable added on the right of a bungalow; the guide range for a bungalow and a townhouse) | | |
| S5 (tighten a bungalow with a right-side gable; open as staff and see that side's gable line) | | |
| S6 (final: all three presets + a unit) | | |

## Rulings log (brief §12)

Each ⚑ has a default so the build never waits. A ruling from Tom goes in the Ruling column with its date; the session that ships it goes in Shipped in.

| ⚑ | Decision | Default | Ruling | Shipped in |
|---|---|---|---|---|
| 0 | Where the walk-around sits | After the range (the tighten step) | | |
| 1 | Condition per side on the tighten step | Per side | | |
| 2 | The typicals table numbers (§5.1) | The brief's numbers, flagged `source: proposed` in the seed | | |
| 3 | The nine home shapes and their names | As listed | | |
| 4 | Shingles have no rate row | Deferral — estimator prices; the range says "not in this number" | | |
| 5 | Brick home default: walls start "not painted"; ticking walls asks "painted before?" | As described | | |
| 6 | Weathered ×1.8 vs peeling ×1.35 on the card | Unchanged; parking lot | | |
| 7 | Gable sides: fascias = the rake; gutters = 0 on the gable side | As described | | |
| 8 | Verandah rules: posts `max(2, round(0.8w ÷ 2.6) + 1)`; ceiling `0.8w × 2.4`; handrail `0.8w`; iron lace = `Posts` + deferral | As described; editable after the range | | |
| 9 | Shutters price at `Wood Shutters` | `Wood Shutters` | | |
| 10 | Shared sides pre-set "not painting" (townhouse L+R, unit L, terrace L+R) unless the row answer opens them | As listed | | |
| 11 | Downpipes: 1 per side, 2 if over 10 m | As described | | |
| 12 | Default window counts by width (`round(w ÷ 4.5)` front/back, `round(w ÷ 5)` sides, × storeys) | As described | | |
| 13 | "Not sure" size keeps the typical, stays flagged, counts as unconfirmed | As described | | |
| 14 | Tighten door first; after every side is checked it reads "Change a side" and Book a site visit is primary | As described | | |
| 15 | No deduction for openings from wall area | Keep | | |
| 16 | Roof painting chip | Not now | | |
| 17 | Production switch: `exteriorV2` ON in production after S6 | Tom flips it | | |
| 18 | Double storey: equal halves; a single storey never gets a second material | As described | | |
| — | **Mockup approval** (the S0 gate) | Build waits for "Mockup approved" | | |

## S0 — the "before" state (19 Oct 2026)

**Screenshots** — `ui-refresh-shots/exterior-before/390/` (this worktree; `/ui-refresh-shots/` is in `.gitignore` line 69). Anonymous customer at 390 × 844, emulated phone, against the C1 test server on :3101 (`.env.test.local`, production refused by `scripts/c1/env.mjs`). Path: start → outside picked → place → outside (empty, then body + windows + doors + fascias + gutters, weatherboards, casement, new colours) → sides → gate → range → Tighten → the sides editor (Front open).

| Shot | Screen |
|---|---|
| `01-start.png`, `01b-start-exterior-picked.png` | Start: address, then Outside picked |
| `02-place.png` | Place (kind only — no bedrooms, no storeys on an outside job) |
| `03-outside-empty.png`, `04-outside-answered.png` | Outside: nothing pre-ticked; then the gated questions (materials, window type, counts 8 / 2, colours, storeys, access) |
| `05-sides.png` | Which sides? |
| `07-range.png` | The guide range — `$7,050 – $12,520` (Guide · within 28%), four doors |
| `07b-tighten-details-sheet.png` | Tighten opened the "A few details first" sheet — C1 is on **range first**, so there was no gate step (no `06-gate` shot; the gate screen is the same component as the inside path's, `ui-refresh-shots/before/390/06-gate.png` in the UI-refresh worktree) |
| `08-sides-editor.png`, `09-sides-editor-front-open.png` | The after-range sides editor: house-from-above, condition question, Front open on "How big is this side?" with the 12 × 2.6 m typical |

Taken by a throwaway Playwright script (not a spec; no e2e lock) driving `/estimate` on :3101; the walk filed one `@example.com` estimate (`fdd461d1-…`), which the hygiene sweep removes.

**The six exterior specs, as they stand on `5e24bcf7`** — run with `./scripts/c1/run-e2e.sh <the six files>` from the main checkout (identical exterior code; the worktree has no `node_modules`).

Lock acquired first try; 20 tests, **15 passed / 5 failed**, 8.7 min.

| Spec | Result | Note |
|---|---|---|
| `exterior-path.spec.ts` | 1/1 PASS | the `?entry=upload` page set |
| `exterior-quick-look.spec.ts` | 3/4 — **Tom's check 3 FAILS** (`[data-side="front"]` never visible after `door-tighten`, 60 s) | same cause as below |
| `exterior-batch-15sep.spec.ts` | 0/4 — **all four FAIL** in `toEditor` (`.sd-card` never visible after `door-tighten`, 90 s) | same cause |
| `sides-editor.spec.ts` | 3/3 PASS | reaches the editor through `driveNoPlanWizard`, which passes the sheet |
| `both-stacked.spec.ts` | 1/1 PASS | |
| `outside-commercial.spec.ts` | 7/7 PASS | must stay unchanged through S6 |

**The one cause of the five reds:** the C1 test project's booking rules are on **range first** (15 Oct, portal-shell session), so the gate never runs and the Tighten door opens the "A few details first" sheet (`talk-sheet`); the failure screenshots show that sheet over the range. `drive.ts` gained `passDetailsSheetIfShown` for this on 15 Oct (`fcc7f60b`) but these five tests click `door-tighten` directly. They are red for the environment, not for the product — they would pass with C1 back on details first, and the S4/S6 rewrites should go through `passDetailsSheetIfShown` after Tighten so they hold under either setting.

## Differences found between the brief and the repo (at `5e24bcf7`)

One line each: what the brief says, what the repo does, which one to follow.

- **§2 row 9 — "Where" is stale.** The brief says `lib/wizard/sides.ts WALL_CODES` offers only "Brick". At HEAD `WALL_CODES` (L62–77) already carries `Brick (Unpainted)` → "Unpainted brick (3 coats)" (migration `20260925000000_unpainted_brick.sql`), so the after-range sides editor does offer bare brick. The finding still stands for the **quick look**: `EXT_MATERIALS` in `lib/wizard/exterior-quick-look.ts` (L116–123) offers one `brick` and `applyExteriorQuickLook` maps it to `Brick`. S3's "painted or bare brick" question is the fix; the sides editor needs no new code for it.
- **§3 — a same-named reference already exists.** `design/reference/customer-review-confirm-exterior-v2-sides.html` has been in the repo since R0 (`8e3d8ce2`). It is the older customer-review sides mockup, not this brief's, and it is not overwritten; the new mockup is `design/reference/exterior-wizard-redesign-mockup.html` as the brief names it.
- **§2 row 3 — line numbers drifted by a few lines.** The exterior trim rows in `supabase/seed/ratecard_v7.sql` are L195–205 at HEAD (Soffits L196, Columns L198, Posts L199, Downpipes L200, Wood Shutters L201, Strapping L202, Hand Rails L205), Stucco L189, `Cutek` L194. Same rows, same rates; the brief's L195–213 range just over-reaches.
- **§2 row 1 — holds.** `SIZE_BAND_FACTOR` is `lib/wizard/starter.ts:170` (`lt120 0.9 / s120_200 1 / gt200 1.15 / unsure 1`), read at `exteriorAnswers.ts:172`; the only writer of `exterior.sizeBand` is the staff-mode outside page (`WizardApp.tsx:3341`, `ext-size-band`). Neither `exterior-quick-look.ts` nor `QuickLook.tsx` mentions `sizeBand`.
- **§2 rows 2, 4, 5, 6, 7, 8 — hold.** `scaffoldCladdingCode` `starter.ts:304–313`; `spreadOverSides` `starter.ts:349`; `conditionOpen` `envelope.ts:55`, `applyConditionPricing` `exteriorAnswers.ts:382`; `panelling → colorbond` `exterior-quick-look.ts:122,196`; `EXT-WEATHERED` 1.8 at `20260922…:54–56`, `COND-POOR` 1.35 at `ratecard_v7.sql:39`; `computeQuantity` `lib/pricing/estimate.ts:380`.
- **§3, §6, §7 pointers — hold.** `exterior` schema `state.ts:411–497`; `stepsFor("exterior")` = `withGate(["start","place","outside","sides"])` (`quick-look.ts:567`, gate appended under details-first); `QuickLook.tsx` outside step at L522, sides at L644; `builtPre1970` in `policy.ts:144/166/196`; `room_type_defaults` read at `scope-store-supabase.ts:54`; `DEFAULT_BANDS.midPct = 8` (`policy.ts:68`); the elevation-source rule is `lib/extract/exterior.ts:7`; the extras migration `20260921` carries the five rows the brief lists plus `Carport $520`.
- **§3 — every file the brief names exists at HEAD** (34 paths checked: the three docs, the fourteen code files, the four unit tests, the six specs, the two help files, the seed and the two migrations).
- **S0 process.** The main checkout was on another session's branch, so S0 made its branch as a git worktree (`git worktree add … origin/main`) rather than switching the shared checkout — `../paint-group-platform-exteriorv2`, per the brief's "in its own worktree".
