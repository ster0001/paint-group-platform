# Movements — Session 2 report (the board engine)

**Date:** 19 Oct 2026. **Branch:** `claude/optimistic-williamson-b85dd5` (worktree). **PR:** open it from https://github.com/ster0001/paint-group-platform/compare/main...claude/optimistic-williamson-b85dd5 — this file is the PR body.

## File list (report item 1, build plan Session 2) — confirmed

Read before building: `docs/briefs/claude-code-brief-pc-movements.md` §4, `docs/briefs/movements-build-plan.md` Session 2, `docs/briefs/movements-session-0-report.md` item 1 (extraction plan, rows 1–18, CSS classes, test IDs, the six gate specs) and item 9 points 9–11. All present. Not touched: `supabase/migrations/`, `lib/movements/` (Session 1's).

---

Movements Session 2 (`docs/briefs/movements-build-plan.md`, brief §4): the Schedule board's lanes × days machinery is lifted into **`app/components/board/`** — one engine — and `app/pc/schedule/ScheduleBoard.tsx` is re-pointed at it with **no behaviour change**. No Movements screen. No migration.

## What moved where

| Engine file | Lifted from `ScheduleBoard.tsx` (Session 0 report item 1 rows) |
|---|---|
| `useBoardDrag.ts` | rows 10–13: pointer drag (5 px threshold, `.dragging`, ghost on rAF `translate3d`, hit-test in the pointer handler, window listeners torn down by one `AbortController`), drop targets via `document.elementsFromPoint`, `.hot` / `.lane.blocked` toggles, the marquee (`.marq`) |
| `useBoardZoom.ts` | rows 1, 3, 4: window state + debounced `onWindowChange`, fit-to-range, zoom bounds, paging |
| `Board.tsx` | rows 2, 6, 8, 9, 12, 15, 16: measured `--sb-space`, month band + day header (`board-header`), greedy sub-row packing, block positioning off `--day-w`, the `.ghost` wrapper, sessionStorage scroll persistence |
| `Lane.tsx` / `DayCell.tsx` | rows 7, 17, 18: `.crow` / `.cinfo` / `.lane` (`data-testid="lane"`) / `.bgc` with `data-day` + `data-label`, overlay slot, block renderer binding |
| `Tray.tsx` | row 14: `.tray`, search (`tray-search`, `tray-no-match`), prelude slot, item renderer |
| `SavedViews.tsx` | row 5: the `filters-open` popover, saved views list + save + delete, Clear |
| `Controls.tsx` | Back / Today / Next, Jump to, 2w/4w/8w, zoom slider — same markup |
| `chrome.tsx` | `Scrim`, `Sheet`, `Toast` |
| `format.ts` | `monthRuns`, `dayLabel`, `dayParts` |
| `board.css` | only what the engine ADDED (sub-slot cells). `schedule.css` is **untouched** — the engine's base `.sb` rules still live there, including the `.pc .sb .lane` override. |

`ScheduleBoard.tsx` goes 2,230 → 1,776 lines and keeps everything a *booking* means: working-day snapping, blocked/held spans, the offer / assign / move sheets, block detail, block-out / visit / hold sheet, every commit action, the tray card and lane head content, every test ID.

## Every prop the engine grew, and why

**`useBoardDrag<P, C>`** (P = what a drag carries, C = what the drop check returns)
- `days`, `dayW` — the window; the day is resolved from the cell's `data-day` against `days`, the fallback arithmetic from `dayW`.
- `check(payload, target) → C` — the drop check, run once per cell entered; `C.blocked` / `C.held` tint the lane and the ghost. Schedule: `spanBlocked` / `spanHeld` + the working-day snap.
- `onDrop(payload, target)` — replaces `setPendingDrop` inside the engine. `target = { laneId, dayIndex, day, slot }`.
- `onRangeSelect(laneId, startDay, endDay)` — the marquee's result (Schedule: `setPendingBlock`).
- `capturePointer` — **new behaviour, default OFF** (see below).
- `autoScroll` (`boolean | { edge, step }`) + `scroller()` — **new behaviour, default OFF** (see below).

**`useBoardZoom`** — `from`, `rangeDays`, `onWindowChange(start, range)` (Schedule: `router.replace`), `presets` (`[14, 28, 56]`), `initialDayW` (64), `minDayW` (24), `maxDayW` (140), `fitMinDayW` (14), `step` (12), `debounceMs` (250). Returns `setScrollerEl` / `scrollerEl()` rather than a ref object (React Compiler lint).

**`<Board>`**
- `lanes`, `laneId`, `filterLane` — the lane model stays the caller's; the filter predicate is Schedule's (tiers / picked / offerable with the employee exception).
- `blocks`, `blockId`, `blockLane`, `blockStart`, `blockEnd` — accessors instead of a fixed `Block` shape.
- `countsTowardLoad(block)` — what the lane head's `peak/crew` counts (Schedule: not `unavailable`, not `hold`).
- `blockPayload(block)`, `isMovable(block)` — what a picked-up block becomes, and which can be picked up.
- `rowHeight` (52) — the sub-row pitch that was hard-coded in the TSX.
- `slots: "none" | "half" | "hour"`, `slotHours` — cell sub-slots (AM/PM halves, hourly rows) carrying `data-slot`; the engine reports the slot under the pointer. Schedule renders `"none"` → identical DOM.
- `laneHeadTitle`, `renderLaneHead(lane, layout)`, `laneData(lane)` (extra `data-*` on the lane: `data-contractor-id`, `data-contractor-company`), `renderLaneOverlay(lane)` (walkthrough pins), `renderBlock(block, bind)` (bind = position style + drag handle), `renderGhost(payload, check, target)`, `emptyMessage`.
- `storageKey` — scroll persistence key (`"pc-schedule:scroll"`).
- `header`, `tray`, `children` — the `.top` bar, the aside, the sheets.

**`<Tray>`** — `items`, `itemKey`, `searchText(item)`, `searchPlaceholder`, `searchLabel`, `title`, `sub`, `emptyText`, `noMatch(query, total)`, `prelude` (approvals + lapsed banner), `renderItem(item, bind)`, `onDragStart(e, item)`, `hint`.

**`<SavedViews<F>>`** — `label`, `filtered`, `views`, `onPersist` (Schedule: `settings.scheduling_views` upsert), `current`, `onApply`, `onClear`, `promptText`, `children` (the Tier / Ready / Pick controls).

Also new, additive: `data-lane="<id>"` on every `.lane` element (the engine resolves the lane from it; `data-contractor-id` stays).

## The one deliberate change — for Tom's phone check

Session 0 item 9.9: the Schedule drag has **no pointer capture and no edge auto-scroll**. Both now exist in the engine, both **default OFF**, and `ScheduleBoard.tsx` passes `capturePointer: false, autoScroll: false` explicitly — so the Schedule board's behaviour is unchanged and its specs pass with zero edits. Turning either on for the Schedule board is a separate, phone-checked decision (S4 turns them on for Movements). What to check on the phone: `/pc/schedule`, drag an offer from the tray onto a lane exactly as before — the ghost, the hot cell, the confirm sheet.

The hit-test now resolves the day from the cell's `data-day` (not its DOM position among the lane's children — Session 0 item 9.10). Same element, same day, same result on the Schedule board; it is what lets a sub-slot be a target later.

## Ruling recorded

`CLAUDE.md` → Architecture boundaries → **One board engine**. Pinned by `app/components/board/boundary.test.ts`, which greps `app/` and `lib/` for a board hit-test, a `.bgc` day cell, a `.hot` toggle or a `.marq` outside the engine.

## Tests

- `npx tsc --noEmit`: clean. `npx eslint --max-warnings 4 .`: 0 errors, 3 warnings (pre-existing).
- Unit: `npm test` 362 files / 3,688 green before the boundary test; `app/components/board/boundary.test.ts` 2/2 green.
- e2e on C1 (`./scripts/c1/run-e2e.sh`), **zero edits to existing specs**: `board-engine` (new, 3), `schedule-drag-dates`, `schedule-hold-visit`, `schedule-end-date-in-progress`, `board-and-paint-usability`, `employee-assign`, `wo-reschedule` — 23 passed, 3 failed — all three failures reproduce identically against main's `ScheduleBoard.tsx` (control run on C1 with the engine removed), so none is from this PR:
  - `board-and-paint-usability` "the month, day and date stay locked" — the timeline's bottom edge sits 0.4 px below the viewport (`bottomGap = -0.40625`, expected ≥ 0); sub-pixel, on main too.
  - `schedule-end-date-in-progress` "moves the END only" — the pointer sweep across a started block fires its click, the detail sheet opens, and the spec's own `block.click()` is then blocked by the scrim; on main too.
  - `employee-assign` "changing the lead" — pure RPC: `set_lead_painter` now returns `ok:lead_set` (migration `20270230`), the spec still expects `ok:lead`. Stale spec, no browser involved.
- Second batch (lighter touches): `offer-accept`, `wo-walkthrough-v3`, `_look-mobile` — `offer-accept` 1/1 green; `_look-mobile` "staff pages at phone width" green; `wo-walkthrough-v3` 5/9 — the four after "the booked final pins onto the staff schedule board" (which passed) never ran their assertions: the C1 `next start` process exited right after that board visit (`⨯ Error: The destination stream closed early`, then `ERR_CONNECTION_REFUSED`). The same exit happened in the control run with **main's** `ScheduleBoard.tsx` (after the first board-and-paint-usability test) and again on a re-run, and did NOT happen during the 26-test first batch, so it is an environment/Next 16.3.5 behaviour on C1, not something the engine introduced. Logged as a finding, not fixed here.
- Not run here: `status-offers-payment-bonus`, `pc-search`, `airtable-import`, `help-capture/*` (grep-matched touches on tray cards / lane labels only). CI's e2e job runs the customer-journey suite, not the Schedule specs.

## Follow-ups (not in this PR)

- Move the engine's base `.sb` rules from `schedule.css` into `board.css` (a pure move, verified by the same specs) once a second consumer exists — Session 4.
- The ghost renders at the viewport origin for the frame between pointer-down and the first move past 5 px (pre-existing; kept as-is for zero change).
