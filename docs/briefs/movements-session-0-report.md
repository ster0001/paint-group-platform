# Movements — Session 0 report (read-only reconnaissance)

**Date:** 19 Oct 2026. **Brief:** `docs/briefs/claude-code-brief-pc-movements.md` v2.2. **Plan:** `docs/briefs/movements-build-plan.md`.
**Bundle commit:** `2ef8a38f` on `main` (brief, plan, mockup, two CSVs, plus a `.gitignore` exception `!docs/briefs/data/*.csv` — the repo ignores every CSV by default and the earlier briefs' CSVs had been force-added).
No code, no migrations, no production writes. Production was read through `IMPORT_DATABASE_URL` with `default_transaction_read_only=on` (`scripts/diag/s0-movements-recon*.mjs`, untracked).

## File list (brief §0) — confirmed

Every repo file in the §0 table exists on `main`. The five bundle files are now in the repo at the paths the plan names. Nothing missing.

One label mismatch, not a missing file: the mockup's header comment (line 7) and footer (line 470) say **"design reference v3"**, while the brief and plan call it **v4**. The content is v4 — it has the three rubbish options (line 767), the drag-to-reorder order card beside the map (lines 935–944, pointer events) and `attachDrag` on chips (line 746). Treat the file as v4; only its own label is stale.

## 1. `app/pc/schedule/ScheduleBoard.tsx` — responsibilities and the Session 2 extraction plan

`ScheduleBoard.tsx` is 2,230 lines, `"use client"`, with no local hooks or sub-components (only `BlockOutBar` inline at L2172–2230). Types come from `lib/scheduling/board.ts`, date helpers from `lib/scheduling/dates.ts`, offer helpers from `lib/scheduling/offers.ts`. `app/components/board/` does not exist yet.

### Board-generic (lift into the engine)

| # | Responsibility | Lines | State / refs | What becomes a prop |
|---|---|---|---|---|
| 1 | Window state + URL push (250 ms debounce → `router.replace('/pc/schedule?from=&days=')`) | 91–97, 175–191 | `range`, `start`, `days`, `today` | `onWindowChange(start, range)`; the `fromHere` back-link (97) stays in Schedule |
| 2 | Measured scroller height → CSS var `--sb-space` (ResizeObserver + `resize`) | 98–131 | `tlRef`, `rootRef` | none |
| 3 | Zoom + fit-to-range → CSS vars `--day-w`, `--days` | 91, 138–142, 1079–1094, 1056 | `dayW` (14–140 fit, 24–140 slider) | min/max day width, range presets `[14, 28, 56]` |
| 4 | Paging: Back / Today / Next / Jump-to date | 1067–1077 | — | none |
| 5 | Lane filters + saved views (`settings.scheduling_views` upsert at 172, `window.prompt`) | 145–173, 1097–1151 | `tiers`, `picked`, `onlyOfferable`, `views`, `showFilters`; `visibleLanes` 156–168 | `filterLane(lane, state)` predicate (tier/offerable and the employee exception at 164 are Schedule's), `savedViews` + `onSaveViews`, lane label accessor |
| 6 | Month band + day header (sticky `.hdr`, `.we`, `.today`, weekday initials under `dayW < 34`) | 26–35, 44–51, 1378–1403 | — | lane-head column title (1388) |
| 7 | Lane rows, sticky `.cinfo`, one `.bgc` per day with `data-day` / `data-label` | 1405–1455 | `laneRefs` (197, ref callback 1448) | **lane header renderer** (1415–1441 is all Schedule content), lane id accessor, lane `data-*` extras |
| 8 | Greedy interval packing into sub-rows | 1025–1054 | `laneLayout` | block id/lane/start/end accessors; optional `countsTowardLoad(block)` (the `peak` that excludes `unavailable`/`hold` is Schedule's) |
| 9 | Block positioning from `--day-w` + row | 1480–1524 | — | **block renderer** (inner `.t/.m/.cd` + kind classes), `isMovable(block)` (1484), `onBlockClick` (1504), block `data-*` provider (1489–1497) |
| 10 | Pointer drag core: 5 px threshold (372), `.dragging` on source (374), ghost on rAF `translate3d` (314–319), hit-test in the pointer handler not rAF (310–313), listeners on `window` torn down by `AbortController` (463–485, 519–524) | 193–216, 310–381, 399–439, 488–525 | `drag {kind, job?, block?, spanDays, el, startX, startY, moved, pointerId}`, `ghostRef`, `hotCell`, `rafId`, `pointer`, `laneRects`, `target`, `dragAbort` | payload type + `spanOf(payload)` (494–497), **drop validation** (today `spanBlocked`/`spanHeld` 288–308), **date snapping** (today `addWorkingDays`/`weekFor`/`endFor` 282–286, 356–357, 413), `onDrop({payload, laneId, dayIndex})` instead of `setPendingDrop` (411–424) |
| 11 | Drop-target mechanism: `document.elementsFromPoint(x, y)` (plural) → first `.bgc` whose parent is `.lane`; lane matched against cached `laneRects[].el`; **day index = the cell's DOM position among `laneEl.children`** (so `.bgc` cells must be the first `range` children); fallback by cached rect y-range + `floor((x-left)/dayW)`; `.hot` on the cell, `.blocked` on the lane, `clearHot` (272–278) | 329–363 | `ghostBlocked`, `ghostHeld`, `ghostDates` (218–226) | the sub-slot resolver: for AM/PM and hourly cells the engine must resolve (lane, day, **slot**) — `data-day`/`data-slot` attributes instead of DOM order |
| 12 | Drag ghost `.ghost` + `.blocked/.held`, lines `.g1/.g2/.g3` (`data-testid="ghost-dates"`) | 1545–1556, text built 511–518 | `ghost {title, sub}` | ghost renderer `(payload, target) => node` |
| 13 | Marquee drag across empty lane space (`.marq`, index by rect arithmetic, starts only on a bare `.bgc` at 455) | 228–232, 441–486 | `marquee {contractorId, anchor, laneEl, pointerId, moved}` | `onRangeSelect(laneId, start, end)` (today `setPendingBlock`) |
| 14 | Tray with search: client-side substring over `${title} ${woRef} ${suburb}` (586–588), no debounce; empty states 1236/1238; cards start a drag on `onPointerDown → beginDrag` (1271); links/notes stop propagation (1283, 1312) | 582–588, 1222–1362 | `traySearch` | **tray item renderer**, search-text accessor, `isDraggable(item)` (1243: `needsIssuing` cards aren't), tray prelude slot (approvals, lapsed banner) |
| 15 | Scroll persistence in `sessionStorage` `"pc-schedule:scroll"` (rAF-throttled, `pagehide`, one-shot restore) | 544–577 | — | `storageKey` |
| 16 | Toast + side-sheet chrome (`flash` 649–652, `.scrim`/`.sheet` 1559–1562, toast 2166) | — | — | content slots |
| 17 | Blocked-day rendering (`.blk.unavailable`, css 229) and the drop-time `.lane.blocked` tint (css 205, 211) | 1509–1510 | — | block renderer covers it |
| 18 | Walkthrough pins as absolutely positioned lane overlays (`.wtpin`) | 1462–1478 | — | **lane overlay / cell sub-slot renderer** |

### Schedule-specific (stays in `ScheduleBoard.tsx`)

`money`, `coarseCountdown` (24 h SLA), `SavedView` (21, 55–63); visit project search (237–262, 220 ms debounced `searchProjectsAction`); the **pending-drop confirm sheet** (385–397, 1564–1762: offer vs assign, working-day date input, ± length, price vs time budget, override reason, note/QA/no-walkthrough boxes, walkthrough gate, `standardsStatus === 'blocked'` disabling confirm 1706–1731, routing 1733–1738); every commit action (`sendOffer` 662, `assignJob` 706, `moveAssignment` 736, `saveAssignmentDates` 756, `addPainter`/`makeLead`/`releasePainter` 768–796, `moveBooking` 798, `moveHeldOrVisit` 831, `saveVisit` 864, holds 892–945, `blockOut` 947, `resolve` 959, `cancelBooking` 984, `saveBlockOut` 999, `removeBlock` 1007 — a direct delete on `contractor_unavailability`); `handle(ActionResult)` 655–660; `isEmployeeLane` 640, `blockKind` 644; the block detail sheet (1765–2024); the empty-drag range sheet (2027–2161); tray card content (1243–1360) + chase notes (590–611); approvals list (1168–1207), lapsed banner (1212–1220), legend (1154–1161), hint (1363–1368), `BlockOutBar`; lane header content (1415–1441); block content + data attributes (1488–1521). All of `actions.ts` (660 lines: offers, assignments, finish date, block-out, notes, visits, holds, project search) is Schedule's.

### Touch

Pointer Events only (`onPointerDown` + window `pointermove`/`pointerup`/`pointercancel`); a drag follows only its own `pointerId`. `touch-action: none` + `user-select: none` on `.sb .jcard` (css 94) and `.sb .blk` (css 221). **`.lane` and `.bgc` have no `touch-action`**, so a marquee on empty space on a phone is probably taken by native panning (inferred, untested). Below 900 px: single column, tray `position: static; max-height: 45vh`, `.tl` scrolls horizontally with `.hdr` no longer sticky (css 62–63, 79–87, `.grid { min-width: min-content }` 141).

### CSS the engine relies on

Root `.sb` (vars `--day-w --days --lane-w --row-h --sb-space --sb-stick`), `.layout .tray .tl .grid`; header `.hdr .mb .mcell .spacer .dh .cell .lanehead .we .today .dw .dn`; lanes `.crow .cinfo .lane .bgc(.we/.hot/.marq) .lane.blocked`; blocks `.blk` + kind classes + `.hollow .visit .dragging`, `.jcard.dragging`; ghost `.ghost(.blocked/.held) .g1 .g2 .g3`; tray/controls `.traysearch .empty .seg.on .zoom .filters .fpop .viewrow .crow2 .lab`; overlays `.scrim.on .sheet.open .toast.show`. Inside PC Command the `.pc .sb .lane` override (css 337–355, light 412–434) is needed because the console's own `.lane` leaks in (189–195). **Hit-testing depends on the literal class names `bgc` and `lane`.** Unused: `.todayline` (css 213), `.blk.settling` (261). Sub-row height is hard-coded 52 px in TSX (1413, 1501) against `--row-h: 66px` in CSS.

### Test IDs the engine must keep emitting

`lane`, `tray-job` (+`data-wo-ref`), `tray-search`, `tray-no-match`, `ghost-dates` (+`data-start`/`data-end`), `board-header`, `filters-open`, `filter-offerable`, `drop-confirm`, `booking-start`, `booking-dates`, `booking-span-days`, `assignment-block`, `hold-block`, `visit-block`, `empty-drag-dates`, `mode-*`, `visit-*`, `hold-*`, `lane-employee`, `lane-status-<id>`, `walkthrough-pin-<id>`, `lapsed-banner`, `tray-lapsed`, `tray-cancelled`, `note-*`, `finish-date*`, `no-work-*`, `assignment-*`, `add-painter*`, `make-lead`, `release-painter`, `open-pc-job`.

### Tests that are Session 2's green gate

**There is no `e2e/scheduling/` directory** — the brief's "`e2e/scheduling/*` stays green" means these flat specs: `e2e/schedule-drag-dates.spec.ts` (ghost dates, `.bgc.hot`, `data-label`, sheet start date), `e2e/schedule-hold-visit.spec.ts` (marquee → visit/hold), `e2e/schedule-end-date-in-progress.spec.ts`, `e2e/board-and-paint-usability.spec.ts` (offerable filter keeps employees, sticky header, tray search, scroll persistence), `e2e/employee-assign.spec.ts`, `e2e/wo-reschedule.spec.ts` (Approve on the decision card). Lighter touches: `wo-walkthrough-v3` (pin), `status-offers-payment-bonus` (Red lane label), `pc-search`, `_look-mobile`, `airtable-import` (tray card), `offer-accept`, `help-capture/scheduling`, `help-capture/gif-scheduling`; also grep-matched: `demo-property`, `employee-portal`, `induction-room`, `revision-contractor-rate`, `status-full-loop`. Drags in specs use `page.mouse.move/down/move×N/up`, which arrive as pointer events. Unit tests cover only the libraries (`lib/scheduling/{dates,days,holds,lapsed,offers}.test.ts`, `lib/crm/work-queue-{holds,employee}.test.ts`, `lib/navigation/backTo.test.ts`); **no component test exists**.

### Extraction plan for Session 2 (in order)

1. `useBoardDrag` — rows 10–13 above, with `elementsFromPoint` kept but resolving `(laneId, dayIndex, slot)` from `data-lane`/`data-day`/`data-slot` on the cell, not DOM order; add `setPointerCapture` and edge auto-scroll **as additions the Schedule board doesn't exercise** (both are absent today — see item 9).
2. `useBoardZoom` + window/paging (rows 1, 3, 4) and the `--sb-space` measure (row 2).
3. `Tray` (row 14) with `renderItem`, `searchText`, `isDraggable`, `prelude`.
4. `Board` / `Lane` / `DayCell` (rows 6–9, 17, 18) with `renderLaneHead`, `renderBlock`, `renderOverlay`, `slots: 'none' | 'half' | 'hour'`, `countsTowardLoad`.
5. `SavedViews` (row 5) with `filterLane`, `savedViews`, `onSaveViews`; scroll persistence (row 15) by `storageKey`; toast/sheet chrome (row 16).
6. Re-point `ScheduleBoard.tsx`; CSS additive only (the `.pc .sb .lane` override must survive); all test IDs above unchanged; the six direct specs + the lighter ones green with zero edits.

## 2. `lib/scheduling/board.ts` `loadBoard`

- **Signature** `loadBoard(from, to)` ([board.ts:207](../../lib/scheduling/board.ts#L207)), inclusive ISO dates. Returns `BoardData = { lanes, blocks, tray, walkthroughs, approvals, errors }` (lines 165–173). It first calls the `expire_booking_offers` RPC (213–216, best-effort).
- **Employees vs contractors.** There is no employees table. Everyone is a `contractors` row; `contractors.employment_type` (`'contractor' | 'employee'`, added in `20270153000000_employment_type.sql:32–38`) is the only distinction. Mapped at line 350 (`employmentType`); anything but the literal `'employee'` is a contractor. Employees are booked through `wo_assignments` (283–289 → `assigned` blocks, 439–469); contractors through `booking_offers` (374–400) or `work_orders.contractor_id + start_date` (406–436). A job with assignments is skipped by the direct loop (408) so it is not drawn twice.
- **Painter names** come from the `profiles ( name )` embed on `contractors`: `c.profiles?.name || c.company_name || "Contractor"` (340).
- **End dates.** Offers: the stored `booking_offers.end_date` if ≥ start, else `addDays(start, daysFromHours(hours_allowance) - 1)` (380–382) — **calendar days**, not working days (`daysFromHours` = `ceil(hours / (8 × crew))`, min 1, lines 180–184). Direct bookings: the accepted offer's `end_date`, else the same fallback (416–418); with no offer `hours_allowance` is null and the block lasts **one day**. `work_orders.end_date` exists (`20261011000000_wo_booking_dates.sql:28`) but is **not in the select** at line 240 (only filtered on at 241). Assignments, extra visits, holds and unavailability use their stored dates. The working-day helpers in `lib/scheduling/dates.ts:60–98` are not used by `loadBoard`.
- **Suburb/address.** `Block` has none. Only `TrayJob.suburb` is derived, from `wo_snapshot.jobAddress` (line 648: `jobAddress.split(",").slice(-3,-2)[0]`).
- **Demo wall.** `realOnly()` on `work_orders` (238), `booking_offers` (248), `wo_walkthroughs` (274), `wo_assignments` (283), `wo_appointments` (296), `schedule_holds` (301).
- **Errors.** `paged<T>()` (17–25) turns a thrown read into `{data: [], error}`; errors are collected as strings into `BoardData.errors` (311–325, 330, 334) and the board renders them. Three reads still drop their error: `wo_walkthroughs` (224), the `profiles` author lookup (568), the expire RPC (213).

**A Movements loader can reuse unchanged:** the `contractors` select + lane mapping (229–232, 337–354), the `wo_assignments` and `wo_appointments` reads, the `booking_offers` read with `OFFER_COLUMNS` / `effectiveState` / `isLive`, the helpers `paged`, `snapshotOf`, `daysFromHours`, `addDays`, the suburb expression, and the `errors` pattern. Simplest: call `loadBoard(from, to)` and read `blocks[].contractorId/start/end/workOrderId/woRef/title/kind` with `lanes[].employmentType/name`.
**Missing for Movements:** address/suburb on blocks (add `doc.jobAddress` from the `wo_snapshot` already fetched at 240); per-day expansion of spans (with `isWorkingDay` and the lane's weekend flags); `work_orders.end_date` in the select for direct bookings; clipping to the window (`loadBoard` returns assignments ±60 days, offers −180/+30, open WOs at any date); dropping the tray/approvals/notes/standards reads it doesn't need; `unavailable`/`hold` kinds to filter or show as "Leave".

## 3. `lib/gcal/read.ts` — what the calendar read returns

- `GoogleBusy` (25–34): `{ staffId, startsAt, endsAt (ISO), label, calendar, allDay }`. **Titles are available** — `label` is the event `summary` (or `"Busy"`): the client calls `events.list` (`lib/gcal/client.ts:181–189`, fields `summary,start,end,status,transparency,eventType,attendees,extendedProperties`), not freebusy. Location and description are not requested.
- `GoogleRead` (37–43): `ok {busy, calendars}` · `not_connected` · `unconfigured` · `needs_reconnect` (no readonly scope, revoked token, or 403) · `error {message}`. Nothing throws; the mapping is in `readUncached` (129–152).
- `readStaffGoogleBusy(staffId, from, to)` (115–127): whole-hour window, 2-minute in-memory cache. `readGoogleBusyForStaff(staffIds, from, to)` (159–173) → `{ busy, reads: Record<staffId, GoogleRead> }`, busy merged only from `ok` reads. The `.in()` connection query at 163 does not check its error: on failure everyone reads as `not_connected` (a candidate for §8 criterion 10 — "says so on the lane").
- Skipped: cancelled, transparent, `workingLocation`/`birthday`, declined, and the app's own events (`extendedProperties.private.pgKind`); only calendars ticked in Google, minus the app-created one and any named "Paint Group …". `maxResults=250`, no paging.
- **Scopes:** staff flow asks for `calendar.readonly + calendar.events + calendar.app.created` (`lib/gcal/oauth.ts:40`, `app/api/gcal/connect/route.ts:37`); what Google granted is stored in `staff_gcal_connections.scopes` (`20270131000000_staff_gcal_scopes.sql:10`).
- **Connected staff (production, ids only):** two rows in `staff_gcal_connections`, both holding `calendar.readonly` and `calendar.events`, no `sync_error`:
  - `17861bed-80b3-47fd-a776-84c215eb7096` — connected 7 Oct 2026 10:47Z, `last_synced_at` null
  - `0e252893-bf74-42e3-b193-c80e5c39abd4` — connected 7 Oct 2026 10:52Z, last synced 7 Oct 11:52Z
  So ⚑6 resolves to **titles** for both connected staff. Any other `boardPeople` entry will read `not_connected` until they connect in the portal's Calendar tab.
- Side finding: `docs/gcal-setup.md:67` holds a plain-text contractor test login (email + password). It should come out of the repo (CLAUDE.md: no secrets in the repo). Not touched in this session.

## 4. Checklist seed rows and the two RPC signatures (as on `main`)

`wo_seed_checklists(p_work_order_id uuid) returns text` — latest definition `20261110000000_wo_no_walkthrough_colour_match.sql:434–474`; seeds (phase, label, detail, required, sort, auto_key, kind, item_key):

| phase | label | required | kind | item_key |
|---|---|---|---|---|
| pre_offer | Scope matches the accepted estimate | yes | tick | — |
| pre_offer | Finish level & standards labels shown per surface | yes | tick | — |
| pre_start | Colour schedule finalised | yes | yes_no | `colours` |
| pre_start | **Materials ordered** ("Needs the colours above first") | yes | tick | — |
| pre_start | **Equipment movements booked** ("Delivery to site and the return trigger") | yes | tick | — |
| pre_start | Access details recorded | yes | tick | — |
| pre_start | Pre-start checklist (emails the customer) | no | tick | `pre_start_checklist` |
| pre_start | SWMS / induction attached | commercial/body-corp only | tick | — |

Matching is by `label` (or `item_key` when set), so the two gate items Session 7 redefines are identified by their **labels**, not keys — Session 7 should give them `item_key`s (`materials`, `equipment`) in the same converging migration before the tick RPC starts branching on them. Seeding fires from `wo_seed_checklists_on_issue` / `_on_assignment` (`20270173000000_pre_start_list_always_exists.sql:41–60`). The completion-prep questions ("Equipment for collection?", "Rubbish?") are seeded elsewhere with `item_key = 'equipment'` (the `list_required` rule in the answer RPC references it).

- `wo_tick_checklist_item(p_item_id uuid, p_done boolean default true) returns text` — live definition `20270159000000_crew_can_work.sql:144–200`. Staff or `wo_painter_on_job`; refuses `auto_key` items (`error:derived:<key>`), non-tick kinds (`error:answer_required`), and **"Materials ordered" before "Colour schedule finalised" is done (`error:colours_first`)**; writes `done_at/by` and a `checklist_ticked` `wo_events` row.
- `wo_answer_checklist_item(p_item_id uuid, p_answer text default null, p_note text default '') returns text` — live definition in the same file after line 202 (first written `20261103000000_wo_prep_questions.sql:120–171`). `yes_no` → `answer`, `answer_note` (yes only), clears `handled_at/by`; `item_key='equipment'` + yes with an empty note → `error:list_required`; `note` kind → `answer_note`. Emits `checklist_answered`.

## 5. Ledger (read-only, production `_prod_migrations`)

| migration | row |
|---|---|
| `20270243000000_pc_prestart_lists_and_work_item_notes.sql` | ✅ 8 Oct 2026 12:13Z |
| `20270248000000_site_checkins.sql` | ✅ 8 Oct 2026 19:12Z |
| `20270266000000_portal_gaps.sql` | ✅ 14 Oct 2026 20:17Z |

Files under `supabase/migrations/` newer than `20270200` with **no ledger row**:

- `20270215000000_wo_after_photos_waiver.sql` (commit 780c4516)
- `20270250000000_import_set_scope_real_pay.sql` (commit 79dd4ea2) — its neighbours `20270251` and `20270252` do have rows

Everything else from `20270200` to `20270277` has a row. Not checked here: `20270278` (exterior typicals, known unrun, another branch).

## 6. `products.brand`

Column added by `20260817000000_product_details.sql:9`, free text, populated by the products admin (`lib/workorder/materials.ts:221–229` searches it alongside name/finish/category/alias). Production today: 47 products.

| brand | n |
|---|---|
| Dulux | 14 |
| Haymes | 9 |
| **(none)** | **7** |
| Taubmans | 4 |
| Zinsser, Berger | 3 each |
| Cabot's, Feast Watson | 2 each |
| Viponds, Porters, **Cabots** | 1 each |

The seven with no brand: Cabots Timbercolour, Cutek Extreme CD 50, Cutek Restore, **Dulux Professional Gloss Enamel**, Fuel / Consumables, Integrain UltraDeck, Premier Roof Coatings. Two spellings of Cabot's exist (`Cabot's` ×2, `Cabots` ×1) — they would make two chips. The Materials rows live inside `work_orders.wo_snapshot` (`materials: WOMaterial[]`, `lib/workorder/snapshot.ts:130`), written only by `wo_set_material` (`20261231000000_wo_set_material.sql`); there is no `wo_materials` table, so the sync groups snapshot rows by the product's brand looked up through `product_id`. Plan §6's "Paint (brand?)" fallback is needed from day one; fixing the eight rows above is a Settings task for Tom, not code.

## 7. Suburb centroids for the suppliers seed

`visit_suburbs` has `lat`/`lng` (`20270212000000_visit_zones.sql:79–80`). All **53 distinct suburbs** in `docs/briefs/data/suppliers-seed.csv` have a centroid row — **no misses** (matched case-insensitively on `suburb`). The two UNVERIFIED Taubmans rows (Mitcham, Cranbourne) have centroids too; they stay inactive until Tom fills in the address (⚑13).

## 8. Google Maps browser key (⚑4)

**Not done.** `.env.local` has `GOOGLE_MAPS_API_KEY` (server-only, used by `app/api/places/{autocomplete,details}/route.ts` and `lib/marketing/googleReviews.ts`), `GOOGLE_CLIENT_ID/SECRET` (calendar OAuth) — and no `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`. Vercel could not be checked from here (no `vercel` CLI, no token); treat it as absent there too. Steps for Tom, in the Google Cloud project that holds the Places key:

1. APIs & Services → Library → enable **Maps JavaScript API** (Places is already on).
2. APIs & Services → Credentials → **Create credentials → API key**. Rename it "paint-group browser maps".
3. Edit the key → **Application restrictions: Websites** → add `https://paint-group-platform.vercel.app/*`, `http://localhost:3000/*`, `http://localhost:3101/*` (and the production domain if the app has one).
4. **API restrictions: Restrict key** → Maps JavaScript API only.
5. Vercel → Project → Settings → Environment Variables → `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` for Production + Preview; add the same line to `.env.local`; redeploy.
Session 6 stops without it. Nothing before Session 6 needs it.

## 9. Where the brief contradicts the code today

1. **Equipment seed categories.** `equipment-seed-template.csv` uses `sprayer · ladder · sander · scaffold · trestles · exterior`; the brief's enum (§3.1, ruling 18) is `step_ladder · ext_ladder_7 · ext_ladder_10 · platform_ladder · spray_gun · planex_sander · festool_vacuum · mobile_scaffold · fall_protection · other`. Session 1's seed must map the CSV (ladder → by name: "Step ladder" → `step_ladder`, "Extension ladder 3.6 m / 6 m" → nearest of `ext_ladder_7`; sander → `planex_sander`, "Dust extractor" → `festool_vacuum`, trestles / pressure washer → `other`) **or Tom replaces the CSV with the real list in enum terms (⚑12)**. Default taken: the seed maps by name and refuses on anything it can't map, with the refusal listing the row.
2. **Gate items are matched by label, not key** (item 4). Session 7 needs `item_key` on "Materials ordered" and "Equipment movements booked"; the brief assumes they are addressable.
3. **No `wo_materials` table.** Brief §0 and §3.2 talk of "the Materials rows"; they are JSON inside `work_orders.wo_snapshot`, so the sync RPC reads `wo_snapshot->'materials'` and the "Materials-card change" trigger is on `work_orders` updates of that column (or inside `wo_set_material`), not on a row table.
4. **`loadBoard` blocks carry no address**, and direct bookings get a one-day end when there is no offer (item 2). The brief's `context(lane, day)` "carries a suburb when it has an address" needs the snapshot address added to blocks, and `work_orders.end_date` added to the select — small, additive, Session 3.
5. **Mockup label** says v3; content is v4 (above). Cosmetic.
6. **`wo_prestart_lists` import is tiny:** 5 rows, 5 with materials text, 1 with equipment text. Session 7's "show the import count" will be 5 lines or fewer.
7. **Company address for ⚑1** is `settings` key `company_profile` (`lib/company/logo.ts:13`), not a `company_profile` table. Session 1 reads the warehouse default from there.
8. **Two migration files have no production row** (item 5). Neither is a Movements dependency; Tom decides whether to paste them (`20270250` real pay may already be superseded — check its neighbours before pasting).
9. **The drag engine has no pointer capture and no edge auto-scroll** (`setPointerCapture` appears nowhere in `ScheduleBoard.tsx`; the only scroll handling re-caches lane rects on a capture-phase `scroll` listener, 527–533). Brief §4 and §8 criterion 3 assume both. Session 2 adds them to the engine as new behaviour; the Schedule board gains them silently, which is a behaviour change to call out in that PR and in Tom's phone check.
10. **Hit-testing resolves the day by DOM position**, not by `data-day` (item 1 row 11). AM/PM halves and hourly rows need a `data-slot` on each drop target; the engine must switch to attributes without changing the Schedule board's results.
11. **`e2e/scheduling/` does not exist**; the Schedule specs are flat under `e2e/` (item 1 lists them). The plan's Session 2 gate should name those files.
12. **Haymes** (9 products) has no supplier in the seed — the brief already allows a brand with no branch ("Felipe picks"); Inspirations Paint stores are Haymes stockists in practice, so a `brands_stocked` on branches may be worth a line in Session 1 rather than code later. Flagged, not built.

## Counts worth knowing for the fixtures

Production work orders by stage: offered 21 · pre_start 16 · in_progress 10 · qa 3 · walkthrough 2 · closed 28.
