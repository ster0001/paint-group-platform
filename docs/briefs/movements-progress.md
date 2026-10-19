# Movements — progress ledger

| Session | Branch | PR | Migration | _prod_migrations row | Status | Date |
|---|---|---|---|---|---|---|
| 0 recon | — (on `main`: bundle `2ef8a38f`, report) | — | — | — | ✅ report written: `docs/briefs/movements-session-0-report.md` | 19 Oct 2026 |
| 1 schema + seed | feat/movements-s1-schema | | 2027NNNN0000_movements.sql | | | |
| 2 board engine | claude/optimistic-williamson-b85dd5 (worktree; the plan's name `feat/movements-s2-board-engine` was not used — the session ran on its own branch) | to open from the compare link (no `gh`); body = `docs/briefs/movements-session-2-report.md` | — | — | ✅ built: `app/components/board/` (engine), `ScheduleBoard.tsx` re-pointed, `e2e/board-engine.spec.ts` 3/3, Schedule specs 23/26 on C1 with the 3 reds reproduced on main (pre-existing), CLAUDE.md ruling, boundary test | 19 Oct 2026 |
| 3 evaluator | feat/movements-s3-evaluator | | — | — | | |
| 4 week | feat/movements-s4-week | | — | — | | |
| 5 day + texts | feat/movements-s5-day | | | | | |
| 6 map + gear + settings | feat/movements-s6-map | | | | | |
| 7 crossings | feat/movements-s7-crossings | | | | | |
| 8 proof | feat/movements-s8-proof | | — | — | | |

## Decisions taken in sessions (⚑ numbers from the brief)
- S0: ⚑6 resolves to **titles** — both connected staff calendars hold `calendar.readonly` (report item 3).
- S0: ⚑4 **not done** — no browser Maps key in `.env.local`; Vercel unverified. Steps in report item 8.
- S0: ⚑12 — the template CSV's categories (`sprayer, ladder, sander, scaffold, trestles, exterior`) are not the brief's nine; Session 1's seed maps by name and refuses what it can't map (report item 9.1) unless Tom replaces the CSV first.
- S0: ⚑1 default — the company address is `settings.company_profile`, not a table (report item 9.7).

## Defects found and fixed
- S2 (found, not fixed): the C1 `next start` server sometimes exits with `The destination stream closed early` right after a `/pc/schedule` render (seen three times, with main's code and with the engine's); every spec after it fails with `ERR_CONNECTION_REFUSED`. Re-run the batch; not a code defect this session could place.
- S2 (found, not fixed — pre-existing on main, reproduced with the engine removed): `board-and-paint-usability` sticky-header test fails on a 0.4 px sub-pixel gap; `schedule-end-date-in-progress` "moves the END only" opens the detail sheet from the pointer sweep and then blocks its own click on the scrim; `employee-assign` "changing the lead" expects `ok:lead` but `set_lead_painter` returns `ok:lead_set` since `20270230`.
- S0 (found, not fixed): `docs/gcal-setup.md:67` carries a plain-text contractor test login — to remove.
- S0 (found, not fixed): `20270215000000_wo_after_photos_waiver.sql` and `20270250000000_import_set_scope_real_pay.sql` have no `_prod_migrations` row.
- S0 (found, for S2): the Schedule drag has no pointer capture and no edge auto-scroll; day index is resolved by DOM order, not `data-day`.

## Session 0 — summary (19 Oct 2026)
Read-only. Bundle committed on `main` (`2ef8a38f`, with a `.gitignore` exception for `docs/briefs/data/*.csv`). File list confirmed complete. Ledger: `20270243`, `20270248`, `20270266` all live. `products.brand`: 7 of 47 blank (Dulux Professional Gloss Enamel among them) and `Cabot's`/`Cabots` split. Suburb centroids: 53/53 seed suburbs covered. Contradictions in report item 9 (12 points); the ones that change a session's work are 9.1 (seed categories), 9.2 (gate items addressed by label), 9.3 (Materials rows are snapshot JSON, no table), 9.9–9.11 (drag engine gaps, DOM-order hit-testing, no `e2e/scheduling/` dir).

## Session 2 — summary (19 Oct 2026)
The Schedule board's lanes × days machinery is one engine in `app/components/board/` (Board, Lane, DayCell, Tray, SavedViews, Controls, chrome, useBoardDrag, useBoardZoom); `ScheduleBoard.tsx` 2,230 → 1,776 lines with zero behaviour change (specs unedited; `schedule.css` untouched). Drop targets resolve from `data-lane`/`data-day`/`data-slot` (9.10 closed); pointer capture and edge auto-scroll exist behind options that default OFF (9.9 — Tom's phone check is the gate before S4 turns them on). The S0 gate list named the flat specs (9.11). For S4: the engine's base CSS still lives in `schedule.css` — import it or move it in a pure-move PR.

## Tom's Session 4 notes → docs/briefs/movements-s4-notes.md
