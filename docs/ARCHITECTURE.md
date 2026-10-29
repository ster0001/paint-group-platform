# Architecture notes

One short entry per change: what changed, and where it lives. Newest first.

---

## 21 Oct 2026 — Movements: Lighthouse mobile ≥ 90 on Week, Day and Gear

**2026-10-22 · `supabase/migrations/20270294000000_tom_batch_22oct.sql`, `lib/invoicing/{jobMoney,moneyInput}.ts`, `app/invoicing/payments/{CostEdit,JobPanel,panelData,labels,JobPieces,Views,ActionsClient}.tsx`, `app/invoicing/actions.ts`, `app/pc/wo/[id]/{JobTitle,WalkthroughCard,page}.tsx`, `app/pc/actions.ts`, `lib/workorder/signoffRequest.ts`, `app/quote/QuoteBuilder.tsx`, `lib/movements/invite.ts`.**
Tom's 22 Oct batch. Payments: a slot and a row carry a display `tone` beside `state` — a deposit issued and not yet due draws blue (sent) wherever the job is, while the chase sections still read `state`; "One-click paid" and "Record a payment"; costs are editable in place (`material_cost_update`, `job_cost_update`) and a material cost can be added by hand against an order (`material_cost_add_manual`); the panel loads the job's paint/materials orders and the order each material cost sits on. Titles: the builder keeps a typed title (the address only fills an empty one) and shows the box on a revision too; the working scope's title is edited on the job page (`wo_set_job_title`). Walkthrough: the office can start it at the quality-check stage, and "Send to the customer to sign remotely" marks them unavailable and sends the sign-off link with the reminder's wording (`sendSignoffRequest`). Movements: the confirm box's invitation also texts the worker what to do, where and when (`movement_booked_text`).

**2026-10-21 · `supabase/migrations/20270289000000_movements_run_planner.sql`, `app/components/materials/MaterialBubbles.tsx`, `app/pc/movements/{RunPlanner,MapView,ChipSheet,MovementsScreen,SourcesView,DayView}.tsx`, `app/pc/wo/[id]/{page,PrestartMovements}.tsx`, `app/quote/QuoteBuilder.tsx`, `lib/movements/evaluate.ts`.**
Tom's second Movements batch. Materials lines are bubbles in every list (one shared component; the builder's draft variant): edit in place, remove, split one item off into its own line and chip (`material_line_split`), combine. The job page loads its movements on every stage and shows a Materials & movements card past pre-start. The chip sheet lists paint shops before hardware with a search, takes any time and a duration (`movements.duration_min`, `movement_set_duration`). A morning drop on a person lane gets the default half time; undated jobs stay out of the tray; tray dates carry the month; the week header is shifted to stay at the top while the page scrolls. The Map gains a run planner: a browser-side draft of stops (chips or purposes on jobs) timed from 07:30 around the calendar (`busyOn`, `firstFreeTime`), drawn as a line, published in one RPC (`movement_publish_run`) that places chips, makes Other chips for purposes, books an unscheduled site check-in and sets the sequence.

**2026-10-21 · `supabase/migrations/20270287000000_movements_first_week.sql`, `lib/movements/{sync,evaluate,load,loadJob,types}.ts`, `app/pc/movements/{actions,ChipSheet,MovementsScreen,SourcesView}.tsx`, `app/pc/wo/[id]/PrestartMovements.tsx`, `app/quote/QuoteBuilder.tsx`.**
Tom's first-week asks on Movements. A materials line is one order chip, comma-separated, 500 chars (constraint, RPCs, inputs). The job page's Equipment section has a Gear needed box: words become an `equipment_out` chip with no register items (`movement_create` allows it when a title is given). A materials line gets NO default shop — the sync (SQL and the TS mirror) writes none, `movement_place` answers `no_shop` on the Supplier lane, and the new `movement_set_method` RPC + `movements.method_pref` back the chip sheet's "How does it get to site?" (Delivered to site places the chip on the Supplier lane on the job start day; Picked up leaves it in the tray). One paint chip per brand: a `products` trigger fills a blank brand from the name's prefix when that brand exists and folds spellings onto the canonical one. Site check-ins with no day load as `World.unscheduledCheckins` and drag from the tray onto a staff lane, which calls `wo_site_visit_set_schedule` with the row's hour.

**2026-10-21 · `app/components/StaffChatDock.tsx`, `app/pc/layout.tsx`, `app/pc/movements/{page,MovementsScreen,HowItWorks}.tsx`, `howItWorksKey.ts`, `movements.css`, `lib/scheduling/board.ts`, `lib/movements/{load,evaluate}.ts`, `lib/supabase/fetchAllRows.ts` (+ test).**
Measured on the C1 build as the staff login over a populated week (Lighthouse 13.5 mobile, two passes): Week 88 → 93, Day 87 → 91, Gear 87 → 91; CLS 0.09–0.14 → ~0. Nothing on screen changed. What moved it, in order: the staff chat dock imported supabase-js statically on every staff page (58 KB gzipped in the paint graph) — it now loads through `lib/supabase/lazyClient.ts` two seconds after mount, since even a hydration-time import landed a few ms before the observed paint; the How-it-works strip opened in an effect on a fresh browser and shoved the board down — `page.tsx` reads its localStorage key during parse and sets `.pc[data-how="open"]`, `movements.css` shows the strip open before hydration (`::details-content`), and `HowItWorks.tsx` removes the attribute once React has it open; Day, Gear, Sources and the two sheets are `next/dynamic` so the Week bundle is the Week; the first byte stopped waiting on chains of single reads — the console layout reads profile, visibility, logos, cookies and the tab switch in one round trip after `getUser`, the Movements page reads the switch alongside the week, `loadBoard` folds the standards and painter-status reads into its one `Promise.all` (the Schedule gains the same), and `fetchAllRows(query, { prefetchPages })` asks for a known-size table's first pages together (the ~3,500 suburb centroids: one round trip, not four); the tab ships one render-blocking stylesheet (`movements.css` `@import`s `schedule.css`); branches travel without `favourite`/`active` (`WorldBranch`). The world JSON (~8 KB gzipped) was not the lever. Two measurement traps for next time: a bare `?view=week` scores an empty week (98), and a cancelled full-loop run leaves C1's `movementsTab` off (every URL 307s to /pc); Lighthouse's `--extra-headers` Cookie no longer signs in under Chrome 141 — plant the cookies into Chrome's profile over CDP instead.

## 20 Oct 2026 — Movements Session 8: the full loop, the rollback switch, training

**2026-10-20 · `e2e/movements-full-loop.spec.ts`, `lib/movements/tabSwitch.ts`, `app/pc/PcNav.tsx` / `app/pc/layout.tsx` / `app/pc/movements/page.tsx` (the switch), `app/(app)/settings/MovementsSettings.tsx` (`movementsTab`), `docs/manual-tests/movements-week-one.md`, `e2e/help-capture/gif-movements.spec.ts`.**
The full-loop e2e seeds the mockup's week small (a live job with a paint chip, a materials line and gear going out; a closed job with a sprayer stranded on it), plans every chip, orders every order on the Day view, runs the week with the painter's ticks on the portal card and the PC's on the board, proves both items back at the warehouse on the Gear view, lands a supplier invoice on its movement by order reference, and asserts the customer sees nothing — every §8 criterion that can be asserted at the API or on a rendered page. `settings.movements.movementsTab` (default on) is the one-click rollback: off hides the tab (`PcNav` reads it through the layout) and sends `/pc/movements` back to the dashboard; nothing is deleted. The manual test is Tom's fifteen minutes; the GIF spec writes the two walkthroughs the help files embed.

## 20 Oct 2026 — Movements Session 6 (part): Gear view and Settings → Movements

**2026-10-20 · `app/pc/movements/GearView.tsx`, `app/(app)/settings/{SuppliersSettings,EquipmentSettings,MovementsSettings}.tsx`, `movementsSettingsActions.ts`, `e2e/movements-gear-settings.spec.ts`.**
`/pc/movements?view=gear` is the register (ruling 18): every item with its type icon, tag, where it is now and what carries it next, all from the evaluator's `locations()` — the last ticked movement that carried the item, never a typed location — with filters, the nine-icon legend, the trail, and Find it in the tray for a stranded item (its return chip on the Week board). Settings gains a **Movements** bucket: **Suppliers** (branches by brand through `supplier_branch_upsert`; the trade account reference through `supplier_branch_set_account`, masked to its last four characters on the server before it reaches the page), **Equipment** (`equipment_item_create/update/set_status`, tag on save) and **Movements** (the one `settings.movements` row — warehouse, Nearby radius, horizon, confirm time, default half times, board people with slots, colour and checks, hire costs, the strip — written by `saveMovementsSettingsAction` under `settings_staff_all`, and a line saying whether the Google Maps browser key is set). **The Map view is not built**: `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` is absent (⚑4) and the plan says stop, not stand in; it lands with the order card once the key exists.

## 20 Oct 2026 — Movements Session 7: the crossings

**2026-10-20 · `supabase/migrations/20270282000000_movements_crossings.sql`, `lib/movements/loadJob.ts`, `app/pc/wo/[id]/PrestartMovements.tsx` (replaces `PrestartListBox.tsx`), `app/quote/QuoteBuilder.tsx` (`internalMaterials`), `app/pc/wo/[id]/MaterialRequests.tsx` (Accept as a line), `app/pc/flow/page.tsx` (gate pills), `lib/workorder/console.ts` / `consoleData.ts` (collect cards retired), `e2e/movements-crossings.spec.ts`.**
The Movements record now crosses into the rest of the loop (brief §3.5). **Estimate → lines**: `builder_state.internalMaterials[]` (internal, ruling 12 — the customer snapshot never carries it, asserted on the rendered `/e` and `/w` HTML) becomes `wo_material_lines(source = estimate)` whenever the job syncs (`movements_lines_from_estimate`, from the work_orders trigger and `movements_sync_now`), idempotently. **The gates are real**: the two pre-start items carry `item_key` materials / equipment; `movements_gate_paint` / `movements_gate_gear` mirror `evaluate.ts gates()` in SQL and `wo_tick_checklist_item` refuses `paint_not_ordered` / `equipment_not_booked` (colours_first still first); `lib/movements/loadJob.ts` is the one-job read (every chip whatever its date, so a gate is never fooled by the week window) the job page and Project Progress pills use. **Prep answers → movements**: a yes on Equipment / Rubbish for collection confirms the job's gear-return (a tray one is made if the office never booked an out) and rubbish chips through `movements_prep_answer`, so the two `collect:` console cards are gone — the Movements work items say what still has to move. **Material request → line**: `material_request_accept` is on the job page. **Money**: `material_costs.movement_id` links a matched invoice to its order by order reference (trigger); a `hire_off` ticked done with `expected_cost_cents` writes a `job_costs` row (equipment_hire, recorded) when `recordHireCosts`. The old `wo_prestart_lists` text was imported once as lines (source = pc, gear lines prefixed "Gear:"); the table stays until a later clean-up.

## 21 Oct 2026 — Movements map: active jobs only, icons only

Tom's ruling after the first live look. `onMap(job, today)` in `lib/movements/evaluate.ts` is the one rule for which jobs the map draws: `MAP_ACTIVE_STAGES` (in_progress, qa, completion_prep, walkthrough) always; closed only until `MAP_CLOSED_GRACE_DAYS` (7) after `Job.paidOn`; offered and pre_start never. `Job.paidOn` is the latest `payments.paid_on` across the job's invoices, read by the loader in the same round as the jobs (`latestPaidOn`, a failure line like every other read). `mapPins()` takes `today` (the Melbourne day, from the view) and skips what `onMap` refuses, so the bounds fit the active jobs. The pin is the icon alone; the address, suburb, job ref and need line live in a `.mpop` popover shown on hover or held open by a tap (`data-open`), and an amber pin's popover carries the Open button for its chip (the icon no longer opens it directly). Tests: `evaluate.test.ts` (onMap, mapPins filtering), `load.test.ts` (latestPaidOn), `e2e/movements-map.spec.ts` (hover/tap popover, Open → chip sheet, pre_start job gone).

## 21 Oct 2026 — Movements Session 6, the Map part: one icon per job, the day in order, real points

**What changed.** `/pc/movements?view=map` (brief §3.4 Map, rulings 13, 21, 22; flags 3, 4, 7) is `app/pc/movements/MapView.tsx` on Google Maps JS, loaded by `lib/maps/googleMaps.ts` (a script tag with `loading=async`, the browser key `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`; no package — the slice of the API used is hand-typed in `lib/maps/google-maps.d.ts`). The tab exists only when the key is set (`mapsOn` from the page; Settings → Movements says so). **Nothing on the map is computed by the view**: `mapPins(world, laneId, day, blocks)` in `lib/movements/evaluate.ts` gives one pin per job with a point (fill teal / amber / grey from `jobNeeds` and the stage, the first need's kind for the amber icon, the street and a one-line "what's needed"), every shop with a point and whether it is a stop today, the warehouse, the selected person's badges keyed by `pointKey` from `runPlan` (numbers; ◌ for a fixed appointment) and the route as a point list; the view draws them (a React portal into one `OverlayView` pane, re-placed on every `draw()`), toggles Shops and the Route line (a dashed `Polyline`, off by default, straight lines — flag 7), and opens the first need's chip sheet on tap. The **order card** lists `runPlan` stops as rows with a pointer-events drag handle (fixed rows have none); a drop builds the new id order and calls the same `reorder()` + `reorderDay` the Day view's ▲▼ call, so map, card, Day and the Week board agree (ruling 22). **Flag 3**: migration `20270283000000_movements_job_points.sql` adds `work_orders.lat / lng / point_checked_at` (range and pair checks), the staff-only writer `wo_set_point` (null stamps an attempt), and makes `movements_job_point` prefer the real point over the suburb centroid so the sync's nearest-branch and Nearby use the point the map draws. The loader reads the three columns; `jobExtras[id].pointSource` (exact | suburb | none) and `geocodeWanted` (no point, not tried in 7 days) drive the lazy fill: the Map view calls the `geocodeJobs` action once per mount for up to 8 jobs, which asks the office Places key through `lib/places/geocodeAddress.ts` (Places API New Text Search, `places.location` field mask, Melbourne-biased, 4 s timeout — a job holds an address, not a place id) and writes through the RPC; a hit re-reads the page. Tests: `evaluate.test.ts` (3 `mapPins` cases incl. numbers following a reorder), `load.test.ts` (`geocodeWanted`), `e2e/movements-map.spec.ts` (the shop numbered 1 and the job 2 at its real point → drag row 2 above row 1 → map, card, database times and the Day view all follow; the amber pin opens the rubbish question, answering it turns the icon teal; Shops and Route toggles) — skips loudly when the key is not in the test env. Help: `docs/help/movements/pc.md` Map section.

## 20 Oct 2026 — Movements Session 5: Day run plans, the texts, the painter side

**2026-10-20 · `app/pc/movements/DayView.tsx`, `app/pc/movements/run/` (`page.tsx`, `RunList.tsx`), `lib/movements/notify.ts`, `lib/movements/painterView.ts` (+ test), `lib/movements/painterLoad.ts`, `app/portal/MovementsCard.tsx`, `app/w/WorkOrderDoc.tsx` (`logistics` prop), `supabase/migrations/20270281000000_movements_painter_run.sql`, `e2e/movements-day.spec.ts`.**
`/pc/movements?view=day&day=&who=` is the Day view (brief §3.4): day chips with move counts, person chips in lane colours, the numbered timeline from the warehouse drawn by the evaluator's `runPlan()`, ▲▼ that re-slot the times through `reorder()` (ruling 22 — the same set of times handed out in the new order) and one server action, `reorderDay`, over `movement_set_sequence` + `movement_set_time`; the Orders to place card over `needsOrder()`. `/pc/movements/run?day=&who=me` is a staff member's own phone list off the same `runPlan()`. **The texts** (brief §3.5) are five registry entries, draft-first (`defaultMode: "approve"`): `movement_pickup_ready` and `movement_delivery_booked` fire from `markMovementOrdered` through `lib/movements/notify.ts` after the RPC answers; `movement_delivery_client_notice` only when the chip's `client_notice` is on (ruling 11); `movement_run_plan` from Send to phone; `movement_arrived_check` from the 6 pm sweep for a supplier delivery still only booked. The "told" stamps (`painter_alerted_at`, `client_notified_at`) are written by `movement_record_alert` (service role only, no client grant), never by the server directly. **The painter side**: `movements_for_painter` (redefined in 20270281 to carry the branch ids) is the painter's one read, through their own session (`painterLoad.ts`); `painterView.ts` turns the rows into the sentences on the portal home's "Your pickups and drop-offs today" card and the job sheet's "Getting it to site" section (Paint · Materials · Loan gear · Rubbish), with Navigate, Call and the tick (`movement_painter_done`). Customers read nothing; the e2e asserts the painter's rendered HTML carries no account number, cost, branch email or office note.

## 20 Oct 2026 — Movements Session 4: the Week board and Sources — the first screen

**2026-10-20 · `app/pc/movements/` (`page.tsx`, `MovementsScreen.tsx`, `ChipSheet.tsx`, `AddChipSheet.tsx`, `SourcesView.tsx`,
`HowItWorks.tsx`, `world.ts`, `movements.css`), `app/components/board/` (additive props), `lib/movements/evaluate.ts`
(`dropProblem`, `trayGroupOf`, `chipFilterKind`, `shortDay`), `lib/movements/load.ts` (`jobExtras`: paint rows by brand + crew notes),
`lib/movements/week.ts`, `lib/movements/gearIcons.tsx`, `app/pc/PcNav.tsx`, `lib/crm/work-queue.ts` (nine kinds wired),
`e2e/movements-week.spec.ts`, `docs/help/movements/pc.md`**

`/pc/movements?view=week|sources&week=&job=` is PC Command's Movements tab (brief §3.4): the tray of chips (grouped by job,
filters with counts, search, + Add a chip) beside the lanes × days board — Supplier, every painter booked in the week, the
staff in Settings' `boardPeople` — with AM/PM halves on `slots='half'` lanes and ten 07:30 hourly rows on `slots='hour'` lanes
(ruling 16; a drop into a row sets the movement's `time`). **It is the second consumer of the one board engine** and the
Schedule board is unchanged: the engine grew only props — `slots` per lane, a fractional `slotHours` start, `renderSlot` /
`renderCellHead` (content INSIDE a cell: context blocks, placed cards, the Nearby pill), `rowSizing="content"`, `laneClass`,
`Tray` grouping (`groupKey` / `renderGroupHead`, `controls`, `after`, `className`), `onDropOnTray` and `dragJustEnded()` on
`useBoardDrag` — and the Movements board is the first to turn `capturePointer` and `autoScroll` ON. Everything drawn is the
evaluator over the world the page read once (`loadMovementsWeek`, context blocks computed on the server, the suburb map pruned
to the week's suburbs for the client); every change is an action in `app/pc/movements/actions.ts` followed by `router.refresh()`.
The ghost's refusals come from `dropProblem` (the twin of `movement_place`'s), but the RPC is still called and its answer is
the toast. The chip sheet (lines → `wo_set_material`; materials line text; gear with locations; the rubbish question of
ruling 20; shop nearest-first; time chips; order reference; client notice off by default; note; Ordered ✓; Copy order text;
Back to tray; Remove for manual chips) and the Sources view (three cards over the one `wo_material_lines` list, add/remove from
any card, the three-doors strip) sit on the same page. Ruling 15: a browser with no theme cookie is set light before paint by
an inline script and the console toggle adopts what it sees. The nine §6 work items now reach `buildPcWorkItems`. Day, Map and
Gear have no tabs yet (Sessions 5–6).

---

## 20 Oct 2026 — Movements Session 3: sync mirror, the one evaluator, the loader, nine work items

**2026-10-20 · `lib/movements/sync.ts`, `lib/movements/evaluate.ts`, `lib/movements/load.ts`, `lib/movements/types.ts` (row shapes +
settings), `lib/crm/work-queue.ts` (nine kinds), `lib/scheduling/board.ts` (additive `Block.address` / `woEndDate`),
`e2e/movements-sync-mirror.spec.ts`**

Everything a Movements screen shows is computed ONCE, here, with tests; no screen exists yet (Session 4). `sync.ts` is the pure
TypeScript twin of `movements_sync_for_wo` (migration 20270279 §10): same inputs, same rules — one paint chip per product brand
(`paint:<brand>`, brand by product NAME via `products.brand`, blank → `paint:brand?`), one per unmerged line (`matline:<id>`),
one undecided rubbish question, tray chips refreshed in place, a placed ORDERED chip only ever flagged (`source_changed_at`),
closed jobs given return chips for stranded gear (`autoReturnFor` = `movements_after_booked`) — and it returns the PLAN (create /
refresh / flag / remove / the chip set after) rather than writing anything. The database is still the one writer; the mirror exists
so a screen can say what the sync will do and so the rule has a readable twin. Pinned two ways: `sync.test.ts` is a golden over the
e2e fixture's known answers, and `e2e/movements-sync-mirror.spec.ts` runs the RPC and the mirror on one fixture through the staff
session and compares the chip sets column for column. `evaluate.ts` is the one evaluator (brief §3.3): `lanes` (supplier, painters
with work or a movement in the window by first start — contractors and employees alike, staff in `boardPeople` order; an employee
in `boardPeople` is ONE lane), `contextBlocks`/`context` (jobs and leave from `loadBoard`, Google busy in Melbourne time with the
read's kind as a lane note, checks / check-ins on the hourly staff lanes or those flagged `boardPeople[].checks`, walkthroughs on the
painter's lane too), `kindLabel`, `methodOf`/`methodLabel`, `laneColour` (Settings for staff, a stable-hash palette for painters),
`needsOrder`, `chipWindow`/`inWindow`, `blockedReason`, `nearby` (staff lanes only), `hotCells`, `whileYouAreThere`,
`orderedStops`/`runPlan` (fixed context at its time, movements by sequence then time, km from the warehouse out and back),
`reorder` (ruling 22: the same set of times handed out in the new order — what `movement_set_sequence` + `movement_set_time` are
given), `itemLocation`/`locations` (= `equipment_item_location`), `jobNeeds` (ruling 21's amber), `jobMoved` (ruling 4), `gates`,
`counts`. `load.ts` `loadMovementsWeek(from, to)` builds the `World` it computes over: one round trip per source, every read keeps
its `error`, `realOnly()` on every list of a flagged table, failures returned as lines; it reuses `loadBoard` (which now carries the
snapshot address and `work_orders.end_date` on each block, additively — `end` is untouched). The nine §6 work items are pure
builders in `lib/crm/work-queue.ts` (`buildMovementWorkItems` + `readMovementQueueRows`), PC-homed, weighted under
`employee_reassign` (32) because that invariant is tested; NOT yet in `buildPcWorkItems` — Session 4 wires them when the screen
they link to exists. No migration.

---

## 19 Oct 2026 — Movements Session 2: the board engine, lifted out of the Schedule board

**2026-10-19 · `app/components/board/` (`Board.tsx`, `Lane.tsx`, `DayCell.tsx`, `Tray.tsx`, `SavedViews.tsx`, `Controls.tsx`,
`chrome.tsx`, `useBoardDrag.ts`, `useBoardZoom.ts`, `format.ts`, `types.ts`, `board.css`, `boundary.test.ts`), `app/pc/schedule/ScheduleBoard.tsx`,
`e2e/board-engine.spec.ts`, `CLAUDE.md`**

The Schedule board's lanes × days machinery — window + zoom + paging, the measured scroller height, the sticky month/day header,
lane rows with one `.bgc` per day, greedy sub-row packing, the pointer drag (5 px threshold, ghost on rAF, hit-test by
`document.elementsFromPoint`, `.hot`/`.blocked` class toggles), the marquee across empty lane space, the searchable tray, the
saved-views popover, scroll persistence and the scrim/sheet/toast chrome — now lives in `app/components/board/` as ONE engine
(CLAUDE.md "one board engine"). `ScheduleBoard.tsx` (2,230 → ~1,780 lines) is its first consumer: it keeps every booking rule
(working-day snapping, blocked/held spans, the offer/assign/move sheets, the block detail, the block-out/visit/hold sheet, every
commit action) and hands the engine props for what differs. The engine resolves the drop target from the cell's `data-lane` /
`data-day` / `data-slot` attributes (not DOM order — Session 0 item 9.10), so AM/PM halves and hourly rows (`slots` prop,
`board.css`) can be drop targets for Movements; on the Schedule board (`slots="none"`) the result is identical. Two additions
exist behind options that default OFF, so the Schedule board's behaviour is unchanged: `capturePointer` and `autoScroll`
(Session 0 item 9.9). Every test ID and class the Schedule specs rely on is still emitted; `schedule.css` is untouched (the
engine's base styles still live there — a later session may MOVE them to `board.css`, a pure move verified by the same specs).
`e2e/board-engine.spec.ts` pins the contract from the user's side (confirm step opens on the ghost's day; a blocked span is
called out under the pointer and on the sheet; a release off the lanes opens nothing; the same drag at a 412 px touch viewport).
No migration.

---

## 7 Oct 2026 — visit booking S6: the gate — details before the range, the switch, the tracking, the report

**2026-10-07 · `supabase/migrations/20270217000000_wizard_gate.sql`, `lib/wizard/quick-look.ts`, `lib/wizard/state.ts`,
`app/wizard/QuickLook.tsx`, `app/wizard/WizardApp.tsx`, `app/wizard/Reveal.tsx`, `app/wizard/TalkSheet.tsx`,
`app/api/wizard/submit/route.ts`, `app/api/wizard/draft/route.ts`, `app/api/wizard/range-option`, `lib/reporting/metrics/funnel.ts`**

R5 reverses the estimator-journey-v2 ruling that took the email gate out from in front of the price: under
"details first" (the default, Booking rules → gate order) the quick look's last question is the GATE — "Where
shall we send your estimate?", full name, email, mobile, an optional unticked marketing tick, "Show my guide
price" — appended by `stepsFor(..., gate)` and enforced on the SERVER: the submit route answers 409
`gate_required` when the session's version is details first and the state carries no complete contact. The
version is the session's, frozen on `wizard_drafts.gate_version` at the first save (the client keeps it on
`state.gateVersion`; the autosave writes the column only when null), so flipping the switch mid-session changes
nothing for it (R6). "Range first" leaves the steps alone and asks for the details on the range screen instead
(R7): Book goes through the visit page's details screen, Speak with us and Send us a message through the talk
sheet, and Tighten my price through the sheet's new "details" mode, which saves them and then carries on. The
range screen follows R24 — Tighten my price (the hero, "Get a more accurate quote now"), Speak with us, Book a site
visit, Send us a message — and the old "Keep this estimate" email door shows only while no contact is held.
Tracking on `wizard_drafts`: `gate_shown_at` (the autosave sees `quick:gate`), `gate_completed_at` (submit with a
contact; or details given after the range through `markGateCompleted`), `range_shown_at` (submit), `range_option`
(+ `_at`, the first door tapped, via `/api/wizard/range-option`). The dashboard's "Where estimates go" card gained
"The gate" by version — sessions, reached, completed, lost at the gate, saw the range, what next — from
`buildGateReport`, with `funnel.gate_sessions` as its CSV export through the one export route. The marketing tick
records a `marketing` consent through the existing `recordConsent` once the account exists. The e2e drive helper
fills the gate when it appears (`opts.email` lands there now, so the keep door is skipped when absent).

## 7 Oct 2026 — visit booking S7: the full loop, section 8 complete, help from the finished screens

`e2e/customer-journey/visit-full-loop.spec.ts` walks wizard → gate → range → Book a site visit → hold → code → booked, then applies "the guest declined" at the seam the inbound sync uses (`visit_set_status` cancelled, `declined_invitation`) and checks the visit is cancelled, the event is on the record, the slot is offered to the next customer and the card is on Today. The Google steps themselves (the event, the invitation, the decline from each mail client, the cancel text) cannot run on the test project and are Tom's `docs/manual-tests/visit-gcal.md` + `visit-full-loop.md`. Section 8 is now covered end to end: 1–11, 13, 15 in `visit-booking-api.spec.ts`; 12 in `gate.spec.ts`; 14 and the platform half of 19 in the full loop; 16 and 17 in `visit-requests.spec.ts`; 18 in `visit-schedule.spec.ts`. Section 10's inventory rows are all in `docs/briefs/messaging-automations-inventory.md` (the "message → staff" row is served by the chat alerts and handoff cards, decided in S4). Help: `visit-booking/staff.md` rewritten from the finished screens (gate, R24 order, request screens); zones, schedule and requests pages were already current. No migration.

## 6 Oct 2026 — visit booking S5: Google Calendar — the visit in the estimator's main calendar, decline cancels, move raises a card

**2026-10-06 · `supabase/migrations/20270216000000_gcal_visits.sql`, `lib/gcal/oauth.ts`, `lib/gcal/client.ts`, `lib/gcal/visitEvents.ts`,
`lib/gcal/staff.ts`, `lib/gcal/inbound.ts`, `lib/gcal/read.ts`, `app/api/gcal/webhook`, `app/api/cron/gcal-sweep`, `lib/visits/holds.ts`**

info@paintgroup.com.au is a Google Workspace account (Tom, 6 Oct), so the staff connection asks for a third scope,
`calendar.events`, and `reconcileStaffCalendar` writes booked visits into the estimator's MAIN calendar instead of
the app-created "Paint Group Visits" one: a one-hour event (R32) with the property as location and the customer as a
guest (`sendUpdates=all`, so Google sends the invitation and records the reply), a popup reminder on the estimator's
copy only (the API's `reminders` are "for the authenticated user"), and a separate 30-minute "Travel" block with no
guests (`lib/gcal/visitEvents.ts`, pure, unit-tested). Both carry `extendedProperties.private.pgKind`, and the busy
reader (`read.ts`) skips anything so marked, so a booking never blocks itself (4.6 "Read"). Booked jobs still go to
the app calendar when `push_jobs` is on. Inbound (`inbound.ts`): `syncStaffFromGoogle` re-reads each visit event
and `classifyGoogleEvent` says gone / declined / moved / same — gone (Tom deleted it) or declined (the guest said no)
cancels the visit through the Diary's `visit_set_status` RPC with `cancel_reason` `deleted_in_google` /
`declined_invitation`, removes both events, sends the cancel email and the `visit_cancelled` text; moved writes
`google_start` / `moved_seen_at` on the mapping row and NOTHING else changes (R27) — the work queue raises
`visit_moved_in_google` until staff move the visit on the Diary or dismiss it. Changes arrive two ways: a push channel
on the primary calendar (`events.watch`, token = HMAC of the channel id with CRON_SECRET, posting to
`/api/gcal/webhook`, renewed a day before expiry) and `/api/cron/gcal-sweep` every five minutes, which also re-runs
the write side (a failed insert is retried; `gcal_sync_failed` card while `sync_error` is set). Booking rules gained
`calendarRequired` (default ON): a zone whose estimator has no connection with the write scope offers the request
path, not the calendar, and `estimator_calendar_missing` tells staff why; if Google cannot be reached when a customer
looks or confirms, `CalendarUnavailable` sends them to request-a-time and nothing books blind. Confirming a booking
or offering a time calls `reconcileForVisit` at once ("within a minute"). The test project has no Google: its e2e
runs switch the rule off for the run (`visitHelpers.ensureEstimator`) and put it back; `e2e/visit-calendar-gating.spec.ts`
drives the no-calendar and dead-token paths. Declines from non-Google mailboxes (Outlook, Apple Mail) are Google's
iMIP handling and could not be tested here — Tom's manual script covers it, and the brief's fallback (a cancel link in
the text) needs his ruling if they do not arrive.

## 6 Oct 2026 — visit booking S4: requests, pre-arranged and out of area, Speak with us, messages, public holidays

**2026-10-06 · `supabase/migrations/20270215000000_visit_requests.sql`, `lib/visits/requests.ts`, `lib/time/workingDays.ts`,
`app/api/visits/{request,message}`, `app/wizard/TalkSheet.tsx`, `app/crm/visit-requests/[id]/`, `scripts/seed-public-holidays.ts`,
`docs/briefs/data/vic-public-holidays.json`**

Everything that creates a REQUEST rather than a booking (addendum §4.4) is one `visit_requests` row: a time request
(pre-arranged address, "None of these suit", nothing free, an unmapped suburb), a visit asked for before the price
range (R3/R4 — the three options "Request a site visit / Call us / Send a message" now sit on EVERY quick-look step,
`TalkSheet.tsx`), or a call from "Speak with us" (R25). The row carries `due_at` = the end of the next working day
(`lib/time/workingDays.ts`: Monday to Friday, Melbourne, the public-holiday list excluded — R23/R33), and the work
queue derives its `visit_request` card from the open rows; the wizard session's outcome note starts "Requested
online:" so no second card is raised for the same fact. Staff answer on `/crm/visit-requests/[id]`: every free slot of
every estimator (`availability()` with zone `"any"` — §4.4 lets staff pick any slot whatever its zone list, far edges
kept), and "Offer this time" books it through the existing `visit_book` RPC, freezes the zone, marks the request
answered and sends the `time_offered` text and email with the invitation; no code. "Speak with us" is decided on the
server: the submit route now stores `guideRange` on `builder_state` and returns `speakWithUs` from
`speakWithUsFor(jobType, top of range, Booking rules caps)` (R34); the call-request route checks it again (test 16).
"Send us a message" (R26/R35) posts into the EXISTING chat — the estimate chat after the range (a draft gets a share
token if it has none), the website chat (`agent_conversations` + handoff) before it, and the submit route links such a
conversation to the estimate once it exists so staff see one conversation per customer — and emails the office address
with the customer on the same email; `customer_message_receipts` makes a retry with the same client id a no-op (test
17). Public holidays: `docs/briefs/data/vic-public-holidays.json` is the Business Victoria list read on 6 Oct 2026
(2026 complete; 2027 without the AFL Grand Final Friday, which the page says is subject to the AFL schedule),
merged into `visit_booking_rules.publicHolidays` by `scripts/seed-public-holidays.ts`; the existing weekday-only
helpers in `lib/time/businessHours.ts` take an optional holiday set (Tom, decision c); a `holidays_next_year`
work-queue item appears from 1 November while next year's list is empty. The old pre-range "Save & book" sheet no
longer fetches the half-day windows (R3: a pre-range visit is a request, never a slot).

## 6 Oct 2026 — visit booking S3: book a visit from the range — hold, text code, one transaction

**2026-10-06 · `supabase/migrations/20270214000000_visit_holds.sql`, `lib/visits/holds.ts`, `lib/visits/ownedEstimate.ts`,
`app/api/visits/{details,hold,confirm,resend,availability}`, `app/estimate/visit/`**

The walking skeleton of the addendum: Book your estimator → `/estimate/visit?id=` → (details, only when we hold none)
→ calendar → ten-minute hold → 6-digit code by text → "Your site visit is booked". `visit_holds` carries the hold
(hashed code, attempts, resends, expiry; a partial unique index makes one LIVE hold per slot per estimator, so the
race between two customers is settled by the database) and `visit_code_sends` is the fact behind the per-mobile and
per-IP limits. Four definer RPCs, granted to service_role only: `visit_hold_place`, `visit_hold_resend`,
`visit_hold_release` and `visit_hold_confirm`. Confirm is the one transaction: code check (five wrong ends the hold),
an advisory lock per estimator-day, one active wizard visit per estimate, the full 90-minute run clear of confirmed
visits (test 19), the R18 far-edge pairing against confirmed neighbours (test 13), then the `visits` row — status
booked, source wizard, `zone` and `far_edge` frozen, `ends_at` = start + 60 (what the customer sees; the 90-minute
block is the slot rule) — whose trigger writes `visit_booked` on `crm_events`. `lib/visits/holds.ts` is the server
side: `loadVisitContext` (address → `resolveZone` → the zone's estimator → `availability()` fed by the week, confirmed
visits, live holds and the estimator's Google busy times), `placeHold` (re-runs availability so a slot the zone list
does not allow is refused however it was asked for — the body cannot even carry a zone), `confirmHold` (re-runs
availability with the customer's own hold set aside, then the RPC) and `resendCode`. `lib/visits/ownedEstimate.ts`
is the one door for the routes: anonymous customers only on the draft their session created
(`customerOwnsDraft`), staff on any. Messaging: `visit_code` (text, always on, never held — `visitCodeSms`) and
`visit_booked` (text, `visitBookedSms`); the email with the .ics invitation is the existing `visit_confirmation`,
whose `visit_when` now reads "Monday 5 October, 2:00 pm to 3:00 pm" (R32). The old half-day windows are no longer
offered to customers: the Book page's "Book a site visit" and the reveal's door both go to the new page; "None of
these suit" and the pre-arranged / out-of-area screens hand off to the Book page's request-a-call-back until S4
builds the real request screens. The customer's e2e (`e2e/customer-journey/visit-booking.spec.ts`) reads the code
back from the `messages` row the adapter records (the test stack has no Twilio); the section-8 API tests live in
`e2e/visit-booking-api.spec.ts`.

## 6 Oct 2026 — visit booking S2: each estimator's week, booking rules, THE availability function

**2026-10-06 · `supabase/migrations/20270213000000_visit_slots_and_booking_rules.sql`, `lib/visits/schedule.ts`,
`lib/visits/scheduleDb.ts`, `app/(app)/settings/VisitScheduleSettings.tsx`, `BookingRulesSettings.tsx`,
`visitScheduleActions.ts`, `scripts/seed-visit-week.ts`**

`visit_slots` holds one row per named slot of an estimator's week (weekday, start minutes, run length, the zones
that can book it, an optional R14 conditional "also Zone X if the slot before is a Zone Y visit"), with a btree_gist
exclusion constraint so two slots of one estimator never overlap (section 8 test 18; the server action checks first
and says which slot it ran into). `visits` gained `zone` and `far_edge`, frozen at booking, because R14 and R18 read
what zone a CONFIRMED visit was in. The booking rules are one `settings` row, `visit_booking_rules` (same-day,
notice, window, hold, slot and visit length, the R34 phone caps, reminder time, public holidays, far-edge pairs, gate
order), created by the migration with the brief's starting values and edited at Settings → Booking rules. The
public-holiday list starts empty; S4 seeds it. `availability()` in `lib/visits/schedule.ts` is the ONE function that
says which slots a customer may see: pure, takes the week, confirmed bookings, live holds, busy times, the rules, the
customer's zone and far-edge flag and "now", applies §4.2's seven rules in order and returns days of offered slots
with the one-hour visit end (R32) and the 90-minute block end. Melbourne wall-clock throughout via `melbourneInstant`,
so the Monday after a DST change still offers 08:00. The nineteen golden tests in `schedule.test.ts` are the brief's
S2 "done when" list verbatim. `STANDARD_WEEK` (section 5, 21 slots, totals 16/13/6/5/9) is seeded per estimator by
`scripts/seed-visit-week.ts --estimator <email>` or the "Load the standard week" button in Settings — never by SQL
inserts. The old half-day engine (`lib/visits/availability.ts`, `settings.visits`) still serves `/estimate/book`
until S3 replaces the customer path; the Estimator visits panel now points at Booking rules for the numbers.

## 5 Oct 2026 — visit booking S1: suburb → zone list, the resolver, Settings → Visit zones

**2026-10-05 · `supabase/migrations/20270212000000_visit_zones.sql`, `lib/visits/zones.ts`, `lib/visits/zoneGeo.ts`,
`scripts/seed-visit-zones.ts`, `app/(app)/settings/VisitZonesSettings.tsx` + `visitZonesActions.ts`, `lib/crm/work-queue.ts`**

First build session of `docs/briefs/claude-code-brief-visit-booking-addendum-a.md`. Three staff-only tables:
`visit_zones` (the five zones, each with the estimator who covers it — R11), `visit_suburbs` (every Victorian
suburb + postcode with a status `zone_1…zone_5 | pre_arranged | out_of_area`, the R18 far-edge tick, a reviewed flag
and the basis), and `visit_unmapped_suburbs` (the FACT behind the "unmapped suburb" work item — a Victorian suburb a
customer typed that the list did not know; resolved when the suburb is added in Settings). The resolver
`resolveZone()` looks up by **suburb and postcode together** (Glen Waverley / Wheelers Hill share 3150) and runs on
the server with the service client for a customer; `resolveFromList()` is the pure rule the tests drive. The seed is
Matthew Proctor's Australian postcodes dataset (CC0), Victorian delivery areas with a 3xxx postcode, each precise
centre point tested against `docs/briefs/data/visit-zones-draft2.geojson` by ascending priority, then the rulings CSV
applied on top (it always wins; the five disagreements are listed in the review CSV and the session report).
`docs/briefs/data/visit-zones-review.csv` is what the seed reads — never hand-written inserts. Settings → Company →
Visit zones: filter by status, move one or many, far-edge tick, bulk approve, add a suburb, answer an unmapped
suburb, and "Check an address", which answers from the live table so a move is live for the next customer at once.
The work queue gained the kind `unmapped_suburb` (one source function, derived from the fact table, due the next
business morning). Pre-existing bugs fixed in passing: the range screen's "Book your estimator" / "Tell us" links
pointed at `/estimate/scope#reach`, an anchor that only renders on `/estimate/book` — they now go to the Book page;
and Save & book read the builder's `{address, city, postal}` keys off the wizard state (which uses
`{street, suburb, postcode}`), so it never linked a property — `propertyAddressFromState()` in
`lib/wizard/save-and-book.ts`.

## 4 Oct 2026 — estimator notes: typed or spoken, builder ↔ PC command, never the painter

**2026-10-04 · `supabase/migrations/20270211000000_estimator_notes.sql`, `app/components/estimator-notes/`
(`EstimatorNotes.tsx`, `actions.ts`, `estimator-notes.css`), `lib/estimate/notesBucket.ts`, `app/quote/QuoteBuilder.tsx`,
`app/pc/wo/[id]/page.tsx`**

Tom: "an estimator notes section at the top … notes or a voice recording … in the PC command page … not for
contractors". Table `estimate_notes` (kind text|voice, body, audio_path, duration) with a staff-only `for all` policy
and plain writes (the wo_booking_notes shape), plus private bucket `estimator-notes` (audio MIME, 25 MB, staff-only
object policies). One client component in both places, `surface="builder" | "console"`, which loads its list through a
staff-only server action AFTER mount — so no note text is in any page's server HTML — and records with MediaRecorder,
uploading the blob from the browser straight into the bucket (`<estimateId>/<ts>.<ext>`); `addVoiceNoteAction`
refuses a path outside that estimate's folder. Voice notes play from hour-long signed URLs. The older free-text
"Admin notes" box (`builder_state.adminNotes`) is unchanged. Spec `e2e/estimator-notes.spec.ts` records with
Chromium's fake microphone and asserts `/w/[token]` and `/e/[token]` HTML carry none of it.

---

## 4 Oct 2026 — an extra visit on any project, found by search

**2026-10-04 · `supabase/migrations/20270210000000_extra_visit_any_project.sql`, `app/pc/schedule/actions.ts`
(`searchProjectsAction`), `app/pc/schedule/ScheduleBoard.tsx`, `lib/scheduling/board.ts`, `app/portal/calendar/page.tsx`**

Tom: the Extra visit picker "only allows one"; make it "a search bar where you can search from all projects regardless
of their status". `schedule_add_appointment` drops the painter-is-on-the-job and not-closed guards (staff-only, logged
as before). The sheet's dropdown became a debounced search (`searchProjectsAction`: two bounded reads — work order
ref/title/address, and estimate title/customer via `estimates!inner` — merged by work order, open first); this row's
own jobs stay as quick picks when the box is empty. The board joins each visit's `work_orders` row in the same read so
a visit on a closed job outside the board's work-order window still draws. The portal calendar draws a visit on a
project the painter is not otherwise on from the visit itself, labelled "Extra visit — <note>".

---

## 1 Oct 2026 — a second visit on a booked job; pink holds while the client decides

**2026-10-01 · `supabase/migrations/20270209000000_schedule_holds_and_extra_visits.sql`, `lib/scheduling/holds.ts`,
`lib/scheduling/board.ts`, `app/pc/schedule/ScheduleBoard.tsx` + `actions.ts` + `schedule.css`, `lib/validation/booking.ts`,
`app/portal/calendar/page.tsx`, `lib/crm/work-queue.ts`**

Two small tables beside the booking state machine, which is unchanged. **`wo_appointments`** is a second run of days
on a job the painter already has (Tom: "a small job in between a job"): `schedule_add_appointment` refuses unless the
painter is named on the work order, holds a live/accepted offer for it, or is assigned to it; move/remove are RPCs too,
each logged on `wo_events`. The board draws a visit in the job's own colour (`Block.appointmentId`, `.blk.visit`), and
the painter's portal calendar reads their own rows (RLS `contractor_id = current_contractor_id()`). Google Calendar is
one event per work order and does not carry visits. **`schedule_holds`** is the office reserving a painter's days
while the client decides — staff-only RLS, the painter has no policy — drawn bright pink (`BlockKind "hold"`,
`--hold: #ff2d9b`). A hold is **resolved by the booking it waits on, not by a tick**: `openHolds()` drops a hold whose
`work_order_id` has a live/accepted offer, an assignment or a dated contractor; a hold with no job stays until
`schedule_release_hold`. The drag across empty lane space now opens a three-mode sheet (Block out · Extra visit · Hold);
the tray-drop sheet gains **Hold these dates instead**; a hold's own sheet has **Book it now** (re-opens the drop sheet
on the held dates) and **Release**. Holds and visits drag along their own row (`moveHeldOrVisit`). Work queue: a new
`hold_pending` item a week before the first held day (`buildHoldItems`, due two days before), label **Held dates** on
Today. Specs: `e2e/schedule-hold-visit.spec.ts`; unit `lib/scheduling/holds.test.ts`, `lib/crm/work-queue-holds.test.ts`.

---

## 23 Sep 2026 — one offer per job for revision changes; approved changes reach the painter

**2026-09-23 · `supabase/migrations/20270192000000_variation_offer_bundle.sql`, `lib/workorder/scopeChanges.ts`,
`app/quote/RevisionPanel.tsx` + `revisionActions.ts`, `app/v/[token]/*`, `app/w/WorkOrderDoc.tsx` + `[token]/page.tsx`,
`app/portal/jobs/[id]/page.tsx`, `app/pc/wo/[id]/as-contractor/page.tsx`, `lib/contractor/jobs.ts`,
`lib/portal/{portfolio,tradePortfolio,timeline,data}.ts`**

**The customer signs a LIST, once.** The row stays the unit of record (one `wo_variations` row per scope block —
strike, contractor pay, invoice line, /e changes all hang off it), but `customer_token` is no longer unique: every
pending revision draft on a work order shares one token, so the signing link IS the offer. `wo_draft_revision_variation`
joins a new draft to the open offer's token; `wo_variation_by_token` returns every row (no `limit 1`);
`wo_customer_sign_variation` / `wo_customer_respond_variation` loop over every pending row behind the token in one
transaction. `/v/[token]` lists the changes with their photos and lines, the net figure and job total before → after,
and one Approve-all / No-thanks. The revision panel shows one offer row (count, net, one link, one Email/Text/Both)
with the changes under it; photos stay per addition and gate the send. The portal's attention list and timeline group
pending rows by token (`pendingOffers`) so five rows are one card. Contractor-raised variations priced through
`wo_price_variation` keep a token of their own (a list of one).

**Approved changes reach the painter.** `wo_has_painter` (named contractor, live/accepted offer, or employee
assignment). With nobody on the job, a signed change folds in on signature — `contractor_accepted`, event
`variation_folded_into_offer` — and `send_offer` prices `payment_cents` as base pay + `wo_contractor_variations_cents`
(the SQL twin of `contractorPay.ts`, pinned by `variationOffer.contract.test.ts`), so the first painter sees one
figure; the jobs list and the portal sheet's Payment line carry the same adjusted figure. With a painter on the job,
release/accept is unchanged. Either way the job sheet lists **Changes to the scope** (`scopeChanges` prop: scope and
hours, never price) from the contractor's own rows on the portal and from `get_work_order_scope_changes_by_token` on
the token link. The sheet's frozen areas are not rewritten by a variation — the list is the record, alongside the strike.
`e2e/revision-builder.spec.ts` drives it as the anonymous customer and the anonymous painter link.

**Approved variations are tick rows (20270193, same day: "make the variations tick items").** `lib/revision/diff.ts`
now carries `addedSurfaces` (key `areaId:surfaceId`, heading, label — every surface of a new area, the new surfaces
of a changed one, never a line item) and the draft action stores them on `priced_inputs.surfaces`. A trigger on
`wo_variations` (update of status, and insert for rows born approved) calls `wo_apply_variation_surfaces`: for a
non-credit variation with `est_hours > 0` it upserts those rows into `wo_surfaces` under the area's heading, marked
`added_by_variation`; a keyless variation (raised on site / quick-priced) becomes ONE row under "Variations" in the
painter's words, keyed `variation:<id>`. A row a credit struck and a later addition brings back is un-struck, not
duplicated; ticks are never reset. `wo_seed_surfaces` keeps `added_by_variation` rows across a re-issue. Rows count
toward progress, the before-photo gate and `wo_gate_blocked` like any other. Backfilled for open jobs in the
migration. Pinned by `variationTickRows.contract.test.ts`; driven in `revision-builder` and `wo-variations` specs.

---

## 4 Sep 2026 — number boxes, capture save-on-exit, office acceptance email

**2026-09-04 · `app/components/NumInput.tsx`, `app/quote/QuoteBuilder.tsx`, `app/quote/capture/CaptureApp.tsx`,
`lib/estimate/acceptedNotify.ts`, `app/api/estimates/accepted/route.ts`, `lib/portal/approvalData.ts`**

`NumInput` is the one number box: text while focused, a number when it parses, `empty` says what a blank
means. Capture's "Exit to builder" became "Save & exit": it commits the room on screen, flushes the offline
queue, awaits tracked in-flight commits, and only then routes to the builder; a server refusal is shown with
its reason (sync state `error`) and is never queued as "offline". `notifyOfficeOfAcceptance` emails the office
once per accepted estimate (guard: estimate_events `office_accept_notified`, switch: Automations
`office_estimate_accepted`); the /e page pings `/api/estimates/accepted` by token, the server-side acceptance
paths call it through `acceptViaToken`.

---

## Tom's 3 Sep batch: settings in buckets, condition hours on the job sheet, auto-release, Automations

**2026-09-03 · `app/(app)/settings/SettingsShell.tsx` + `page.tsx`, `app/(app)/settings/AutomationsSettings.tsx`,
`lib/automations/registry.ts`, `lib/messaging/config.ts` + `load.ts`, `lib/workorder/conditionAllowance.ts`,
`lib/workorder/snapshot.ts`, `app/quote/QuoteBuilder.tsx` (computeWorkOrderDoc), `app/w/WorkOrderDoc.tsx`,
`lib/wizard/exteriorAnswers.ts`, `supabase/migrations/20261229000000_variation_auto_release.sql`**

**Settings is six buckets.** Company · Communications & automations · Estimates · Pricing · Rooms & scope rules ·
Money. `SettingsShell` (client) takes the buckets as data — each folder's content is still rendered by the server
page and passed in as a node — and adds a sticky jump bar, a "Find a setting" filter across every folder, and
`#<folder-id>` deep links that open and scroll to a folder. Folder TITLES are unchanged (the e2e clicks them);
`SettingsFolder.tsx` and `MessagingSettings.tsx` are gone, the latter absorbed into Automations.

**Condition reaches the painter in words, not just in the number.** The Condition modifier always scaled
painting HOURS (`priceSurface: paintingHr = base × jobMod`), so the contractor's hours, the offer allowance and the
booked days already carried a Poor/Heritage/Weathered job — but nothing said so. `conditionExtraHours()` splits the
condition's slice back out; the work-order document now carries `condition {code,label,multiplier,extraHours}` and
per-surface `paintingHours/prepHours/conditionHours`; the job sheet shows "Condition · extra prep: Poor — extra prep
allowed for: +N h" and each surface "incl. N h prep"; the offer card shows "Extra prep allowed". The one path that
genuinely priced nothing was the wizard's exterior **"Peeling & flaking"** — it raised the site-visit deferral and
NO modifier. It now maps to `COND-POOR` (worst-wins with weathered), in the wizard, the loop's Condition card and the
assistant, and the visit deferral still stands. `estimate.test.ts` pins that a poor job gives the contractor more
hours and more pay.

**Approved variations go straight to the painter.** `wo_customer_sign_variation` has released on signature since
20261002 when `wo_loop.variationRelease = "auto"`; the seed said `'pc'` and no screen could change it. Migration
20261229 flips the row (data only); the switch is on Settings → Automations ("Approved variations go straight to
the painter", written as a merge into the `wo_loop` row); the sign action already texts the painter. The revision
panel's "Already signed" list now says where each change is (with the painter to accept / painter accepted /
awaiting release). `e2e/variation-auto-release.spec.ts` pins the auto side; `wo-variations.spec` pins the manual
side by setting the mode for its run (`setVariationRelease` fixture helper).

**Presentation tick saves itself; the Estimate tab previews unsaved edits.** `presentationId` joined the
builder fingerprint (it was missing, so a tick never dirtied or saved the estimate), a tick triggers `save()`
at once, the Estimate tab shows the live build whenever `unsaved` is true (with a banner) instead of the stale
published snapshot, and the presentation picker re-reads `presentations` on window focus / on open so a
presentation made in Settings appears without a reload.

**Automations — one list, one switch each.** `lib/automations/registry.ts` is the catalogue of every outbound
communication (34 send sites audited): key, audience, channels, trigger, kind (automatic / manual / planned),
template fields. The `messaging` settings row gained `disabled: string[]` and template fields for the automatic
messages that were hard-coded (job offer text+email, variation released, QA fail, walkthrough invite,
signed report, chat reply, receipt, remittance, wizard saved-link). Each send site asks `automationOn(cfg, key)`
first (`lib/messaging/load.ts` is the one server loader) and renders its wording with `renderTemplate`. Manual
sends (estimate, invoice, update, variation-signature) are listed, not gated; "planned" rows name the events that
are recorded but send nothing, so nobody assumes a message is going out.

---

## Tom's 23 Aug batch: settings that save, optimistic deletes, a phone nav, balustrades, allowances

**2026-08-23 · `lib/settings/numeric.ts`, `app/(app)/settings/PricingSettings.tsx`,
`app/(app)/estimates/`, `app/(app)/AppSidebar.tsx`, `lib/estimate/substrates.ts`,
`lib/capture/commit.ts`, `app/api/estimates/[id]/rooms/route.ts`**

**Settings could not be saved at all.** "Pricing & job numbers" took every row
that wasn't one of six named keys — including whole configuration objects
(`wizard_policy`, `wo_loop`, `service_area`) — coerced each with `Number()`, and
got `NaN`. `NaN` serialises to JSON `null`, `settings.value` is NOT NULL, and one
bad value fails the whole upsert. `lib/settings/numeric.ts` now decides by SHAPE
rather than by a list of keys to exclude, so a key added tomorrow is handled
without anyone remembering the folder exists; and a save writes the
`{unit, notes, value}` envelope back whole instead of flattening a lever to a
bare number. Had the old save ever succeeded it would have wiped the units and
notes off every row and replaced the config objects with integers.

**Deletes are optimistic.** The row leaves the list on confirm and the server
action finishes behind it; a row only returns if the database actually refused
it, and then it returns with the reason. The single button no longer deletes —
it asks, and hands the id to the table, which owns the list.

**The staff sidebar is a drawer on a phone.** 224px of a 390px screen left
almost nothing for the page. Off-canvas behind a menu button under `md`, with
the logo and the current page's name in a bar across the top.

**Balustrades are one tick on both sides.** The card files the interior run
under `Balustrades` and the exterior one under `Hand Rails`, so the substrate —
which knew only the exterior code — was invisible indoors and went by a name
nobody searches for outdoors. One key, both codes, one label ("Balustrades &
hand rails"), and it joins the always-offered tiles so it is in the grid rather
than buried in the add panel. Allowances are now excluded from the customer's
add panel: an allowance is an estimator's judgement in hours.

**Plastering and raw timber: hours and a note, on the capture screen.**
`ALLOWANCE_DEFS` in `lib/capture/commit.ts` is one mechanism with two members.
The hours ride `prepHr`, NOT a quantity — pricing charges prep hours at the
charge-out rate whether or not the code matches a rate-card row, so they price
correctly with no new rate rows and no migration to wait on, and can never be
knocked out by a rate row drifting off "one hour per unit". Raw timber stamps
`RAW TIMBER — seal before topcoats.` on the crew note whether or not hours are
added, because the tag is the point. **The e2e caught a real bug here**: the
rooms route's zod schema strips what it does not name, so the allowances reached
the server and were silently dropped — the "compiles and unit-tests" version of
this feature would have shipped doing nothing.

---

## Projects console: the schedule moves in, and site photos finally get read

**2026-08-22 · `app/pc/schedule/` (was `app/(app)/schedule/`), `app/pc/PcNav.tsx`,
`lib/workorder/photos.ts`, `app/components/wo/PhotoGrid.tsx`,
`supabase/migrations/20261024000000`**

Four changes, one theme: the office screens now show what the job actually is.

**Scheduling is a step in the workflow, not a separate app.** The board moved
under `/pc/schedule` and became the FIRST tab of the console, which the sidebar
now calls **Projects** rather than "Live jobs"; the standalone Schedule sidebar
entry is gone and `/schedule` permanently redirects. The tab rail became a client
component (`PcNav`) so the current tab can light up — the `.on` style was already
in the stylesheet with nothing setting it. `schedule.css` widens the console
shell only on a page that actually contains a board (`:has(> .sb)`), so the rest
of the console keeps its 1060px measure.

**The lane column pins.** `.cinfo` (and the two header cells above it) are
`position: sticky; left: 0` inside the timeline scroller, with the `.tl` left
padding removed — a gutter there is a strip the pinned names do NOT cover, and
blocks scrolled through it and read as debris. The day header now stacks the
weekday over the date at every zoom level instead of dropping the name below
44px per day.

**The job sheet reads the ticks, not the frozen copy of the scope.**
`wo_snapshot` carries a `status` per surface, written once at issue and never
again, so every job sheet said "Not started" over work the painter finished.
`WorkOrderDoc` now takes a `ticks` map keyed by the document's own surface key
(`lib/workorder/surfaces.ts` → `ticksBySurfaceKey`): the builder's Work order tab
gets it from `wo_surfaces` in the page query, and `/w/[token]` — anon, so RLS
rightly refuses it the table — gets it from the new security-definer
`get_work_order_ticks_by_token`, degrading to the frozen statuses if the
migration has not been applied yet.

**Site photos exist on screen.** `wo_photos` rows had been written since the loop
shipped and read by exactly one query ("has this elevation got a before
photo?"). `lib/workorder/photos.ts` is the read side — one place that signs a
batch of paths into the private bucket, shapes and groups them, and drops a row
whose object has gone missing rather than rendering a broken tile.
`PhotoGrid` renders them with no hooks, so the same component serves the Server
Components and the builder's client tree. They now appear on the console job
screen (grouped by kind, and again under the variation each one justifies), on
the job sheet, and as a "Latest from site" strip on the Projects dashboard.

---

## AI plan reader — P0: the boundary, the schema and the file pipeline

**2026-08-17 · `lib/extract/`, `app/api/extract/floorplan/route.ts`,
`app/dev/extract/[runId]/`, `supabase/migrations/20260910000000`**

The first piece of the plan reader, and the app's **first API route**. It takes
a plan, works out what it is from its bytes, rasterises each page at 200 DPI,
lifts the text layer, classifies each page, stores everything in a private
bucket and writes one run row per page. **No model call** — that is P1. The
brief's own reasoning: the model call is the easy part; the accuracy lives in
the geometry and the plumbing.

**Two departures from the brief, both forced by the actual schema.** There are
no `areas` / `surfaces` tables to add provenance columns to — the builder tree
lives in `estimates.builder_state` jsonb with integer node ids, and
`estimate_areas` / `estimate_lines` are vestigial (nothing reads them). So
per-node provenance goes inside the jsonb node as additive fields, which suits
the brief's first rule better than a side table: the AI adds fields to the tree
rather than changing its shape, provenance survives duplicating an area, and no
backfill is needed because an absent `origin` reads as `human_confirmed`.
`defect_observations` therefore keys by `estimate_id` + the builder's own node
ids rather than by foreign key.

**mupdf (WASM) over poppler or a native canvas**, because it needs no system
binary and runs unchanged on Vercel. It also extracts the text layer, and that
turns out to matter more than the rendering: on a vector plan the dimension
strings come back exactly — `3.60 x 4.20` as characters. The brief names small
dimension text as the single biggest source of read errors; for digital plans
that is largely solved before the model is asked anything. A scan has no text
layer, says so, and carries low confidence.

**Page classification is deterministic**, from the text layer, and explains
itself in words that surface on the debug page. It found a real trap while being
tested: a Victorian **Section 32** vendor's statement is routinely bound into
the same PDF as the plan, and "section" is also a drawing term — it was reading
as an elevation sheet. Only a drawing-shaped label (`SECTION A-A`,
`SECTION 1:100`) counts now.

**No service-role key.** The brief specifies one; this app has never had one and
runs on the anon key plus RLS. The route uses the caller's own session, so RLS
and the storage policies do the enforcing — strictly safer than introducing a
key that bypasses them.

---

## An offer may only go to a compliant contractor

**2026-08-17 · `supabase/migrations/20260909000000`, `app/(app)/schedule/actions.ts`**

**Found by the end-to-end test on its first real run**, which is the entire
argument for having one. The test dropped a job on the first lane of the board;
lanes sort by company name and a contractor who hasn't filled hers in sorts to
the top, so the offer went to someone with **no verified insurance certificate**.
It was accepted by the system without complaint. Had she accepted it, an
uninsured painter would have been booked into a customer's home.

`send_offer` checked `active` (not suspended) but never `offerable`. Everything
upstream of that flag was correct — the trigger that computes it, the staff
verification step, the column privileges stopping a contractor setting it
themselves. Nothing consulted it at the moment it decided anything.

The fix also closes the stale-flag gap carried since Phase A: `offerable` is
recomputed only when a `contractor_documents` row changes, so a certificate that
lapses untouched leaves it reading true. `send_offer` now recomputes at the
point of use, so an offer can't ride on a certificate that expired last month.

Non-offerable lanes still appear on the board on purpose — staff need to see who
is nearly ready, and those lanes are already marked. The send is refused, not
the visibility.

---

## R6 — error reporting, query counts, and the last of the input validation

**2026-08-17 · `lib/monitoring/report.ts`, `lib/contractor/session.ts`,
`supabase/migrations/20260908000000`**

**The silent catches were worse than silent (S9).** Nine `catch {}` blocks
swallowed failures — but Supabase's client returns `{ error }` and does not
throw, so most of those handlers never ran at all and the error was simply
never read. Three of them dropped real work: the customer's **signature** on
acceptance, and two staff writes (product sheen, and the work-order colours and
crew notes a contractor works to).

`lib/monitoring/report.ts` is now the single seam every failure goes through.
`reportIfError(result, { where })` takes the `{ error }` shape directly, which
is what makes the dropped-error class of bug hard to write again. Best-effort
calls (view pings, expiry sweeps) still continue on failure, but they warn
rather than vanish. There is no Sentry account yet, so rather than half-install
one behind a missing DSN, the file marks the one place `captureException` goes.
The three that lose data now surface: the customer is told plainly if their
signature didn't store, and staff see why a save failed.

**The portal ran its session guard twice per request (S5).** The layout called
`getContractorSession` and the page called `requireContractor`, each doing
getUser + profiles + contractors. The three queries are now behind React's
`cache`, which is per-request and therefore safe for an auth check. Measured by
counting executions against a running server: **4 runs for two page loads
before, 2 after** — one per render, three queries saved per portal view.

**Unbounded selects (S6).** The scheduling board fetched *every offer ever
made* on each load; it now takes a window, deliberately wider than the visible
range because settled offers supply the tray's decline note and proposals must
appear in the approvals queue whatever their dates. The contractors page asked
for every offer to compute two counts, and settings read every estimate row to
count presentation usage. Both now ask only for what they use. The builder's
product and contact lists are deliberately NOT capped — silently truncating a
picker is worse than the query it saves.

**Input validation, the C4 remainder.** Money and state already went through
validated functions; ordinary editable data had nothing checking *what* was
written, only which rows. Constraints now live in the database rather than a
route, because a CHECK cannot be gone around with the anon key and curl: crew
size 1–99, sane text lengths on the contractor and document tables, a trigger
refusing a certificate that expires more than ten years out (a trigger, not a
CHECK — "ten years from now" is not immutable), and invite lifetimes clamped to
30 days inside `create_contractor_invite`, which previously took whatever day
count it was handed.

---

## R5 — tests (Vitest + Playwright)

**2026-08-17 · `vitest.config.mts`, `playwright.config.ts`, `lib/**/*.test.ts`,
`e2e/`, `lib/scheduling/dates.ts`**

Audit finding S8: nothing built in the last five phases had a test. The offer
state machine, the privacy gate, compliance state and the date arithmetic were
all verified by hand against the live database — which found real bugs, but none
of it was repeatable.

`npm test` is now **Vitest**, and runs under `TZ=Australia/Melbourne`. The
timezone is not decoration: the worst bug this project has shipped was calendar
dates parsed as local midnight and formatted back through `toISOString()`,
which moved every computed date a day earlier east of Greenwich — a job dropped
on 1 September was saved as 31 August. A suite running in UTC cannot see that
class of bug at all. The first test in `dates.test.ts` asserts the suite really
is east of Greenwich, so the rest can't pass vacuously.

**`lib/scheduling/dates.ts` is new** and is the enabling change: `addDays`,
`dayDiff` and the local-`today` helper existed in three hand-copied versions
(board loader, schedule page, board component) which is how the versions
disagreed in the first place. One module, imported by all of them, tested once.

The 42 pricing tests moved across unchanged — only the `node:test` import line
differs — and 63 new ones cover the offer state machine (expiry lapses an
unanswered offer but never a proposal), the **privacy gate** (`toJob` and
`committedIds`, which decide whether a customer's address reaches a contractor's
browser), compliance state (`docState`, including the stale-`status` case), and
the FIN→PG finish mapping. 105 in total.

Each of those was checked by breaking the code and watching the test fail:
removing the redaction fails 2 privacy tests, and reintroducing the date bug
fails 6.

**Playwright** (`npm run test:e2e`, never part of `npm test`) drives a real
browser against the real database, so it is deliberately opt-in and takes its
logins from the environment — the config carries no credentials.
`contractor-portal.spec.ts` passes today and includes the standard that
contractor HTML never carries customer money, asserted against the raw response
body including the RSC payload. It matches this codebase's own field names
(`marginCents`, `subtotalCents`) rather than the bare word "margin", which
appears in framework CSS — the same false positive the audit itself hit.
`offer-accept.spec.ts` covers the critical path end to end but **has not been
run**: it needs a staff login, which the session that wrote it did not have.

---

## R4 — upload limits, the bank-change alert, and two small things

**2026-08-17 · `lib/uploads/validate.ts`, `supabase/migrations/20260905000000`
–`20260907000000`, `app/(app)/contractors/`, `app/join/[token]/page.tsx`**

Four independent audit findings, none of which needed the others.

**Uploads are constrained by the bucket, not the file input (C5).** All six
upload paths went browser → Storage with only `accept=` between them and the
bucket, which is a UI hint. Each bucket now declares `file_size_limit` and
`allowed_mime_types`, so Storage refuses an oversized or wrong-typed file
whether or not a browser was involved. `lib/uploads/validate.ts` holds the same
rules for the pre-flight message, so a painter is told *before* pushing 200 MB
up a phone connection. SVG is on no list anywhere: it can carry script.

**Bank changes raise an alert (S10).** `contractor_set_bank` has always written
a `bank_changed` event; nothing read it. The event now records what the details
changed *from*, and only fires when they actually moved. `/contractors` opens
with a queue of unacknowledged changes — old account → new — that staff clear
with "I've checked this" (`acknowledge_contractor_event`). This is the
invoice-redirection control; encryption and masking were already in place.
`contractor_events` lost all client write access in the process: every event is
written by a SECURITY DEFINER function, and an audit trail its subject can edit
is not one.

**`/join/<unknown>` 404s (S2).** It rendered a friendly 200, which told a
guesser the difference between "no such invite" and "one that was revoked".
Real-but-dead invites (revoked, used, expired) keep their friendly page — the
painter holding one deserves to know which it is.

**`work_orders.contractor_id` is indexed (S4)** — it sits in the portal's RLS
policy, so it was evaluated on every contractor read of the table.

---

## R3 batch 1 — work orders through the server (recorded late)

**2026-08-17 · `supabase/migrations/20260904000000`, `app/quote/workOrderActions.ts`**

R2 revoked `wo_snapshot`, `contractor_payment_cents`, `status`, `issued_at`,
`contractor_id` and `start_date` on `work_orders` from client roles — correctly,
since they are money and state — but the builder still wrote them directly, so
"Issue to contractor", the contractor dropdown and the start-date field had been
broken on the live database since that migration ran.

`issue_work_order` takes no document and no amount: the server reads both from
the estimate's saved work-order document, the same source `accept_estimate`
uses, so restoring the button cannot reopen the hole R2 closed.
`set_work_order_schedule` handles the contractor and start-date controls and
refuses to reassign underneath a live offer (`conflict:live_offer`) rather than
silently desyncing the work order from the offer. Hand-edited content — colours,
crew notes, hours overrides — still writes directly under RLS; it is neither
money nor state.

---

## R2b — the server boundary for estimate send and accept

**2026-08-17 · `supabase/migrations/20260903000000`, `app/quote/actions.ts`,
`lib/validation/estimate.ts`**

Two holes closed.

**Accepting a quote no longer trusts the browser's total.** `accept_estimate`
took `p_total_cents` from its caller, and that caller is the customer's browser
on a public token page — anyone with the link could accept a $9,800 quote for
$1, and the deposit invoice is raised from that figure. It now derives the total
from the estimate's own stored snapshot and ignores what it is handed. The
parameters stay for compatibility; `estimate_events` records the figure the
client claimed alongside the one actually used, so an attempt is visible.

**Sending is a guarded transition.** `send_estimate` refuses to send an accepted
(locked) quote and returns `conflict:<status>` if the screen's idea of the state
is stale. `estimates.status`, `sent_at`, `accepted_at`, `accepted_name` and
`accepted_signature` are revoked from client roles; everything the builder
legitimately saves stays writable.

**Still open, and it needs a decision:** `estimates.subtotal_cents` and
`total_cents` are still written by the builder on save. Recomputing them
server-side needs `SUPABASE_SERVICE_ROLE_KEY` in the server environment —
permitted by CLAUDE.md, but the app has no such key today. Until then those two
columns remain client-written. Flagged rather than half-done.

---

## R2 — the server boundary for booking money and state

**2026-08-17 · `supabase/migrations/20260902000000`, `lib/validation/booking.ts`,
`app/(app)/schedule/actions.ts`**

Booking writes no longer come from the browser. Each transition is one
SECURITY DEFINER function = one transaction (`send_offer`, `withdraw_offer`,
`reassign_offer`, `move_booking`), fronted by a server action that zod-validates
its input and checks the caller is staff.

Three properties worth stating plainly:

1. **No amount crosses the wire.** `send_offer` reads the payment from
   `work_orders.contractor_payment_cents`, which the server wrote from
   `lib/pricing` — the reason R1 came first. The zod schemas have no field for
   an amount, deliberately.
2. **Every transition takes the expected current state** and returns
   `conflict:<actual>` if the row has moved on. A stale tab can no longer
   withdraw an offer the contractor already accepted; it gets "refresh".
3. **The back door is shut.** `revoke insert, update, delete on booking_offers
   from authenticated`, and `work_orders` keeps write access only to the
   hand-editable columns (crew notes, colours, access notes). Calling
   supabase-js directly with the anon key is refused by the database, not just
   discouraged by the UI.

Contractor-side responses (`respond_to_offer`, `resolve_proposed_offer`,
`cancel_booking`) already had this shape and were left alone.

**Deferred to R2b:** estimate send/accept still write status directly, and
`accept_estimate` still takes a total from the caller. Invoices and variations
don't exist yet, so their RPCs wait for the features.

---

## R1 — estimate pricing extracted to `lib/pricing/`

**2026-08-17 · `lib/pricing/estimate.ts`, `app/quote/QuoteBuilder.tsx`**

All estimate arithmetic moved out of the builder component into
`lib/pricing/estimate.ts` as pure functions: plain typed objects in, integer
cents out, no React, no Supabase, no clock. `QuoteBuilder` now assembles inputs
and renders results — it computes nothing. 135 lines lighter.

Why it matters beyond tidiness: the server can now reproduce any amount. That is
the precondition for the server boundary (R2), where a booking offer's payment
must be derived server-side rather than accepted from the browser.

The safety net is `lib/pricing/golden.test.ts`: it reprices every estimate in the
dev database and asserts the result matches what the ORIGINAL in-component code
stored — an independent check, since those figures were produced by the code
being replaced. Fixtures live in `__fixtures__/golden-estimates.json` and carry
no customer data (only the fields that affect a cent).

One case needed an override: an estimate whose stored total predates a reference
price change. The value the original code produces *today* was read from the
running app and recorded with provenance in `__fixtures__/golden-overrides.json`
rather than the fixture being quietly re-recorded.

`npm test` now runs the whole pricing suite — 42 tests.

**Still non-compliant here:** money is still written to the database from the
browser; that is R2's job, not this phase's.

---

## Estimates are snapshots, and staff read the same one the customer does

**2026-08-17 · `app/quote/QuoteBuilder.tsx`, `app/quote/page.tsx`, `app/e/[token]/`**

An estimate is published as a **snapshot** (`estimates.sent_snapshot`, built by
`buildCustomerDoc`). Both the customer's token page and the staff view render
*that* snapshot, so the two can never show different numbers.

Opening a saved estimate lands on the **ESTIMATE** view — the customer's copy,
read-only. Changing it is a deliberate act: **Edit estimate** switches to the
builder and shows a standing warning that saving republishes the customer's
copy. A brand-new estimate opens straight into the builder, because there is
nothing published yet.

The snapshot is held in component state and refreshed from the value written
during `save()`, so republishing updates the screen without a page reload.

This replaces the previous "staff see a live rebuild of current form state"
behaviour, which could disagree with what the customer was looking at and
breached the standard that token surfaces render snapshots, never live drafts.

**Since fixed:** `save()` used to write `estimates.status` directly instead of
going through a state-transition function (C3 in the audit) — R2b replaced that
with `send_estimate` and revoked the column. The pricing-in-component problem
was fixed in R1.

---

## Contractor portal, scheduling and onboarding

**2026-08-16 · `app/portal/`, `app/(app)/schedule/`, `app/(app)/contractors/`,
`lib/contractor/`, `lib/scheduling/`**

Contractor-facing surfaces (`/portal`, `/w/[token]`) render the work-order
snapshot only, with the customer's address and contact redacted **server-side**
until the contractor accepts the booking — not hidden with CSS.

Booking offers are a Postgres enum state machine (`offer_state`). Contractor
responses go through `respond_to_offer`; staff resolution through
`resolve_proposed_offer` / `cancel_booking`. Two rules are enforced in the
database rather than the UI: one live offer per job (partial unique index), and
24-hour expiry re-checked server-side on every response.

Compliance: `contractors.offerable` is computed by trigger and requires an
insurance document that exists in storage **and** has been verified by staff.
`offerable`, `tier`, `active` and the bank columns are withheld from client
writes by column privileges.

**Since fixed:** the staff scheduling board used to write
`work_orders`/`booking_offers` directly from the browser, with the offer amount
supplied by the client. R2 moved every booking transition into a transactional
RPC and R3 did the same for the work order; the client no longer sends an
amount at all.

---

## Internal wizard (Step 7, W1–W3)

**2026-08-18 · `app/wizard/`, `lib/wizard/`, `app/api/wizard/submit/`,
`app/api/estimates/[id]/wizard-edit/`, `lib/pricing/context.ts`**

The five-page wizard (`/wizard`, staff-gated, dark scoped `wizard.css` per the
approved mockup) collects ANSWERS into one zod-validated state object — never
a room, a quantity or a price. Page-1 uploads start the existing plan-reader
pipeline in the background (one read per page at upload time); the submit
route rebuilds the tree from the STORED readings (or, no-plan, from a starter
list synthesised through the same `buildDraft` stage 5 and downgraded to
`ai_assumed`), then `lib/wizard/merge.ts` applies the answers: page-2 ticks
filter surfaces, the condition tier sets coats, and the "mostly" door/window
styles resolve the reader's deferred openings ("not sure" stays deferred —
never guessed). The estimate lands as `source='wizard'` (migration 20260915;
graceful fallback with a staff-visible warning until it runs) with the full
wizard state snapshotted in `builder_state.wizard` for the editor's add-room
re-merge and the Step 8 customer layer.

The editor reprices EVERY edit server-side via `wizard-edit` (confirm height /
confirm room / add / remove) and shows the dollar-weighted accuracy score
(`lib/wizard/accuracy.ts`) over the provenance model. The shared `RoomCard`
is consumed, not forked. `lib/pricing/context.ts` now owns the
PricingContext/Adjustments assembly that previously lived inline in the
capture page and rooms route.

**Known gaps, recorded not faked:** plan↔card region-highlight sync needs room
outlines the extraction schema doesn't report; listing scrape still returns no
address/photos/m² (Step 8); exterior-only jobs create an empty estimate
carrying the site-check deferral until E2 wires the envelope drafting.

---

## Exterior envelope E2 (Step 6)

**2026-08-19 · `lib/extract/elevation.ts`, read-route fork, wizard submit,
`scripts/score-envelope.ts`**

The envelope now has eyes. `readElevationPhoto` reports cladding bands with
REFERENCE-BASED measurements only — door heads, counted brick/board courses,
storey lines, unit sizes injected from the `measurement_units` Settings table
— and `readSitePlan` reports footprint edges from printed dimensions or a
scale bar only. `mergeSitePlanWidths` fills photo-unmeasured widths from the
matching side's edge (the photo's own reference wins). `/api/extract/:runId/
read` forks on `page_class`, so elevation and site-plan runs get their own
readers instead of failing through the floorplan prompt. The wizard's submit
assembles the envelope, appends priced `Exterior` nodes via
`envelopeToAreaNodes` (now typed `DraftArea[]`), writes the reconciled
`exterior_envelopes` row and `requires_site_check` (best-effort), and defers
per segment. Proportion is never a basis: the rae276 smoke run correctly
priced NOTHING on a parapeted rendered terrace with no countable reference —
that job defers to a site check by design.

`scripts/score-envelope.ts` scores predicted wall m²/lineal m against the
exterior work-order truth (walls ±10% band); it lists jobs awaiting facade
photos. `score-regression.ts` now routes exterior-SHAPED work orders (cladding
items, no Ceiling — jobs 3000/3087 wore a "mixed" label) out of the interior
gate, which they had been polluting.

---

## Customer wizard — Step 8 (W4)

**2026-08-19 · `app/estimate/`, `app/wizard/CustomerResult.tsx`,
`lib/wizard/policy.ts`, `lib/supabase/service.ts` + `guards.ts`, all wizard
routes, migration 20260916**

The public wizard (`/estimate`) runs the same five-page flow plus an email
gate, in CUSTOMER mode. The architecture is deliberately narrow: a visitor
gets a Supabase ANONYMOUS auth identity but ZERO direct table access — every
read and write goes through the existing server routes, which switch to the
service-role client (`createServiceClient`, server-only) with explicit
ownership checks (`getWizardActor`; a customer touches only their own
`customer_intake` draft, 404 otherwise). The rate card is therefore never
readable from a customer's browser; RLS is unchanged.

`lib/wizard/policy.ts` (pure, Settings-driven) is the safety core, evaluated
server-side BEFORE any price is revealed, most severe first: asbestos +
lead-paint HARD STOPS (no price, ever), service-area postcode check,
commercial/heritage/body-corp HANDOFFS, the $2k floor, then a REVEAL as a
range whose width follows the accuracy band (≥90 ±4 / 70–89 ±8 / <70 ±15).
Acceptance is gated by the walkthrough policy and is impossible for any
`requires_site_check` job — every exterior signs off with a human (Tom's
rule). `customerPayload` strips margin, point price and internal labels;
adversarial tests (`lib/wizard/adversarial.test.ts` +
`scripts/adversarial-wizard.ts`) assert the leaks and bypasses fail safely.
Customer confirmations stamp `customer_stated` (accuracy credit 0.75) —
better than an assumption, always cross-checked in the staff review queue.
The route is OFF behind the `wizard_public` setting until Step 10's launch;
staff preview anytime.

---

## Proving window — Step 9 enablement

**2026-08-19 · `app/(app)/proving/`, `lib/wizard/proving.ts`, submit snapshot**

The proving window (Step 9) is Tom's calendar work — real enquiries through
the wizard — but its exit condition (median staff correction < $150, on a
real sample) needs measuring. Each wizard submit now freezes its first-guess
numbers into `builder_state.wizard.snapshot` (total, accuracy, outcome).
`lib/wizard/proving.ts` (pure) reprices the live estimate and measures the
correction against that baseline; `/proving` (staff nav) shows it per
estimate and in aggregate with the gate verdict. "Is the wizard accurate
enough to switch on?" is now a number, not a feeling — and it's the same
`wizard_public` flag Step 10 flips once the gate holds.

---

## Builder/settings/chat batch (Aug 2026 — Tom's 8-point list)

**Wizard paint page** asks colours-vs-advice after a brand is picked
(`paint.colourHelp`). **Line items** carry a `subcontractorExpense` flag
(carpentry/scaffolding via a 3rd party) — admin invoiced-vs-paid
reconciliation is still to build. **The builder** opens on the builder view,
not the customer view; the **quote name auto-fills** from the first line of
the job address. **Status** is a clickable pill → `set_estimate_status` RPC
(migration 20260917, server-owned column, accepted stays locked); declining
prompts for and stores `declined_reason`.

**Settings**: EditableTable + LineItemsManager save by SECTION (dirty-tracked,
one button); substrates group under their Folder (`sub_category`); the
substrate paint field is a dropdown of products; a secondary
`company_profile.logoUrlLight` is used on the email + quote PDF.

**Estimate chat** (migration 20260918, `estimate_messages` + anon token RPCs):
two-way thread on an estimate. A staff reply (`replyToEstimateChatAction`)
notifies the customer by SMS and email, both linking to `/e/{token}#chat`,
which auto-opens the customer chat. Redesigned bubble UI both sides;
best-effort delivery logged to `estimate_events`, never blocking the message.

**Substrate registry (A2)**: `lib/estimate/substrates.ts` is the ONE source
of the "what's being painted" lists. Each substrate (walls, weatherboards,
fence…) maps to its `rate_items` codes; the Interior/Exterior split is read
from `rate_items.category` at load (`substrateOptionsFromRates`), so the rate
card stays the authority and a substrate with no rate (Brick pre-20260919) is
simply not offered. Wizard pages load the options server-side and pass names
only; page 2 renders Interior, Exterior, or both as grouped sections by job
type, with per-type default ticks (`defaultSurfacesFor`). The exterior
scaffold + envelope lines are filtered by the same ticks
(`filterSurfacesByTicks`), and ticked extras (deck/fence/pergola/garage
doors/balustrade) always arrive as $0 measure-on-site placeholders
(`exteriorExtrasNodes`).
**Plan uploads (A3)**: files stage straight to storage via signed URLs
(`POST /api/extract/upload-url` → `incoming/{userId}/…`, ownership-checked by
`lib/uploads/incoming.ts`), then `/api/extract/floorplan` ingests the staged
paths as JSON — the serverless multipart path (still supported for small
files) hit the platform's ~4.5 MB body cap and failed silently. Magic-byte
validation runs on the staged bytes as before. HEIC converts to JPEG at
ingest (`lib/extract/heic.ts`, heic-convert WASM) with the original kept;
the wizard pre-validates client-side (`checkUpload`), shows per-file
progress, and background read failures surface as a visible note instead of
being swallowed.

**Damage photos → prep lines (A7)**: the pipeline was broken in three places
that were each silent. The defect reader now gets a damage-purpose prompt
(`readPropertyPhoto(bytes, "damage")` — the generic doors/windows ask framed
"no defects" as the expected answer); each matched defect becomes ITS OWN
"Prep — …" surface line with hours (`lib/extract/draft.ts`, previously folded
invisibly into walls.prepHr); a defect with no `defect_prep_rates` row raises
an amber "needs pricing" deferral instead of being dropped. The photos route
accepts staged signed-URL uploads (same A3 staging), skips bad files per-file
instead of aborting the batch, converts HEIC, tags damage evidence
`kind: "defect_photo"`, and the submit route claims photo sources onto the
estimate. The wizard shows "ANALYSING THE DAMAGE PHOTOS…" during the read and
surfaces per-photo failures as warnings. `npm run seed:extraction` seeds the
rates table.
**Capture opens any estimate (A5)**: capture is a view over the area tree
regardless of author. Provenance is derived (`room_loop` / `assisted` for
AI-drafted or customer-stated / `builder`), every room card opens, and a
recommit merges instead of replaces (`lib/capture/recommit.ts`): builder-only
detail (products, colours, photos, rate overrides) carries onto matched
surfaces, absolute overrides survive only when the surface was untouched, and
lines no tile can express are preserved verbatim. Wizard exterior nodes'
`roomType "exterior"` aliases to capture's `exterior_elevation`; the server
derives Interior/Exterior from the node, not the client's vocab toggle. Null
`storey_heights` pre-fills the confirm prompt from the blocks themselves
(`storeyHeightsFromBlocks`) so a double-storey wizard job keeps both storeys;
recommitted rooms prune their own aiDeferred entries. Parity is tested:
an untouched wizard room prices identically after a capture round-trip.
**Fast removals (A4)**: profiled with the two kept specs
(`e2e/perf-removals.spec.ts`, `e2e/perf-wizard-editor.spec.ts`). The /quote
builder was already fast (32–49 ms, zero network per removal — pricing is
client-side, save is manual). The real cost was the wizard editor: every
action awaited the full `wizard-edit` round trip (~820 ms dev) before the row
disappeared, serially. The editor now renders a DERIVED payload — the last
authoritative server response with pending optimistic transforms re-applied —
so removals vanish instantly (33–45 ms measured), requests queue strictly
serially in the background (the server never races itself on builder_state),
failures drop their transform (the row returns) with a message, and the
route loads its pricing context in parallel with the mutation (~200 ms off
every action). No refetching anywhere: the action's response IS the payload.
**Window sizes (A6)**: window surface rows carry `size` (small/medium/large,
absent = medium = unchanged pricing — goldens hold). `lib/pricing`
(`windowSizeMultiplier`) applies it as a multiplier on the window rate's
hours, tunable via settings "Window size — small" (0.8) / "Window size —
large" (1.2), surfaced in Settings → Pricing & job numbers. Builder rows and
the capture review screen get compact S/M/L controls (capture's placeholder
hours apply the same multiplier for parity); the rooms route accepts a
bounded `sizes` map. The wizard always writes medium. The model is ONE
window rate × size — legacy separate small/large window rate items keep
pricing as-is and are flagged superseded in Settings.
**Address autofill (A1)**: wizard page 1's first field autocompletes AU
addresses via server-proxied Places (New) routes — `/api/places/autocomplete`
+ `/api/places/details`, key in server-only `GOOGLE_MAPS_API_KEY`, Melbourne
location bias, session-token billing. Picking a suggestion names the estimate
("street, suburb"), stores the structured address in wizard state
(`state.address`) → `builder_state.jobAddress` at submit, and for customers
fills suburb/postcode and runs the service-area check immediately (the
details route evaluates the same `service_area` setting as the policy
engine; out-of-area shows the polite message before any other question).
`AddressField` degrades to a plain input on the first failed lookup — no
key, no problem.

**Customer scope editor — B1, interior + shared** (`/estimate/scope?id=…`,
per `design/reference/customer-scope-editor-mockup.html`): customers get
full control of WHAT is painted and none of hours/rates/allowances,
enforced at the wizard-edit route's action whitelist — the only
customer-reachable mutations are `toggle_surface`, `set_count` (1–12),
`rename_room`, `add_note` (→ amber estimator deferral, never silently
priced), `flag_geometry` (→ requires_site_check + deferral) plus the
existing add/remove room. Pure logic in `lib/wizard/scope-editor.ts`
(tiles derived from room_type_scope_rules + the A2 substrate registry;
toggles add lines at the wizard-answered style as customer_stated with
assumed ["style"]; tested that no hour/rate/cent ever serialises).
Responses return `customerPayload` (ranges only) + rebuilt `scopeRooms`.
UI matches the mockup: tile grids + steppers, "More surfaces…",
skirting pairing advice (Keep/Leave), per-room notes, delta toasts +
live range flash (Settings `scope_editor.liveRange`, default ON ⚑),
sign-off ladder framing from the policy decision. Telemetry:
`estimate_events` type `scope_edit`. Entry: "Open the editor" on the
customer result screen. STILL TO COME (B2): exterior element-first view,
real accept + visit booking with prep pack, capture verify-mode handoff.

**Customer scope editor — B2, exterior + ladder**: exterior renders
element-first (Body with Whole house / Front only / Front + sides — extent
parks out-of-scope elevations as `isOption`, outside the total, reversible;
Trims & openings; Roofline pre-ticked with the note; Extras off by default,
fence takes metres via `measureL` or "not sure" → amber). Exterior toggles
apply across every elevation (`applyExteriorToggle`); geometry chips are
read-only with "Not right? Tell us" → flag. The sign-off ladder is
Settings-driven (`scope_editor`: selfServeInteriorCapCents $6k ⚑,
selfServeExteriorCapCents $12k ⚑, selfServeMinAccuracy 90, visitSlots):
self-serve → `accept_intent` (event + desk-check deferral); visit tier →
`book_visit` with server-validated slots (`offeredVisitSlots`), which writes
the PREP PACK into builder_state (kind, slot, customer-removed substrates
from telemetry, flags/not-sures) and capture shows it as the verify-mode
banner — rooms pre-filled (A5), confirm-as-you-walk flips provenance to
human_confirmed (capture's commit semantics).

## Wizard rebuild R0–R4 (19–20 Aug 2026)

The customer estimate flow was rebuilt to the four reference mockups
(`design/reference/`: floorplan-wizard, customer-review-confirm interior,
customer-review-confirm-exterior-v2-SIDES, scope-editor workflow), per
`docs/briefs/wizard-rebuild-plan-v2.md` + the confirm-loop addendum.
R1.1: wizard-edit's payload follows an explicit `view=customer|staff`
(never the caller's role) — `lib/wizard/contract.ts` throws in dev on a
wrong shape. R1.2: unsure door/window styles price at default rates
(ai_assumed, amber "style to confirm"), never a silent $0. R1.3: one
floorplan (replace-not-add), condition photos never require a plan
(run-less `/api/extract/photos` keeps them), exterior has no floorplan
field. R1.4: ONE confidence function (`accuracy.ts:roomConfidencePct`)
feeds header, cards and bands; unverified trees cap at 65%. R2: pure
exterior branches at job type into its own five pages (state.exterior →
`exteriorSurfaceKeys`). R2b: the exterior editor is a BY-SIDES confirm
loop (`lib/wizard/sides.ts`, meta in builder_state.sidesLoop) — wall
%-mix with a served 100% rule, window groups with S/M/L bands, skipped
sides = isOption (outside totals AND accuracy). R3: the interior editor is
a room-by-room confirm loop (`lib/wizard/rooms-loop.ts`, meta in
builder_state.interiorLoop) — L×W size questions, cupboard questions by
room type (cabinetry rate items, migration 20260920), custom surfaces as
unpriced amber flags that route to the visit tier. R4: the v2 sign-off
ladder in `policy.ts` (interior ≤$6k @≥90 / straightforward exterior
≤$12k @≥85, $15k rule deleted, all Settings values); QuoteBuilder saves
now SPREAD loaded builder_state (the fixed key list silently dropped
wizard/prepPack/loop state). The journey suite `e2e/customer-journey/`
drives all of it as the definition of done.

## Work-order completion loop — step 1: the seven-stage machine (2026-08-21)

WO v1's `status` (draft | issued | in_progress | complete) is now DERIVED, never
typed. `work_orders.stage` (`wo_stage`: offered → pre_start → in_progress → qa →
completion_prep → walkthrough → closed) is the single source of truth for the
loop, and `public.wo_derive_status(stage, issued_at)` recomputes `status` inside
every transition so the contractor link, the schedule board and the v1 chips keep
working with nothing rewritten. The legal moves live in a TABLE,
`wo_stage_transitions` (from, to, label, actors), because the RPC, the UI and the
tests all need to agree about them; `lib/workorder/stages.ts` mirrors it for the
browser and `stages.test.ts` parses the migration and diffs the two, so the
mirror cannot drift silently. Ten moves are legal, the other 39 pairs are not,
and both failure paths (QA fail, walkthrough flag) return to `in_progress` — one
tick list, always.

Every change of stage goes through `wo_set_stage`, which validates the move,
writes a `wo_events` row and re-derives `status` in one transaction; the public
`wo_advance_stage` RPC works out whether the caller is staff, the assigned
contractor or the job's customer **from the session** and checks that actor
against the transition's `actors` — `'system'` is not reachable from outside.
`wo_gate_blocked()` is the hook each later step fills with its own readiness gate
(all surfaces ticked, QA passed, pack delivered); today it is deliberately open.
A trigger on `booking_offers.state` keeps the stage honest when a booking is
accepted, cancelled, declined, expired or withdrawn, rather than reopening three
working scheduling functions. Client UPDATE on `stage`/`stage_entered_at`/
`blocked_reason` is revoked at the database.

Migration 20260927 creates the rest of the loop's tables — `wo_checklist_items`,
`wo_surfaces`, `wo_photos`, `wo_variations`, `wo_updates`, `wo_qa_checks`,
`wo_signoff` — each RLS'd three ways (staff all, contractor assigned-only,
customer own-job-only) and write-revoked for every client role, plus the private
`wo-photos` bucket. Surfaces carry no history columns: tick history is
`wo_events` rows, because the report and the console already read that log.
20260928 lands the ⚑ business decisions in `settings.wo_loop` — including the two
sign-off switches, `clockEnabled: true` (the clock and nudge ladder may run) and
`deemedEnabled: FALSE` (deemed execution waits on the ACL/UCT legal review), a
deliberate departure from the brief's default.

## WO loop — step 2: surfaces, ticks and the photo gate (2026-08-21)

The tick list is an INDEX into the work-order document, not a second copy of the
scope: `wo_surfaces` holds one row per surface, seeded by `wo_seed_surfaces` from
the document the builder already computes (`lib/workorder/surfaces.ts`
`seedRowsFromDoc`), carrying labels and headings only — no money, no
measurements it could contradict. Seeding runs on issue and is idempotent:
re-issuing refreshes wording and order but never resets state, so it cannot wipe
a day's ticks off a painter's phone. Heading meta is derived from what the
document actually knows ("3 surfaces · 2 coats · PG-3") rather than the mockup's
measurements, which live in the estimate's sides loop and aren't in the frozen
snapshot; `seedRowsFromDoc` takes a `metaFor` hook for when they are.

`wo_tick_surface` is the only way a surface moves. It establishes the actor from
the session, refuses a job that isn't in `in_progress`, and enforces the
before-photo rule: **the first tick on an elevation is refused unless that
elevation has a `before` photo** (`error:before_photo_required:<heading>`). The
UI prompts for the photo ahead of the tap so a painter meets the rule as an
instruction, but the rule is server-side and a direct RPC call hits it — proven
in `e2e/wo-ticks.spec.ts`, which calls the RPC outside the browser. Ticks move
in any direction because a mis-tap on a phone needs an undo, and every move
writes a `wo_events` row of type `surface_tick` with `{from, to, heading}` — the
same log the console, the daily update and the completion report read.

Photos take the remediated two-stage path (`app/api/wo/photos`): POST signs an
upload into the private `wo-photos` bucket, the phone PUTs the bytes, PUT
ingests — reading the signature from the STAGED BYTES, because a signed URL is
permission to store bytes and never a statement of what they are. A file that
fails the sniff is deleted rather than left as an orphan.

Step 2 also fills its arm of `wo_gate_blocked`: leaving `in_progress` now
requires every surface `done`, reported as "N of M surfaces still to tick off".
A job with no tick list at all is deliberately exempt, so work orders issued
before this step aren't stranded behind a gate they cannot pass.

## WO loop — step 3: variations, both-sided (2026-08-21)

`wo_variations` carries one variation from raise to accepted, and the order is
enforced by the database. `wo_raise_variation` refuses without photos
(`error:photos_required`) — evidence is what stops a variation becoming an
argument later. `wo_price_variation` is staff-only and takes the customer price
from `app/quote/variationActions.ts`, which computes it on the server through
`lib/pricing`'s `chargeOutCents` (hours × the active card's charge-out for the
trade, plus any materials figure staff enter). The engine's inputs are stored in
`priced_inputs` beside its output so any figure can be recomputed later.

**The contractor's side is computed in SQL and cannot be supplied by a caller**:
`round(hours × wo_contractor_rate_cents())`, reading the `Contractor rate`
setting, with the rate stamped onto the row so an approved variation cannot
silently reprice. Change the rate in Settings and the next variation follows it.

Nothing reaches `contractor_accepted` without both approvals recorded, in order:
`wo_customer_respond_variation` (token-only, like the quote) writes
`customer_responded_at`, `wo_release_variation` is the PC's human step between
the two money events (⚑2, `variationRelease` defaults to `pc`, `auto` skips it),
and the accept refuses with `customer_not_approved` or `not_released` otherwise.
Declined variations are kept, never deleted — they belong on the completion
report as raised-and-declined. The customer surface is `/v/[token]`: unknown
token → 404, and the contractor's rate and delta are absent from the HTML, not
hidden.

Photos live in the private `wo-photos` bucket at `wo/<work_order_id>/<file>`,
and `20261003` gives `storage.objects` the policies that path implies — staff,
the assigned contractor, or the job's own customer. Without them the bucket
existed but every upload failed at the signed-URL step; the lesson is that
creating a bucket in a migration is only half of it.

Step 3 also extends `wo_gate_blocked`: no forward stage move while a variation
is `raised`, `priced` or `customer_approved`. The surfaces gate answers first.

## WO loop — step 4: drafted updates and the silent site (2026-08-21)

`lib/workorder/updates.ts` composes the day's customer update from `wo_events`
rows of type `surface_tick` — grouped by elevation, latest state per surface
winning, in plain English rather than Australian ("we have prepped the left-hand
side", not "knocked that over"). It is a pure function taking `now`, so the
greeting is testable. **No ticks means no draft**: it returns null rather than
writing filler, and the console gets a flag instead.

Storage and the gates are `20261004`: `wo_draft_update` (staff or the service-key
sweep), `wo_approve_update` (staff; the edit and the approval are one action, so
there is no edited-but-unapproved window), `wo_send_update` (refuses anything not
already approved). `source_tick_ids` is stored with the draft so any sentence
traces to the events behind it, and a later sweep never rewrites an update a
person has approved. Delivery itself is a later phase — this records that it went.

`wo_zero_tick_sweep()` flags a job that is `in_progress`, whose start date has
arrived, and which logged no tick yesterday or today: one `zero_tick_flag` event
per job per day plus a `blocked_reason`, and a trigger clears the reason on the
next tick. It never messages the customer — a silent site is a phone call.

`app/api/cron/wo-sweep` is the first scheduled endpoint in the codebase. It is
guarded by `Authorization: Bearer $CRON_SECRET` and refuses everything when the
secret is unset rather than falling back to running unauthenticated, because it
writes. `vercel.json` schedules it at 08:00 UTC = 6pm Melbourne, end of the
working day. Composition happens in the route (TypeScript), storage in the RPC —
the same split the rest of the money/state boundary uses. **CRON_SECRET must be
set in the Vercel project env for the schedule to do anything in production.**

## WO loop — step 5: QA, prep, walkthrough and sign-off (2026-08-21)

QA checks are auto-scheduled only for contractors inside their first N finished
jobs (⚑1). `wo_record_qa` records pass/fail; a **fail appends rectification rows
to `wo_surfaces` and returns the job to `in_progress`** — the same tick list, with
`rectification = true` the only thing marking them out. Photo minimums (⚑5) set
`thin_record` and never block a pass. The completion-prep checklist is seeded per
Settings (the rubbish line changes with `rubbish.organisedBy`) and gates
`completion_prep → walkthrough`.

The customer surface is `/s/[token]`: area-by-area approve or flag, then
type-to-sign. A flag becomes a rectification row and sends the job back, and —
found by the e2e — **a flagged area must be re-reviewable**, or a job can never
close after being put right. Views are recorded because a viewed-but-silent pack
is what makes a deemed sign-off defensible later.

`wo_sign` is one transaction: warranty (2 years from the sign-off date, ⚑4,
deemed included), the review-request `follow_ups` row, the completion report
built from `wo_events`/surfaces/photos/variations/QA — **declined variations
included** — and the draft invoice stub for the invoicing phase.

The clock is split into two switches per Tom's ruling: `clockEnabled` (on) runs
the 0/24/48h ladder, `deemedEnabled` (**off**, pending ACL/UCT review) would
execute the sign-off. **`wo_nudge_copy(rung, deemed_enabled)` is where the
compliance lives** — while deemed is off the copy must not mention deemed
signing, automatic sign-off, invoices or payment, and `signoff.test.ts` asserts
exactly that. Each rung fires at most once; a late sweep sends one late nudge,
never the whole ladder. An unanswered extension request pauses the clock.

## WO loop — step 6: the PC Command console (2026-08-21)

`/pc` is the approved mockup as real routes — Command, The flow, Updates, and a
work-order view — staff-gated in the layout (a contractor is redirected to
`/portal`). `lib/workorder/console.ts` holds the logic as pure functions:
`buildQueue` turns rows into the §6.1 cards, `rankQueue` orders them
critical→warning→info and oldest-first inside each, `pulseTiles` counts **from
the queue it was given** so a tile can never disagree with the cards below it,
and `headline` is written from those same counts. `consoleData.ts` loads it in a
fixed set of parallel queries — never one per card.

Two date bugs were caught by the TZ-pinned suite and are worth keeping in mind
for anything else that buckets by day: `toISOString().slice(0,10)` is the **UTC**
date, so before 10am Melbourne it silently reports yesterday — `melbourneDate()`
is the fix, and `melbourneDayStartUtc()` derives the day's start from the zone
rather than a hardcoded `+10:00`, which would be an hour out from October to
April. The cron sweep now uses both.

The console is also where the PC surfaces deferred from steps 3–5 landed:
pricing a variation (hours in, money worked out on the server — `lib/pricing`
for the customer's side, SQL for the contractor's), releasing the adjusted
offer, and reviewing/editing/sending a drafted update.

**A grant, not a policy, was the bug worth remembering** (`20261007`): with a
`zero_tick_flag` row present and `is_staff()` true, a staff session read zero
rows from `wo_events`. RLS was never involved — a policy only filters rows a
role may already select, and the table-level `GRANT SELECT` was missing, so the
console rendered "nothing needs you" over a database that had something to say.
Every table this module adds now states its read access outright rather than
relying on the project's default privileges.

## WO loop — step 7: hardening, and what the full story found (2026-08-21)

`e2e/wo-full-loop.spec.ts` runs one job all the way round in every role that
touches it — offer accepted (through `send_offer`, which is what puts the
contractor on the work order), pre-start, ticks gated on before-photos, a
variation through both approvals, the day's update drafted by the cron sweep and
sent by a person, a QA fail and its rectification, QA pass, the prep checklist
gate, the customer flagging an area, the fix, and the signature. It then asserts
the downstream artefacts exist and that **every stage the job passed through is
reconstructable from `wo_events` alone**, both loops back into `in_progress`
included.

`lib/workorder/boundary.test.ts` is the brief's §7.6 grep audit as a test, since
a grep somebody has to remember is a grep that stops being run: no client write
to a money or status column on a loop table, no hard-coded contractor rate
outside the engine, no hours×rate arithmetic outside `lib/pricing`, no service
key in a client component, and none of the date traps above. It **strips
comments before matching and matches within a statement rather than a file** —
its first version flagged three files, and all three were the prose explaining
the rule.

Known and unchanged from before this phase: `estimates.subtotal_cents` /
`total_cents` are still written from the builder client. That predates the loop
and is on the audit list; the loop's own tables are all RPC-only.

## Booking → work order: the calendar comes first (2026-08-22)

`send_offer` used to write only `contractor_id`; the dates lived on
`booking_offers` and reached the work order when `respond_to_offer` copied
`start_date` across on acceptance. So a job the office had scheduled showed no
dates on its own work order, and `work_orders` had no `end_date` column at all.

`20261011` adds `end_date` and moves the booking→work-order glue into
`wo_stage_follows_offer`, which now fires **on INSERT as well as UPDATE**:
offering a job puts its requested dates on the work order immediately, and
releasing the last live offer clears them. The four booking functions are
untouched — they work, and reconstructing one from memory is how `send_offer`
lost its compliance check.

**Requested vs confirmed is derived, not stored.** `wo_booking(work_order_id)`
reads the live offer's state; a second column would be a second thing to keep
true. `lib/workorder/booking.ts` turns it into words and a tone — amber while it
waits on the contractor, emerald once accepted — and the work-order header says
which it is rather than showing a bare date.

The contractor's calendar opens the job when a booked day is tapped, and a job's
span now comes from the booking's real `end_date` instead of a `hours ÷ 8` guess.

**Known limitation, surfaced by a test collision:** the contractor calendar keys
jobs by date (`Map<date, job>`), so when two jobs fall on the same day only the
last one is shown and tapping it opens that one. Fine while a contractor runs
one job at a time; it needs a real answer before they run two.

## Stages 1–4 completed against the lifecycle mockup (2026-08-22)

`design/reference/work-order-lifecycle-mockup.html` defines each stage **by
lane**, and three stages had machinery but no face. Now built:

**Pre-offer / pre-start checklists** (`20261012`–`20261014`). Labels and
captions are the mockup's, not paraphrased. Colours and QA are DERIVED, not
ticked — colours read the builder's per-product chips, QA reads whether checks
are scheduled — because a checkbox that can disagree with the data is a lie
waiting to happen; those rows say `auto` and explain where to change them.
Colours block "Materials ordered" per the mockup, and gate the START, never the
offer ("the contractor accepts with the TBC chip visible").

Two bugs worth remembering came out of it. The seeder was staff-gated, so the
SQL editor's own backfill was refused silently AND a **contractor accepting an
offer** — which moves the stage under their session — never got the pre-start
list on the job they had just taken. Seeding is machinery, not a privilege; the
guard is gone. And `wo_colours_confirmed()` answered false for a job whose
document listed no materials, which would have stranded it at pre-start for
ever; with nothing to confirm the step is vacuously done.

**Completion prep** moved to the contractor's lane, where the mockup puts it —
the person who did the work is the one who can say the site is clean.

**QA standards** (`20261015`–`20261016`) are tickable lines, seeded per check by
a trigger: cut lines, coverage, prep evidence, site. A PASS is refused until
every one is ticked (`standards_outstanding:N`); a FAIL is not, because its job
is to record what was wrong and put rectification on the painter's own list.

**Deliberately not built:** the closed/completion-report view. The report is
generated and stored at sign-off, but rendering it staff-only would be half a
feature — it ships with the customer portal, where the customer gets it beside
their warranty and job history.

## Reoffer, job kind, and staff-side ticking (2026-08-22)

**Reoffer** (`20261018`) is one transaction: withdraw the lapsed offer, write an
`offer_lapsed` event for the contractor whose it was, then create the next offer
by **calling `send_offer`** rather than reimplementing it — `send_offer` carries
the compliance check that a contractor without current insurance cannot be
offered work, and the reoffer path is the worst place to lose it. If it refuses,
the whole thing rolls back, so a job can never be left with the old offer
withdrawn and no new one. The courteous wording lives in the migration so its
tone has one home, and the spec asserts it carries no blame words.

**job_kind** (`20261017`) — `residential | commercial | body_corporate` on
estimates, with its own column-level UPDATE grant (R2 granted `estimates` UPDATE
column-by-column, so a later column is silently unsavable without one). SWMS
becomes a required pre-start item for commercial and body corporate, and the
`required` flag is reconciled on every seed so changing a job's kind after the
checklist exists updates it.

**Staff tick the same list as the painter.** `TickList` moved to
`app/components/wo/` and takes a `surface` prop switching class names only —
never a forked copy. The console renders it interactive while a job is in
progress, read-only at other stages, and the office meets the same before-photo
gate the painter does.

## Moving a job forward, and starting on time (2026-08-22)

**The control did not exist.** The stage machine, its gates, `wo_advance_stage`
and its server action were all built and tested, and nothing in the UI called
them — a job could reach pre-start and stop there for ever. Every e2e drove the
RPC directly as staff, so the whole suite passed while the button was missing.
*A test that calls the API cannot tell you a screen is unreachable.*

`app/pc/wo/[id]/StageAdvance.tsx` is that control. Its buttons come from the
transition table, so the console can never offer a move the database would call
illegal — only not-yet-ready, which it reports in the gate's own words. Forward
moves only; going back is a QA fail or a customer's flag, which are their own
actions. Prep → walkthrough routes through `wo_deliver_evidence_pack`, because
delivering the pack is what mints the customer's link and starts their clock.

**Starting on time** (`20261019`): `system` may make the `pre_start →
in_progress` move, and `wo_autostart_sweep()` — run from the 6pm cron — starts
every job whose date has come and whose list is true. The gate still decides.
`wo_start_now()` covers "they got on site today" and **moves the start date with
it**, so the silent-site catch is not measuring against a date that is no longer
true. The console asks before starting early, naming the booked date.

The transition table is re-seeded canonically in `20261019`, and
`stages.test.ts` diffs the mirror against that file — one list, still.

## Invoicing Step 1 — the job money ledger (24 Aug 2026)

Each job now has a **ledger**, and one function owns its arithmetic:
`public.invoice_ledger` in SQL (the runtime authority inside transactions)
and `lib/invoicing/ledger.ts` in TypeScript (the golden-tested twin; a
contract test pins the two to the same rule). Adjusted contract = the
accepted snapshot total (frozen into `estimates.accepted_total_cents` at
acceptance) plus approved variations, minus approved credits. Invoices are
the only "payment request" concept — deposit / progress / final / variation /
standalone are all rows in `invoices` with a `kind`. The §3.2 state machine
(draft → issued → sent → viewed → partially_paid → paid, with void and
written_off off the issued+ states) is a seeded matrix table enforced by a
BEFORE UPDATE trigger for every writer, so an issued invoice is immutable at
the database: money edits raise, only drafts delete, the PDF path writes
once, and a variation can appear on at most one non-void invoice (partial
unique index — double-billing is a constraint violation). GST has one
rounding rule (⚑14) in `lib/invoicing/gst.ts` mirrored by SQL twins:
line-built invoices sum ex-GST lines and compute GST once; ledger-anchored
invoices (deposit/progress/final) carry the promised inc figure and split it.
`accept_estimate` drafts the deposit invoice in its own transaction;
`wo_sign` / `wo_close_without_walkthrough` draft the final invoice
(replacing the old $0 stub) via `invoice_draft_final`, which seeds lines
from the snapshot by source refs. All mutations are SECURITY DEFINER RPCs
(`invoice_issue/send/mark_viewed/record_payment/void/write_off/extend_due/
delete_draft/request_payment/create_final`); direct client writes to
`invoices`/`payments` are revoked. `overdue` is derived, never stored.
Migrations `20261111` (enum, alone) + `20261112` (core); Tom's script:
`docs/manual-tests/invoicing-step1.md`.

## Invoicing Step 2 — the three money screens (24 Aug 2026)

`/invoicing` is the business-wide dashboard, `/invoicing/job/[estimateId]` one
job's ledger, `/invoicing/inv/[id]` one document — three altitudes over the
same `lib/invoicing` functions and `invoice_events`, never a second store.
`lib/invoicing/derive.ts` owns every screen figure (tiles, aged buckets, stage
rail, ages) and is golden-tested against the dashboard mockup's own numbers;
components only format. The §7.3 editor round-trips every edit through the
20261113 RPCs (line edits recompute totals server-side; deposits amend by
inc-anchored re-split) and the reconciliation banner makes silent drift
impossible: the server-computed drift either becomes a recorded one-off
adjustment event or a staff-override variation on the existing wo_variations
machinery, which moves the adjusted contract so the document reconciles. The
PC console links in (nav tab + per-job "Money view →"), and
`e2e/invoicing.spec.ts` walks accept → deposit → issue → pay in a real
browser as staff, including the database-level immutability proof.

## Invoicing Step 2 — the three money screens (24 Aug 2026)

The §7 surfaces are live at three altitudes over one ledger: `/invoicing`
(the business-wide dashboard — pulse tiles, filterable receivable rows with
payment-stage dots, aged buckets, cross-job activity feed; filters are query
params), `/invoicing/job/[estimateId]` (one job's money view — stage rail,
money strip, Payments/Invoices/Costs tabs, the request-payment sheet and
invoice-in-full), and `/invoicing/inv/[id]` (the document editor — the
editor IS the customer-facing document; drafts edit through server
round-trips, the amber reconciliation banner shows any drift from the
ledger with two one-tap resolutions, and issue locks it). Every figure is
derived in `lib/invoicing/derive.ts` (goldens pinned on the mockup's own
numbers) or the `invoice_ledger_staff` RPC; components format and never
compute. Draft editing is migration `20261113` (line RPCs recompute totals
server-side; `invoice_set_draft_total` for inc-anchored amends;
`invoice_record_drift_as_variation` writes a staff-override wo_variation so
the ledger moves by exactly the drift; the same file hardens
`invoice_draft_final` against object-shaped selected_options). The PC WO
view's money strip links to the money view and the console rail carries
"Invoicing". Proven by `e2e/invoicing.spec.ts` — accept → deposit draft on
both surfaces → issue (DB refuses edits after) → bank payment → surfaces
update → 25% claim server-computed → amend → banner with both resolution
paths writing events — 6/6 against the live schema, plus the sign-off and
full-loop suites re-run green.

## Invoicing Step 3 — PDF, send pipeline, customer token view (24 Aug 2026)

One document, three faces: `/i/[token]` renders the customer's invoice as a
white professional A4 sheet on a dark shell; the print stylesheet IS the PDF
(the pipeline in `lib/invoicing/pdf.ts` drives headless Chromium at
`/i/[token]?print=1`, so screen, paper and file can never disagree); staff
download via `/invoicing/inv/[id]/pdf` (heal-if-missing → signed URL). PDFs
live in the private `invoice-docs` bucket, written with the service key and
read only through short-lived signed URLs; `invoice_attach_pdf` /
`payment_attach_receipt_pdf` write the path exactly once (regeneration is
refused in the RPC, the trigger and the pipeline — three layers). Receipts
render from `lib/invoicing/receiptHtml.ts` behind `after()` so recording a
payment never waits for Chromium. Sending rides the existing lib/messaging
provider interface (⚑16): configured → Resend email with pay link + bank
details in ENGLISH tone; not configured → the log driver, and issuing
proceeds regardless. `invoice_by_token` (migration 20261114) returns exactly
one invoice's customer-safe payload — drafts only for staff preview,
unknown tokens are nothing; customer visits write `viewed` (staff previews
and the PDF printer are recognised and skipped). ATO tax-invoice fields per
§6.7 are on the document; ⚑11/⚑12 entity + bank come from Settings.

## Invoicing Step 4 — Stripe (24 Aug 2026)

§5 exactly, over plain REST (the Resend/Twilio pattern — no SDK, no PCI
surface): the customer's "Pay now" POSTs to `/i/[token]/checkout`, which
mints a FRESH Checkout Session per click against the invoice's exact current
balance plus the ⚑4 surcharge as its own disclosed line
(`lib/invoicing/stripe.ts`, rate from Settings via
`lib/invoicing/surcharge.ts`). The webhook
(`app/api/webhooks/stripe/route.ts`) is the SOLE writer of card-payment
success: signature verified first (`lib/invoicing/stripeSig.ts`, real-HMAC
unit tests), then the three-state idempotency door (`stripe_event_insert`:
new/retry/done — a dispatch crash before "processed" reprocesses on Stripe's
retry instead of being waved through as a duplicate), then the
service_role-gated RPCs of migration `20261115`: `record_stripe_payment`
(intent-unique, receipt allocated, status derived), `payment_set_stripe_fee`
(balance-transaction fee behind after()), `record_stripe_refund` (payment
flips, invoice status deliberately untouched — refunds never silently
un-pay; the event carries needs_credit_note), `record_stripe_failure`
(feed only). The return page polls the read-only `/i/[token]/status` and
never claims success the database can't back. No keys configured → the card
path vanishes cleanly (bank transfer only, 503s with friendly copy) — and
per Tom's C1 ruling, test keys and the test-card e2e live only in the
dedicated test project. Settings gained an Invoicing folder (entity, bank,
money defaults); banking now has ONE editor that writes both
company_profile (estimate header) and invoicing_bank (invoices) in
lock-step.

## Invoice-builder addendum A1 — drawn variation signatures + the working scope (24 Aug 2026)

Ruling 1 made law (migration `20261116`): a variation is APPROVED only by
`wo_customer_sign_variation` — name + drawn PNG (data URL, stored on
`wo_variations.signature/signed_name/signed_at`, the estimates.accepted_signature
pattern); the old one-tap approve in `wo_customer_respond_variation` now answers
`error:signature_required` (decline stays one tap). The pad itself is ONE shared
component now — `app/components/SignaturePad.tsx` — used by `/e` acceptance and
`/v` approval; `/v` also renders the credit sign, the engine's `priced_lines`,
old → new job total (from `invoice_ledger` via the token RPC), and the signed-by
record; the signer's name travels to the invoice line detail
(`app/invoicing/inv/[id]`) and the completion report. Rulings 2–3 machinery: a
signed CREDIT strikes its `wo_surfaces` rows (`removed_from_scope`, never
deleted; tick RPC refuses them, the stage gate no longer counts them, reseeds
keep them) — but only `todo` surfaces; any started/done surface flips
`needs_manual_deduction` and the PC sets `deduction_cents` by hand via
`wo_set_variation_deduction` (⚑10 stands — deductions are never computed).
Contractors ACKNOWLEDGE credits (`wo_contractor_acknowledge_variation`, no veto,
refuses while a manual deduction is unset); additions keep release → accept.
The estimate side is now DB-frozen: trigger `estimates_frozen` refuses changes
to builder_state/sent_snapshot/money columns while status='accepted'
(service_role exempt), and post-acceptance edits live on
`public.wo_working_scopes` — accepted_state (immutable baseline, trigger-guarded)
+ working_state, written only by `wo_open_working_scope` (clone-on-first-open) /
`wo_save_working_scope`, both staff-gated. Contract tests:
`lib/workorder/variationSign.contract.test.ts`.

## Invoice-builder addendum A2 — builder mode "revision" (24 Aug 2026)

`QuoteBuilder` gained `mode="revision"` (shared component + mode prop — no
fork): `/quote?id=<estimate>&mode=revision` opens the SAME builder over the
job's working scope (clone-on-first-open via `wo_open_working_scope`), priced
with the estimate's OWN `rate_card_id` — never the active card, so a signed
job cannot silently reprice. Saves go to `wo_save_working_scope` only; the
send/status/template controls disappear; an amber "Revision · working scope"
badge replaces the status pill. The DIFF against the accepted baseline is
`lib/revision/diff.ts`: a CHAIN of whole-estimate re-prices (one changed block
swapped in at a time, adjustments last) so sundries/discount/GST rounding ride
along and Σ deltas = working − accepted TO THE CENT by construction (unit-
pinned). `RevisionPanel` previews the changes live and "Save & draft
variations for signature" calls `draftRevisionVariationsAction`, which
RECOMPUTES server-side and writes through `wo_draft_revision_variation`
(migration `20261117`): one live draft per change (`revision_block_ref` +
partial unique index), re-draft updates the same row/token, zero-delta
retires it, contractor delta = hours × settings rate stamped in SQL, and
already-SIGNED revision variations for a block subtract so a second round
drafts only the increment. Zero-site-work variations auto-advance past the
contractor at signing (`variation_no_site_work`). e2e:
`e2e/revision-builder.spec.ts` (5 scenarios incl. the byte-identical
accepted-row proof); contracts: `lib/workorder/revisionDraft.contract.test.ts`.
C1 seed now provisions an active rate card + items so pricing paths run on the
test project.

## Invoice-builder addendum A3 — the contractor loop + WO sync (24 Aug 2026)

Rulings 2–3 on every surface. CREDITS: the portal card says **Acknowledge**
(scope owner is the customer — no veto) via
`wo_contractor_acknowledge_variation`; the pay figure is the engine's
hours-delta unless the removal hit started work, in which case
`needs_manual_deduction` routes it to the PC — a `SetDeduction` card on the
job page plus a `variation-deduction` warning card in the /pc queue — and
`wo_set_variation_deduction` records the person's figure (acknowledge REFUSES
`awaiting_pc_deduction` until then; the contractor is told, not asked).
ADDITIONS keep release → accept. Struck surfaces render struck-through with a
"Removed from scope" chip on the portal TickList, the PC read-only list AND
the anon /w job sheet (migration `20261118` adds the flag to
`get_work_order_ticks_by_token`); `progressOf` excludes them so "N of M" and
the finish gate mean live scope. The one pay rule lives in
`lib/workorder/contractorPay.ts` (offer + accepted additions − acknowledged
credits, manual deduction winning; only `contractor_accepted` counts) and the
invoicing job money view's Costs tab reads it. e2e:
`e2e/revision-contractor.spec.ts` (5 scenarios AS CONTRACTOR/PC).

## Invoice-builder addendum A4 — the reconciliation proof (24 Aug 2026)

`e2e/revision-reconcile.spec.ts` is the addendum's acceptance, run in real
roles and real UIs on the C1 stack: accept → revision (one add, one credit)
drafted from the real builder → both signed on /v with the drawn pad →
contractor accepts + acknowledges → then the arithmetic: the ledger's
adjusted contract equals `priceEstimateTotals(workingScope)` TO THE CENT
(accepted + Σ signed variations = the engine's working total, by the diff
chain's construction); `invoice_create_final` drafts to exactly that figure,
inc-anchored GST, each signed variation its own line at
`variationLineExCents(price)` with the credit sign flipped, all lines summing
to the document's ex total; `invoice_final_drift_staff` answers 0; contractor
deltas are hours × the stamped rate and `contractorAdjustedCents` nets them;
and the accepted estimate row is byte-identical before and after the whole
journey. No figure in the spec is typed — every expectation comes from
lib/pricing, lib/invoicing and lib/workorder, the modules production uses.

## Invoicing Step 5 — contractor invoicing v2 (24 Aug 2026)

The 20261112 `contractor_invoices` table got its machinery (migration
`20261119`). ONE money rule, twinned: total (inc) = offer + Σ accepted
addition deltas − Σ deductions, where a deduction is the engine's figure for a
clean removal and ONLY the PC's `deduction_cents` on started work —
`contractor_invoice_amounts` in SQL, `lib/workorder/contractorPay.ts` in TS,
contract-tested against each other. INC-ANCHORED (⚑14): GST registration
changes the document (Tax Invoice + GST backed out vs Invoice + GST 0), never
what we pay — accountant flag. Sign-off AUTO-DRAFTS it (both tails — `wo_sign`
and `wo_close_without_walkthrough`, re-issued BODY BASIS 20261112, which also
put the drawn-signature record into the frozen completion report);
`wo_reopen_signoff` drops the draft. The contractor reviews it at
`/portal/money/[id]` — LIVE figures while draft, deduction lines named and
noted pre-submit — and `contractor_invoice_submit` validates (entity fields,
11-digit ABN, bank, no pending manual deduction), recomputes, pins entity +
GST registration, allocates `CI-…` (ci_no_seq) and freezes the row (guard
trigger: draft→submitted→approved→paid, RCTI shortcut draft→approved only
with `rcti_agreement_signed_at` — staff record it via `contractor_set_rcti`,
toggle on the contractors page). PC approves and marks paid (bank reference +
date) from the dashboard's Payables tab (`payablesTiles` in derive.ts, rows
with inline Approve/Mark paid); paying allocates `REM-…`, renders the
remittance advice (`remittanceHtml.ts` → `ensureRemittancePdf`, invoice-docs
bucket, attach-once) and emails it to the contractor's login email behind
`after()` (⚑16 log-driver). The job money view's Costs tab shows the CI chip.
e2e: `e2e/contractor-invoicing.spec.ts` (7 scenarios — all three §8.5 accept
criteria) + the full-loop's sign-off assertion now covers the auto-draft;
`ciStateMachine.ts` mirrors the guard. Loop fixtures delete contractor
invoices in teardown (work_order_id is RESTRICT).

## Revision builder = THE invoice surface (24 Aug 2026, Tom's follow-up)

Five rulings in one pass. (1) The money view's "Revise scope" is now a
prominent amber button under the header (crumb link stays). (2) The invoice
document editor takes NO manual lines any more — the add-line control is gone,
replaced by a link to Revise scope; every change to an invoice is measured,
engine-priced and customer-SIGNED (amend/remove on existing lines and the
reconciliation banner remain as the safety net). (3) In revision mode the
customer tab is labelled INVOICE and always renders LIVE from the working
scope — "the final invoice, previewed" — with a View invoice button on the
RevisionPanel flipping to it. (4) Signing links go out through the messaging
rails: `sendVariationForSignatureAction` (email via the branded shell + SMS,
recipient from the estimate's own contact, ⚑16 log-driver), with per-variation
"Email & text to customer" buttons beside Copy on both fresh drafts and
standing ones. (5) Signing lands the customer back on THEIR page: migration
`20261120` adds `estimate_changes_by_token` (signed + awaiting variations,
adjusted total — customer-safe) and `estimate_token` on the variation token
read; /v's approved state auto-redirects (4s) to `/e/<token>#changes` and /e
renders "Changes to your job" — each signed change, sign-links for pending
ones, and the ledger's updated total to the cent. e2e: revision-builder 7/7
(the new customer-journey test walks /v → /e for real).

## Two money tabs + contractor payment claims (24 Aug 2026, follow-up #2)

Navigation: **Invoicing** (`/invoices`, estimates-tab layout — one row per job,
the ADDRESS opens the revision builder, every invoice's status chips on the
row, filters active/all/draft/awaiting/overdue/paid) and **Payments**
(`/invoicing`, the renamed ledger dashboard, now desktop-width `.invx .wrap`
1080px; phones keep the fluid column). Invoicing left the PC Command nav.

Contractor claims (migration `20261121`): `contractor_invoice_request` lets a
contractor invoice AT ANY TIME — percent of adjusted pay or fixed dollars,
SQL-bounded to what remains uninvoiced, born SUBMITTED with the same
validation as the one-tap submit; the sign-off FINAL now drafts only the
REMAINDER (`previously_invoiced_cents` on its face; submit/approve recompute
the same way). Every submitted contractor invoice renders a PDF under THEIR
entity, billed to Paint Group (`contractorInvoiceHtml.ts` →
`ensureContractorInvoicePdf`, attach-once, heal-on-view routes
`/portal/money/[id]/pdf` + staff `/invoicing/ci/[id]/pdf`). Portal Money tab:
"Invoice Paint Group" card (job picker, 25/50/custom % chips or $, live
remaining preview) + Download-PDF buttons; the detail page shows claims as
their own line and "less previously invoiced" on finals. Payables rows carry
the job's PC stage, a claim tag, and the Invoice PDF button; **Mark paid asks
for the bank reference AND the payment date**, and the paid state (with
remittance) reads straight back in the contractor's portal. e2e:
contractor-invoicing 12/12 (claims journey incl. bounded fixed claim,
remainder final, dated payment); revision-builder 8/8 (the /invoices door).

## Close-off batch (24 Aug 2026, night)

Variation signing links now send by CHOICE — Email / Text / Both segmented
buttons on each link row (`via` on `sendVariationForSignatureAction`; a
channel with no contact detail names itself instead of silently skipping).
Contact hygiene: `lib/validation/contact.ts` — a mobile only saves as a full
Australian mobile (04xx/+614), an email only as a whole address; enforced on
BOTH ContactModal exits (Save to Contacts and Use on estimate), empty stays
allowed. The revision builder's INVOICE tab now renders the customer document
headed "Invoice EST-…" (CustomerEstimate `docLabel` prop — eyebrow + footer
drop the 60-day validity line), so what staff preview is the invoice the
customer will see, live from the working scope.

## Cost capture 6a — one pipeline, four doors (25 Aug 2026)

Every cost now enters through `cost_intake` (migration `20261122`): the
bills@ email webhook (`app/api/inbound/bills` — svix-signed, 3-state
idempotency door keyed on message_id, raw email + attachments stored in the
private `cost-docs` bucket), the Airtable/Zapier transition webhook
(`app/api/inbound/airtable`, Bearer secret, idempotent per record_id), and
staff manual entry ("+ Add cost" on the job money view — document required,
staged through a signed upload URL and byte-sniffed before the row exists).
Reading is `lib/costs/`: `rules.ts` (deterministic field extraction, always
runs), `extractBill.ts` (Anthropic forced-tool reader, proposes only, with
per-vendor `extraction_hints` injected), `match.ts` (the ladder: exact
`PG-<job_no>` order ref → single-winner address match → vendor sender-domain
memory → unmatched). Work orders gained a sequential `job_no` — the `PG-0087`
job code (⚑A3/⚑21) that makes supplier matching exact. Nothing becomes a
cost row until a person confirms in the intake queue on the Payables tab
(`app/invoicing/PayablesCosts.tsx`); the duplicate guard (same
vendor+invoice-no, or same total+date+sender inside the Settings window)
flags instead of writing; unreadable documents park as "couldn't read this",
never $0. Confirmed rows land in `job_costs` (recorded → approved → paid,
inline on Payables) or `material_costs` (null WO = unmatched queue, one-tap
assign) with the source document attached and proposed-vs-confirmed kept —
the accuracy readout on the queue header is the evidence for ⚑A1
(auto-confirm, seeded OFF and inert). Settings → Cost intake carries the
window/threshold/toggle. e2e: `cost-intake.spec.ts` 9/9 on C1.

**Materials: a possible duplicate can be linked to a job (15 Oct 2026).** Two Viponds invoices
for the same amount on the same day, each with its own invoice number, tripped guard (b) and the
second sat in To check with only Dismiss. `20270273` replaces `cost_intake_set_extraction` so guard
(b) skips a candidate whose invoice number is read and differs (two numbers are two invoices; a
document with no number read still falls back to total + date + sender). On the screen the
"Possible duplicate" row (`app/invoicing/payments/MaterialsView.tsx`, `MatButtons` in
`ActionsClient.tsx`) now carries its invoice number, date and amount and the same Confirm / Other
job / Pick a job / Record as a cost buttons as a pending document, with Dismiss in place of Delete;
`lib/invoicing/materials.ts` keeps the row's real figures while every total still excludes it. The
database never needed changing for that: `cost_intake_confirm` has always accepted a flagged
duplicate as a human decision.

## 25 Aug 2026 — the small-things batch (Tom's list)
Contractor portal: live offers on Home with the 24h countdown; OfferBar pins
clock + accept/decline atop an offered job; server-side suburb-only redaction
now covers the job TITLE and the offers payload; Money→Invoicing; claimable
jobs fall back to wo_snapshot.contractorPaymentCents; StartJob card moves
pre_start→in_progress via wo_contractor_start (migration 20261124, gate
unchanged). PC: attention cards dismissible (wo_dismiss_card → card_dismissed
events, filtered in buildQueue); accepted-job card fires day zero; reschedule
proposals raise a queue card; schedule detail opens /pc/wo/[id]; checklist
ticks optimistic. Variations: PC card's primary is the revision builder,
quick-price secondary; priced variations email/text the signing link from the
card; pricing auto-emails. Customer updates: UpdateComposer on the PC job page
(text + up to 8 photos) delivers email+SMS with the /e token link via
lib/workorder/sendUpdate; the Updates tab delivers too. WO snapshots carry
`inclusions`. Customer invoice sheet says "Payment request" for progress kind.

## 26 Aug 2026 — Portal 3a-1: the customer identity layer (accounts)
Migration `20261128_customer_accounts`: `accounts` (residential|trade,
email-unique on lower(email), flags jsonb) + `account_users` (verified logins
only — never created from an unverified wizard email) + `properties` joined
to accounts (customer_id now legacy-optional; per-account dedupe on
`address_norm`); `estimates.account_id` / `invoices.account_id` FKs, all
RESTRICT. Every invoice inherits its estimate's account via a BEFORE INSERT
trigger (structural S2 fix — no insert site can forget). RLS: staff all;
members SELECT accounts/membership/properties; estimates and invoices stay
customer-unreadable (margins live in builder_state — rendered views only,
the standing role-view rule). `lib/accounts/identity.ts` owns the two
identity keys (normalised email, address dedupe key); `lib/accounts/link.ts`
find-or-creates account+property (schema-missing = inert no-op); the wizard
submit route links every customer save. Backfill:
`scripts/portal/backfill-accounts.mjs` (dry-run default, report-and-confirm).
Proof: `e2e/account-rls.spec.ts` 7/7 on C1 through real customer sessions.
Resolves the linking half of `docs/briefs/customer-identity-link.md`.

## 27 Aug 2026 — Portal 3a-2: magic-link sign-in + the portal shell
`/account` is the customer portal (no migration). Sign-in is passwordless
(⚑3): `lib/portal/auth.ts` mints a Supabase magic-link token server-side
and emails OUR link (/account/auth?token_hash=…) through lib/messaging —
no Supabase SMTP or redirect-allowlist dependency; `/account/auth`
verifies (verifyOtp) and only THEN joins the login to its account
(`ensureMembership` — first login = owner; the 3a-1 verified-auth ruling).
Shell: `app/account/` — scoped `account.css` from the approved mockup
(call chip in the header of every page, bottom tabs phone / sidebar
desktop via one responsive stylesheet, base type ≥18px), state-aware Home
(`lib/portal/home.ts`, pure + unit-tested precedence: walkthrough >
underway > booked > ready > saved > welcome) with exactly one primary
action, honest not-yet stubs for Project/Colours/Money/Messages.
`lib/portal/data.ts`: memberships/accounts/properties via the caller's
session (RLS is the authority); estimates/work_orders via the service
client scoped to proven account ids, customer-safe columns only; company
contact (name/phone/logo only) via service because `settings` is
staff-RLS'd. Customer logins land on /account; /dashboard redirects.
Wizard saves email a sign-in link (real addresses only — `isTestEmail`
guard protects deliverability). Proof: `e2e/portal-shell.spec.ts` 4/4 live
— wizard → save → magic link → portal with no registration form anywhere.

## 27 Aug 2026 — Portal 3a-3: Money in the portal
The /account/money tab renders the invoicing phase's rows read-only (no
migration): lib/portal/money.ts is the pure customer view-model — visible
statuses only (issued/sent/viewed/partially_paid/paid; drafts, voids and
write-offs never render), chips derived through lib/invoicing/derive (the
one-source rule with the staff dashboard), GST via the inc-anchored
gstFromIncCents, per-job "balance on completion" remainder = accepted
contract − issued. Reads ride lib/portal/data.getPortalMoney (service
client scoped to proven account ids, safe columns only — no surcharge or
Stripe internals). Invoice rows deep-link to the existing /i/[token]
surface (PDF + pay — one component, no fork); receipts get
/account/receipt/[paymentId] (ownership via payment→invoice→estimate→
account chain, 404 otherwise, ensureReceiptPdf + signed URL).
account.css gained a real print stylesheet (white paper, no chrome).
Proof: e2e/portal-money.spec.ts 3/3 live + 9 unit tests on the view-model.

## 27 Aug 2026 — Portal 3a-4: the Project Timeline
/account/project renders the job from WO-loop data (no migration).
lib/portal/timeline.ts = the pure feed builder: SENT updates only, photos
grouped to their Melbourne day and attached to that day's leading card,
milestones (deposit/underway/qa-pass/walkthrough/ready/signed), variation
cards reusing the /v token flow, area rollups in the four customer words.
Rulings encoded: QA renders only as a pass milestone (fails and qa-kind
photos are never fetched — Tom, 23 Aug); declined variations stay on
record kindly; no +10:00 literals (UTC-noon day anchors). Photos:
lib/portal/photos.ts signs 640px/1600px RENDITIONS via storage transforms
(verified live: ~14% of original bytes) — a phone feed never downloads an
original (§10.3). getPortalProject picks the customer's current WO by
stage precedence and reads safe columns only; painter surfaces as first
name. PhotoGrid client component = grid + full-screen lightbox. Proof:
e2e/portal-timeline.spec.ts on live + 8 unit tests.

## 27 Aug 2026 — Portal 3a-5: colours register, Documents, warranty
Migration 20261129: company_documents (+ private company-docs bucket,
staff-only storage policies) and warranty_issues (photo-first reports;
account_id RESTRICT; written only by the server action after an
account-chain ownership check). Settings → Documents (DocumentsManager):
upload certs with expiry, active toggle, and the warranty-terms approval
flag (settings key warranty_terms). PC console: loadConsole returns
expiringDocs (≤30 days) rendered as an amber banner (⚑13), and open
warranty_issues become warning cards (buildQueue warranty-issue:<id>,
clearing when handled). Portal: /account/colours = the permanent register
(lib/portal/colours.ts — snapshot areas × materials × live match codes;
TBC honest, never invented; print = the PDF), /account/documents = live
warranty card per job (warranties table dates + countdown), report-issue
form (lib/uploads validation, photos to wo-photos/warranty/), credential
downloads via /account/document/[id] (active-only, signed URLs, 404
otherwise), completion-report link (/s token), and the full §2 terms
DRAFT-watermarked until approved. Proof: portal-aftercare 3/3 on C1.

## 27 Aug 2026 — Portal 3a-6: the embedded builder + multi-property
No migration, no fork: the portal links to /estimate — the ONE wizard —
with a `prefill` prop (email from the verified session, address from the
chosen property, read through the caller's RLS). getWizardActor now
admits signed-in customers (role customer + real email) as the customer
actor with `verifiedEmail`; the submit route trusts the session email
over the typed one, skips the saved-email for members, and consults the
account's gates: lib/portal/limits.bypassesWizardLimits (trade unlimited
— decided; flags.unlimited = office unblock ⚑1; residential standard,
⚑12 account-wide). The email gate page is absent for members (lastPage
5); signed-in members also bypass the wizard_public holding page (B4).
Multi-property: ensureProperty extracted as the one dedupe rule (shared
by wizard save + the add-address action); /account/addresses/new (shared
AddressField, portal-styled wz-* classes); Home gains the property
switcher at 2+ (filters by estimates.property_id), the builder card and
the add-address link. Proof: portal-builder e2e 3/3 live + the no-fork
contract test.

## 27 Aug 2026 — Portal 3a-7: the commercial workspace
No migration — trade is aggregation over the same customer-safe rows
(§6). lib/portal/portfolio.ts = the pure view-model (tiles, attention
queue reusing the shared overdue rule, underway bars).
AccountTabs/Home branch on account_type: trade gets Home(portfolio)/
Properties/New estimate/Money. Properties carries register + warranty
lines and the one-tap rebook; /estimate gained `rebook=` — ownership via
the account chain, the prior wizard state re-validated through
wizardStateSchema AFTER stripping every file/run reference (a state that
only made sense with its floorplan falls back to address-only), then
seeds WizardApp via `prefillState` (surfaces kept, no defaults reset).
getRebookCandidates exposes only a wizard-presence marker — builder_state
never reaches the client. Money: trade header + /account/statement/[month]
(white printable statement; ⚑5 display-only 14-day terms). Settings →
Trade accounts (⚑2 office-side granting + the ⚑1 unblocked flag).
Proof: portal-commercial e2e 4/4 live incl. the seeded rebook.

## 27 Aug 2026 — Portal 3a-8: the volume gate
Seeded C1 with the ⚑14 dataset (25k accounts/60k estimates/20k WOs/500k
photo rows — scripts/portal/seed-volume.mjs, generate_series, ~70s) and
measured the portal against it (e2e/portal-volume.spec.ts →
test-results/volume-gate.json). Findings fixed: member RLS policies were
per-row is_account_member() calls (559ms/1006ms bare selects at seed) —
migration 20261130 rewrites them to the invertible IN-subquery shape with
init-plan-wrapped staff quals (now 3–7ms; account-rls re-proven); Home's
five-query waterfall collapsed to two (embedded chain reads); timeline
photo signing cut from 2×fetched to thumbs-only for at most 12 rendered
(full-screen minted on demand via /account/photo/[id], ownership + kind
re-proven); pagination caps swept. Numbers: Home p95 1012→324ms ✓,
timeline 1483→648ms (median 457; co-located lands under the 500 target —
runner sits ~50ms from Sydney; strict assert behind VOLUME_GATE_STRICT).
RLS plans all hot paths <10ms (scripts/portal/volume-plans.mjs).
e2e/portal-full-loop.spec.ts = the whole journey, both personas, phone +
desktop. Report: docs/manual-tests/portal-3a8-volume-gate.md.

## 27 Aug 2026 — Phase 3a close-out: staff saves join the account chain
linkEstimateAccountAction (app/quote/actions.ts): after a successful
builder save with a contact email, the estimate joins the customer's
account through the same lib/accounts identity rule the wizard uses —
fire-and-forget, staff-session RLS, test emails refused, frozen-estimate
refusals tolerated. Called from QuoteBuilder.save(). With this, every
path creates/joins accounts on its own (wizard, portal builder, staff
builder, verified login) and backfill re-runs are history. Proof:
e2e/builder-account-link.spec.ts as staff on live. 20261130 policy
migration RUN LIVE (account-rls 7/7 re-proven on prod).

## 27 Aug 2026 — Warranty certificate + cert on display + demo customer
/account/warranty/[woId]: the per-job warranty CERTIFICATE (holder,
property, sign-off and expiry dates, plain-language cover summary, ACL
statement, entity ABN/address footer; DRAFT-watermarked until approved;
Download as PDF via the print pattern), linked from the Documents
warranty card. Tom's real $20M certificate of currency uploaded to
company-docs (expires 2026-09-30 — the console goes amber ~31 Aug).
scripts/portal/seed-demo-customer.mjs: the showcase customer on live
(pg.alice.customer@gmail.com → /login → /account): two properties, a
day-3-of-6 live job with photos/updates/variation, paid deposit +
receipt, closed job with register + warranty. Idempotent; demo photos
are generated PNGs under demo/.

## 27 Aug 2026 — Google Calendar sync for contractors (lib/gcal)
Portal → Calendar gains a "Connect Google Calendar" card (OAuth, modelled
on the MYOB dance in lib/myob). Scope is calendar.app.created ONLY: the
app creates a "Paint Group Jobs" calendar in the painter's account and can
never read their personal events. Tokens live in contractor_gcal_connections
(migration 20261201000000; RLS with NO policies + grants revoked —
service-client-only, like warranty_issues), pushed-event ids in
contractor_gcal_events. There is no "push one change" path: every trigger
calls reconcileContractorCalendar (lib/gcal/sync.ts), which diffs ACCEPTED
bookings (committedIds — the same rule that gates addresses, so unaccepted
offers with trigger-written start_dates never leak into Google) against the
pushed set and inserts/patches/deletes the difference; spans mirror spanOf
so Google matches the portal calendar. Triggers: client pingGcalSync
(lib/gcal/ping.ts, fire-and-forget POST /api/gcal/sync) after the
browser→RPC transitions (OfferCard, OfferBar, ScheduleBoard cancel/resolve
— staff pass the offerId and the server resolves both contractors a
reassign touches — and quote OfferPanel resolve); after() hooks in
moveBooking/reassignOffer actions and setFinishDate; the nightly wo-sweep
reconciles everyone connected as the backstop. Setup: docs/gcal-setup.md;
manual script docs/manual-tests/gcal-sync.md; unit tests lib/gcal/gcal.test.ts.

## Wizard batch — Tom's nine items (31 Aug 2026)

The customer wizard's contact page (name/email/phone) is the LAST page before
the AI builds (WizardApp lastPage; trade/portal members with all three details
on their account skip it entirely) — NOTE this narrows the drop-out funnel to
people who reach that page. Condition prices from the FIRST reveal:
lib/wizard/exteriorAnswers.applyConditionPricing (shared by submit and the
draft pricer) maps exterior "weathered"→EXT-WEATHERED, ticked access→the
Access Allowance row, interior damage tier ≥2→COND-POOR, worst multiplier
winning one Condition slot; the sides loop's Condition card arrives pre-answered
from the wizard (builder_state.sidesLoop seed). In the sides editor a wall mix
may total UNDER 100% (part glass/garage — sides.confirmSide refuses only >100%
or 0; 5 Oct: `sides.wallSharePct` is the one rule for an UNSHARED line — a lone
line reads 100 so a weatherboard-only side confirms untouched, an unchosen
split reads 0 each — and the gate, `syncWallMeasures` and the card's tiles all
read it), a ticked freestanding extra IS the extras answer
(scope-editor.hasFreestandingExtras; "Nothing else" no longer demanded on top),
and both sweeps' "+ Something else" opens a text box whose name rides the amber
deferral (loop_sweep/iloop_sweep add). Exterior can build FROM SCRATCH
(exterior.noPhotos in the state schema relaxes the page-1 listing/facades gate;
elevations size from answers as always). Interior listings can be READ:
/api/extract/listing-plan fetches an allow-listed listing, finds the floorplan
image (lib/extract/listing.findFloorplanImages — plan only, the 20 Aug
no-agency-photos ruling stands), stages it, and the client ingests it through
/api/extract/floorplan like any upload. The processing screen is a live step
list + progress bar + rotating tips (PROC_TIPS). vercel.json pins functions to
syd1 — they ran in US East against a Sydney Supabase, which was most of the
wizard's per-tap latency. Manual script: docs/manual-tests/wizard-31aug-batch.md.

## Assistant agent — S1 (2 Sep 2026)

The assistant (briefs `claude-code-brief-assistant-agent.md` + Addendum A;
rulings in `docs/briefs/agent-rulings.md`) lives in `lib/agent/`. It is a
tool-user: the model may only act through the zod tool contract in
`schemas.ts` (25 tools, each marked by mode and by explicit `view=staff`), and
every call is logged to `agent_tool_calls` so any number in a reply can be
reconstructed. `turn.ts` is one pure turn — persist the person's message
first, check the per-conversation and per-account-per-day budgets (exhaustion
becomes a handoff, never an error), run the model/tool loop through the
contract, then three guards: a `hard_stop` script IS the reply, a `$` figure
no tool returned replaces the reply and logs `number_guard`, a refused tool's
reason is relayed. `gateway.ts` (server-only; lint rule keeps it out of
pages/components, reach it from `app/api/agent/**`) binds the Anthropic SDK
client (`model-anthropic.ts`, streaming), the service-role store
(`store-supabase.ts`) and, for now, `NoopTools`; S3 binds the real scope and
pricing tools. Model ids, budgets, support hours, tone, disclosure and the
scripted hard stops are rows in `agent_settings` (migration `20261228`,
seeded for `paint-group`), never code. The seven tables carry RLS: customers
read their own conversations/messages/handoffs via the SECURITY DEFINER
`agent_is_my_conversation`, tool calls are staff-only, no client role can
write the transcript. D19 (`20261227`) adds four cupboard-interior rate rows;
`lib/wizard/rooms-loop.ts` gains `CUPBOARD_INTERIOR_BY_ROOM_TYPE` +
`applyCupboardInterior` and the wizard-edit route the `room_cupboard_interior`
action. Manual script: `docs/manual-tests/agent-s1.md`.

## Assistant agent — S2 question graph (2 Sep 2026)

`lib/agent/question-graph.ts` is the deterministic "what do we ask next"
(assistant brief §4). It is generated, not hand-written: per-area required
questions come from `lib/wizard/required-questions.ts` — a data registry the
editors' own gates (`confirmRoom`, `confirmSide`) now read, so a new required
question added there is asked by the assistant and enforced by the editor
without touching the graph; per-room "what are we painting" confirms come
from `room_type_scope_rules`; cupboard questions are data-driven on the rate
card; globals follow the wizard page order; the sweep mirrors the loop metas.
`gapsFor` returns every open gap ordered stop → required → tightening (by $
swing from price_scope, Addendum A) → recommended → confirm, with hallway
first, sides front→left→right→back, and a both-job's interior questions before
its exterior ones; `nextGap` is the head; `nextBatch` gives one question in
guided mode, up to three sweep confirms, everything in co-work. Known ≠ asked:
plan-read sizes are a one-time confirm, never required. Six fixture jobs pin
the order in `question-graph.test.ts`. The five previously missing reference
briefs (plan reader, site capture, visit booking, inbound calls) and the Brain
v1 seed (`docs/brain/brain-v1.md`) are now committed.

## Assistant agent — S3 scope tools + parity (2 Sep 2026)

The tools are bound. `lib/wizard/build-tree.ts` is the wizard path (starter →
draft → answers → exterior → condition pricing) extracted from the draft pricer
so the draft board, the assistant and the parity test share it. `lib/agent/
scope-doc.ts` is the estimate's builder_state as pure functions: `applyAnswer`
maps every question-graph key onto the same loop function the wizard-edit
route dispatches to (room sizes, cupboards and interiors, custom notes,
confirms, sides, wall mix, the condition card, sweeps), builds the tree with
build-tree once the answers form a complete wizard state (unsure tiles filled
for anything still open), and patches door style / window style / ceiling
height in place afterwards. `lib/agent/scope-tools.ts` binds get_scope,
next_gap, list_gaps, answer_gap, add_area, add_surface (per-item charge-out
pinned), set_count, set_size, remove_item, add_custom_line (always amber +
visit tier), price_scope (editorPayload + guardrails + bands, plus the
Addendum A assumption chips with $ swings priced by diffing the alternative,
and R4's showNumber: trade from the first price, residential only when every
area is confirmed and swept), check_thresholds (the route's self-serve rule
with customer wording), hard_stop, get_support_hours and emit_crm_event;
everything else falls through to NoopTools until its session. Storage is
`ScopeStore` (memory / Supabase service role). The parity suite in
`scope-tools.test.ts` builds six jobs the wizard way and the assistant way
against captured reference data (`lib/agent/__fixtures__/scope-refs.json`) and
asserts identical rows, hours, cents and range.

## Assistant agent — S4 guided mode (2 Sep 2026)

The first screen. `/estimate/assist?c=<conversation>` (or `?estimate=<id>`
to adopt a draft from the scope editor) is the split view: the chat on the
left, the SAME confirm-loop editor (`ScopeEditor` / `SidesEditor`) on the
right, remounted from a fresh `CustomerScopeBundle` after every turn. That
bundle is `lib/wizard/customer-scope.ts` — the editor page's data assembly
extracted so the two surfaces cannot price or gate differently. Every tap on a
chip is a structured answer `{key, value}` carried on the message as an
`[answer key=… value=…]` marker the model turns into `answer_gap`; free text
goes to the model as prose. Routes: `POST /api/agent/start` (creates a blank
customer_intake draft for the actor, or resumes on an owned estimate; seeds
the disclosure + first graph question as the greeting, logs `wizard_started`),
`POST /api/agent/turn` (one turn through the gateway; links the account when
an email lands — the wizard's own `ensureAccountAndProperty`; returns reply,
UI state and the bundle), `GET /api/cron/agent-sweep` (a quiet conversation
with an email and no acceptance emits one `wizard_abandoned`). All server work
sits in `lib/agent/session.ts`; the page and routes never import the gateway
directly (the lint rule). `AGENT_MODEL_STUB=1` (the C1 stack) swaps the
Anthropic client for `lib/agent/model-stub.ts`, a templated phrasing layer
that follows the same tool sequence — everything else is real, which is how
the three journey specs in `e2e/customer-journey/assistant.spec.ts` run
without a live model. The wizard's page 1 offers "Rather chat it through?";
the scope editor offers "Chat it instead". Range card and CTA in the chat
read `price_scope` / `check_thresholds` — R4: no number for a residential
customer until every area is confirmed and swept.

## Assistant agent — S5 co-work mode (2 Sep 2026)

Staff co-work at `/estimates/[id]/assist` (`new` opens a blank staff draft).
`lib/agent/brief-extract.ts` reads pasted text into FACTS (a model tool call
with a zod schema; `heuristicExtract` is the rule-based reader the stub uses)
and always runs an injection regex — instruction-like lines are reported and
never followed. `lib/agent/propose.ts` builds the proposed tree with the
wizard's own drafting code: the starter composition for the bedroom count
reconciled with the rooms the text names (unnamed rooms are assumed and say
so), typical sizes unless stated, only the surfaces stated (ceilings not
stated → not included, chip with its $ swing), coats defaulting to two with a
fill-in, defects priced at the defect rate on an assumed quantity and held
amber (D22), unmapped items as amber custom lines. Every co-work mutation lands
on a PENDING copy of builder_state (`scope-doc.ts` pendingOf/withPending/
applyPending) and `apply_diff` commits it, logging who applied; the customer's
own guided draft has no gate (Addendum A §3.3). `price_scope` says when it
priced the proposal and carries the live total; the staff panel shows the diff
(added/changed/removed with provenance), the fill-ins, the gap batch grouped by
the Settings review gate (`agent_settings.feature_flags.priceImpactGateCents`,
default $150), the two $/hr figures, and Apply (`POST /api/agent/apply`, the
same tool run directly so applying never depends on the model). Tom's
paragraph is the golden in `propose.test.ts` (Addendum A §3.2); the staff
journey is `e2e/cowork.spec.ts`.

## Assistant agent — S6 support mode + Brain (2 Sep 2026)

Support mode lives in the customer portal at `/account/assist/[estimateId]`,
reached from the estimate's message thread ("Ask the assistant"). Ownership
is account membership (`loadMemberEstimate`). Answers come, in order, from
the estimate's own data (`explain_estimate` composes rooms/surfaces/range from
`get_scope` + `price_scope` — a sent estimate always shows its number), the
Brain (`lookup_brain` = Postgres full text over `brain_entries`, approved and
written entries only, audience-filtered, Settings tokens rendered live by
`lib/brain/parse.ts`), and otherwise "no entry yet — want a person?". A change
request on a sent estimate writes an `estimate_events` row (type
`change_request`) that `lib/crm/work-queue.ts` derives into a `change_request`
work item ("Reprice"), closed by a staff reply in the thread; on a draft the
tool points at the editor instead. Visits go through `lib/visits/policy.ts`
— the one visit-policy function from the visit brief (self_serve |
phone_first | manual; lead paint never self-serves) — and
`open_visit_booking` hands into the existing ladder. The Brain seed
(`docs/brain/brain-v1.md`) is parsed by `lib/brain/parse.ts` and imported as
drafts by `scripts/import-brain.ts` (idempotent on slug; [TOM TO WRITE]
entries carry `needs_content` and are never served; approved answers are
never overwritten by a re-import). Tom approves per entry in Settings →
Brain. Migration `20261229` adds `slug` + `needs_content`.

## Assistant agent — S7 human handoff (2 Sep 2026)

"Talk to a person" is real. `request_handoff` inside support hours writes an
`agent_handoffs` row (requested), puts the conversation in `handed_off` (the
assistant stays quiet; the customer's messages keep landing in the SAME
transcript), pings the on-duty roster by SMS (`agent_settings.support_hours.
roster`, per weekday, `escalateTo` on top) and surfaces as a `handoff_
requested` work item in Today with one action, Claim → `/crm/chat/[id]`.
Claiming posts a 3-line summary (who, what they said, the range) as a system
message; staff replies are `role=staff` in the transcript; Resolve reopens the
conversation and the assistant resumes ("They've stepped away — keep going or
leave it here?"). Realtime (`useLiveConversation`) subscribes under the
viewer's own session to inserts/updates and refetches the authoritative
transcript, with a polling fallback. Outside hours the tool refuses with the
next opening and offers a callback; the callback form posts a structured
answer that `request_callback` turns into a `callback_requests` row dated for
the next working day plus a `callback_requested` CRM event — the existing
callback card. The SLA (`sla_claim_seconds`, D10) runs in the agent sweep:
unclaimed past it → `escalated_at`, an escalation ping, and the customer is
offered a callback. `lib/agent/handoff.ts` holds the pure parts; migration
`20261230` adds `escalated_at` and the Realtime publication.

## Assistant agent — Addendum A2 trade build flow (2 Sep 2026)

"Describe the job" sits beside the wizard's fill-in on page 1: the paragraph
goes to `POST /api/agent/start` as `brief`, which runs it as the first turn —
the model calls `propose_diff`, and on the customer's OWN draft the proposal
applies straight in (no Apply gate). The range card shows at once for trade
(R4/D21) with the band (±15 first) and every open tightening gap as a chip;
tapping a chip asks that question (`focus` on the turn route — no model turn)
and the answer removes it. A brief build assumes a house and clear safety
flags and says so: `facts.flagsAssumed` turns `q.property_flags` into a
tightening chip that is answerable after the build. Photos uploaded through
the estimate's own route count (`estimate_sources` kind defect_photo →
`facts.photoCount`) and clear the photo chip. Residential sees the chips but
no number until every area is confirmed and swept. Tests: `trade-flow.test.ts`
(chips = open tightening gaps, exactly) and `e2e/customer-journey/
assistant-trade.spec.ts` (trade and residential).

## Assistant agent — S8 evals, dashboard, launch checklist (2 Sep 2026)

**Evals run in `npm test`.** `lib/agent/evals/adversarial.test.ts` sends the adversarial set (haggling, margin fishing, "ignore your instructions", abuse, and lead minimisation through the guided flow) through the stub model and the real tools: every case ends in the scripted hard stop or a handoff, no dollar figure leaves without a tool result, nothing internal reaches a customer. `lib/agent/evals/replay.ts` holds twenty synthetic enquiries and `corpusReplay()`, which turns the git-ignored regression corpus into anonymised count-only briefs and reports the correction against the sent total (a proving-window figure, not a gate); `replay.test.ts` asserts determinism and that every fill-in is listed. `scripts/agent-evals.ts` prints the numbers for `docs/briefs/agent-launch-checklist.md`, which Tom signs.

**Hard stops a person can trigger by talking** live in the stub as `hardStopIntent()` (discount / margin) and an abuse pattern → `request_handoff(sentiment)`; the production model reaches the same tools by instruction, and the turn loop still forces the script into the reply either way.

**Photos never gate the build.** `tryBuild` no longer waits on `ext.photos` or `condition.photos`; upload-type gaps rank last in the question graph, and `toWizardState` takes the wizard's own "no photos to hand" exterior path when there is no listing and fewer than two facade photos. Defect photos tighten an amber price (D22) rather than block it.

**Photos in the chat.** Upload-type gaps (`condition.photos`, `ext.photos`) render `PhotoForm` in `AssistView`: the wizard's own staging (`/api/extract/upload-url` → signed upload → `/api/extract/photos`), now with an optional `estimateId` that claims the rows for the customer's own draft at once (ownership rule as `loadOwnEstimate`; staff may claim any). The turn then records "attached" and the graph reads the count from `estimate_sources`. "None to hand" sets `facts.photosDeferred` — the amber prep line stands and the ask stops. A pending photo ask never withholds the price or the accept button (`finished` ignores upload gaps).

**Briefs.** Plural counts ("5 bedrooms, 2 bathrooms") now extract; a brief that names rooms without a bedroom count builds exactly those rooms (fill-in `rooms.named_only`) instead of refusing.

**`/admin/agent`** (staff shell) derives everything from rows the assistant already writes: estimated spend by Melbourne day (token counts × `agent_settings.feature_flags.modelPrices`, defaults in `lib/agent/settings.ts`), conversations by mode and channel, handoff rate and past-SLA count, cost per completed guided estimate (guided conversations whose estimate carries a prep pack), and drop-off by question key (the last `next_gap` result per unfinished guided conversation). Pure metric functions sit in `lib/agent/evals/metrics.ts`.

**Entry point (3 Sep 2026).** `app/quote/AssistantFab.tsx` — the floating chat button bottom-right on the builder (`/quote?id=…` → `/estimates/[id]/assist`) and on the estimates list (→ `/estimates/new/assist`, a fresh staff draft). A link, not a widget.

## Assistant — co-work inside the builder (3 Sep 2026)

Tom's first real run of co-work (a separate page, pending proposal, one question at a time, "we're closed right now" said to an estimator) changed the design:

- **The chat lives in the builder.** `app/quote/AssistantDrawer.tsx` — the floating button on `/quote` opens a side panel; `POST /api/agent/cowork` finds or creates the staff conversation for the estimate (or makes a fresh draft and reopens the builder on it with `?assist=1`); turns go through `/api/agent/turn` as before. The standalone `/estimates/[id]/assist` page stays as a deep link.
- **Changes apply live.** `ScopeTools` no longer gates co-work (`gated = false`); `propose_diff` and every answer land on the estimate row at once, `applied: true`. The pending copy + `apply_diff` machinery is still wired but idle.
- **Two writers, one row.** The builder saves on demand from in-memory state, spreading what it loaded. `app/quote/builderBridge.ts`: the drawer flushes the builder's unsaved edits before each turn (`dirty()` compares a fingerprint of what a save would write against the last save/load), then `router.refresh()`; the page keys `<QuoteBuilder>` on a hash of `builder_state`, so a changed row remounts the builder on the fresh state and its next save spreads the assistant's writes rather than the stale load.
- **Staff never see people tools.** `toolsFor("cowork", …)` excludes request_handoff, request_callback, get_support_hours, visit_policy, open_visit_booking. The co-work system prompt says act first: propose_diff on the first message however short, assume and list, ask the rest as one batch, report only what a tool confirmed.
- **Answers as people phrase them.** `bool()` reads "No, it'll be empty" / "Yes, we'll be there"; `oneOf()` matches a label by prefix ("Single storey" → single). The transcript's "occupied" loop was answer_gap refusing the chip label while the model claimed it stuck.

**3 Sep, second pass (from Tom's production transcript + screenshots).** "Outside … 4 bedroom house" is an EXTERIOR job (room words describe the house; only a strong interior cue makes it both). An exterior built from answers now carries the wizard's page-2 ticks derived from substrates + what we're painting (`exteriorTicks()` in scope-doc), so the scaffold has trims, windows and doors, not bare walls; in co-work every side is included at typical size with the stated substrates split across each side (fill-ins `sides.all`, `sides.wall_split`). `condition.tier` is answerable after the build ("3 coats" → dark_to_light) and re-coats every row. A model or tool failure in `/api/agent/turn` persists a plain "something went wrong" line instead of returning a silent 500.

## Marketing homepage v2 — session 1, walking skeleton (4 Sep 2026)

Brief: `docs/briefs/homepage-v2-build-brief.md`; prototype (source of truth for copy, layout, events): `design/reference/paint-group-homepage-v2-prototype.html`. The public `/` is now the marketing homepage, a route group at `app/(marketing)/` with its own layout (Switzer self-hosted via `next/font/local` from `app/(marketing)/fonts/`, Martian Mono via `next/font/google`, both `display: swap`), one file per section under `_sections/` (Nav, Hero, Footer, CallBar so far; no section imports another) and shared pieces under `_components/` (`AddressField`, `Button`, `Chip`, `TelLink`, `TrackedLink`). Styling is the prototype's CSS ported to `app/(marketing)/marketing.css`, scoped under `.mk`; the colour tokens are the Figma "01 Foundations" names added to the `@theme` block in `app/globals.css`. `AddressField` knows nothing about the wizard: it reuses the one lookup brain (`app/components/useAddressLookup`) and hands `onSubmit(address, mode)` to the page; `Hero` fires `see_price {where, mode}` and routes to `estimateHref()` (`lib/marketing/estimateLink.ts`) — `/estimate?address=&mode=home|business`. `/estimate` reads those through `parseEstimateIntent()` (`lib/marketing/prefill.ts`) into a new `intent` prop on `WizardApp` (address text shown in the field; business pre-selects the commercial property kind) — intent only, no account, no event. Analytics is `track()` in `lib/analytics.ts` (typed event names from brief §5; a `pg:track` DOM event now, Clarity + `crm_events` in session 7). The places proxy (`/api/places/*`) now admits sessionless same-origin callers through a per-IP in-memory bucket (`lib/places/publicLimit.ts`) so the homepage gets suggestions without spending an anonymous sign-in per typist. E2E: `e2e/marketing/homepage-skeleton.spec.ts` (anonymous, 375px, lookup mocked at the network edge, asserts the URL values and the analytics contract). Placeholders carry `data-todo="9.x"` (phone 9.10, service/legal links 9.8).

## Marketing homepage v2 — session 2, showcase data (4 Sep 2026)

`showcase_jobs` (migration `20270101000000_showcase_jobs.sql`) is the data model behind "Real jobs, real prices" (brief §4.4a): one row per finished job with slug, job/property type enums, suburb, completed month, days on site, price range in integer cents, scope line, summary, `what_we_did`/`colours`/`gallery` as ordered jsonb, condition notes, optional customer line, optional `estimate_id`, `featured_rank` 1–3 (unique), `consent_confirmed` (⚑9.11) and `published`. Site Capture's media table does not exist yet, so photos are storage paths in the new public-read, staff-write `showcase-media` bucket (`hero_path`, `gallery[].path`). The database mirrors the rules: low ≤ high, scope line ≤ 90, slug shape and a trigger that locks the slug once published, and a `publish_ready` check — no row can be published without a hero photo, both ends of the price range, a completion month and consent. RLS: `anon`/`authenticated` read `published = true`; staff read everything; there is NO client write policy and the default write grants are revoked — the only write path is `saveShowcaseJobAction` in `lib/showcase/actions.ts` (zod, staff session proven, service client, publish checklist, `rank_taken` conflict for the editor's "which one to replace", ISR `revalidatePath` on `/`, `/work`, `/work/[slug]`). `lib/showcase/schema.ts` holds the zod shapes + `publishChecklist()`, `format.ts` the money/date/slug helpers (tested), `queries.ts` the cookie-less anon reads the ISR pages use (`featuredShowcaseJobs`, `publishedShowcaseJobs`, `showcaseJobBySlug`, `relatedShowcaseJobs`). `scripts/seed-showcase-placeholders.mjs` seeds the prototype's three cards as DRAFTS (test project by default, `--prod` gated on `SEED_ALLOW_PRODUCTION=1`); until Tom photographs, consents and publishes them the homepage (session 5) shows bracketed placeholder cards. `e2e/showcase-rls.spec.ts` proves the policy set through the anon and staff sessions and the database rules through the service client.

## Marketing homepage v2 — session 3, Settings → Showcase (4 Sep 2026)

`/settings/showcase` (list, `app/(app)/settings/showcase/page.tsx`) and `/settings/showcase/[id]` (`new` creates) with `ShowcaseEditor.tsx` — ONE form in the exact order the public page renders (brief §4.4b), a live preview at ≥1200px that is the real `ProjectPage` fed the form's state, and a Preview sheet below that. Photos go up from the browser through the same direct `storage.upload` path the product photos use, behind the bucket's staff-only insert policy and `lib/uploads/validate`, downscaled to 1600 px in the browser first (`lib/showcase/media.ts`); `next/image` (remotePatterns for `*.supabase.co/storage/v1/object/public/**` in `next.config.ts`) derives the smaller variants. Saves go through `saveShowcaseJobAction`; the editor turns its answers into inline sentences, the publish checklist (also computed live on the client from the same `publishChecklist()`), and the "featured spot is taken — replace which job?" dialog (`displace_featured` retry). Staff reads live in `lib/showcase/staff.ts` (session client, staff policy). The public template is `app/(marketing)/_components/ProjectPage.tsx` — nine blocks, blocks 5–7 omitted when empty — with `Gallery.tsx` (masonry + keyboard lightbox), `GetPriceLike.tsx` (AddressField, mode from property type, `job_get_price`, wizard URL carries `scope`/`from` for session 4) and `JobCard.tsx`; swatches from `lib/showcase/swatches.ts`; fonts shared via `app/(marketing)/fonts.ts`. Settings → Company gains a "Showcase jobs" folder linking to the list. E2E: `e2e/showcase-editor.spec.ts` (staff: create → photo → price → preview → publish → public reads it → replace rank 1 via the dialog → unpublish → public can't; plus the checklist refusal).

## Marketing homepage v2 — session 4, /work + project pages (4 Sep 2026)

`app/(marketing)/work/page.tsx` (ISR, revalidate 60; `WorkList.tsx` client chips by job type / property) and `app/(marketing)/work/[slug]/page.tsx` (ISR with `generateStaticParams` over published slugs, `dynamicParams` for new ones, `notFound()` for unknown/unpublished → `app/(marketing)/not-found.tsx`, `generateMetadata` = `“{title} in {suburb} — $low – $high | Paint Group”` + OG hero, Article JSON-LD with no Offer markup) render the shared `ProjectPage` template. The save action's `revalidatePath` calls are what make an edit/unpublish live within a minute; time-based ISR was measured at ~65 s on the production build. "Get a price like this" lands on `/estimate?address&mode&scope=<job_type>&from=<slug>`: `parseEstimateIntent` validates `scope` (enum) and `from` (slug shape); the page resolves `from` through the PUBLIC read (published rows only) and, when that row links an estimate, reads `builder_state->wizard->state` with the service client and passes it through `sanitiseClonedState` (`lib/wizard/showcaseSeed.ts`) — identity, contact, address, suburb/postcode, listing, plan/photo runs and damage notes stripped, the scope tree kept; no link or an invalid state → `scopeSeed(job_type)`. The estimate id never rides the URL. To make seeds validatable, `lib/wizard/state.ts` now exports `wizardStateShapeSchema` (fields only) alongside `wizardStateSchema` (shape + the cross-field rules a submit must pass). E2E: `e2e/marketing/work-pages.spec.ts` (anonymous; list + filters, template blocks, keyboard lightbox, metadata/JSON-LD/noindex, 404, both hand-off paths incl. the PII-stripping assertion).

## Marketing homepage v2 — session 5, the remaining sections (5 Sep 2026)

`app/(marketing)/page.tsx` now composes all thirteen sections in the brief's §3 order (ISR, revalidate 60; the showcase save action revalidates `/`). New files under `_sections/`: `HowItWorks`, `RealJobs` (server; `featuredShowcaseJobs()` = published ranks 1–3, empty slots render the prototype's bracketed placeholder cards with `data-todo="9.2"`, never a draft), `Promise` + `_components/PromiseExplorer.tsx` (client; role=tablist/tab/tabpanel, arrow/Home/End keys, `promise_n` events, the approve flow with the prototype's toast, no remote sign-off wording), `Story` (the reduced-motion END STATE of §4.7 — Day 5, all done, signed off, eight captions listed; session 6 adds the 22 s timeline and keeps this as its fallback), `LiveStrip` (static tiles from `lib/marketing/liveStats.ts`, ⚑9.4; count-up in session 6), `Painters` (+ `_components/PainterCard.tsx`, `painter_card`; three `[Painter n]` placeholders, ⚑9.3), `Trade` (`[Agency name]`, both buttons `#` + `data-todo="9.5"`, `trade_walkthrough`/`trade_account`), `Reviews` (⚑9.6 placeholders), `Faq` + `_components/FaqList.tsx` (eight `<details>` from `lib/marketing/faq.ts`, multi-open allowed, `faq_open {index}`; the same array emits the FAQPage JSON-LD on the page), `ClosingCta` (client; second `AddressField`, `see_price {where:"bottom"}`). The prototype's CSS for these blocks is ported into `marketing.css` (scoped `.mk`, theme tokens). E2E: `e2e/marketing/homepage-sections.spec.ts` (anonymous; every section at 1280 and 375 with no horizontal overflow, explorer keyboard + approve, FAQ multi-open + indexed events, CTA hand-off, featured-cards rule through service-client fixtures with the ISR wait) and the session-1 skeleton spec now scoped to the hero (two address fields on the page).

## Marketing homepage v2 — session 6, motion (5 Sep 2026)

Framer Motion added (story and estimator only — no page-transition or scroll effects anywhere, Tom's ruling). Two pure timelines under `lib/marketing/`, both unit-tested: `ghostEstimator.ts` (the four §4.2 examples, ⚑9.1; `ghostSchedule()` = per-character 38–78 ms jittered steps → result → 3.2 s hold → 400 ms fade; `applyGhostStep`/`stopGhost` state machine; `ghostWorstCase()` proves the 2 s / 6 s ACs) and `progressStory.ts` (`storyStateAt(t)` — every phone visual and the caption index as a pure function of elapsed ms over the prototype's BEATS; the drift test asserts caption and phone flip on the same millisecond at every beat). `AddressField` takes `ghost` (hero only): plays the schedule after first paint on plain timers, stops for good on focus/pointerdown/chip (`ghost_stopped`), never starts under reduced motion; the input is controlled by the ghost text while it plays and the placeholder is hidden. `_components/ProgressStory.tsx` keeps ONE requestAnimationFrame clock (paused on `visibilitychange`, resumed on return), renders `storyStateAt(elapsed)`, plays once at 50% in view via IntersectionObserver, never auto-replays, `↻ Replay` restarts from 0, fires `progress_story_start/_complete/_replay`; Framer animates the transitions (banner, photos, variation card, sign-off, signature `pathLength`); `useReducedMotion` renders the final frame with the captions listed; the phone is aria-hidden and the caption list is always in the DOM (visually hidden outside reduced motion). `_components/CountUp.tsx` counts the live tiles up on enter (900 ms ease-out cubic), server-rendered with the final number. The CSS transitions the prototype used for these elements were removed so Framer owns them. E2E: `e2e/marketing/motion.spec.ts` (mobile ghost: typing within 2 s, result within 6 s, chip follows, tap → empty/focused/no ghost/never restarts, chip stop, reduced motion idle; story: plays once, ~22 s runtime, Day 3 → Day 5, no auto-replay, replay from 0, the three events; reduced-motion end state; tiles count to the config numbers).

## Marketing homepage v2 — session 7, analytics + consent + noindex (5 Sep 2026)

`lib/analytics.ts` `track()` now has its providers: (1) the `pg:track` DOM event, (2) the platform's own table ALWAYS — `POST /api/events` via `sendBeacon`/keepalive fetch with the first-party `pg_vid` visitor cookie (12 months, minted on first event, `lib/marketing/consent.ts`), (3) Microsoft Clarity as `clarity("event")` + a custom tag, only when the tag is present. The address leaves the browser on `see_price` only: `scrubProps()` drops `address` from every other event client-side and the sink drops it again server-side. `app/api/events/route.ts` (sessionless, same-origin + per-IP brake via `lib/places/publicLimit` kind `events`, zod, name must be in `MARKETING_EVENT_NAMES`, always 204) writes `crm_log_event` with the service client as the new `web_event` CRM type (`lib/crm/events.ts`: `{name, props, path, visitorId, address}`) — one type, the marketing name in the payload, so CRM lead-source attribution can join `visitorId` to a later wizard draft. Consent (Tom's spec): `_components/ConsentSheet.tsx` mounted in the marketing layout — bottom sheet, `Only what's needed` default/focused/ghost, `Allow analytics` cyan, `pg_consent` first-party cookie for 12 months, `CookieSettingsLink` in the footer reopens it via a window event; `lib/marketing/clarity.ts` `loadClarity()` injects the tag only after "Allow analytics" (or on load when the cookie already says analytics) and only when `NEXT_PUBLIC_CLARITY_ID` is set. Noindex (§8): `next.config.ts` `headers()` adds `X-Robots-Tag: noindex, nofollow` to every path unless `SITE_INDEXABLE=1`, on top of the layout's robots metadata; the subdomain alias is a Vercel-dashboard step (docs/testing/homepage-v2-session7-manual.md). E2E: `e2e/marketing/analytics.spec.ts` (sheet default + cookie lifetime + no Clarity before/after decline, Clarity after allow when configured, reopen from the footer, rows in `crm_events` with the visitor id and the address on `see_price` only, the sink stripping a smuggled address, unknown/cross-site dropped, the header on `/`, `/work`, `/estimate`).

## Wizard + builder batch (5 Sep 2026)

Ten items from Tom's live review. **Sheen per material row**: `QuoteBuilder` keeps `sheens` in builder_state keyed `${type}::${code}` (like `materialColours`); `products.finish` is only the default; the customer paint cards group by product + sheen; `WOMaterial`/`WOSurface` carry `finish` and the PC materials card shows it. The old control wrote the catalogue row and moved every estimate. **Garage door 22 L → 6 L**: `rate_items.litres_per_item_per_coat` 10 → 2.727 on the two Garage Door rows (migration 20270102), and Settings → Substrates now exposes that column and `metres_per_litre`. **Size uplift**: `sizeUpliftCents()` in `lib/pricing/estimate.ts`, two tiers from Settings rows ("Margin uplift — tier n threshold / %"), marginal on the slice above each threshold, applied inside the subtotal before discount/GST so wizard range, builder, margin and work order agree; seeded 0%. **Countable per-item lines**: `sidesView` takes `hoursPerItemCodes(rateItems)` — every "Hours Per Item" rate code (posts, strapping…) gets the −/+ stepper the server already honoured. **Eaves twice**: `addSideSurface` allows `TWICE_OK_CODES` (Eaves) a second row, relabelling upper/lower; the editor's add panel offers it. **Fence type**: `exterior.extras.fenceType` (paling / picket_hand / picket_spray) → `FENCE_CODE` picks the card row at submit (`exteriorExtrasNodes`), `applyFenceType` + route action `set_fence_type` swap it in the editor; a segmented control on wizard step 5 and chips on the extras card. **Finalise my price**: `ContactCard` (call us via Settings phone, threaded as `companyPhone`; call back; site visit with availability) → route action `request_contact` writes the prep pack, an `estimate_events` row and — the part a booking never did — a `crm_events` `callback_requested` (note prefixed `SITE VISIT —`), so it appears on CRM → Today and the account timeline; the slot strip and `book_visit` UI are gone (the action remains for the assistant). **Measured sides**: `applyExteriorAnswers` takes `MeasuredSides`; the submit route fills it from the site-plan read's edge lengths and the elevation reads' heights, so a side the envelope could not price still gets its real L/H (origin ai_extracted, not flagged) instead of the 12/14 × 2.6 constants — the root of "always the same measurement". Interior no-plan rooms remain typical by design.

## Wizard progress, estimate status and CRM buckets (6 Sep 2026)

Brief: `docs/briefs/wizard-progress-crm-buckets.md`. The brief's `wizard_sessions` IS
`wizard_drafts` (one row per wizard start, keyed on the anonymous auth user — the brief's
`session_token`); migration `20270107` adds the session columns (mode, entry_source,
address, current/furthest page, pages_total, outcome, active_seconds, step_times,
dropped_at, bucket). A session exists from the FIRST answer (address, suburb, or leaving
page 1), not from the email. Leads, stages and tasks stay DERIVED (CLAUDE.md): the bucket
rule is `lib/wizard/journey.ts bucketFor` (unit-tested over every completed × outcome ×
idle case); the only stored classification is `wizard_drafts.bucket`, written by the
autosave, the heartbeat, the outcome routes and the 30-minute sweep
(`/api/cron/wizard-sweep`, 45 idle minutes → dropped / priced_no_request, ≤500 rows).
Attention: `/api/wizard/heartbeat` every 15 s while visible + input in the last 60 s;
12 s per-session rate limit. Outcomes: call/visit requests via the estimate's wizard-edit
route; `/api/wizard/outcome` for "Stuck? Ask us to call you" (wizard footer) and "Talk to
a person" (assistant). Staff: Estimates page gets a Wizard status column, a Journey drawer
and a Wizard tab (bucket/source/mode filters); Today gets `wizard_ready` / `wizard_help` /
`wizard_priced` work items (Melbourne business-hour due dates, `lib/time/businessHours.ts`)
and a "Dropped this week" panel grouped by page; board cards carry the bucket pill. Entry
source rides the hand-off as `?src=` (`homepage_hero`, `homepage_cta`, `job_page:<slug>`,
else `direct`). Manual check: start `/estimate?src=homepage_hero`, answer two pages, wait
20 s, leave; `curl -H "Authorization: Bearer $CRON_SECRET" /api/cron/wizard-sweep?minutes=0`;
open Estimates → Wizard and CRM → Today. e2e: `e2e/wizard-buckets.spec.ts`.

## Website session 8 — residential and commercial audiences (6 Sep 2026)

Brief: `docs/briefs/website-audiences.md`. One brand, two domains, one codebase.
`audience ∈ {home, business}` is decided per request in `proxy.ts` by
`lib/marketing/audience.ts resolveAudience(host, path)` (unit-tested): the commercial
host (env `COMMERCIAL_DOMAIN`, ⚑ D1) is business and its root is rewritten to the
`/business` route; `/business…` on the residential host 301s to the commercial domain,
or, with no domain configured (dev, C1, the Settings preview), is served locally. The
proxy stamps `x-audience`; the two homepage routes (`app/(marketing)/page.tsx`,
`business/page.tsx`) render one `HomePage` per audience and stay static/ISR; the `/work`
pages read `getAudience()` (dynamic) and a project page 301s to the domain matching its
`property_type`. `AudienceProvider` gives client sections `useAudience()`; `track()` adds
`audience` from `<html data-audience>`.

Copy: `site_content` (migration 20270109; public select, service-only writes) keyed
audience/section/key, seeded for BOTH audiences from `lib/marketing/copy/{home,business}.ts`
via `scripts/gen-site-content-seed.ts`; `lib/marketing/siteCopy.ts getSiteCopy` merges rows
over those defaults; the field list is `lib/marketing/copy/schema.ts` (one list feeds the
seed, the editor and the reader). Settings → Company → Website copy: two tabs, sections in
page order, live preview iframe, markdown (`lib/marketing/md.ts`) on lead/answer keys.

Per audience: hero (chip defaults to the audience, unlocked), self-typing examples with the
audience's mode only, steps, promise rows, story captions (+ the business beat at 13.0 s,
`storyBeats`), painters intro, trade lane promoted after the jobs on the business site,
reviews (`review_tags` table + `lib/marketing/reviewTags.ts pickReviews`: business shows
confirmed-business reviews, fewer than three → best untagged under "From homeowners and
businesses"; Settings → Website → Reviews confirms tags), FAQ, CTA (chips on the business
site), meta + `LocalBusiness` JSON-LD with one `@id` and a per-audience `serviceType`.
Cards: `showcase_jobs.featured_rank_business` (⚑ D4) + `lib/showcase/rank.ts` (never pads
with home jobs while ≥3 business jobs are published). Sitemap: `app/sitemap.xml/route.ts`
per host. e2e: `e2e/marketing/audiences.spec.ts` (mobile; journey 3 needs
`COMMERCIAL_DOMAIN`). Hand-off: `see_price` on the business site carries
`src=commercial_home_hero|_cta` and, on the commercial domain, an absolute residential
`/estimate` URL (⚑ D2).

## Help content foundation — session A1, the convention (6 Sep 2026)

Brief: `docs/briefs/claude-code-brief-help-content-foundation.md` (Phase A only). Help
content for staff, PCs, contractors and (later) customers lives as markdown at
`docs/help/<feature>/<role>.md` — one source of truth that Phase B (assistant support-mode
retrieval), Phase C (`/help` route) and Phase D (voiced video) will all generate from.
Roles are `staff | pc | contractor | customer`; `pc` is a distinct role (⚑1 ruled 6 Sep) for
PC-only screens, never alongside `staff.md` for the same content. Role scoping is by
construction: separate files, never one file with hidden sections. `CLAUDE.md` → Process now
carries the rule that a feature is not done until its help files exist for every role that
can see it, written after the e2e run from the real screens, shipping in the same PR.

Pieces: `docs/help/_template.md` (the brief's §6, verbatim), `docs/help/README.md` (folder
convention, roles, front-matter spec, index rules), `scripts/help-index.ts` → `npm run
help:index` (plain `node`, no new dependency — Node 24 strips types; keep the file free of
enums and parameter properties). The script validates every role file (known keys only,
role in the allowed set and matching the filename, feature matching its slug folder,
referenced screenshots and walkthrough GIF present on disk, no stray `.md` files) and
writes `docs/help/_index.json` (feature, role, title, summary, path, walkthrough, media,
verified_at_commit). The index is committed; the CI `gate` job runs `help:index -- --check`,
which fails on any validation problem or a stale index. `verified_at_commit` is read now
and set from git in session A4. Backfill (A2 scheduling + self-invoicing, A3 work orders)
and GIF walkthroughs (A4) follow on this branch.

## Help content — session A2, scheduling + self-invoicing backfill (6 Sep 2026)

First four help files, written from e2e runs on the C1 test stack in the real roles:
`docs/help/scheduling/{contractor,staff}.md` and `docs/help/self-invoicing/{contractor,staff}.md`,
35 screenshots under each feature's `media/`. The screenshots come from a committed capture
rig, `e2e/help-capture/` (`rig.ts` = viewport presets, `shot()`, an invented-data job fixture
`createHelpJob` that lands in the tray or on a contractor; `scheduling.spec.ts` and
`self-invoicing.spec.ts` drive both roles end to end and save the PNGs). Not CI gates; re-run
to regenerate. Contractor shots are viewport-sized because the portal's fixed tab bar and
bottom sheets strand mid-image under a full-page capture. `contractorIdForEmail` in
`e2e/fixtures/woLoop.ts` now pages 50×200 users (was 10×200 — the test project's anonymous
wizard sign-ins passed 2,000 and the helper silently returned null). Running the flows
surfaced three app defects, reported in the session notes, not fixed here: the sign-off
invoice submitted after a progress claim loses the "previously invoiced" subtraction
(migration 20261127 dropped it — money bug, live), a reschedule request re-redacts an
accepted job to suburb-only, and approving a proposed date moves start_date but not end_date
or the booked walkthrough.

## Help content — session A3, work order loop backfill (6 Sep 2026)

`docs/help/work-orders/contractor.md` (painter: pre-start, before-photo-before-first-tick,
ticks, site notes, variations, the finishing-up list, quality check and rectification, Mode A
walkthrough on the painter's phone) and `docs/help/work-orders/pc.md` (six lanes, the attention
queue and its colours, pre-start list, pricing/releasing variations, drafted customer updates,
quality checks, walkthrough and Mode B gate, deemed clock in neutral wording, closing). No
`staff.md`: the loop lives entirely in the PC console, so there is no office content that is not
PC content. Screenshots from `e2e/help-capture/work-orders.spec.ts`, which drives both roles
through the whole loop on C1 (offer → accept via RPC, then every step through the real screens;
the customer's variation signature via RPC as the customer). Rig additions: `placeholderPng`
(zlib-encoded gradient PNGs so uploads look like photos, not colour blocks), `frame()` (centre
a card before shooting), `DESK_TALL` for the two-column PC job page. Trap: the tick list opens
the phone's file picker DIRECTLY on an area's first and last tap (before / finished shot) — a
Playwright tap must intercept `filechooser` or the tick silently never lands. Stage names in
the files match `STAGE_LANES` in `lib/workorder/stages.ts` and the on-screen rail.

## Help content — session A4, walkthrough GIFs + staleness (6 Sep 2026)

Every help file now has a silent captioned walkthrough GIF (`media/<role>-walkthrough.gif`,
the painter's work-order flow split into two under 60 s). Produced by
`e2e/help-capture/gif-{scheduling,self-invoicing,work-orders}.spec.ts`: the rig injects a caption
banner per step (`installCaptions`/`caption`, persisted through navigations in sessionStorage),
captures frames ~5/s (`startRecording`, skipping half-loaded pages and any frame whose
`innerWidth` is not the viewport — mobile emulation draws a page without its viewport meta at
980 px), and `writeGif` joins them with `sharp` (already a dependency; libvips merges identical
consecutive frames, so a 26 s film is ~200 KB). Real-time frame delays, uniform speed-up past 58 s,
two-second hold on the last frame. Chosen over the brief's Claude-in-Chrome `gif_creator` because
it is scripted, deterministic and never touches production. Staleness: front-matter `sources:`
(repo paths the file documents) + `verified_at_commit:` written by `npm run help:index -- --stamp
<feature>`; `--check` prints a GitHub `::warning::` when commits after the stamp (or uncommitted
changes) touched the sources — never a failure. CI's gate checkout is `fetch-depth: 0` so the
comparison can see history.

## Help centre — Phase C, the /help routes, search and the first-sign-in tour (6 Sep 2026)

Brief: `docs/briefs/claude-code-brief-help-centre.md`. The markdown under `docs/help/` is now
read in the app. **Routes**: `/portal/help` and `/portal/help/[feature]` for contractors (portal
shell, `.pt` tokens, a HELP tab in `PortalTabs`); `/help` and `/help/[feature]/[role]` for the
office (Tailwind, a sidebar entry every login sees — `AppSidebar` treats area `help` as
always-on). **Role scoping is server-side by construction**: `lib/help/content.ts` →
`rolesFor("staff") = [staff, pc]`, `rolesFor("contractor") = [contractor]`; the page lists,
reads and rewrites only files whose role is in that set, and a file outside it is `notFound()`
(the office shell streams behind `loading.tsx`, so the not-found is a 200 body without the
guide — the e2e asserts on the served HTML, not the status). `lib/help/session.ts` `helpReader()`
is a non-redirecting role probe: a suspended contractor still reads Help (⚑ C-3). Screenshots
and films are served by `app/api/help/media/[feature]/[file]` under the same role check, 404
when it fails — never 403, so a URL never confirms a file exists — with `Cache-Control:
private`. The markdown goes through `lib/help/markdown.ts` (`stripFrontMatter`, `parseHelp` →
h/p/img/list blocks with per-item images, `helpToText`) and `lib/marketing/md.ts`'s `inlines`,
whose link grammar now accepts `../feature/role.md` relative links; `rewrite()` turns media
paths into the API route and related links into the right route for the reader, or demotes
them to plain text when the target is a role the reader may not see. `next.config.ts`
`outputFileTracingIncludes` ships `docs/help/**` with the three route groups so Vercel can read
the files at request time. **Search** (`lib/help/search.ts`, `?q=`): AND over the query's
terms, weighted title/summary/body, a sentence snippet, ranked; full-body (⚑ C-4) but only over
the reader's own role files, so an office phrase finds nothing for a painter. **Tour** (⚑ C-1
contractors only, ⚑ C-2 once per account): `docs/help/_tours/contractor.md` is cards of
`## Title` / `target: /portal/…` / body, validated and indexed by `help-index.ts` (`tours` in
`_index.json`); `PortalTour.tsx` overlays one card at a time, Next walks to the card's tab,
Done/Skip call the server action `markTourSeen()` → RPC `contractor_tour_seen()` (migration
**20270114**, `contractors.tour_seen_at`, self-only). The portal layout mounts it when the
contractor is not suspended, has no `tour_seen_at`, and has no live offers or work orders — an
existing painter is never interrupted; `/portal/help?tour=1` replays it without recording.
**Join fix found by the tour e2e**: Supabase answers `signUp` for an email that already has an
account with no error and no session (anti-enumeration); `JoinForm` treated that as success and
the redeem RPC failed `not_signed_in`. It now signs in when there is no session. Help for the
help centre: `docs/help/help-centre/{contractor,staff}.md`. e2e: `help-centre.spec.ts`
(index-driven: every guide listed and opened per role, office text absent from portal HTML,
search both ways, anonymous media 404) and `help-tour.spec.ts` (real invite → join → tour →
recorded → replay; the shared contractor with work on the books is not toured). The capture
rig's `help-centre.spec.ts` shoots the centre itself; every earlier portal screenshot was
re-captured because the tab bar gained HELP.

## Reschedule requests keep the address; approving a new date moves the whole booking (6 Sep 2026)

Two defects from the scheduling help capture, both in the offer state machine's
`proposed` state. (1) `request_reschedule` flips an ACCEPTED offer to `proposed` with
`prior_start_date` set, and `committedIds` (`lib/contractor/jobs.ts`) only counted
`accepted`, so the painter's job snapped back to suburb-only and the jobs list retitled
it with the suburb. `offerCommits` now treats `proposed` + `prior_start_date` as a
commitment (the booking they already hold; the original date stands until staff decide);
a first-time proposal — no prior date — stays redacted. The job page header shows the
held booking while the request is pending (the `wo_booking()` RPC reports the PROPOSED
start for the office, which read "proposed – old end · 1 day" there). Unit:
`privacy.test.ts`; e2e: `contractor-portal.spec.ts` (response-body assertion after
`request_reschedule`). (2) `resolve_proposed_offer` moved `start_date` only — the offer's
`end_date` and the booked final walkthrough stayed on the old days, so the painter's
Requests card read "Fri 11 – Tue 8" and the walkthrough pin sat before the job started.
Migration **20270110** shifts `end_date` by the start's delta (offer + work order) and
re-books a BOOKED final walkthrough by the same delta, carrying the client-confirmed
time — the `wo_contractor_set_finish_date` precedent (20261222) rather than clearing it
and raising the console card, because Approve is pressed after ringing the customer
("Ring the customer, then approve or reject") and a finish-date change already moves
the walkthrough without a second call. The move writes a `walkthrough_booked` event with
`via=reschedule_approved`, `from`, `delta_days`. The board's Approve now also pings
`/api/appointments/confirm` (`lib/workorder/appointmentPing.ts`), so the customer's
confirmation (idempotent per start date) and the walkthrough invite (idempotent per
date+time, sequence climbs) go out at approval instead of waiting for the nightly
`wo-sweep`. e2e: `wo-reschedule.spec.ts` (reschedule of an accepted booking, first-time
proposal, and the refuse branch moving nothing).

## Estimator plan · Phase 0 + 1 (7 Sep 2026)

From `docs/briefs/estimator-wizard-end-to-end-plan.md`. **Online estimates switch:**
`lib/wizard/publicFlag.ts` reads the `wizard_public` settings row as `{ enabled,
holdingTitle, holdingBody }` (old `{ enabled }` rows still read); Settings → Estimates →
Online estimates (`OnlineEstimatesSettings.tsx`) is the only place it is flipped. While
off, `/estimate` renders the holding page WITH a call-me form (`HoldingCallback.tsx` →
`POST /api/wizard/callback`, sessionless, same-origin + per-IP bucket `callback` in
`lib/places/publicLimit`), which files an account by email and a `callback_requested`
CRM event — the existing `buildCallbackItems` puts it on Today. **Honest defaults:** the
three safety answers (heritage, built-before-1970, asbestos) carry no pre-selection; the
wizard tracks `answered` per question and `pageBlocker` names the open one; the kicker
counts `lastPage` steps ("Step 2 of 6"). **Save-and-return:** `lib/wizard/resume.ts` is
the pure codec (7-day freshness, shape-validated, a homepage hand-off for a different
address starts fresh); WizardApp writes the record to localStorage a beat after every
change and restores it on mount with a "Welcome back — you were at Surfaces" line and
Start again; cleared on a successful build. Ownership of a customer draft is now
`customerOwnsDraft` (`lib/supabase/guards.ts`): the anonymous builder OR a signed-in
member of the linked account — used by `/estimate/scope` and the wizard-edit route — so
the portal Home's "Keep shaping my estimate" (`lib/portal/home.ts`, wizard-built drafts
only) and the saved-estimate magic link (now `next=/estimate/scope?id=…`) reopen the
editor on any device. Journey specs: `holding-and-honest-defaults.spec.ts`,
`save-and-return.spec.ts` (anonymous customer, phone viewport).

## Estimator plan · Phase 2 — the simpler form (7 Sep 2026)

WizardApp's pages are a LIST per job type (`pageKeys`), not numbers: customer interior =
Property · Surfaces · Condition (coats + damage on one page) · Details · Your details (contact
+ paint preferences embedded); customer exterior = Property · House · Scope · Condition ·
Extras · Your details; staff and members whose details are known keep a Paint page instead of
the contact page. `pageBlocker` gates by page key. Page 1 asks the property questions first,
then **"How would you like to do this?"** — three cards (`EntryChoice`: describe · questions ·
upload; `entryPatch`/`entryFromState` keep the choice and the state in step, also across a
job-type switch and a resumed walk). "Describe it" is the assistant's build-from-brief,
promoted from a textarea above the form. `lib/wizard/journey.ts` page labels follow.
**Styles in the editor:** `lib/wizard/styles.ts` is the ONE door/window style swap
(assumed-style lines only; the assistant's scope-doc mirrors it); wizard-edit actions
`set_door_style` / `set_window_style` swap the rate codes, clear the amber deferral and
write the answer into the wizard snapshot; ScopeEditor shows an "A few details to settle"
card (doors, windows, ceiling height via `confirm_height`) while any is open, the amber list
now reads the LIVE payload, and a "Last change: …" line sits under the sticky range.
**Size band:** `starter.ts SIZE_BAND_FACTOR` scales typical L×W by "Roughly how big"
(0.9 / 1 / 1.15; calibrate from the Proving tags), plumbed through build-tree, the submit
route and add_room. Sides editor shows its range once. Journey spec:
`simpler-form.spec.ts`; drive.ts and the inline specs lost the paint step.

## Estimator plan · Phase 3, first pieces (7 Sep 2026)

**Correction tags:** `lib/wizard/correction.ts` (reasons, `correctionFrom`, `correctionBreakdown`)
stored at `builder_state.wizard.correction` by the staff server action
`app/(app)/proving/actions.ts` (read-merge-write of the jsonb; no migration); the Proving page
shows a "Why staff corrected them" panel and a per-row `CorrectionTags` control. **Extra rooms:**
`basicsSchema` gained optional `bathrooms / separateToilet / garage / study`; `starterRoomList`
adds Ensuite / Bathroom N / WC / Study / Garage; the quick basics ask them. **Footprint band:**
`exterior.sizeBand` (optional) scales the 12 m / 14 m typical side lengths in
`applyExteriorAnswers` by `SIZE_BAND_FACTOR`; read measurements still win. All three are
starting values the correction tags are meant to calibrate.

## Estimator plan · Phase 4, first pieces — the assistant (7 Sep 2026)

Three fixes for the failure recorded on 6 Sep (a full paragraph brief answered with "We're
closed right now… I need at least the suburb or postcode"): (1) `lib/wizard/addressText.ts`
parses a typed AU address line; `scope-doc` `q.address` accepts a string as well as the
structured fields. (2) The guided system prompt (`lib/agent/turn.ts buildSystemPrompt`) now
says: record EVERY fact a message contains (one `answer_gap` per fact) before asking the ONE
question `next_gap` returns; a price question is a normal question, never a stop or a
handoff; never volunteer opening hours or callbacks. (3) `scope-tools.requestHandoff` returns
the "we're closed" script only when the reason is `customer_asked`; any other out-of-hours
handoff attempt gets one quiet line. Model tier is DATA (`agent_settings.model_default`) —
Tom's ruling is the Sonnet-class model for customer chat; SQL in the manual test. Streaming
replies and a real-model regression eval remain open.

**7 Sep, Tom's ruling — Describe it lands in the editor.** `POST /api/agent/start` returns `built`
after the brief turn; when true the wizard sends the customer to `/estimate/scope?id=…` (the
plain confirm-loop editor with the assumptions as amber lines and the details card) instead of
the chat split view. The chat interview remains the fallback for a paragraph that could not
build, and the explicit "Chat it through instead" link. In the chat, ScopeEditor runs in
`chatMode` (quiet preview). Budgets: 400k per conversation / 2M per account per day in code;
the seeded `agent_settings` row overrides (SQL in the P4 manual), and the budget message now
points at the editor rather than only at a person.

**7 Sep, Tom's pricing rules.** `lib/wizard/allowances.ts reconcileRoomAllowances` is the ONE place
the engine adds its own per-room lines — Colour Match Allowance (tier "fresh") and Ceilings Only
Allowance (ceilings on, walls off) — as rate rows (migration 20270111, Hours Per Item) marked
`allowance` so the customer editor lists them as inclusions rather than tiles; it runs at submit,
in build-tree and after every wizard-edit, so the lines follow the scope. Occupied homes:
`details.occupied` (interior) → `modSel.Staging = STG-OCCUPIED` + a "living there while we paint"
deferral (`applyConditionPricing`). Cupboards: `CUPBOARD_DOOR_INSIDE_BY_ROOM_TYPE` +
`applyCupboardDoorInside` (a flat door side per robe door, `cupInside` lines excluded from the
doors total), `applyCupboardsEverywhere` behind the sweep's two chips, and the room card renders
the interior + door-inside questions. Policy: `asbestos_unsure` is a visit-tier flag;
`guardrailWhy` puts the hand-off reason on the customer screen.

## CRM v2 · Phase 1 — identity, the self-feeding event log, the facts layer (7 Sep 2026)

Source: `docs/briefs/crm-v2-deep-dive.md` (the 7 Sep assessment Tom accepted in full). Phase 1 fixes the
three faults every other phase reads through: identity, the event log, and how lists are computed.

- **Identity is an email OR a phone** (migration 20270120). `accounts.email` is nullable; the constraint is
  `accounts_reachable` (email or `phone_e164`). `phone_e164` is maintained by trigger through the one SQL
  normaliser `phone_e164_au()`. `account_contacts` holds every person on an account; the account's own
  name/email/phone are mirrored in as the primary row by trigger (one-way, so the account stays canonical).
  `crm_find_account(email, phone)` is the one lookup, used by `lib/accounts/link.ts ensureAccount`, which
  now accepts a phone-only enquiry and fills an existing record's blanks (never overwrites).
  `crm_merge_accounts(keep, drop)` re-points every FK generically, fills blanks, logs `account_merged`;
  `crm_duplicate_candidates(limit, account?)` finds pairs by phone / email / address.
- **The event log feeds itself** (20270121). SECURITY DEFINER triggers on `estimates`, `estimate_views`,
  `work_orders` and `invoices` write `estimate_sent · viewed · accepted · declined · lapsed`,
  `job_started · completed`, `invoice_sent · paid` into `crm_events` with dedupe keys; history is backfilled.
  App code no longer has to remember. `crm_lapse_estimates()` expires sent estimates past `valid_until`;
  `estimate_lapsed` is a new event kind and a Today item (`estimate_lapsed`, "chase, re-send, or mark lost" —
  decision 8.11, lapsed ≠ lost). `stage.ts` gained two lanes: `lapsed` and `lost`.
  The append-only guard on `crm_events` allows exactly two updates: an FK unlink (SET NULL when the linked
  estimate/WO/invoice is deleted) and the merge's account re-point under `crm.merge = on`.
- **The facts layer** (20270122). `crm_account_facts` is the CACHED output of `cardFor`/`stageFor` per
  account plus sort keys and counters. Not a stored status: triggers on the source tables mark rows
  `stale`; `lib/crm/facts.ts` recomputes — after every CRM write (one account), for any stale row on the
  page being shown, opportunistically on CRM reads (bounded batch, 30 s throttle), and in full from
  `/api/cron/crm-sweep` (daily; `?rebuild=1` recomputes every row — 27,567 in 3.6 min on C1). The
  Customers tab (list and board) reads it through SQL: search (`pg_trgm`), filter, sort, page, count.
  `crm_board_counts()` / `crm_board_tiles()` give the chips and tiles. A logged call now counts as activity.

Verification: `e2e/crm-p1-facts.spec.ts` (serial, 4 journeys on C1), `lib/crm/facts.test.ts`,
`lib/crm/stage.test.ts`, `lib/crm/work-queue.test.ts`; manual test
`docs/manual-tests/crm-v2-p1-identity-facts.md`.

## CRM v2 · Phase 2 — the customer record (7 Sep 2026)

Source: `docs/briefs/crm-v2-deep-dive.md` §4.1. Migration 20270123 (`crm_update_account`, `crm_set_owner`,
`crm_upsert_contact` / `crm_delete_contact`, `crm_create_account`; the facts trigger learns
`email_logged` / `sms_logged`; and the `crm_account_facts` / `account_contacts` policies rewritten to
`tenant_id = (select public.current_tenant())` — the bare call ran per row and the Customers list hit the
8 s statement timeout at 27k rows).

- **The record** (`app/crm/customers/[id]/page.tsx`): head with tap-to-call phone, mailto email, inline
  edit (`RecordDetails`), owner select; a status line from the cached card; tiles (latest estimate, since
  SENT, won so far, last contact by channel); every estimate / job / invoice / property listed with a deep
  link; `Contacts` (people on the account); `DuplicateBanner` (crm_duplicate_candidates narrowed to this
  account, one-click merge); the timeline. A stale facts row is recomputed before the page shows it.
- **The log sheet** (`app/crm/LogSheet.tsx`): six outcomes + a line + "come back to this" (presets or a
  date). Inline in `CustomerPanel`; a "Log" popover on every Today item. Server action `logContact` writes
  the event and, when asked, the follow-up in one go. Follow-up / snooze take a calendar day
  (`melbourneInstant`, never a hard-coded offset) with presets and a Clear chip.
- **Quick add** (`app/crm/customers/QuickAdd.tsx`): name + phone; `crm_create_account` dedupes through
  `crm_find_account` and owns the record to its creator (decision 8.5).
- **Global search** (`app/crm/Search.tsx` + `/crm/api/search`): the facts `search` column (trigram) +
  estimate titles; ⌘K / Ctrl+K.
- All writes live in `app/crm/recordActions.ts`; shared vocab in `recordTypes.ts` (a `"use server"` file
  may export only async functions).

Verification: `e2e/crm-p2-record.spec.ts` (4 serial journeys on C1); manual test
`docs/manual-tests/crm-v2-p2-record.md`.

## CRM v2 · Phase 3 — the messaging spine (7 Sep 2026)

Source: `docs/briefs/crm-v2-deep-dive.md` §3 F3, §4.2. Migration 20270124: `messages` — every email, SMS,
call, portal message (and later chat summary), in or out, one row with body, provider id, delivery status,
thread and customer; `account_id` nullable so an unmatched inbound is STORED, never dropped.

- **The funnel** (`lib/messaging/record.ts recordMessage`): the two send primitives in
  `lib/messaging/send.ts` (`sendEmail`, `sendSms`) record every send themselves — body, provider id, status
  (sent / failed / not_configured) — resolving the customer from the address through `crm_find_account`
  when the caller passed no `ctx`. So all ~30 send sites are covered; the campaign senders record with
  their `campaign_message_id`. `sendEmail` sets `Reply-To: reply+<token>@REPLY_DOMAIN` when that env is
  set (decision 8.6); `sendSms` passes a `StatusCallback`.
- **Inbound email**: `/api/inbound/messages` (svix-signed, `MESSAGES_INBOUND_SECRET`) — routes by the
  reply token → the thread and customer; else by sender through `crm_find_account`; else unmatched.
  Body hydrated from Resend's API like bills@.
- **Delivery**: `/api/webhooks/resend` (`RESEND_WEBHOOK_SECRET`) updates status by provider id, never
  downgrades (opened stays opened), sets `marketing_undeliverable_at` on a hard bounce and
  `marketing_unsubscribed_at` on a complaint, and writes `campaign_bounced` for campaign mail.
  `/api/sms/status` does the same for Twilio receipts. The SMS inbound route now records every text.
- **Timeline**: the `messages` insert trigger writes `message_in` / `message_out` events (dedupe
  `message:<id>`); the facts trigger reads their channel for "last contact". `estimate_messages` is
  mirrored in by trigger and backfilled. `crm_attach_message` writes the event when a person matches an
  unmatched row and adds the sender's address as a contact.
- **Screens**: the record's Messages section (`app/crm/customers/[id]/Messages.tsx`) — one conversation,
  reply-in-place by email or text (`sendReply`), marks inbound read on open; `/crm/messages/[id]` for an
  unmatched message with a customer search and Attach. Today: `message_unanswered` (inbound with no
  outbound message or logged call after it, due in 4 h) and `message_unmatched` (attach, due in a day) —
  both were registered kinds with no producer since 2A.
- The log sheet's call / email / text outcomes also write a `messages` row (provider `manual`).

Verification: `e2e/crm-p3-messages.spec.ts` (6 journeys on C1, signing its own webhooks);
`lib/messaging/record.test.ts`; manual test `docs/manual-tests/crm-v2-p3-messages.md` (the env to set,
in order: `RESEND_WEBHOOK_SECRET`, then the receiving domain + `MESSAGES_INBOUND_SECRET`, then
`REPLY_DOMAIN` last).

## CRM v2 · Phase 4 — the status model (7 Sep 2026)

Source: `docs/briefs/crm-v2-deep-dive.md` §4.5. Migration 20270125. "More buckets" is five INDEPENDENT
dimensions, not one dropdown: stage (derived, unchanged) · relationship state (stored, staff-set:
active / delayed-until / do_not_contact / lost-with-reason / archived) · per-channel contact permissions
with provenance (`permit_email|sms|phone` + `permit_meta`) · temperature · tags (`crm_tags` registry +
`accounts.tags`). Vocabulary and helpers in `lib/crm/states.ts` (`isQuiet`, `delayEnded`, `stateChip`,
the five ruled lost reasons with their final wording).

- **Rules**: `stageFor` (lib/crm/stage.ts) now takes the state — a quiet state (dnc / archived / holding
  delay) clears every chase flag; a delay whose date passed is awake and needs you; `lost` set by a person
  IS the Lost lane whatever the estimates say. `crm_set_state` clears follow-up/snooze for quiet states; the
  `estimates` insert trigger re-opens a lost customer; either marketing channel declined keeps
  `marketing_unsubscribed_at` set for the guard chain (P5 reads the columns directly). Decision 8.4: a
  declined phone permission hides the "worth a call" prompt, never the number.
- **Today**: `suppressQuiet` drops every item for a quiet customer; `delay_ended` is a derived item from
  `accounts` (state delayed, date passed) carrying the note — no sweep, no stored task.
- **Thresholds in Settings** (`lib/crm/thresholds.ts`, `settings.crm`, Settings → CRM): chase days,
  going-cold, second attempt, past-customer, message/callback overdue hours, after-care, review window,
  repaint years by job type. Read by the facts refresher (`stageFor(facts, now, thresholds)`,
  `repaint_due_at`) and the work queue.
- **Customers**: filters (state incl. "delay ended", tag, owner incl. nobody, temperature, lifecycle
  after-care / review / repaint-due) ride the URL; archived is hidden except in search; saved views live in
  `settings.crm_views` (`app/crm/customers/viewActions.ts`, `ViewSaver`).
- **Record**: `StatusPanel` (state with date/reason/lost-reason forms, permissions with provenance, tag
  toggles + new tag); the status line composes lane · because · state · permissions · tags.
- The unsubscribe page and the SMS STOP/START route write `crm_set_permission` with provenance.

Verification: `e2e/crm-p4-status.spec.ts` (5 journeys on C1); manual test
`docs/manual-tests/crm-v2-p4-status.md`.

## CRM v2 · Phase 5 — campaigns with real rules (7 Sep 2026)

Source: `docs/briefs/crm-v2-deep-dive.md` §4.3, decisions 8.1 (two classes) and 8.9 (cron cadence). Migration
20270126. Manual test `docs/manual-tests/crm-v2-p5-campaigns.md`; e2e `e2e/crm-p5-campaigns.spec.ts`.

- **Audiences are a rule TREE, evaluated in SQL.** `{groups:[{match:"all"|"any", rules:[{field, op, value, not}]}]}`
  — ALL of the groups, ANY/ALL within, NOT per rule; one level deep by design. `lib/crm/fields.ts` is the registry
  (label, type, facts column, operators, option source); `lib/crm/segments.ts` compiles a rule to `{col, op, v}`
  primitives; `crm_audience_where` (plpgsql, column whitelist, `%I`/`%L`) turns them into a WHERE over
  `crm_account_facts`; `crm_audience_count / _sample / _ids / _match` are the only callers. The preview, the
  sweep, the dry run and the send-time guard all go through `lib/crm/audience.ts` — one evaluator, no customer
  loaded into memory (the 2,000-row cap is gone; `lib/crm/loadSubjects.ts` is deleted). Pre-P5 rows carry
  `criteria`; `segmentsStore` translates on read, the next save writes `rules`.
- **New facts columns** for the rules: last_sent_at, last_estimate_status, last_accepted/declined_at,
  decline_reason, job_types (ANY estimate), quoted_cents, dwell_seconds (estimate_views), invoice_state/due_on,
  campaigns_received, last_inbound_at / last_inbound_call_at (they wrote or rang), last_staff_contact_at (a person
  here logged a call/email/text). Stale triggers on campaign_messages (sent) and invoices.
- **Two classes** (`campaigns.class`): `followup` — service messages about a quote they asked for; allowed to
  quoted-not-accepted; four steps max; ALWAYS exits on reply / accepted / declined; skips delayed, lost,
  do-not-contact; exempt from the monthly marketing cap. `marketing` — C9a/C10/C11 as before; quiet states hold
  or exit. Legal confirmation of 8.1 is still Tom's.
- **Entry and anchor.** `entry = audience` (the list, re-asked every sweep) or `event` (`trigger_event` in
  estimate_sent / estimate_viewed / estimate_lapsed / estimate_declined / job_completed / visit_completed /
  invoice_paid, scanned from `events_since`). Enrolments carry `anchor_at` + `anchor_key` (the estimate; '' for
  audience) — unique per (campaign, account, anchor), so a NEW quote starts the follow-up again. Steps carry
  `afterDays` (+`afterHours`) FROM THE ANCHOR and a `condition` (unopened / opened_silent / not_replied /
  not_accepted). Send keys include the anchor.
- **The guard chain** (`lib/campaigns/guard.ts`) is now two halves: `judge` (consent per channel via
  permit_email/permit_sms, relationship state, deliverability, exit rules measured from the anchor, marketing's
  open-work rule, still-in-audience, the step condition) and `guardSend` (= judge + snooze, monthly cap for
  marketing only, C11 window, template approval, human-or-auto). Verdicts say `exit` (enrolment over) or `skip`
  (this step only). The sweep runs `judge` before queuing — a skipped step is written as a stopped row so the
  key is consumed and the enrolment advances; an exit finishes the enrolment and stops its siblings.
- **One delivery path** (`lib/campaigns/deliver.ts`): the queue's approve, approve-all, and the sweep's auto-send
  (`campaigns.auto_send` → `SendPolicy.autoSend`, per campaign, off by default) all call `deliverMessage`. It
  refreshes a stale facts row first, asks `guardSend`, personalises (`lib/campaigns/personalise.ts`:
  first_name / name / suburb / estimate_total / last_job_date / estimator / company), tracks links
  (`lib/campaigns/links.ts` → `/t/<token>`, HMAC, never the unsubscribe link) and sends. An approval outside the
  window is remembered (`approved_at`) and the next sweep sends it inside the window.
- **Analytics** in SQL: `crm_campaign_stats` (enrolled/active/exited, waiting/sent/stopped/failed,
  delivered/opened/bounced from `messages` status via the P3 webhooks, clicked from `campaign_messages.clicks`,
  replied = inbound message within 14 days of a send, unsubscribed = permission declined after a send,
  converted/revenue from `crm_campaign_mark_conversions` — an estimate_accepted after the anchor inside
  `conversion_days`, after a send). `cta_clicked` finally has a writer.
- **Cron**: `campaign-sweep` and `crm-sweep` run every 30 minutes (Vercel Pro from 7 Sep, decision 6.9); the
  chat hand-off sweep (`agent-sweep`, SLA escalations + abandoned guided conversations) every 15 minutes — it had
  never been scheduled. `maxDuration` 300 on the sweeps: a full facts rebuild fits one call.

## CRM v2 · Phase 6 — visits, the Diary, staff Google Calendar (7 Sep 2026)

Source: `docs/briefs/crm-v2-deep-dive.md` §4.6 and the visit-booking brief's rulings. Migration 20270127.
Manual test `docs/manual-tests/crm-v2-p6-diary.md`; e2e `e2e/crm-p6-diary.spec.ts`.

- **`visits`** finally exists: account / property / estimate / estimator, start and end, kind (quote, re-measure,
  colour consult, walkthrough), status (booked, done, no_show, cancelled, rebook), source (wizard, staff, phone,
  assistant), a frozen address / name / phone for the day, outcome, and the two sent-at stamps. Writes go through
  `visit_book` / `visit_set_status` / `visit_move` (staff or service role); the browser never inserts.
  **Double-booking is impossible by constraint** — an EXCLUDE over (staff_id, tstzrange) for booked visits.
- **Events, atomically.** The table's trigger writes `visit_booked` (also on a move / re-book), `visit_completed`,
  `visit_no_show`, `visit_cancelled`. `stageFor` treats a cancel or no-show newer than the booking as no booking;
  the `visit_rebook` work item is derived from no_show / rebook rows with no later booking for that customer.
- **Availability** (`lib/visits/availability.ts`, pure): per-estimator days / hours / visit length
  (`staff_availability`, Settings → Estimator visits) and the global numbers (`settings.visits`: AM/PM windows,
  horizon, cutoff, reminder hour). `offeredWindows` = the zone half-day windows with room left after booked
  visits; `pickSlot` turns a chosen window into the freest estimator's earliest block. The wizard's slot strings
  are now these labels (`lib/visits/wizard.ts`); a chosen label books a real visit via the service client, and a
  window that filled since returns 409 with the list refreshed. A pinned `scope_editor.visitSlots` list still wins.
- **One write path** (`lib/visits/book.ts`): book / move / status → the customer's confirmation with a `.ics`
  (`lib/visits/notify.ts`, automation `visit_confirmation`; SEQUENCE climbs on a move; CANCEL on cancel) and the
  estimator's calendar (`lib/gcal/staff.ts`). The day-before reminder text (`visit_reminder`) rides the 18:00
  wo-sweep, once per visit, cleared by a move.
- **Staff Google Calendar** reuses the contractor design whole: an app-created "Paint Group Visits" calendar
  (scope `calendar.app.created`), a reconciler with claim-before-continue, hash-based patches, self-healing;
  timed events for visits (`insertTimedEvent` / `patchTimedEvent` in `lib/gcal/client.ts`) and, with `push_jobs`,
  the 07:30–15:30 job blocks. Same OAuth client and callback: `/api/gcal/connect?who=staff`, the callback
  branches on the signed-in role; `/api/gcal/staff` = sync / push-jobs / disconnect.
- **Diary** (`app/crm/diary`): day or week, estimator lanes with Done / No show / Rebook / Move / Cancel, then
  jobs running and booked jobs from the work orders, then the calendar card. Booking lives on the record's
  Visits panel (`VisitPanel.tsx`) — the diary is the day view, not a second scheduler.

## CRM v2 · Phase 7 — the scale gate, dark / light (7 Sep 2026)

Source: `docs/briefs/crm-v2-deep-dive.md` §4.7; decision 6.5. No migration. Manual test
`docs/manual-tests/crm-v2-p7-scale.md`; e2e `e2e/crm-p7-scale.spec.ts` + the gate `e2e/crm-volume.spec.ts`.

- **Today at volume** (`lib/crm/work-queue.ts`): every capped source is ordered by its urgency key, oldest first,
  and a read that fills its cap is reported (`counts.truncated`) and shown as an amber line — never dropped
  silently. Quiet states and owners are looked up for the queue's own customers by id (`inSlices`, 120 ids a
  request), not by scanning every non-active account; "delay ended" is its own state-bounded read.
- **Scope and grouping**: `scopeItems(items, "mine" | "all", userId)` — mine = my customers + unowned (decision
  6.5); `groupByAccount` per bucket — one card per customer per bucket, the rest as "also" lines.
- **Badge fast path** (`lib/crm/badgeCache.ts`): a 45 s per-user, per-instance cache the layout, the Today page and
  `/crm/api/badge` share; `?fresh=1` rebuilds; a dismissal forgets it. The layout no longer builds the queue on
  every CRM page.
- **Theme**: `.crm[data-theme="light"]` redefines the palette; every former literal colour is a variable. The
  choice rides the `crm_theme` cookie (server-rendered, no flash) and localStorage; `ThemeToggle.tsx` top right.
- **Onboarding**: "/" focuses search; `docs/help/crm/staff.md` is the first-hour page in the help centre.

## Estimator wizard · Tom's 7 Sep (evening) batch — describe-path questions, the exterior question set, photo sign-off, sign-back-in, the room-name scroll (7 Sep 2026)

Five customer-facing fixes, one branch (`feat/wizard-batch-7sep`), one migration (`20270128_cement_sheet_rate` — a Render clone named `Cement Sheet`, the tilt-slab pattern).
**Describe it asks the form's questions.** `WizardApp.pageKeys` for `entry === "describe"` is Property → Condition (+ damage photos) → Details (flags, occupancy) → Contact for interior/both, Property → exterior Condition → Contact for exterior; the property page keeps its describe short-circuit, the later pages keep their gates. `startChat` uploads the damage photos first (`analyseDamagePhotos`, the run-less route) and posts `answers` (condition, details, customer flags, exterior condition/access, `conditionSourceIds`) to `POST /api/agent/start`, which seeds them onto the agent draft with `seedFormAnswers` (`lib/agent/scope-doc.ts`) BEFORE `propose_diff` and claims the photo rows for the estimate. `proposeFromBrief` takes the worse of the stated damage tier and the paragraph's defects, and no longer assumes the four flags clear when the form answered them; `toWizardState` carries `conditionSourceIds` and `occupied`. `describeFinish` writes the real job type on the lead row.
**The exterior question set.** `state.exterior` grew `targets` (house / fence / floor / deck / shed / wall), `substrates` + `stucco` / `cement_sheet` / `colorbond` / `other` / `none`, `elements` (windows, doors, eaves, fascias, gutters, garage door — one tick each; `painting` stays the derived summary older readers use), `sides` (absent = the full exterior), `shed { substrate }`, `wall { substrate, metres }`, `floor { m2 }` and `fenceType: "metal"`. Every field defaults so stored states parse. `exteriorSurfaceKeys` reads the new fields (`exteriorElements` / `exteriorSides` are the readers). Pages: "What are we painting?" (`PageExteriorHouse`, the house questions appear when the house is ticked), a follow-up page (`PageExteriorScope`) that exists only when something other than the house was ticked, then condition, then extras (pergola, balustrades, paint). The registry gained `stucco` (its own key now), `cement_sheet`, `colorbond`; `WALL_CODES` and the editor's body group know them. `applyExteriorAnswers`: an unticked side arrives `isOption` with `customer.include=false, confirmed=true` (the loop reads NOT PAINTING; no width deferral); a job with no house keeps the four sides as the loop's frame, all skipped; `none` cladding lays no wall line; `other` scaffolds weatherboard + a "wall cladding" deferral; a metal fence is a deferral, never a line at the paling rate (`exteriorExtrasNodes` skips it); a shed is the card's `Shed` row with its cladding on the label; a wall is `Exterior - Wall` at the cladding rate over 1.8 m assumed × the stated or 10 m length; floor coatings are a deferral (no rate row). The submit route flags `requires_site_check` for metal fence / floor / wall / shed / other. The exterior "Answer a few questions" card also clears `noPlan` + `basics` (`entryPatch`), and `showBasics` excludes exterior — the interior bedrooms/open-plan block was riding along.
**Condition photos = estimator sign-off.** `applyWizardAnswers` raises a `photo_review` deferral (`PHOTO_REVIEW_KIND`, `conditionPhotoCount`) for ANY attached condition photo — before, attaching photos removed the only review flag. Both build paths set `requires_site_check` on photos (submit route; `tryBuild`), so the customer cannot accept online. Customer wording: `customerPayload.photosPendingSignOff` + the confirm-on-site line "Your photos are with your estimator…"; the ScopeEditor tier line and the sides editor's `photos` visit reason say the same. Staff: `app/quote/page.tsx` loads `estimateDocuments(…, { includeFacades: true })` → `QuoteBuilder` renders a "Customer photos · Needs estimator sign-off" panel above the areas with the thumbnails and a "Signed off — prep priced ✓" button that removes the deferral (`aiDeferred` is state now) and stamps `builder_state.photoReview`; the save carries both. The work queue has a `photo_review` kind (`buildPhotoReviewItems`: draft estimates whose `builder_state.aiDeferred` contains the kind, due next business morning, group approvals). The AI defect reader still only runs on the plan path and only ever proposes prep lines; the sign-off is the human gate.
**Sign back in after a drop-out.** `lib/wizard/draftOwner.ts`: `findOpenDraft` looks up the open `wizard_drafts` row by `user_id`, else (verified email only) by the member's `account_id`s or the draft's normalised email, 30 days; `adoptDraft` re-keys `user_id` to the signed-in user so autosave/heartbeat keep the same session — nothing else on the row changes. `/estimate` uses it for the resume (`serverResumeFrom` takes a max age); portal Home uses it read-only and lists the walk as a "Not yet submitted" card (`portal-unsubmitted-estimate`) linking to `/estimate`; wizard-built drafts in the list are tappable ("Keep shaping" → the editor). The sweep (`sweepWizardSessions`) now emails a sign-in link landing on `/account` on the FIRST drop of a session (the CRM event's dedupe key decides), only with an email on the row, never to a test address, behind the `wizard_abandoned` automation (now `automatic`, email, templates `wizardResumeSubject/Body`, placeholders company_name / where / page). Idle threshold stays `IDLE_MINUTES = 45`.
**The room-name scroll.** `app/estimate/scope/scrollCard.ts` — `scrollCardToTop` measures the sticky stack (`.sc-freeze` / `.sd-top` / `.wz-top`) and scrolls the card's HEADER under it; `openAndScroll` (ScopeEditor) and `openNext` (SidesEditor) use it instead of `scrollIntoView({ block: "center" })`, which centred a card taller than the phone and pushed the name above the header. `scroll-margin-top` on `.sc-rc` / `.sd-card` matches the measured stack.
Tests: `lib/wizard/exteriorTargets.test.ts`, `lib/wizard/photoReview.test.ts`, `e2e/customer-journey/tom-batch-7sep.spec.ts` (the five, as an anonymous customer + staff); the four exterior specs follow the new page order. Manual: `docs/manual-tests/wizard-batch-7sep.md`.

### Same evening, Tom's follow-ups (7 Sep 2026, late)
- **No "built before 1970" question anywhere in the wizard** — interior Details, exterior Condition, the describe path, the assistant's flags question and the brief build's "assumed" chip all drop it; the office finds the build year. `customer.builtPre1970` stays in the state as `"unsure"`; `evaluateGuardrails` no longer hands off on `unsure` + damage 3 (`lead_paint_possible` is gone). A definite `"yes"` (staff, the assistant) keeps the lead-paint hard stop.
- **Commercial properties** (`customer.propertyKind === "commercial"`, the Commercial chip or the homepage's business hand-off) skip "Anything else out there?" — the exterior page list is Property → What we're painting → (follow-ups) → Condition → Your details.
- **The water/oil paint question** (and its oil-trim follow-up) is interior-only and never shown for a commercial property (`PagePaint.askBase`).
- **The Proving window "stopped pulling in jobs"**: `/proving` measures `builder_state.wizard.snapshot`, which only the form's submit route wrote; every describe / chat build showed as "pre-snapshot" and never counted. `withWizardSnapshot` (`lib/agent/scope-tools.ts`) now freezes the first price + accuracy + guardrail verdict on the assistant paths (`propose_diff`, and any `answer_gap` that builds), once, with `submittedAt`. Estimates built by the assistant BEFORE this change have no baseline and stay "pre-snapshot".

## Estimator wizard + builder · Tom's 8 Sep (evening) batch — sides by name, runs by the metre, the notes box, "book in your estimator" (8 Sep 2026)

Twelve items from two messages, one branch (`feat/wizard-batch-8sep-b`), **no migration**. Manual walk: `docs/manual-tests/wizard-batch-8sep-evening.md`.

**Gutters and fascias twice per side.** `TWICE_OK_CODES` (`lib/wizard/sides.ts`) is now `Eaves | Gutters | Fascias`, with `SECOND_ROW_LABEL` naming both rows `(lower)` / `(upper)` — a two-storey elevation has a lower run and an upper run, each measuring on its own. `SidesEditor.sideAddGroups` reads the same set instead of its own `o.key === "Eaves"` test, so the panel and the server can never disagree; a third row still refuses ("already on this side twice").

**A side takes the customer's name.** `applySideRename` sets `customerLabel` AND rewrites the block name to `Exterior - Left (Courtyard)`, so the quote, the work order and the job sheet all read the customer's word with no change to their renderers. `sideBaseName` (everything before the first `(`) is what `isSideBlock` / `findSide` match on — that is what stops "Right of the shed" on the LEFT side from answering `findSide("right")`. `SideView.label` prefers the custom name (so "Confirm courtyard ✓" and the add panel follow), `customLabel` carries it for the rename box. Route action `rename_side`; empty string restores the default.

**Metres on a lineal run.** `applySideMetres` pins `measureL`, which `computeQuantity` reads before it falls back to the elevation's length — so 6 m of handrail on a 14 m side prices as 6 m. `linealCodes(rateItems)` (unit `Lineal Metres`) drives a `.sd-mseg` box on every lineal tile: empty reads *follows this side*, stated reads *you told us*, cleared hands it back. `syncWallMeasures` only ever touched wall lines, so a later size change leaves a stated run alone; walls refuse metres and keep their %-of-wall control. Route action `side_metres`.

**A side nobody asked for never reaches the estimate** (Tom: "it gave me the right side as an option in the estimate — this shouldn't have been in there"). `applyExteriorAnswers` used to mark an unticked side `isOption` + `include:false, confirmed:true`, which the quote then carried as an exclusion. It now **removes** those areas (recording them in `merged.skipped`), under two floors: a house job never loses every side, and a no-house job (fence / shed / wall only) keeps the four as the loop's frame exactly as the 7 Sep ruling set it up. A side the customer OPENS and skips in the loop still reads NOT PAINTING — that is a decision, and the quote should carry it. `sidesDoneCount` therefore counts the sides that EXIST plus the four whole-job checks instead of a fixed 8, and the house diagram greys a missing edge (`.sd-edge.gone`).

**…and the AI now knows which sides were named.** `briefExtractionSchema.exterior.sides` is new, with rule 5 in `EXTRACT_SYSTEM` ("a side that is not named is not painted"; unstated stays null). The rule-based reader is deliberately timid — it only reads sides when the text is plainly about elevations (`sides?`/`elevations?`, or a front…back pairing) and a "whole outside" phrase stops it dead — because a bare "left" in prose must never narrow a job; it also cannot read a negation, which is why the real path runs through the model. `proposeFromBrief` carries them onto `draft.exterior.sides` (with an `ext.sides` fill-in, and `sides.all` suppressed), co-work only includes the named sides, `toWizardState` passes them through, `applyAnswer` gained an `ext.sides` key, and the question graph asks "Which sides are we painting?" before the build (after it, the loop's own skip is the way to drop one).

**The optional notes + photo box, per side.** `applySideNote` stores `customerNote` + `customerPhotos` on the block; `SideNote.tsx` collects the text and uploads photos the same way the wizard's own condition photos go (signed upload URL → `/api/extract/photos` with `estimateId`, kind `defect_photo`), so they land in the Plan & photos panel and the estimator's photo sign-off. Neither prices anything: the route raises one `side_note` review line per side (replaced, not stacked, when the note is edited).

**"Book in your estimator."** `ReachStrip` leads with the offer and each action carries an inline-SVG icon tile that fills cyan on hover/open; the office hours sit under the Call us button, wording from **Settings → Company details → Phone hours** (`company_profile.phoneHours`, falling back to `DEFAULT_PHONE_HOURS`). The call-back form arrives with the customer's own mobile in it (`customerPhone` = `builder_state.wizard.state.contact.phone`, threaded through `loadCustomerScope` → both editors → `ReachStrip` / `ContactCard`) and stays editable.

**The finalise button is never dead** (Tom: "make it clear… that they can click it before they have clicked all the details"). Exterior: `.sd-cta` is enabled throughout with a `cta-hint` line naming what is left. Interior/both: the same, and R3's rule still holds where it matters — until every card is confirmed the tap opens the contact/visit flow rather than **accepting** a fixed price against an unconfirmed scope.

**Fit to screen.** Two things, and the second was the real one. Sideways: every fixed width under `.wz` is bounded by `min(100%, …)` — the wraps, the sticky rows, the tile grids, the house SVG, inputs. Deliberately **not** `overflow-x: hidden` on `.wz`: that hides the symptom, breaks `position: sticky` inside it, and would make the guard pass vacuously. Downwards: the sticky footer is `position: fixed`, so it takes no space in the flow and whatever is at the bottom of the page sits under it permanently — `.sc-wrap` papered over that with a guessed `padding-bottom: 170px` and **`.sd-wrap` had none at all**, which is why the exterior editor's last card was always buried. `useStickyRoom` (a `ResizeObserver`, one custom property, no state) publishes the footer's real height as `--wz-stick-h` and both wraps derive their bottom padding from it, so the reservation follows the footer as it grows (the reach strip, the "you don't have to finish first" line, an open call-back form). `e2e/customer-journey/tom-batch-8sep.spec.ts` asserts, at 320 / 375 / 768 / 1440, that the page does not scroll sideways (naming the offending element) and that the last card clears the footer once scrolled to the bottom.

**The chat bubble on the website.** The chat's CSS moved out of `wizard.css` (where it was scoped under `.wz`) into `app/wizard/chat.css` with its own palette, imported by `ChatWidget` itself. `ChatWidget` gained `place` and `ensureSession`: given the latter it renders before `ready` and signs the visitor in on the FIRST TAP, so a marketing visitor who never opens the chat never becomes an anonymous user. `app/(marketing)/_components/SiteChat.tsx` supplies that through the wizard's own `establishSession` (bounded retries + deadline) and the layout mounts it. One localStorage key means a question asked on the homepage and an estimate started afterwards are the same conversation.

**A customer's own item, in the staff builder** (Tom: "security bars… hasn't been mentioned anywhere as an unpriced option for me to pick up"). `customerCustom` was written by the online estimate and read by nothing a person could see. `QuoteBuilder` now renders an amber `customer-asks-panel` above the areas listing each one with its area, an *Add a line on <area>* button (opens the surface picker there) and *Priced / not needed ✓* which clears it and its `custom_surface` review-gate entry. Until then the send gate still refuses to let the estimate out unnoticed and the customer cannot accept online.

Tests: `lib/wizard/sides.test.ts` (+5), `lib/wizard/exteriorTargets.test.ts` (rewritten for the new ruling, +1), `lib/agent/propose.test.ts` (+2), `e2e/customer-journey/tom-batch-8sep.spec.ts` (4 — the controls, the reach strip, fit-to-screen with screenshots, the website bubble) and `e2e/customer-asks-panel.spec.ts` (1, as staff). Three existing specs asserted the two rulings this batch reversed and were updated: `sides-editor` (CTA disabled), `interior-loop` + `both-stacked` (`.il-cta` disabled), `reach-and-chat` (`.sc-btn.il-cta` disabled), `exteriorTargets` (the unticked-side option). `doors-tiles-steppers` read a tile's label off its last text node, which the metres control displaced — the tile name now has its own `.sd-tlname` element.

## Estimator journey v2 · Phase 3 — coats and preparation derived per surface (9 Sep 2026)

From Tom's brief of 9 Sep (`docs/briefs/estimator-journey-v2-plan.md`, §4.2 and §9.3),
built on `feat/paint-systems-derivation`. **No migration** — the table is a `settings` row.

**The gap.** The wizard asked the customer to pick coats for the whole job, from a card
that said "1 COAT / 2 COATS / 3 COATS", and `coatsFor(tier, isDarkToLight)` stamped that
one number onto every surface in the tree. Coats differ by surface — new-colour walls
need two, a white-on-white ceiling usually one, enamel trims two plus preparation — and a
homeowner cannot judge that. The plan calls it the single biggest accuracy gap (§2.2).

**The shape.** `lib/pricing/systems.ts` is a pure lookup: `deriveSystem(group, answers,
table)` over five surface groups (walls · ceilings+cornices · trims · doors · windows)
× three colour intents (same · new · bold), with the condition band and three flags on
top. It returns coats, an undercoat flag, prep hours per unit, the customer-facing
sentence, the painter's crew note, and a `review` flag. `systemsForSurfaces()` is the
body of the paint-systems screen phase 4 will render.

- The customer answers **colour intent** and **condition**; nothing else changed in what
  is asked. `condition.tier` keeps its stored values (`fresh|change|dark_to_light`) —
  `colourIntentFromTier` maps them to `same|new|bold`, so every snapshot, seed and replay
  fixture still parses. The field is now documented as the colour question it always was.
- **Exterior is deliberately excluded.** `groupForSubstrate` returns null for every
  exterior substrate and for `staircase`, and those surfaces keep the whole-job coat
  count. Plan §4.4: the per-elevation allowances spec does not exist yet, so deriving
  exterior systems would be inventing unvalidated numbers.
- **Two rules override Settings.** A single coat is only reachable where that surface is
  not changing colour (allowances spec §7.6) — enforced in `deriveSystem` AND in the
  Settings UI, so a mistyped "1" cannot ship a job that will not cover. Coats stay
  *effective labour coats*: an undercoat or bonding primer is +1, priced by the card's own
  marginal-coat rule. Nothing touches `coatMultiplier` or the card's 1-coat column.

**Where it is wired.** `applyWizardAnswers` takes the table as an optional 4th argument
(defaulted, so every caller still compiles); `app/api/wizard/submit` and the wizard-edit
route pass the live settings row. `lib/agent/scope-doc.ts` re-coats per group after a
colour-intent change instead of stamping one number on every row.

**Settings → Estimates → Paint systems** (`PaintSystemsSettings.tsx`, `paint_systems` row).
Every coat count, both judgement calls, the gloss switch and the prep hours are Tom's,
editable without a deploy (⚑2).

**⚑ rulings applied** (Tom, 9 Sep — "use your suggestions, flag them"): ⚑3 ceilings one
coat white-on-white, "they're marked" is the two-coat tap · ⚑4 same-colour trims two
coats, one only when condition is good — note this **contradicts §4.2's own table**
(which says one coat); ⚑4 is the later explicit ruling and is what ships · ⚑5 the gloss
question is asked, "not sure" is the default, prices as no and sets `review`.

**Prep hours default to ZERO** on all three bands. Prep already reaches the tree from
`defect_prep_rates` (the photo pipeline) and the manual stepper; a non-zero default here
would silently reprice every job the day it shipped. The band has a home now; the numbers
wait for ACTUALS — work-order hours × charge-out plus materials. NOT the proving
window: it benchmarked the wizard against PaintScout quotes that themselves lost
money (Tom, 8 and 9 Sep 2026), so it is not a baseline to set prices from.

**What it moves.** `scripts/paint-systems-impact.ts` prices a 3-bed single-storey interior
both ways on the golden rate card (reads only, no database). Same colours +17% to +25%
(trims 1→2 coats), new colours −2% (ceilings 2→1, offset by trims 2→3), bold +26%.
Run it before turning "fix online" on.

**Traps.** `coatsFor` is still exported and still correct — it is the exterior and
unmapped-code path, not dead code. Adding the two ⚑3 answers to `condition` broke four
object literals that build a state by hand (they are `z.default`s, so only TypeScript
noticed); `defaultWizardState()` is the one to copy. Two existing tests asserted the old
"one number on every row" behaviour (`merge.test.ts`, `propose.test.ts`) and were
rewritten to the per-group rule rather than deleted — they are the record of the change.

## Estimator journey v2 · Phase 4 — the paint-systems card (9 Sep 2026)

Branch `feat/paint-systems-screen`, stacked on phase 3's `feat/paint-systems-derivation`.
**No migration.** Plan §3 and §4.2; prototype screen 8.

**Why it exists.** Phase 3 stopped asking the customer to pick coats and derived them per
surface instead. On its own that trades a question they could not answer for an assumption
they could not see — worse, not better. This card is the other half: it shows what was
derived, in the painter's own words, with one tap per line to correct it.

**`lib/wizard/systems-view.ts`** is the whole surface, and it is pure:
- `systemAnswersFromState` — the ONE reader of the customer's answers, now shared by
  `merge.ts` (which stamps the coats), the view (which explains them) and the editor
  action (which re-derives after a correction). Three copies would be three chances for
  the screen to describe a system the tree does not carry.
- `paintSystemsView(state, blocks, table)` → one `PaintSystemLine` per group, each with the
  sentence, the coats, the chips that can move it, `review`, and the reason the coats
  differ from the plain table cell.
- `applySystemPatch` → the corrected answers. `applyPaintSystems` → the re-derived tree.

**Three rules the module keeps**, each with a test:
1. **Groups come from the TREE, not the wizard's ticks.** By the editor the customer has
   already added and removed surfaces; a ceilings line on a job whose ceilings were removed
   is a lie, and the tick list would still say yes.
2. **Interior only.** An exterior-only job gets no card at all rather than numbers nobody
   validated (plan §4.4).
3. **A correction re-derives the WHOLE tree.** Colour intent is job-wide: "same colour
   actually" on the walls has to move the trims too, or the estimate holds two answers to
   one question.

**The route.** `set_paint_system` posts a FIELD and a VALUE — never coats. The customer
cannot post geometry or money here any more than anywhere else on this route; the server
re-derives from Tom's Settings table. The snapshot is written before the tree is re-derived,
so a room added later merges at the corrected answer (the rule `set_door_style` follows).
`paintSystems` rides EVERY response, not only a `set_paint_system` one — removing the last
ceiling has to remove the ceilings line, and that arrives as a `toggle_surface`.

**Traps.**
- Nesting a `z.discriminatedUnion("field", …)` inside `actionSchema` via `.and()` collapses
  the outer `action` discriminator and every `act.` narrowing in the file breaks. The posted
  shape is flat; `systemPatchFrom` pairs field to value and returns null (a 400) rather than
  coercing — a customer who taps a chip and sees nothing move has been lied to.
- The crew note is REPLACED, not appended. This runs on every correction, so appending grew
  "check the trims | check the trims | …" on a second tap. `stripSystemNotes` removes only
  the notes this module writes, so a note from anywhere else survives.
- "That's right" on the ceilings clears BOTH ceiling flags. Clearing `ceilingsMarked` while
  leaving `ceilingsChangingColour` set would keep the line at two coats and make the card
  argue with itself.
- Changing colour intent away from bold clears `darkToLightSurfaces`. That list belongs to
  the old per-surface question; leaving it would lift surfaces the customer just said are
  staying the same.
- The card is hidden in `chatMode` like the other question cards — the assistant asks these
  in conversation, and a pane of open questions beside the chat repeats it.

### Per-surface condition flags (Tom, 9 Sep 2026)

Tom: *"what if the doors need 3 coats because they're all stained, but the rest are 2?"*
Every correction on the systems card was job-wide (colour intent) or a single yes/no; nothing
let a customer say one surface GROUP needs more than the rest.

The fix is a **condition flag per group, not a coat picker** — plan §4.2 says the customer
never picks coats, a picked "1" over a colour change is a warranty claim (§7.6), and a number
tells the painter nothing that "they're stained" doesn't tell them better.

`SurfaceFlagRule` is a Settings-editable catalogue: the groups a flag applies to, a floor
and/or ceiling on the coats, whether the extra coat is a primer, the customer's sentence and
the painter's note. Answers live at `condition.surfaceFlags` (`{ doors: ["stained"] }`).
Shipped: stained · bare timber · new plaster · marked (⚑3) · sound (≤ 1 coat, sets `review`).

**⚑3's marked ceiling became one of these** rather than staying its own branch, so the
ceilings card and the doors card cannot drift apart. `ceilingsMarked` remains the stored field
the chip writes and is folded into the flag set inside `deriveSystem`; `ceilingsMarkedCoats`
still owns its number.

**Traps.**
- Flag keys are deliberately NOT validated against the catalogue in the zod schema. Tom can
  add or rename a flag in Settings without a migration; an unknown key stops applying rather
  than 400-ing somebody on a stale page.
- The catalogue falls back **whole-list**, not per flag: a half-parsed list would offer the
  customer taps that price nothing.
- `addNote` — crew notes ACCUMULATE. ⚑5's gloss note used to overwrite, so a stained door on
  a job with possible oil gloss reached the painter told to bond-prime and not to stain-block.
  De-duplicated, so re-derivation cannot grow them.
- Removing a group's last flag deletes the key rather than storing `[]`: absence reads as
  "not asked", `[]` as "asked and answered none", and the CRM and work order read this state.
- Adding `surfaceFlags` to `condition` broke seven hand-built state literals (zod defaults, so
  only tsc caught them) — the same trap the two ⚑3 fields sprang. Copy `defaultWizardState()`.

## Estimator journey v2 · Phase 4b — flagged spots as repair lines (9 Sep 2026)

Branch `feat/paint-systems-screen`. **No migration** — the rates table
(`defect_prep_rates`) and the photo pipeline already existed.

**The gap** (plan §2.3): condition was ONE global answer for the house, and "needs repair"
opened a free-text box the engine could not price. Nothing pinned a defect to a room, so the
commonest thing a customer knows — "a water mark on the hall ceiling, a crack behind the
kitchen door" — arrived as prose an estimator had to re-read and re-price by hand.

**`lib/wizard/spots.ts`.** A spot is a photo and a tag. The tags are the CUSTOMER'S words for
defect types the platform already has (`lib/extract/photos.ts` `defectTypes`, priced by
`defect_prep_rates`) — a relabelling, never a second list, so the plan reader's `water_damage`
and the customer's "Water mark" price identically. The repair line uses the plan reader's own
shape: its own surface row on the room, hours on `prepHr`, `assumedFields: ["prep"]`. Prep
hours are charged at charge-out whether or not the code matches a rate row, so this needed no
new rate rows.

- **⚑6 lives in `AUTO_PRICED`** and nowhere else: a crack and a nail hole auto-price (their
  repair is genuinely standard); everything else is recorded, shown, and left for a person.
- **Severity is always 1.** A customer cannot judge severity and should not be asked to; 1 is
  the honest floor and the estimator raises it on the photo.
- **The line is created whether or not it prices.** A spot that became only an amber note in a
  queue would be the free-text box again, wearing a tag. An auto-priced tag with no rate row
  is not silently free — it raises the same "needs pricing" deferral the plan reader raises.
- Per-room condition (`same | better | worse`) is not a second condition band: the job's band
  still sets the paint system. Only "worse" raises a deferral, and changing back to "same"
  clears it rather than leaving a stale one.

**A bug this found in existing code.** Prep lines fell through `customerRoomView`'s catalogue
branch and rendered as ordinary surface TILES with a count stepper — inviting the customer to
order "3 water damages". That was already true of the plan reader's photo-read defects before
this work. `isPrepLine` now excludes them from tiles and surfaces them as `room.spots`
instead, so the reader's defects and the customer's spots are one list of repairs.

**Traps.**
- `RoomSpots` MUST pass `estimateId` to `/api/extract/photos`, or the photo row is written
  with `estimate_id` null and nothing ever sets it — the orphaned-photo bug that left 92 rows
  unreachable (R5).
- A failed photo upload still records the spot. The customer told us something true about
  their house; the photo is evidence, not the point.
- `remove_spot` refuses anything whose label is not `Repair — …`, so the action can never
  become a way to delete a painting line the customer is meant to untick. Removing a spot also
  drops its deferral, or the estimator chases a spot that no longer exists.
- There is deliberately **no `spotLabel()`**. The card reads a spot's name off the line
  (`customerRoomView` strips the prefix), so the customer sees the word they tapped. Two ways
  to name a spot is two ways for them to disagree — the same rule `roomDoorScope` follows.
- "wallpaper" is the one tag with no row in the defect vocabulary — stripping paper is work,
  not a defect. It is review-only, so it never tries to auto-price, and the unmatched code
  takes the engine's no-rate-item path (prep hours charged, nothing else, cannot throw).

## Estimator journey v2 · Phase 5a — site and access (9 Sep 2026)

Branch `feat/paint-systems-screen`. **No migration, and no multipliers.**

**The gap** (plan §2.4): interior access was **never asked**. Stairwells, voids, furniture,
floors, parking and lift bookings had no home in the flow, so the things that decide how long
protection and packing down take had no bearing on the price at all.

**Why there are no numbers in `lib/wizard/site-access.ts`.** The plan says this screen is the
allowances spec §4's four modifiers "verbatim", and §9.1 gates the phase on that spec being
merged. **It is not in the repository.** Writing four multipliers would be inventing prices
nobody has validated — the same thing the exterior derivation was refused for.

So it follows the pattern `applyConditionPricing` already set for weathered exteriors and
occupied homes: each answer names a MODIFIER CODE, and

- if Tom has seeded that modifier (Settings → Pricing → Modifiers) it applies, at his multiplier;
- if he has not, the answer becomes an **amber deferral naming the code to seed**.

Never a silent no-op, never an invented number. The questions can be asked today and start
pricing the moment Tom sets a multiplier, with no deploy.

**Only answers that imply extra work raise anything.** "The rooms will be cleared", carpet, a
driveway and "no pets" cost nothing and must not flag — a screen that flags every answer
teaches the estimator to ignore the flags. Pets are a crew note, never a price.

**Ceiling height and asbestos are deliberately NOT on this screen**, though plan §4.4 lists
them: height is already the details card's `confirm_height` question and asbestos is a hard
stop the policy ladder owns. Asking either twice invites two answers. The e2e asserts their
absence.

**Traps.**
- One selection per modifier GROUP wins (`jobModifier`), so staging and access are separate
  groups and "part cleared" cannot collide with "furniture stays".
- Re-answering **clears the previous note and modifier before re-applying** — the handler
  strips every `SITE_ACCESS_DEFERRAL` and both groups from `modSel`, then re-derives from the
  whole answer set. Changing back to "the rooms will be cleared" must not leave yesterday's
  flag behind.
- Hard and mixed floors share a code and a reason; `because` is de-duplicated.
- The chip lights optimistically, so a pressed chip does NOT mean the save landed. An e2e that
  reloads must first wait for `.sd-saving` to clear, or it races the last write.

## Estimator journey v2 · Phase 5b — the whole-job extras sheet (9 Sep 2026)

Branch `feat/paint-systems-screen`. **No migration.** Plan §4.5, §9.5.

**The gap** (plan §2.5): extras were never asked. "Anything else" was flagged and never priced,
so mould treatment, a ceiling rose, a stain or varnish job and a colour consult fell out of the
estimate entirely.

**§4.5's rule, verbatim: named extras price; unusual ones flag.** Those are the only two
outcomes, and they are deliberately different controls so the customer can see which is which —
the listed ones show a price and move the range, the sentence shows none and says so.

- **The list is derived from the rate card**, reusing `interiorAddOptions`' judgement about what
  a customer may add and what another control owns (cabinetry, allowances, style variants)
  rather than restating it. Nothing is hardcoded: add a row tomorrow and it appears. A row with
  no charge-out is dropped — it cannot be presented as a price, and a tick that cannot price is
  a lie.
- **The note is never priced.** `extraNoteDeferral` returns the amber note and says so in the
  words the estimator reads ("not on our card, so it is NOT priced"). Re-raised from scratch, so
  editing the sentence replaces the note instead of stacking a second.
- **"Help me choose the colours"** is not a rate row and never was — it rides
  `paint.colourHelp = "advice"`, the field the CRM already reads to raise a colour-advice
  follow-up (1 Sep). The sheet is a second way in, not a second field.

**`toggleExtrasItem` was generalised, not copied**, to take a side. An interior extra priced in
the `Exterior - Extras` block would be charged at the exterior rate and read as an exterior line
on the customer's estimate. `EXTRAS_BLOCK` now matches either, and the exterior default keeps
every pre-phase-5 caller unchanged.

**What is ON is read off the TREE**, not from a stored list, in both the loader and the
response — an estimator who removes an extras line in the builder must see the sheet agree with
them.

**Traps.**
- The card renders even when the rate card carries no extras rows: the "something else" box is
  exactly what a card cannot cover.
- The e2e asserts the MECHANISM, not a row. A test hardcoding "Ceiling Rose" would fail the day
  Tom renamed it and pass the day the sheet broke.

**The finish line** (§9.5's third item) already existed before this phase — the policy ladder's
CTA (`selfServe ? "Accept estimate" : "Finalise my price"`), "Book a site visit" and "Request a
call back" on the reach strip. Nothing was rebuilt.

## Estimator journey v2 · Phase 6 — remote confirmation (9 Sep 2026)

Branch `feat/paint-systems-screen`. **No migration.** Plan §5, §9.6, ⚑7.

**The gap.** `accept_intent` has always written a prep pack and pushed a deferral, and raised
**nothing on Today**. The customer was told a person would confirm their price; no person was
ever told. This is the plan's whole "how jobs get quoted without being looked at" (§5), and it
had no estimator-facing surface at all.

**⚑7 — the door** (`remoteConfirmVerdict`, `lib/wizard/policy.ts`): interior only, ≤ $12,000,
both Settings values on `wizard_policy` so widening is a business decision Tom makes with fifty
jobs of evidence, not a deploy. A job that FAILS ⚑7 is not dropped — the desk check still
happens and its recommendation becomes a visit. Somebody still looks at every job; they just do
not always drive to it. That is the difference between this and self-serve.

**The pack** (`lib/wizard/desk-check.ts`, pure) assembles what already exists into the order a
person decides in: can I fix this at all (⚑7) → what is still open → what did they say is wrong
(spots + photos) → what did we assume (systems) → what makes it slower (access) → the tree. It
invents nothing and duplicates nothing; the total is passed IN because pricing is the engine's
job and this must never become a second opinion about money.

**The page** `/quote/desk-check?id=` is deliberately READ-ONLY, and the three outcomes §5 names
are links to the flows that already own them: prices change in the builder, questions go to the
thread the customer is already in, visits go to the visit flow. A fourth place to change money
would be a fourth place for it to go wrong. `recommendedOutcome` highlights one and nothing
more — a recommendation that could not be overridden would be self-serve wearing a person's name.

**The queue.** A new `desk_check` work-item kind, built from estimates carrying the prep pack.
Adding it forced classification in all three registries (weight, filter group, Today's tag) —
the "one source of truth for every list and badge" rule doing its job.

**Traps, all found by the e2e.**
- `estimates.total_inc_cents` **does not exist** — it is an *invoices* column; the estimates one
  is `total_cents`. Selecting the wrong one makes the query error and the surface show nothing
  at all, silently, in both the queue and the page.
- The page prices the tree **LIVE**, so a stored `total_cents` does not drive its verdict. A
  test that seeds a big number and expects the over-cap path is testing nothing; the TREE has
  to be over the cap. The queue uses the stored total to order itself and says so.
- The route sits under `app/quote`, so it inherits that segment's "Loading estimate…" state and
  streams. An e2e must wait for the page's own testid, not for `goto`.
- `wizardStateSchema` refuses a state that neither uploaded a plan nor took the quick basics, so
  a seeded snapshot has to look like a real run. The page's polite "wasn't built in the wizard"
  holding is the correct response to one that does not.

## Estimator journey v2 · Phase 7a — commercial segment and routing gates (9 Sep 2026)

Branch `feat/paint-systems-screen`. **No migration, and no pricing.** Plan §9.7;
`docs/briefs/commercial-pricing-strategy.md`.

That brief's own sequencing, kept: **"First — routing, no pricing."** `lib/wizard/commercial.ts`
decides who gets seen and captures why; it touches the pricing engine nowhere and contains no
dollar figure. The sector bands and per-segment caps are a later step and need `commercial_rates`
data this repository does not have.

**The segment question** replaces the 8 Sep "what sort of commercial job" for anyone answering it
now: office · hospital/aged care/medical · strata · industrial · shop front · other. One answer
that selects the sector band, the substrate set and which gates matter.

**The gates.** Seven yes/no questions; **any single one sends the job to an appointment — no
scoring, no override.** A gate is not a risk weight to balance against a good lead; it is a
statement that we cannot price this from a form. The brief's principle: *price online where the
variables are bounded, and refuse to guess where they aren't.*

- **Two segments trip before a question is asked.** Healthcare is the brief's regulated-environment
  gate and strata its owners-corporation gate; asking a customer to self-declare either is asking
  them to talk us out of visiting.
- **An unanswered gate is never a "no."** A blank is the least bounded answer there is, so an
  incomplete set cannot price online — but it is not "tripped" either, and says so differently
  ("some of the site questions aren't answered yet" vs "we'll need to see this one").
- **The page is not blocked on the gates**, only on the segment. The brief says capture everything
  they have already told you and don't throw it away because you can't price it.
- The 8 Sep `commercialKind` answer stays as the fallback for every session that predates the
  segment question and for the assistant, which does not ask it. Two routes to one decision is one
  too many, so the gates win wherever they exist.

**A gap the e2e caught.** The gates routed correctly but `guardrailWhy` had no wording for the new
reason codes, so the customer got the generic handoff line. The brief is explicit that a gate must
SAY WHY — "we'll need to see it" with no reason reads as a brush-off, and a facilities manager who
knows exactly why we are coming will trust us more for saying it. Every gate now has its own line,
and a unit test asserts a WHY exists for every code the ladder can raise.

**Still blocked: the exterior quick look**, §9.7's other half. It needs the per-elevation
allowances spec (§4.4, §8), which is not in the repository — the same gap that has held exterior
work out of phases 3, 4 and 5.

## Estimator journey v2 · Phase 8a — trade saved specs, and ⚑11 (9 Sep 2026)

Branch `feat/paint-systems-screen`. **No migration.** Plan §7, §9.8, ⚑11.

**Most of §7 already existed.** The trade portal v2 work (merged) built the property spine,
the timeline, approvals, money and the colour register (`colour_records`); one-tap rebook and
the saved-property list were already on `/account/new-estimate`. What was missing was **saved
specs** — and they had been deliberately declined, in a comment on that very page: *"rebook
covers the end-of-lease-in-2-minutes promise without a second store of specs."*

**That decision is reversed, and the comment now records why.** They answer different questions:

- **Rebook** is *"this property again"* — the whole prior job, rooms included, because the rooms
  have not moved.
- **A spec** is *"this way of working, somewhere new"* — the answers only. Its rooms come from
  the new address, which is the entire point.

So it is not a second store of the same thing. `lib/wizard/saved-specs.ts` holds **no tree and
no price**: storing a tree would make a spec a copy of one job rather than a way of working, and
would also be a way around the boundary this codebase keeps everywhere else (the client posts
answers, the server rebuilds the tree, the engine prices it).

**Storage is `accounts.flags.savedSpecs`** — the jsonb column that already holds `flags.unlimited`.
No migration: a trade account has a handful of specs, not a table's worth. `flags` is now selected
in `getPortalContext`, so the portal needs no second query.

**The colour policy is a NOTE and is applied to nothing.** The per-property colour register is the
machine-readable answer; a second source for the same question is how two of them come to disagree.

**⚑11 — "trade self-acceptance: never in v1."** The existing relaxation only forced a visit for a
trade job that would *otherwise* have handed off; a plain trade interior under the cap could still
accept its own price online. Every trade job now takes the visit tier. The price still shows as a
range — the ruling is about acceptance, not visibility. Volume is exactly what makes a trade
account worth having and exactly what makes an unchecked price expensive: the same wrong
assumption goes out forty times.

**A bug the e2e caught, and the reason to write it.** `?spec=` parsed the seeded state with
`wizardStateSchema`, whose cross-field rules a *submittable* state must pass ("upload a floorplan,
or choose the quick basics instead"). A seed has not been near those questions, so the parse
failed silently and the customer got the defaults — specs would have shipped doing nothing at all.
It now uses `wizardStateShapeSchema`, the same choice `showcaseSeed` makes for the same reason.

**Traps.**
- `account_users` keys on **`profile_id`**, not `user_id`.
- `/estimate` treats a signed-in user as a MEMBER only when `profiles.role === "customer"`;
  without it `?spec=` and `?rebook=` are both ignored and the wizard opens on the defaults.
- The portal is passwordless, so a browser test signs in with a real magic link redeemed on
  `/account/auth` (the `_look-portal` pattern) — there is no password field to fill.
- Surface tiles carry their state in `.wz-tile.on`, not `aria-pressed`. Asserting only that Walls
  is ticked proves nothing: it is ticked by default too. Assert something the spec REMOVED.

### Phase 8b — making a spec (9 Sep 2026)

Phase 8a shipped saved specs with no way to create one. A spec is a **NAME on a job the member
already did**, not a builder: nobody sits down to invent "end-of-lease repaint" in the abstract —
they do the job, notice they will do it forty more times, and name it. So the control sits on the
repeatable-jobs list `/account/new-estimate` already renders, and the only thing it asks for is
what to call it (plus an optional colour note).

The answers are read from the estimate's stored wizard state **server-side**, so the client never
posts the spec's contents — the same boundary the wizard keeps everywhere. A member may only name
a job on one of their own accounts, checked by id against the portal context.

**Traps.**
- A non-draft estimate must carry `level_of_finish`, and it is a **smallint** (3), not a modifier
  code ("FIN-3").
- `getRebookCandidates` keys `hasWizard` on `builder_state->wizard->**version**`, not on the state.
  A seeded job without it never reaches the repeatable list, so the save control has nothing to
  sit on. The submit route writes `{ version: 1, state, submittedAt }`.

### Phase 5a REWORKED on Tom's numbers — multipliers were the wrong shape (9 Sep 2026)

Tom, asked whether multipliers were right for site and access, gave the figures instead:
empty or mostly empty ≈ **2% of job value**, furnished ≈ **4%**, hard/mixed floors **not
factored** (already inside that prep), stairwell/void **not allowed for**, tricky parking
≈ **2–3 hours**, lift access ≈ **1 hour**.

That is two different shapes, and only one of them is a multiplier:

- **OCCUPANCY scales with the job** — a furnished six-bedroom takes more covering than a
  furnished flat — so it is a percentage, which is exactly what a modifier already is
  (`paintingHr = base × jobMod`). `STG-EMPTY` / `STG-PART-CLEARED` / `STG-FURNISHED`, in the
  **Staging** group, so they can never compound with the lived-in-home modifier already there.
- **PARKING and a LIFT BOOKING do not scale at all.** Carrying gear from a side street costs the
  same two hours whether it is one room or ten. A percentage would under-price the small job it
  hurts most and over-price the big one. They are **flat hours** on a "Site access" block, riding
  `prepHr` — which needs no rate row, the same reason the plastering and raw-timber allowances do.

**Two questions were removed rather than repriced.** Floors is gone from the screen: Tom prices it
inside the empty/furnished figure, and a question that changes nothing wastes the customer's
patience. The stairwell stays — the painter needs to know — but as a **note with no price**, and
its hint no longer implies one.

This also **deleted the one-per-group flaw** the first cut had: with parking and the lift no longer
modifiers, the Access group carries nothing, and occupancy is one answer in one group.

**The hour allowances are Settings-editable** (`site_access_hours`), per-entry fallback, so Tom can
move parking to 3 h without a deploy.

**The desk-check pack reads the access answers through the same function that PRICES them**, so it
can never describe an allowance the job did not get — the percentage, the flat hours and the
unpriced notes each reach the estimator in their own words.

### ⚑4 REVERSED, and condition priced by EXTENT (9 Sep 2026, Tom)

**⚑4 was wrong and I shipped it.** Tom: *"on a same colour job with sound trims our crew would
put 1 coat generally, with a spot prime for scuff marks."* The plan proposed two coats and phase 3
took them there; that was most of the **+17–25%** same-colour movement. `trims.same` and
`doors.same` are now **one coat** with spot-priming in the sentence, and the same-colour movement
falls to **+10.7%**.

What was genuinely missing is not a second coat nobody applies — it is **prep on damaged trims**,
which is now priced by extent.

**Extent, not presence.** Tom: *"on some jobs there may be peeling in 1 or 2 spots, which wouldn't
require a 1.8 margin, whereas others are peeling across the whole job."* That is the verdict on a
job-wide condition multiplier. `defect_prep_rates` already carries `hours_sev1/2/3` per defect —
which IS "a couple of spots / patches here and there / most of it". Phase 4b hard-coded severity 1
on the reasoning that a customer cannot judge severity; that was wrong. Nobody can answer "is this
a severity 2", but anyone standing in the room can answer "a couple of spots, or most of it". The
words are the customer's, the severity is ours (`EXTENT_SEVERITY`).

**What prices, and why.** A crack or a nail hole prices from words alone (⚑6 — the repair is
standard). Anything else prices **only with a photo**: extent is the whole question for flaking or
rot, and a photo is the only thing that settles it — a sentence is a claim, a photo is evidence.
Without one it is still recorded, still shown, still on the work order; it just goes to a person.
**Photos earn a price, words earn an estimator**, which is the incentive we want and loses nothing
either way. A photo-priced spot raises `confirm the prep` for sign-off before the price is fixed
(the `photo_review` rule, Tom 7 Sep).

**The one-coat prep allowance already existed.** Tom: *"generally for 1 coat jobs I would allow
some additional prep time across the job, for spot priming and filling."* That is
`ROOM_ALLOWANCES.colourMatch` — the **Colour Match Allowance**, one per interior room when the job
is a colour match, priced from its own rate row (Tom, 7 Sep). No second mechanism was built.

**⚑ A gap this opens.** That allowance keys on the JOB's tier (`fresh`), but coats are now derived
per surface — so a white-on-white **ceiling on a new-colour job is one coat and gets no allowance**.
By Tom's own reasoning it should. Keying it on the derived coats instead would fix it, and would
add cost to every new-colour job, so it is his call rather than mine.

### Tom's rulings of 9 Sep, actioned — and the movement lands at zero

**Windows on a same-colour job: one coat** ("generally 1"). With the trims already reversed to
one, a same-colour job now prices at **exactly what it priced before** — +0.0% on the impact
script. That is Tom's *"our current production rates are pretty accurate already"*, confirmed by
the engine rather than asserted.

| | before these rulings | now |
|---|---|---|
| Same colours | +17% → +25% | **+0.0%** |
| New colours | −2.0% | −2.0% (⚑3's ceiling) |
| Much lighter / bold | +25.6% | +25.6% |

The bold figure **overstates the real change**: the script compares against the old whole-job
count with no surfaces ticked dark-to-light, where in practice the customer ticks the walls and
the old code already gave those three. Interior bold-to-white being *always* three is Tom's own
ruling, so the direction is right.

**Exterior derives now** — the thing that had blocked phases 3, 4, 5 and 7. Tom: *"these are just
groups to make it easier to find the substrate, not because they share anything in common"*, so
there is no grouping to invent and one rule covers every exterior substrate: **same 1 · new 2 ·
bold 2**, with the sentence saying a third coat may be needed and that we will say so *before* we
start that wall — Tom prices two and raises a variation rather than quoting three and hoping.
Two substrates stay out: `brick_unpainted`, whose rate row already carries `default_coats: 3`
(the card is the authority where a substrate needs more than the rule), and `staircase`, which has
no rate row at all. **Interior bold stays at three** — inside, dark-to-white is always three.

The systems CARD stays interior-only: the exterior editor is the sides builder, and deriving
exterior coats is a separate decision from showing them on a screen that exterior customers
never see.

**Ceilings without walls is a 30% RATE UPLIFT, not a flat line.** Tom: *"if ceilings are being
painted and walls aren't, we need to charge the ceiling and cornice at a 30% higher rate."* The
flat `Ceilings Only Allowance` line under-charged a big living room and over-charged a WC. A new
per-surface `upliftPct` on `SurfaceInput` multiplies that surface's painting hours; absent or 0
changes nothing, so every existing estimate prices identically. It is set on the ceiling and
cornice when the walls are off and **cleared the moment they come back on**, so unticking the
walls by mistake is not a permanent 30%.

**Migration `20270133000000_occupancy_modifiers.sql`** seeds `STG-EMPTY` 1.02,
`STG-PART-CLEARED` 1.02 and `STG-FURNISHED` 1.04 in the **Staging** group, on Tom's approval.
Applied to C1 and verified. Parking and the lift are deliberately absent — they do not scale with
the job and are flat hours in code, needing no row.

**`scripts/prep-hours-sheet.ts`** produces the worksheet Tom asked for: every substrate against
the FOUR cases he named (peeling · raw MDF or bare timber · badly damaged · oil needing
water-based), times the three extent columns `defect_prep_rates` already carries. There is
deliberately no general "prep" column — the standard rate covers minor sanding, caulking and
filling, and a column for prep-in-general would invite a number that double-counts it. Each case
appears only against substrates it can happen to (77 rows, not 119: no "raw MDF on the walls").
Two of the four cases — raw timber and oil-to-water — have **no defect type yet**; both are real,
and get seeded with the hours.

## Estimator journey v2 · Phase 9 — the plan-reader on customer photos (9 Sep 2026)

Branch `feat/paint-systems-screen`. **No migration.** Plan §8, §9.9.

**The gap.** `/api/extract/photos` had always KEPT the customer's condition photos and never READ
them — its own comment said *"no AI analysis, no silent drop"*, because the analysed path needed
a floorplan run to fold findings into and the no-plan path has none. So the commonest case (three
taps, no floorplan, two photos of a damp patch) stored evidence nobody looked at until an
estimator opened it by hand. Tom, 9 Sep, asked for exactly this: *"do they add photos which AI
reads and it automatically adds prep hours for these things?"*

Everything needed already existed and was unused on this path: `readPropertyPhoto` has a
**`damage` purpose** written for customer-submitted damage photos, returning typed defects with a
severity and a confidence.

**`lib/wizard/photo-defects.ts` is the translation, and only that.** The model says
`water_damage, severity 2`; the customer's screen says "Water mark — patches here and there". One
is the other, and this is the single place that mapping is written. It calls no model and touches
no database, so what a reading MEANS is testable without an API key.

- **ONE suggestion, never a list.** A customer who photographed a damp patch is telling us about
  that patch; handing back four checkboxes turns a helpful gesture into a form. The rest of what
  the model saw still rides to the estimator on the photo.
- **Strongest by SEVERITY, then confidence.** A confident scuff matters less than a probable case
  of rot, and the estimator would rather be pointed at the worse thing.
- **0.7 confidence bar** — the same one `mergePhotoFindings` uses to accept a door style. Below
  it we say nothing and let the customer tag it themselves.
- **Phrased as a question, never a finding:** *"From your photo that looks like flaking in patches
  here and there — does that look right?"* Told "we found flaking", a customer will not argue;
  asked whether it looks right, they will happily say no — and their answer is what we price.

**The reading is opt-in per request** (`analyse`), because it costs money and most uploads are not
asking a question, and **best effort**: storage runs first, so a model outage costs a suggestion
and never the evidence.

**The upload moved to the moment the photo is CHOSEN**, not when the tag is tapped — a suggestion
that arrives after the customer has already answered is a suggestion nobody needs, and the slow
part now happens while they read the question rather than while they wait on a button.

### ⚑ Phase 9's other half is BLOCKED by a conflict between two of Tom's own decisions

⚑14 says move "Describe it" off screen 1 and **behind the chat bubble**. But:

- The wizard's bubble is **a direct line to the office, not the AI** (Tom, 8 Sep: *"so they can
  talk to us"* — `ChatWidget`). Putting an AI build-from-brief behind it would mean tapping "chat
  to a person" and getting a robot.
- Tom's 8 Sep flow ruling was that the three ways in are **peers** (floorplan / describe / three
  taps), which is the opposite of demoting one of them.

The AI assistant is a *different* widget (`AssistantWidget`, on `/estimate/assist` and
`/estimate/scope`) and is not on screen 1 at all. Honouring ⚑14 literally would mean adding a
second bubble to screen 1, which is worse than the problem.

**Nothing was moved.** The real goal behind ⚑14 is §2.1 — *stop making the customer choose a route
before they have seen any value* — and that is a flow decision for Tom, not a mechanism to pick
unilaterally.

### ⚑14 resolved by dissolving it — describe it ALONGSIDE (Tom, 9 Sep)

Tom, on being shown the conflict: *"Maybe we can add describe it alongside the other features —
like floorplan plus describe it, or describe the condition overall and tell us if there is
anything which needs extra work — then it could come back asking for photos? We still want the
customer to be able to live chat with the office… but this shouldn't have anything to do with the
describe it function, and should run separately."*

That is a better answer than any of the three options put to him, because it removes the
either/or rather than picking a side. **A floorplan and a description were never alternatives** —
a plan says where the rooms are, a description says what state they are in, and no drawing has
ever shown that.

**Nothing was demoted.** The three ways in stay exactly as they were, so the Describe route and
the assistant door behind it are untouched (four e2e specs depend on that card, and it is the
customer's main way into the AI). What is NEW is an additive **condition box** on the two routes
that are not already a description.

**It is narrower than "describe the whole job" on purpose:** the condition is the part a
floorplan cannot answer and the part that decides the preparation.

**`lib/wizard/condition-brief.ts` is a MATCHER, not a model call.** Tom's own list is the whole
vocabulary — *"it is only when the paint is peeling, is raw MDF, is badly damaged, or is painted
in oil and needs waterbased top coats that additional prep is required"* — and it is short,
concrete and written in words people actually use. So it costs nothing, runs as they type, can
only notice words they actually wrote, and is testable without an API key. The patterns are
written from how a homeowner describes a wall ("the paint is coming off"), not how a painter does
— anything needing a trade word is a rule that will never fire.

- **It answers with a photo ask, not a price**, because it cannot judge how bad something is.
  That is the photo reader's job (phase 9), and this only notices that somebody said something
  worth photographing.
- **At most two asks.** A customer who wrote three sentences and got back six photo requests has
  been punished for being helpful — the fastest way to teach them to write nothing next time.
- **Raw MDF and oil-based paint come back as NOTES, not photo asks**: they are properties of a
  surface rather than damage in a place, so a photo of "the raw MDF" is not a photo of a spot.
  Both still mean real extra hours, so the estimator is told.
- **A clean description is answered as clean** — no photo chased for nothing.

**The live chat bubble is untouched**, which was Tom's other point: it is a direct line to the
office and has nothing to do with any of this.

## Ceilings that go from dark to light — all of them, or named rooms (11 Sep 2026)

Tom, 11 Sep: *"It isn't typical for a ceiling to go from dark to light — so maybe it could be
added to the dark to light as ceilings some rooms, or all ceilings; if it's some rooms, then it
adds an option to choose the rooms in the room builder."*

This closes the gap the 10 Sep dark-to-light change opened and flagged in its own commit
message: the ceilings-changing-colour question lived on the paint-systems card, that card is
gone, and ceilings were not on Tom's tick list — so a bold job derived its ceilings at one coat
and nothing asked.

**Why ceilings are the one surface answered per ROOM.** "Some walls" has to stay a note for the
estimator because we cannot know *which* walls, and ticking them all over-quotes a whole house
for one feature wall. Ceilings are different: the rooms are already on the screen. So "some" is
a real list of rooms and earns a real price, instead of a follow-up.

- `condition.darkToLightCeilings` (`"all" | "some" | null`, default null — the usual answer) and
  `condition.darkToLightCeilingRooms` (area ids). Ceilings are deliberately NOT written into
  `darkToLightSurfaces` by the card: one field owns the answer, so the two cannot disagree.
- The job-wide row is `darklight-ceilings-row`; tapping the chip that is already on turns it
  **off**, because "none" is the common answer and must not need a third chip.
- The per-room tick (`room-ceiling-d2l-btn-<areaId>`) renders only when the answer is "some"
  *and* that room has a ceiling being painted. It sits inside the room card, so it is reached
  the same way — and in the same rhythm — as the size, the cupboards and the spots.
- `applyPaintSystems` is the only place that reads it, and it already walks the blocks with the
  area in hand; that is why per-room cost almost nothing. A ceiling going dark to light also
  forces `ceilingsChangingColour` for that surface — it IS a colour change, and without it ⚑3's
  coverage guard would read a repainted ceiling as "white again".
- **"some" with no room named prices every ceiling at the standard**, and the card says so. No
  room chosen means no coat added; it never guesses upward.
- **Back compat:** the assistant maps a whole-job "dark to light" onto the surface list,
  ceilings included, and so do older snapshots. A ticked `"ceilings"` in that list still means
  "all" unless the new field says otherwise — reading only the new field would quietly drop a
  coat those jobs were already quoted for.

### ⚑ A bold ceiling is TWO coats, not three — and that is Tom's Settings row

`DEFAULT_PAINT_SYSTEMS.ceilings.bold` is `rule(2, …, "A new ceiling colour. Two coats of flat
ceiling paint.")`, where walls, trims and doors on the bold system are three. So a ceiling going
lighter gets one extra coat (1 → 2), not the third coat the card's pill promises for walls.

The derivation follows the table rather than inventing a number, and the card says *"we allow
the extra coat it needs"* — never "three coats". Promising three and charging two is how a quote
and an estimate stop matching. If Tom wants three over a genuinely dark ceiling, it is a
one-row Settings change, and the unit tests read the table so they follow him instead of
failing.
## One ladder — C1 (11 Sep 2026)

Closes audit 9.2, 9.5 and 9.6. "Can this be accepted online?" was decided in three places that each re-derived the caps from `scope_editor.selfServe*` with hard-coded fallbacks (`customer-scope.ts`, the wizard-edit route, `scope-tools.ts`), while `evaluateGuardrails` had already applied the real `wizard_policy` caps. A cap changed in Settings moved rung 5 and nothing else. The three copies are gone; `evaluateGuardrails` is the only function that returns `canAccept`, and `lib/wizard/ladder.ts` turns that one decision into what the customer is shown.

`ladderFor()` → `{ tier, selfServe, reason, visitSlots, nextUnlock }`. Tier = the `wizard_bands` thresholds (Guide < `midMin`, Detailed ≥ `midMin`, Confirmed ≥ `tightMin` **and** `decision.canAccept`); `selfServe` is exactly `decision.canAccept`; `reason` is `visitReason` when not self-serve. `nextUnlock` never names a target the road can't reach: exterior, mixed scope, over the cap, a hand-off, or a visit-only reason (peeling / rot / flagged / photos) returns null; a no-plan interior at Detailed is told "upload your floorplan". Trap found by its own test: `visitReason` returns `"signoff"` as its residual for *any* non-self-serve job, so treating "signoff" as visit-only hid Confirmed from the one job that can reach it — "signoff"/"big" are deliberately outside `VISIT_ONLY`.

**The tiers are accuracy labels, not rewards** (ruling G, 11 Sep). Guide / Detailed / Confirmed describe how much we know about the job. The branch this came from also shipped `wizard_rewards` — a paint upgrade, first pick of start dates, a Dulux consult and a `goldSkipVisit` switch, keyed by tier. All of it was stripped in C1: a benefit that varies by tier rewards completing our form, prices the thinnest-margin jobs worst, and makes a booking promise the calendar may not keep. Nothing in the build says bronze, silver or gold.

**Audit 9.5** — the same commercial site asked two ways gave a trade actor two answers: `softForActor` in `policy.ts` whitelisted `commercial_strata` (from the `commercialKind` question) but not `commercial_gate_strata` (from the segment question, via `ALWAYS_APPOINTMENT` in `commercial.ts`). Both segment-driven gates — strata and healthcare — now join the set. The four gates the customer answers about physical conditions (height, equipment, hours, stages) stay hard for everyone. `softReasons` at :338 is now a copy of `reasons` rather than an alias; that is defensive, not a live fix — both returns that hand back the bare array run before the first push.

Surfaces: both editors show a `tier-chip` and a `tier-next` line on the confidence card; `checkThresholds` returns `tier` + `nextUnlock` for the assistant. **Settings → Estimates → Accuracy tiers & online cap** (`TiersSettings.tsx`) edits `wizard_bands` and `wizard_policy` (v2 keys); migration `20270132` strips the seven dead keys. Tests: `lib/wizard/one-ladder.test.ts` (10, one per finding), `lib/wizard/ladder.test.ts` (11), `e2e/tiers-settings.spec.ts` and the customer-journey ladder spec's chip assertions — both run green on the C1 test stack.

## requires_site_check, decided once — C2 (11 Sep 2026)

Closes audit 9.1, which was executed proof rather than a theory. `app/api/wizard/submit/route.ts`
derived the flag correctly for the COLUMN it wrote at the end of the route — condition photos,
double storey, peeling, access gear, unpriceable targets, "other" cladding — but passed
`wantsExterior` into `evaluateGuardrails` a hundred lines earlier. Those are different questions.
An interior job with condition photos was therefore told at submit that it could accept online,
while `estimates.requires_site_check` said it could not and the scope page refused. Worse, the
proving snapshot recorded `walkthroughRequired: false` for exactly those jobs, so the calibration
baseline the gate depends on inherited the wrong answer with nothing to mark it.

`requiresSiteCheck({ state, stored })` in `lib/wizard/ladder.ts` is now the only derivation. The
submit route calls it once and uses the answer for the decision, the snapshot **and** the column,
so the three cannot drift. `state` is `effectiveState` there, not `state`: a failed defect read
must not count as a condition photo — it is flagged for review instead.

`stored` is ORed in rather than replacing the derivation, because escalations after submit live
only in the column (`wizard-edit/route.ts:493` and `:887` set it for a custom surface, rot or a
geometry flag). Four callers now share it: the submit route, `customer-scope.ts`,
`wizard-edit/route.ts` and `lib/agent/scope-tools.ts`. The last two already read the column; ORing
the derivation in can only make them stricter, and it closes the gap on rows submitted before C2
whose column may be wrong.

`wantsExterior` survives in the submit route for the one thing it actually means — whether to
compute the exterior envelope from elevation photos (`:371`).

The snapshot gained `requiresSiteCheck`. Its ABSENCE identifies a row from the affected window;
the contradiction `estimates.requires_site_check = true` with
`snapshot->>'walkthroughRequired' = 'false'` identifies a provably wrong one. Correction SQL is in
the C2 PR body — read the count before running the update. Exterior rows are not corrupted:
`evaluateGuardrails` forces `exterior_signoff` for any exterior work, so `walkthroughRequired`
landed true either way.

Tests: `lib/wizard/site-check.test.ts` (19). Mutation-checked — dropping the condition-photo clause
fails six of them, dropping the stored-column OR fails one.

## One server truth for a part-finished walk — C3 (11 Sep 2026)

`wizard_drafts` autosaved last-write-wins. `/api/wizard/draft` read the open row and wrote the
whole state back, so two tabs on one anonymous session — a laptop and the phone beside it, or a
staff member joining through `wizard_assist_patch` — meant the later write erased the earlier one.
Nobody saw it happen: the route is best-effort by design and answered 200 either way.

**`wizard_drafts.version`** (migration `20270136`) makes the write conditional. The client sends
the version it read; the update carries `where version = <that>` and bumps it. Zero rows updated
means somebody moved first, and the route answers **409 with the server's copy** — the one
non-200 it returns, and one the customer must never see as an error. A database trigger refuses a
version that goes backwards, so a stale client cannot rewind it inside an otherwise valid write.

**`lib/wizard/draft-merge.ts`** decides what the customer ends up with. It is a THREE-way merge:
`base` (what I last saved), `mine` (what is on screen), `theirs` (the server's). A field I have
not touched takes theirs; a field I am editing stays mine; and **a confirmation is never withdrawn
by a merge** — `done.*` and `answered.*` booleans are ORed, because a confirmation is a person
positively saying "yes, that's right" and losing one silently would re-ask a question they already
answered. Arrays are taken whole rather than spliced: a room list is ordered and self-referencing,
and merging two versions element-wise would produce a tree neither side ever saw.

**localStorage stops being a third truth.** It was reconciled with the server copy by comparing
`savedAt` timestamps — two clocks, on two devices, deciding which half-finished quote a customer
gets back, with skew picking the loser silently. The cache now carries the version it is based on
and `pickResume` (`lib/wizard/resume.ts`) uses that instead: same version means the browser copy is
the server's plus a few seconds of typing and wins; behind means the server has writes this device
never saw and the server wins. It is still written eagerly, because only writing on server
confirmation would lose the last keystrokes to a hard refresh — but it can no longer WIN against a
server copy that has moved on.

**`last_screen`** is where they actually are, as a word — `quick:condition`, `page:rooms`. The
funnel keeps `current_page`/`furthest_page` as numbers; this is what staff read when they open a
live session with the customer still in it.

**One writer of `state`.** Every other path that touches `wizard_drafts` — the conversion at
submit, the keep route's email, the outcome route, the assist patch, the nightly sweep — writes
lifecycle columns only, and a version predicate there would produce spurious failures without
protecting anything. `lib/wizard/draft-writers.test.ts` pins that by reading the source: a second
writer of `state` fails the suite. It is an unusual test and a deliberate one — the invariant is
about which files exist, not about what a function returns.

**A1b is closed.** The "26-second silent wait" does not resolve as a finding anywhere in the repo,
but the phenomenon is checkable and addressed on all three counts: the wait is not silent
(`app/wizard/WizardApp.tsx` renders step ticks, a moving bar and rotating tips while the AI works),
it is bounded (`app/api/wizard/submit/route.ts` sets `maxDuration = 60`), and a dropped connection
is caught rather than stranding the customer on the spinner (`WizardApp.tsx` `runSubmit`, "their
answers are all still in state, so send them back to retry"). What remains is that there is no
CLIENT-side abort — the bound is the platform's, not ours. Parked, not fixed.

Tests: `lib/wizard/draft-merge.test.ts` (15), `lib/wizard/draft-writers.test.ts` (3),
`e2e/customer-journey/draft-versioning.spec.ts` (3, green on the C1 stack).

**Two bugs the e2e caught that reasoning had not.** First, the cache is written 400 ms after a
keystroke while the server confirms at 2.5 s+, so its version stamp always lagged by one save;
`pickResume` read "the browser is behind" on a perfectly good copy and resumed from the server's
older state. The cache now re-stamps when a save is confirmed. Second, `decodeResume` rebuilds the
record field by field, so `version` and `lastScreen` were written to localStorage and silently
dropped on the way back in — every other piece was in place and the refresh still resumed wrong.
Both are the kind of thing only a real browser finds.

## Outside + Commercial, and the exterior finish line — C4 (11 Sep 2026)

Closes audit 9.3 and 9.4, and finishes Phase 0.

**9.3(a) — the hand-off fired on every Continue.** `?mode=business` seeds
`quick.propertyKind = "commercial"` before the first render (`lib/marketing/prefill.ts`), and the
commercial hand-off in `quickNext` was checked on EVERY call, before the "are we on the last
screen?" test. So a business visitor's first Continue on screen 1 exited the quick look: promised
four screens, given one, with no explanation. The hand-off now belongs to the step that ASKS the
question — `quickStep === "place"`. Anywhere else it was firing on an answer nobody gave there.

**9.3(b) — the promise was typed.** `QuickLook.tsx` read "Four quick screens" while `stepsFor`
returns three for Outside and five for Both, so the sentence was false on two of three branches
while the dots below it showed the truth. `stepCount()` in `lib/wizard/quick-look.ts` is now the
only source of either, and a unit test asserts the word matches the array length on every branch.

**9.3(c) — commercial outside got domestic questions.** `pageKeys` for `jobType === "exterior"` is
`property → house → …`, and `house` is `PageExteriorHouse`: "What we're painting", with house /
fence / deck / shed and domestic storeys. An office block was being asked which weatherboards it
has. Every commercial outside or both is a visit anyway (ruling, 10 Sep), so there is nothing to
gain by asking first: it routes to the `handoff` outcome with a reason, and `flushDraft` writes the
lead immediately rather than waiting out the 2.5-second autosave — the customer may well close the
tab on that screen. Commercial + INSIDE still goes into the page set, where the segment question
and the gates live. **This is the stop-gap C14's exterior brief replaces.**

**9.4 — an exterior job had no finish line.** `finish/page.tsx` returned "Open your estimate to
finish it off." for every non-rooms bundle, and said so in its own comment. Screen 10 dead-ended
for every exterior customer. The sides bundle already carries everything the summary needs, so it
renders the SAME `Finish` component off the SAME `summaryRows` — a second summary would be a second
opinion about the job. `SummaryInput` gained an optional `sides` block (sides checked, storeys and
substrates, doors and windows, the condition answers) and `finishOptions` takes a `kind`, because
"checks your rooms, systems and photos" described a job an exterior customer never gave us. An
exterior job never self-serves, so the two doors are Send for confirmation and Book a site visit —
that was already the policy; this screen just stopped hiding it.

Tests: `lib/wizard/quick-look-routing.test.ts` (14) pins the step counts, the promise and the four
job-type × kind combinations as a table; `e2e/customer-journey/outside-commercial.spec.ts` (7) and
the finish-line assertions appended to `exterior-path.spec.ts` pin the wiring on the real screens.
All four fixes are mutation-checked — reverting each one fails exactly the test that names it.

### Extent is a QUANTITY, not a severity — Tom's question found a real fault (9 Sep 2026)

Tom, reading the prep-hours sheet: *"where the areas are priced per square metre, is the extra
allowance per square metre or a fixed amount? If paint is peeling it says m2 0.3 — is that 0.3 per
square metre, or 0.3 hours for everything?"*

**Per square metre.** `defectHours` is `perUnit × qty`. And asking it exposed a fault in the spot
lines: they passed **`qty: 1`** and let the customer's extent pick the SEVERITY column instead. So
"most of it" on a whole peeling room priced at **0.3 h — eighteen minutes** — because one square
metre was all it ever asked for.

Two different axes were being conflated:

| | means | who answers it |
|---|---|---|
| `severity` | how bad it is **per unit** — light flaking vs paint hanging off | the photo reader, or the honest floor of 1 |
| `qty` | **how much** of it there is | the customer — "a couple of spots / patches here and there / most of it" |

Extent is plainly the second. So extent now sets the **quantity**, and severity comes from the
photo read when there is one. A customer is still never asked for severity: *"is this a severity
2"* is a question for somebody who prices these for a living.

**`DEFAULT_EXTENT_QTY` (1 / 3 / 8) is a deliberate floor, and wants Tom's numbers** — enough that
"most of it" is no longer eighteen minutes, conservative enough that nobody is over-charged while
it is unconfirmed. Settings-editable (`spot_extent_qty`), so correcting it is not a deploy. The
photo reader's `qtyExtent` bands match those numbers, so a photo measured at four square metres
pre-selects the answer that prices four square metres.

The crew note now says how much was allowed, in the rate row's own unit — "most of it — allowed
for 8 m²" — so the painter can see the allowance rather than infer it.

### Estimates → Waiting on you: remove rows from this list (Tom, 15 Sep 2026)

The waiting table has tick boxes and a **Remove from this list** button. It is deliberately not a
dismissal: `work_item_dismissals` silences a key for the whole queue (Today, the badge, every view)
and asks for a reason, whereas Tom's ask was "just from the waiting screen". So the hidden keys live
in their own table, `estimates_waiting_hidden` (migration `20270147`), keyed by the work item's own
deterministic key and shared across staff, written only through `estimates_hide_waiting()` /
`estimates_unhide_waiting()`. The evaluator in `lib/crm/work-queue.ts` never reads that table — the
filter is applied on the estimates page alone (`app/(app)/estimates/page.tsx`), so CRM Today keeps
the item and the badge keeps counting it. `WaitingTable.tsx` went client-side for the ticks; the
rows are still whatever the evaluator said. Removal is optimistic with an Undo, matching the
estimates table's delete. A key that re-fires under a new discriminator is a new fact and reappears.

### CRM Today: a sent quote gone quiet is a follow-up (Tom, 15 Sep 2026)

"Ensure sent quote reminders go into the CRM to be followed up — I can't see all of them in there."
They were not there: `followup_due` was registered in `lib/crm/work-queue.ts` (weight, group, key
shape, tests) but never given a source, so the only sent quote Today ever showed was one that had
already lapsed. The board's "Chase due" flag in `lib/crm/stage.ts` knew the rule; the queue did not.
`buildQuietQuoteItems` now applies the same Settings → CRM thresholds (`chaseUnopenedDays`,
`chaseOpenedDays`, `goingColdDays`) to every quote sent in the last 90 days, measured from the last
touch (the send, or the latest logged call / message after it — `CHASE_EVENT_TYPES`, shared with
the lapsed source). One item per customer, the newest quote. Each quiet cycle is a new key
(`quiet-<anchor day>`, escalating to `cold-…`), so a dismissal never silences the next round.
Automated campaign messages are deliberately not a touch. Migration `20270148` adds the partial
index the read needs (`estimates (sent_at desc) where status = 'sent'`).

### Exterior batch, 15 Sep 2026 (late): sides before the gate, condition on the tighten screen

Tom's 11 items on the outside journey. The quick look's outside screen is now picture tiles
(`app/wizard/ExteriorTiles.tsx`, the same `wz-pk` style as the door and window drawings) and no
longer asks the paintwork's condition; a new **"Which sides?"** screen follows it, just before the
range (`stepsFor` → `["start","place","outside","sides"]`), and the answer sets
`exterior.sidesAnswered` so the sides editor starts every side at "yes". The range prices an
unanswered outside condition **good-to-peeling**: `lib/wizard/envelope.ts` opens a `condition`
question and prices the dear end with the Poor modifier (`COND-POOR`) until the tighten screen's
answer writes `modSel.Condition`; the submit schema no longer requires it. On the tighten screen
(`SidesEditor.tsx`) the old "Which sides?" and "Condition & access" cards are gone: condition,
peeling sides (with `PeelingPhotos.tsx`, labelled "Peeling & flaking"), timber rot anywhere and
where, and access are a `Paginated` block at the top that confirms the loop item itself on the last
answer; the counts check and the last check are a second block at the bottom, each confirmed by a
tick box. A side unticked before the gate is not on the screen at all and cannot come back (Tom, 16 Sep);
every side card header carries an × that deletes the side, confirmed or not, like a room. The sides-loop
meta carries `peelingSides`, `peelingPhotos` and `rotWhere` (`loop_cond`), which reword the amber
deferrals so the estimator reads where. The "Upload photos or a listing" door left screen 1; the
page set behind it answers to `/estimate?entry=upload` (the specs use it).

### Estimates list: Duplicate an estimate (Tom, 16 Sep 2026)

Every row on the Estimates list (accepted ones included) has a **Duplicate** link beside Delete. One click inserts a NEW draft and opens the builder on it — the copy is saved before the builder opens, so it already has its number (the first eight characters of the new row id) and its first save mints a share token like any other draft. What the copy carries and what it leaves behind is decided in ONE pure module, `lib/estimate/duplicate.ts` (`buildDuplicate`): everything the builder owns comes across (blocks, modifiers, materials, colours, sheens, inclusions/exclusions, discounts, the wizard's answers and snapshot, the rate-card pin, level of finish, job kind, storey heights, `requires_site_check`, `source`); the title is left exactly as it was and only the FIRST LINE of the address, `builder_state.jobAddress.address`, becomes "… (copy)" (then "(copy 2)", "(copy 3)" on a copy of a copy); and **no photos**: the original's `estimate_sources` rows and files are neither linked nor deleted, every reference the builder state keeps to them — `photoReview`, `wizard.state.planRunIds`, `facadeRunIds`, `conditionSourceIds`, `planPreviewUrl` — is cleared, and the photo count `wizard.state.details.damagePhotoCount` goes to ZERO (Tom's ruling, 16 Sep), so a copy re-run through the internal wizard with tier 2–3 damage and no note is asked for evidence again. Nothing customer-side carries over — status is `draft`, `share_token`/`sent_snapshot`/`sent_at`/`valid_until` are null, and there is no customer/property/account link (the contact stays in the builder state as text; keeping the email re-links the account on the first save). The server action `duplicateEstimateAction` (`app/(app)/estimates/actions.ts`) checks staff, reads the source with `DUPLICATE_SELECT`, and inserts under the staff user's own session so the builder's RLS and column grants govern it; no migration. Button: `app/(app)/estimates/DuplicateEstimateButton.tsx`. Tests: `lib/estimate/duplicate.test.ts`, `e2e/duplicate-estimate.spec.ts` (seeds a sent estimate with a photo row and a sign-off, presses the button, proves the copy and that the original kept its photo). Manual test: `docs/manual-tests/duplicate-estimate.md`.

### Optional substrates inside a room (Tom, 16 Sep 2026)

Until now "optional" was a property of a whole block: an area or a line item ticked Option sat outside the total under "Optional extras". Tom's case is finer: the walls and ceilings of a room in the estimate, the doors, architraves and skirting of the SAME room offered as an extra. So `Surface` (the builder's substrate row) carries `isOption?: boolean`, and ONE press on the row's **Option / Include** button in the area editor (`AreaEditor`, the substrate table's action cell; also a tick under the surface's Advanced Options) flips it. Pricing: `lib/pricing/estimate.ts` `SurfaceInput.isOption` — `priceEstimateTotals` skips an optional surface exactly as it skips an optional block (out of the subtotal, the hours, the materials cost), and `priceAreaSplit` gives an area's `{ includedCents, optionalCents }` (`priceArea` = the included part). In the builder: the room's price, the area editor's TOTAL row and the folder card show the included figure, with "+ $X optional" beneath and an OPTIONAL row under TOTAL; the room's optional substrates appear as ONE card per room under "Optional extras" titled "Living room — Doors, Skirting" (the same section the optional blocks use), with a **Put back in the estimate** button that clears the flag on all of them. Customer snapshot (`buildCustomerDoc`): the area lists its included substrates only and prices them; the optional ones become one `options[]` entry with id `${areaId}:surfaces`, so the customer page's existing tick (`CustomerEstimate.tsx`, `selected_options`) adds it to the total and `invoice_draft_final` invoices it as "(selected option)" by that id — no change to either. `computePaints` and `computeWorkOrderDoc` skip optional surfaces (no paint card, not on the painter's sheet). Older rows have no flag and read as included. **Ticked options reach the work order (Tom's second ruling, same day; migration `20270149000000_wo_apply_selected_options.sql`):** the builder saves `builder_state.woOptions` beside `woDoc` — one contractor-safe fragment per option id (`WOOptionFragment`: areas, materials, `contractorPaymentCents` from the engine's `contractorOfferCents` over just that slice, condition hours), computed by the same `computeWorkOrderParts` the job sheet uses. `wo_apply_selected_options(estimate)` merges every selected, not-yet-applied fragment into `work_orders.wo_snapshot` AND the estimate's own `woDoc` (so a later Issue, which re-copies `woDoc`, keeps them), sets the pay to the merged document's figure while no offer is live (a live offer keeps its number; the extra is a variation matter), appends the new surfaces to `wo_surfaces` (the painter's tick list, mirroring `seedRowsFromDoc`), and records the ids in `appliedOptions` so it is idempotent and never removes scope. `accept_estimate` calls it right after creating the work order. After acceptance, staff use **Options on this accepted job** in the builder (`addAcceptedOptionAction` → `estimate_add_option`): the id joins `selected_options`, the accepted total rises by the option's price with the quote's percentage discount and GST applied as the customer page does, a standing DRAFT final invoice is re-drafted so it carries the line (an issued one is left alone — the ledger's balance shows it), and the scope is applied to the work order. The accepted-estimate freeze (`estimate_frozen_guard`) opens for those columns only under the transaction-local `estimates.options = on` setting (the `crm.merge` convention). Estimates saved before this change have no `woOptions`; their ticked options are still invoiced, and the fragment appears on the next builder save. Removing an accepted option is not offered: that is a credit variation. Tests: `lib/pricing/estimate.test.ts` (an optional SUBSTRATE sits outside the total), `e2e/optional-substrates.spec.ts` (the press, the room's price, the card, the save, the customer's tick lifting the total by the option plus GST, the put-back; acceptance with the option ticked puts the doors on the work order, its pay and the tick list; staff adding the option after acceptance moves the total and the work order). Manual test: `docs/manual-tests/optional-substrates.md`.

### Builder batch, 16 Sep 2026 (afternoon): the option tick, title = address, "+ Add a paint"

Three rulings from Tom after seeing the optional-substrates build. (1) **The option tick.** The Option/Include button at the right-hand end of a substrate row was not what Tom saw as "an option tick next to each substrate" (and on a narrow screen the row scrolls, so the far end is off-screen). It is now a checkbox labelled Option in the FIRST cell of every row of the area editor's substrate table, before the folder icon; same `surface-option-toggle-<id>` test id, same `Surface.isOption` flag, nothing else changed. (2) **The title follows the job address.** On every save, `title` becomes "street, suburb" from `builder_state.jobAddress` whenever an address is on the estimate (`savedTitle` in the save path); a typed title only stands while there is no address, and the header input updates without a reload. The estimates list already shows the address under the title only when they differ, so nothing is doubled. (3) **"+ Add a paint."** The Materials card ends with "Also shown to the customer": a product picker over the whole catalogue and a usage note per added product, stored as `builder_state.extraPaints: { productName, usage }[]`. `computePaints` appends one `SnapshotPaint` per entry (skipping a product already on a card), role from its category or "Preparation", `isPrep` by category or name (prep, primer, sealer, undercoat, block…), the note as its usage chip, so it appears on the customer's "The paint we're supplying" — under Preparation products when it is one. Not priced, not a surface, and NOT on the work order's materials (that list is litres per product×colour from the surfaces; a hand-added paint has no quantity — the crew note is the place for "stain blocker on the ceiling"). Tests: `e2e/builder-batch-16sep.spec.ts`; the tick is driven by `e2e/optional-substrates.spec.ts`. Manual test: `docs/manual-tests/builder-batch-16sep.md`.

### "Change" renames the substrate for the customer (Tom, 16 Sep 2026)

`selectSubstrate` used to keep whatever `clientLabel`/`internalLabel` a surface already had on a re-pick (labels were only seeded when empty), so changing "Windows — style to confirm" to Double Hung Sash left the customer reading the old words. Now when the code actually changes both labels follow the new substrate, and the area description's `<p>old label</p>` line (the one the first pick appended) is swapped for the new code where it still reads verbatim. A re-pick of the same code, and the first pick, behave as before; coats are still only defaulted on the first pick. Spec: `e2e/builder-batch-16sep.spec.ts` ("Change to a different substrate renames it for the customer").

### Door-and-frame already includes the architrave (Tom, 16 Sep 2026)

43 Keith Street came out of the wizard with "4 × doors and frames as well as 4 × architraves": the "+ architrave" door answer rode the door-and-frame rate AND added an `Architrave (1 Side)` line at the door count (`lib/wizard/merge.ts`, since 21 Aug). Tom's ruling: the door-and-frame rate already covers the architrave, so a room with a door-and-frame line never carries a separate architrave line. The merge now drops any `Architrave (1 Side)` surface from a room that has a `… and Frame` door line — whether it came from the "+ architrave" answer, a ticked "architraves" surface, or the plan reader — and adds none itself. A door-ONLY room keeps its architraves, the one case where the two are separate work. The "architrave" answer still exists and still labels the line "Flat door, frame & architrave"; it simply prices as frame. `lib/extract/scope.ts` carries the note; tests in `lib/wizard/merge.test.ts` ("what comes with each door"). Existing estimates are not rewritten — 43 Keith Street's architrave line is removed by hand with × on the row.

### Messaging automations · Session 1 — the control screen (Tom's brief, 16 Sep 2026)
Every AUTOMATIC message now goes through one dispatcher, `lib/automations/dispatch.ts` (`sendAutomation`), which asks the pure `decide()` in `lib/automations/decide.ts`: switch on? which channel (Text / Email / Both, `controls[key]` on the `messaging` settings row, D3 fallback when the chosen channel has no contact detail)? office approves first (→ `automation_holds` row, status `pending`)? outside sending hours (D1, `quietHours`) or over the daily cap (D2, `dailyCap`, counted off `messages.meta.automation`) (→ `held` with `release_at`)? Otherwise it sends through `lib/messaging/send.ts` as before. `releaseDueHolds` runs from the campaign sweep (every 30 min) and the wo-sweep; `sendHold` (Approve on the queue, or a release) re-checks the switch and `lib/automations/stillNeeded.ts`. `lib/automations/reminders.ts` is the once-only rung ladder (`automation_claims`, latest-due-rung-only) Sessions 3–7 build on. The registry (`lib/automations/registry.ts`) carries per-automation `defaultChannel / approvable / defaultMode / quietExempt / capExempt / sendKind / timing`, plus three sends brought onto the list (tenant text, CRM record reply, Google Calendar push) and editable wording for the six staff alerts. Settings → Automations (`app/(app)/settings/AutomationsSettings.tsx`) renders channel, mode, timing, sending hours, the daily limit and a wording editor (token picker, live preview off `SAMPLE_VARS`, SMS part counter, "Send test to me" via `automationActions.ts`, reset). The approval queue is `app/crm/messages/queue` with a `message_approval` work item on Today (derived from pending holds). Migration `20270150000000_automation_holds.sql`. Help: `docs/help/automations/staff.md`, `docs/help/message-queue/staff.md`.

### Messaging automations · Session 2 — timing (16 Sep 2026)
Three cron changes in `vercel.json`: the wizard sweep runs every 30 minutes (the plan has been Pro since 7 Sep — D4), the trade digest is scheduled hourly (the route already picks each admin's Melbourne hour; it now accepts Vercel's `Authorization: Bearer` as well as `x-cron-secret`), and the wo-sweep is scheduled at 07:00 AND 08:00 UTC with a guard — `isMelbourneHour(now, EVENING_HOUR)` in `lib/time/businessHours.ts` — so it runs in whichever of the two is 6 pm in Melbourne (D5: the visit-reminder text stays at 6 pm across the 4 Oct daylight-saving change). `?force=1` (and the hand-run POST) bypass the guard; the e2e callers pass it. Held automatic messages were already released by the 30-minute campaign sweep in Session 1.

### Messaging automations · Session 3 — money and sign-off (16 Sep 2026)
`lib/automations/sweeps/moneySignoff.ts` runs from the half-hour campaign sweep (`?only=reminders` skips the campaign engine): the unpaid-invoice ladder (four rungs off `timing`, anchored on the due date at midday Melbourne — `dayInstant`; rungs 3–4 add a text; trade accounts go to the finance seat's login email; `invoices.chase_hold_reason`, migration 20270151, pauses it — set from the invoice row's Pause reminders button), the deposit reminder (after issue / before start), the sign-off reminders (calls `wo_signoff_sweep()` so the DB ladder records the rung and its compliant copy as a `signoff_nudge` event, then sends each event once — one ladder, not two), the variation reminder (anchored on the `variation_priced` event; no stamp = no guess), the painter's send-your-invoice prompt (off the sign-off auto-draft) and the `office_signoff_overdue` staff alert. Every rung goes through `runLadder` (claimed first, latest-due-only) and `sendAutomation`; `stillNeeded.ts` re-asks the balance / signature / status when a held or queued message is released. The customer welcome is `sendCustomerWelcome` in `lib/estimate/acceptedNotify.ts`, called from both acceptance seams.

### Invoicing never shows an empty ledger over a failed read (16 Sep 2026)

Tom reported every invoice missing from Invoicing. Nothing was lost: Session 3 above added `chase_hold_reason` to the shared `INVOICE_SELECT` in `app/invoicing/data.ts`, migration `20270151` had not yet been run on production, and Postgres rejected every invoice select with `42703`. `loadDashboard` and `loadJobMoney` took only `data` off the result (`const { data: invoices }`), so the error vanished and `rows` fell back to `[]` — the dashboard then rendered its ordinary empty state, $0 tiles and "Nothing here — change the filter", over a full ledger. The same gap silently stopped the unpaid-invoice and deposit reminders, which read that column too.

The reason now reaches the screen. `lib/invoicing/loadFailure.ts` turns a rejected read into one line of staff English — a missing column says the database is behind the app and names the fix; anything else is passed through verbatim, never swallowed — and both loaders return it as `loadError`. `/invoicing` and the per-job money view render it as a clay `.banner.bad` above the tiles ("The invoices could not be loaded — this is not an empty ledger"), and the receivables empty state changes its wording so it can no longer speak for a failed read. Tests: `lib/invoicing/loadFailure.test.ts` (the message logic) and `e2e/invoicing-read-failure.spec.ts`, which goes red the moment `INVOICE_SELECT` asks for a column the database does not have. The standing rule this encodes: **a money screen must never render an empty list on a failed read** — an empty array is equally the signature of a rejected query, the same lesson as the RLS note above.

### The payments read: a wrong number is worse than a blank screen (16 Sep 2026)

The invoicing read-failure guard above covered the invoice list. Asked to extend it to payments, the fix found two bugs.

**The swallowed error.** `loadDashboard` and `loadJobMoney` took `data` off the payments read and dropped `error`, so a refused read produced no payments and every invoice rendered at its full total — paid ones shown as unpaid and overdue, the aged buckets and "Collected · 14 days" wrong with them. That is a worse lie than the empty ledger: an empty screen invites a question, a plausible wrong number gets acted on, and the action is chasing a customer who has already paid. So `lib/invoicing/loadFailure.ts` now returns a `{ headline, detail }` and has a sibling, `paymentsFailure`, whose wording is deliberately louder — *"treat every amount on this screen as wrong… Do not chase anyone off this screen"* — and `firstFailure` ranks payments ABOVE invoices when both fail.

**The read was already failing, every time.** Surfacing the error immediately went red on the test project: `TypeError: fetch failed`. The dashboard passed every invoice id into one `.in("invoice_id", ids)`, and at 400 invoices that URL is ~15 KB and the request layer refuses it. The CRM work queue had already met and fixed this ("request layer refuses (found on the P5 rebuild)"); Invoicing never got it, so its payments read had been failing silently and the dashboard had been overstating what customers owe — $265,910 against a true $257,110 on the test data, an $8,800 phantom. The slicing now lives in `lib/supabase/inSlices.ts`, RETURNS a refused slice's error rather than hiding it (a partial answer is the same lie, smaller), and the queue's local `inSlices` delegates to it so there is one implementation. The queue's wrapper still drops the error — its existing behaviour, flagged in place for the unchecked-read audit rather than changed blind inside an invoicing fix.

Tests: `lib/invoicing/loadFailure.test.ts` (the payments wording, the ranking, the fall-through) and `e2e/invoicing-read-failure.spec.ts`, which is red for a broken payments read as well as a broken invoice read. The standing rule is enforced for new code by `local/no-unchecked-supabase-read` (see CLAUDE.md).

### Airtable → CRM import: history, the 35 signed jobs, and the handover door (Tom's brief rev 3, 16 Sep 2026)
Paint Group's customer history since May 2025 (1,048 accounts, 1,306 properties, 1,482 estimates, 549 jobs, 6,014 events) and the 35 already-signed PaintScout jobs come into the platform through two loaders under `scripts/import/` (`airtable-crm.ts` for history over Postgres, `paintscout-booked.ts` for the signed jobs over the API), one migration (`20270152000000_import_provenance.sql`) and one inbound door (`app/api/inbound/airtable-jobs`). What is REAL: every account, property, estimate status and amount, every dated note and lifecycle event, every job's dates, invoice total, offer and hours. What is ASSUMED and marked: Level 3 where Airtable did not say (`external_ref.level_of_finish_assumed`), a 30 Apr 2025 date on 74 bulk-loaded rows (`date_confidence = low`), `something_else` for a no-response loss with a state note. Where provenance lives: `source` + `external_ref` on accounts, properties and estimates; `crm_import_keys` (import name + stable key → row) which is what makes a re-run an update and a purge possible; `crm_events.source = 'airtable_import'`. History estimates carry no scope and open as a read-only card (`app/quote/ImportedHistory.tsx`); history jobs are `crm_jobs` rows on the record (R11), never work orders. The two estimate triggers that would corrupt history (the lifecycle emitter stamping now(), the reopen-lost rule) obey a transaction-local `crm.import` switch. The signed jobs are built by `lib/import/booked/build.ts` into the builder's own working scope — every surface and line an override, `sizeUpliftDisabled`, `preparationOverrideCents = 0` — and the build refuses unless `priceEstimateTotals` reproduces the PaintScout total to the cent; `import_booked_job` then writes the estimate accepted by hand under the switch (office marker and welcome claim first, so nothing sends), the one historical `estimate_accepted`, and an issued work order with no contractor and no date, with the Airtable plan as a booking note — at `offered` since 20 Sep 2026 (below), `pre_start` before that. Estimates home keeps history behind an "Imported history" chip; Today chases an imported open quote only for a hot or warm customer; a handover job with no per-area hours raises `hours_to_confirm`. The pack itself is gitignored (real people); `e2e/airtable-import.spec.ts` runs both loaders on a synthetic pack and purges it. Runbook: `docs/imports/README.md`.

### The rest of invoicing: understated costs, and a 404 for an invoice that exists (16 Sep 2026)

Closing the invoicing remainder from the two notes above. Three things, one shared banner.

**The Payables / Costs lists stay tolerant, and stop being silent.** `loadCostCapture` and `loadJobCosts` have always substituted an empty list per table (`error ? [] : data`) so one missing thing cannot blank the tab — that part is right and is kept. What was wrong is that they did it without a word, and the lie a money-OUT list tells is a quiet UNDERSTATEMENT: a job looks cheaper than it was, an approval queue looks clear, a supplier invoice that arrived looks like it never came. Nobody sees an alarming blank; they see a smaller number and move on. `costsFailure` in `lib/invoicing/loadFailure.ts` now names the lists that failed and says the totals are understated — *"don't read this tab as 'nothing outstanding'"* — and the tab still renders everything that did load. The contractor-invoice read behind the Payables rows and tiles is covered the same way (either loader failing makes the tab incomplete); the Activity feed is deliberately left tolerant and unreported, because a gap there costs a reader nothing they would act on and a banner for it only teaches people to ignore banners.

**An invoice that cannot be read is not a missing invoice.** `loadInvoiceDoc` returned null for both a refused read and a genuinely absent row, so `/invoicing/inv/[id]` answered **404 — "there is no such invoice"** for an invoice that exists. It now returns `{ doc, failure }`: a refusal renders the reason with a way back to Payments (HTTP 200, proven on the real screen), and only a genuinely missing invoice reaches `notFound()`.

**One banner, one place.** Three screens now show a read failure, so the markup lives in `app/invoicing/ReadFailureNotice.tsx` — presentational, so it renders in the server page and inside the client shells alike. A money screen that tells you its figures are wrong must say it the same way every time, or the quieter variant is the one that gets trusted. The shared invoice wording also lost its "the figures below are blank" clause, which was untrue on a document page with no figures below it.

Verified by inducing each failure against the real database and driving the screens: the Payables notice over *"nothing waiting / nothing approved / intake queue is clear"*; the document refusal returning 200 with its reason; Receivables unaffected, so the notice stays scoped to the tab that is actually broken. `e2e/invoicing-read-failure.spec.ts` + `e2e/invoicing.spec.ts` 10 passed / 1 skipped; 335 unit tests; the unchecked-read baseline ratchets 593 → 591.

### Employed painters — Session 1: one identity, two employment types, a money contract (17 Sep 2026)

Paint Group is adding PAYG **employees** alongside contractors (`docs/briefs/claude-code-brief-employed-painters.md`; the read-only diagnostic that preceded any code is `docs/briefs/employed-painters-session-0.md`). This session adds the identity and the money contract; nothing an employee can do yet beyond signing in.

**Not a fourth role.** `contractors.employment_type` (`contractor` | `employee`, migration `20270153`, default contractor, self-write revoked) is the whole distinction. Every behavioural difference derives from ONE function, `painterCapabilities()` in `lib/painters/capabilities.ts` — ten booleans pinned to the brief's matrix by `capabilities.test.ts`. No component, RPC or policy checks the column; the session (`lib/contractor/session.ts`) reads it once per request through a best-effort select (`lib/contractor/employment.ts`, the works_saturday rule — a missing column degrades to contractor, never a broken portal) and carries `capabilities` for pages to branch on.

**The money contract is the policies, not a hidden div.** Every painter-facing page reads its money tables directly under the contractor role's RLS, so "an employee never sees a dollar figure" is enforced where the rows are: `work_orders_contractor_read`, `booking_offers_contractor_read`, `contractor_invoices_own`, `wo_variations_read` and `wo_events_read` each gain `and not (select public.is_employee())`. An employee still reads surfaces, photos, checklists and updates through `wo_visible_jobs`, and still claims expenses. The shapes an employee WILL be sent (Session 3 onward) are declared once in `lib/painters/employeeView.ts`; `lib/painters/money.ts` is the vocabulary that must never appear in them, and `employeeView.test.ts` walks every schema against it. The portal hides the REQUESTS and INVOICING tabs by capability and the routes behind them answer 404 — the tab filter is a convenience, the 404 is the control.

**The golden adversarial test** is `e2e/employee-money.spec.ts`: it creates a `pg.e2e.employee.*` account for the run, makes it the contractor on a work order carrying a payment, an accepted priced offer, a priced variation and a priced event, then asserts as that account that no money key or dollar figure is in any portal response and that every direct PostgREST read of those tables returns zero rows — while the job's surfaces still read. It removes what it made. `employees_enabled` (settings row, `lib/painters/employeesFlag.ts`) gates only the office's tick box, which arrives in Session 5; a row that is an employee is treated as one whatever the switch says.

**Imported jobs land in the tray at `offered` (20 Sep 2026).** Tom's ruling: an imported job has not been booked — no contractor, no date, no offer — so `pre_start` (which the tray's needs-booking lane, the console's `unbooked:` card and `pc.jobs_to_schedule` all ignore) was the wrong stage. `20270185000000_import_booked_lands_in_offered.sql` redefines `import_booked_job` to insert at `offered` and adds `import_release_to_tray(uuid)` (service role only), which moves an already-imported `pre_start` row to `offered` through `wo_set_stage` and skips anything booked by hand since. `scripts/import/release-to-tray.ts check|run` drives it; `lib/import/booked/release.ts` is the pure decision `check` prints, pinned equal to the RPC's by its test. Runbook: `docs/imports/README.md`.

**Draft deposits for imported jobs (17 Sep 2026).** `invoice_draft_deposit(uuid, text)` (20270153) drafts, for an accepted estimate with no deposit invoice, the deposit an online acceptance would have drafted (document % else settings default) — status draft, so the ledger ignores it until the office issues it. `scripts/import/draft-deposits.ts` runs it over the estimates an import created; see `docs/imports/README.md`.


### Employed painters — Session 2: assignments, Accept, lead painter, the calendar (17 Sep 2026)

An employee's job is **assigned, never offered** (ruling 1). Migration `20270154` adds `wo_assignments` — one row per painter per job with their own dates, a `status` enum (`assigned | accepted | released`) and `is_lead` — with the two rules the database enforces: exactly one lead among the painters still on the job (partial unique index `wo_assignments_one_lead`, the same shape as `booking_offers_one_live`) and a painter on a job once. Nothing is written to `booking_offers`, and `respond_to_offer` / `send_offer` / the stage trigger are untouched; a contractor drop still creates a booking request.

**The lead painter IS `work_orders.contractor_id`.** That one decision keeps every existing "who's painting" read — the customer portal, the confirmation email, the walkthrough invite, the board's walkthrough pins — correct without a change, and the 20270153 money policies still exclude the lead because they test `is_employee()`, not the column. The other painters on the job reach its surfaces, photos and checklists through `wo_visible_jobs`, widened to union the assignments; `wo_painters(work_order_id)` is the one read surface for bookings ∪ assignments, so nothing is mirrored (session-0 §3: "a second copy would be a second thing to keep true").

Five SECURITY DEFINER RPCs, all `ok:` / `conflict:` / `error:`: `assign_job` (validates every painter — employee, active, not already on it — before writing any row; refuses `conflict:overlap:WO-1234` or `conflict:unavailable:leave:2026-10-05` unless the office gives an override reason, which lands on the `assignment_made` event; the FIRST assignment moves the job out of stage 1 through `wo_set_stage` with `acceptance_mode: 'assigned'` on the event, later ones just add painters), `acknowledge_assignment` (the painter's own Accept: idempotent, sets `accepted_at`, logs `assignment_acknowledged`, nothing downstream waits on it), `reassign_dates` (clears the Accept, logs both spans), `set_lead_painter` (the Lead painter button, moves `contractor_id` in the same transaction, logs `lead_painter_changed`) and `release_assignment` (future days only, past ticks stay; the lead cannot be released while others remain; releasing the last painter sends the job back to the tray). `contractor_unavailability` gains `kind` (`other | leave | rdo | sick`) and an approval pair — Session 2 only refuses to schedule over them; the request/approve flow is Session 7's.

On the board (`lib/scheduling/board.ts`, `app/pc/schedule/ScheduleBoard.tsx`): a lane whose painter is an employee reads **EMPLOYEE** instead of READY / NOT READY. Dropping a tray job on it opens the same sheet with "Assign this job?", a time budget instead of a price, and an override-reason field; the button reads **Assign job** and calls `assignJobAction`, which after the commit sends the customer's confirmation at assignment (⚑A default — the office has committed the job; Accept is visibility, never a gate; idempotent per start date so three painters make one confirmation), books the walkthrough, and texts each painter "you're on this job — tap Accept". One job with three employees draws three blocks in the same green, each with a `1 OF 3` chip, a star on the lead's lane, and a **dashed outline until the painter taps Accept**. The block's detail sheet carries the crew list, **Make X the lead painter**, an add-a-painter picker (same days, no second walkthrough booking) and **Take X off this job**. Dragging an assignment block moves that painter's days only. Templates `assignmentSms` / `assignmentEmail*` / `assignmentDatesChangedSms` / `assignmentReleasedSms` ride the automations registry as `employee_assigned`, `employee_dates_changed`, `employee_released`.

`e2e/employee-assign.spec.ts` drives the board as staff (drag → sheet → Assign) and the painters through their own sessions: three lanes, one lead, one stage event, at most one confirmation, a second lead refused by the index, the lead's release refused, Accept and its reset, overlap refused by name, override logged, a contractor refused, and zero booking offers at the end. Not done here: Google Calendar reconciliation for employees (`lib/gcal/sync.ts` still reads bookings only) and the employee's own portal screens (Session 3).

## Invoicing — a payment recorded before the send (17 Sep 2026)

**Money that arrives before the invoice goes out no longer forces a send.** Tom, 17 Sep: a customer pays the deposit by bank transfer off the estimate; the office should record it, not Issue & send an email nobody needs. Migration `20270155000000_invoice_pay_before_send.sql` redefines `invoice_record_payment` so that a **draft** is accepted: the RPC calls `invoice_issue` itself (number, totals, due date, lock, `issued` event) and records the payment in the same transaction, then writes `payment_received` with `paid_before_send: true`. The §3.2 matrix is untouched — draft → issued → paid, never draft → paid — and `invoice_send` is never called, so no `sent` event and the status never passes through `sent`; the customer hears from us once, with the receipt. UI: the draft card on `/invoicing/job/[estimateId]` and the Payments card on `/invoicing/inv/[id]` now offer **Record payment** on drafts (`MoneyView.tsx`, `InvoiceDoc.tsx`); `lib/invoicing/schema.contract.test.ts` pins the migration's shape and `e2e/invoicing.spec.ts` drives a draft progress claim to paid. Help: `docs/help/invoicing/staff.md`.

## Invoicing — deposit invoices list the accepted scope (17 Sep 2026)

**A deposit invoice now itemises the job it is a deposit on.** Tom, 17 Sep: "include all line items on deposit invoices". Migration `20270156000000_invoice_deposit_scope_lines.sql` adds `invoice_lines.informational` and moves the snapshot walk (preparation, areas, line items, selected options, discount) out of `invoice_draft_final` into one helper, `invoice_write_snapshot_lines(invoice, estimate, sort_start, informational)`; `draft_final` calls it with `false`, and a new AFTER INSERT trigger on `invoices` (`t_invoice_deposit_scope`) calls it with `true` for every deposit draft, so `accept_estimate` and `invoice_draft_deposit` need no third copy. Informational lines are excluded from `invoice_recompute_draft` and from `invoice_set_draft_total`'s single-money-line rule, so a deposit stays inc-anchored: its total is the deposit figure, never the sum of what it lists. Existing draft deposits are backfilled by the migration; issued deposits (locked, PDF rendered) are left alone. UI: the staff document (`InvoiceDoc.tsx`) renders informational lines without the pencil and labels the group "for information"; the customer sheet needed no change because it already groups `estimate_snapshot` lines as contract works. Same PR: the staff document's line rows became a grid with the pencil slot BEFORE the amount, so every figure shares the totals' right edge (Tom: "values next to line items all in a line").

### Employed painters — Session 3: the employee's own portal (17 Sep 2026)

An employee has no row-level read on `work_orders`, `booking_offers`, `wo_variations` or `wo_events` (20270153), so their jobs arrive through **`employee_jobs(p_work_order_id)`** (migration `20270157`): a SECURITY DEFINER function returning one row per live assignment for the caller — their own dates, the lead flag, the Accept stamp, crew size, the stage and walkthrough flag the page needs, a time budget (the document's hours and the office's day count, never a rate), and the frozen job sheet passed through **`jsonb_strip_money()`**, which walks the whole document and drops every key that looks like money (the same vocabulary as `lib/painters/money.ts`; case-sensitive, because a case-blind match ate `gst_registered` and `accurate`). Absent, not zeroed — the read-back select in the migration proves it on a nested document.

**Reuse, don't fork (brief §5.2).** `lib/contractor/employeeJobs.ts` maps those rows onto the SAME `ContractorJob` shape the portal already renders, with `assignment` set and `paymentCents` null. Jobs, Calendar, Home and the job page take `capabilities` from the session and choose the loader; the job card shows a time budget where a contractor sees their price, an amber **Tap Accept** chip until the painter has acknowledged, and a **Lead** chip. On the job page `AssignmentCard` carries the one-tap **Accept — I've seen it** (`acknowledge_assignment`, idempotent) and the **I can't make these days** flag (`assignment_cant_make_it`, ruling 11): a reason and an event, and nothing else changes on the assignment. The offer bar, reschedule request, priced variations, claim composer and crew link branch away on capability; `WorkOrderDoc` gains `variant="employee"` (no payment section — the second lock on a door the SQL strip already shut) and `acceptanceMode`, so the stage-1 badge reads **Assigned**. The PC job page derives the same label and retitles the stage-1 checklist **Ready to assign** from the presence of assignments (`stageTitle()` in `lib/workorder/stages.ts`; the enum never changes).

**The Reassign item** is the first employee work item in `lib/crm/work-queue.ts` (`employee_reassign`, weight 32 — a booked day with nobody on it outranks every internal chase): derived from `assignment_cant_make_it` events against live assignments, cleared by a later `assignment_dates_changed` or a release, keyed by assignment so a second flag does not resurrect a dismissal, due the day before the painter's first day, action **Reassign** → the board on those dates. `employee_flag_state()` gives the painter's page the same answer from the same events. Help gains the `employee` role in both enums (`scripts/help-index.ts`, `lib/help/content.ts`) and `helpReader()` routes an employee to `employee.md` files only — the contractor guides talk about offers, prices and invoices. `e2e/employee-portal.spec.ts` runs the loop as a real employee: list → Accept → Assigned badge, no payment → start → before-photo → tick → the PC's daily draft names the employee's tick → can't-make-it raises the Reassign item on Today and leaves the assignment byte-identical; no dollar figure, `AUD`, `/hr` or money key on any screen along the way. Not done here: the Google Calendar card is hidden for employees because `lib/gcal/sync.ts` still reconciles bookings only.

### Employed painters — Session 4: variations, the employee side (17 Sep 2026)

Same card in, different card out (brief §3.5, ruling 8). Migration `20270158` does three things and touches no contractor path. **Any painter on the job may raise:** `wo_raise_variation` keeps its 20261002 body with one line changed — the "is this yours?" test goes through `wo_my_job_ids_as_contractor()`, which is the lead (still `contractor_id`) plus everyone assigned; a contractor matches exactly as before. **The money-free read:** `employee_variations(work_order_id)` returns the same rows with an `outcome` (`with_office` · `with_customer` · `approved` · `not_going_ahead`), the hours, the office's declined note, and the priced lines passed through `jsonb_strip_money()` — what to do, never what it costs. **No accept step on an employee job:** a `BEFORE UPDATE` trigger on `wo_variations` turns `customer_approved` into `contractor_accepted` in the same statement the customer's signature lands, when `wo_is_employee_job()` (assignments, no booking offer) and no manual deduction is pending, logging `variation_employee_applied`. `wo_customer_sign_variation` is not edited — its body is fenced — and the stage gate, which waits on `customer_approved`, therefore never waits on nobody.

On the page, `app/portal/jobs/[id]/Variations.tsx` is the one component with a `mode` prop (CLAUDE.md: never fork): `employee` mode keeps the identical raise form and renders **With the office / With the customer / Variation approved (+ "3 hrs added" + scope lines) / Not going ahead (+ the office's note)**, with no accept or acknowledge button and no formatter. `e2e/employee-variation.spec.ts` raises as a real employee (photo and all), prices as staff, signs as the customer on `/v/[token]`, then asserts the approved card, the applied status and event, and the absence of any money key or figure; `wo-variations.spec.ts` runs alongside to prove the contractor's adjusted-offer path unchanged.

**4b — the whole crew can work the job (ruling 6).** Found by the variation spec: five painter-side RPCs (`wo_tick_surface`, `wo_record_photo`, `wo_tick_checklist_item`, `wo_answer_checklist_item`, `wo_add_note`), the storage bucket's `wo_photo_access` and the scalar `wo_is_my_job_as_contractor` all asked "is this painter the work order's `contractor_id`?" — which, since the lead painter became that column, is only the lead. A second employee on the job could see the tick list and do nothing on it. Migration `20270159` adds one question, `wo_painter_on_job(work_order, painter)` (the lead, or anyone assigned and not released), and re-creates those seven functions from their **live definitions** (`pg_get_functiondef` on the test project, which matches production for these files) with that single test swapped — generated by a script, not retyped. The two money RPCs carrying the same test (`contractor_invoice_request`, `wo_contractor_accept_variation`) stay lead-only on purpose. `app/api/wo/photos/route.ts` asks the same helper instead of reading `work_orders`, so an employee's upload URL is signed. The variation spec now raises as the NON-lead crew member.

## Contractor portal — the pinned Start-the-walkthrough bar (17 Sep 2026)

**A finished job's next step is never a scroll away.** Tom, 17 Sep: "once all of the check boxes have been done, a start walkthrough button fixed to the top of the page — currently I can't get to the walkthrough". `app/portal/jobs/[id]/WalkthroughBar.tsx` (client) renders under the sticky portal header (`position: sticky`, its `top` measured from `.pt .hd` once on mount) whenever the job is committed and every working surface is done, the job is parked at the hidden completion-prep stage, or it sits at walkthrough. One button, two phases, both decided by the page from the same facts it already computes: `finish` calls `contractorFinish` (the same server routing as the All-done card — QA first when a check is due, gate refusals shown in the RPC's words) and, when that lands the job at walkthrough, opens Walkthrough Mode straight away; `walkthrough` calls `startWalkthroughMode` alone. The bar carries `prepLeft`, the count of required finishing-up items still open, so it says what is blocking before the press. The `FinishUp` and `WalkthroughStart` cards stay where they were — the bar is a second door to the same two server actions, not a fork of them. Pinned by `e2e/wo-walkthrough-bar.spec.ts` (absent until the last tick, sticky under the header at the foot of the page, gate → QA routing, and the walkthrough-stage press landing in `/s/[token]`). Help: `docs/help/work-orders/contractor.md` steps 12 and 15.
## Contractor portal — WorkCover on Insurance & licences (17 Sep 2026)

**WorkCover is asked for, never a gate.** Tom, 17 Sep: "ask to provide WorkCover certificates as well as the public liability policy; allow the gate to pass on approval of just public liability, but say WorkCover is required if they have any other workers working with them." Migration `20270160000000_contractor_doc_kind_workcover.sql` adds `'workcover'` to the `contractor_doc_kind` enum and nothing else — `contractor_recompute_offerable` (20260831) still keys on a verified, unexpired `'insurance'` row alone, and the migration's read-back asserts that. `lib/contractor/model.ts` gains the label and `workcoverNeeded(crewSize, docs)`: true when the crew is bigger than one and no WorkCover row is on file (uploaded-and-being-checked already counts; lapsed does not). The profile's Insurance & licences section asks for both certificates in words, offers WorkCover as a document type, and shows a red "N painters are on your crew, so a WorkCover certificate is required" line from the live crew-size field; Home lists the same as a "Needed" action item; the staff Contractors page labels document kinds through `DOC_LABEL`. Pinned by `lib/contractor/workcover.test.ts` and `e2e/contractor-workcover.spec.ts` (wording + option, crew of one silent, crew of three told and STILL offerable, a `workcover` row accepted by the database without moving `offerable`). Help: `docs/help/self-invoicing/contractor.md` step 2 and `docs/help/scheduling/contractor.md` before-you-start. **17 Sep, later:** the Ready-for-work card on Home carries the same fact as a line of its own — "REQUIRED: Please upload your WorkCover certificate" (amber, linked to Insurance & licences) above the "Offers will land in Requests" note — whenever the crew is above one and no WorkCover is on file; a crew of one sees the card unchanged. Still never a gate (`ready-workcover-reminder`, asserted in `e2e/contractor-workcover.spec.ts`).

### Employed painters — Session 5: expenses only, settings, the Employee tick box, the customer's lead (17 Sep 2026)

Migration `20270161`, five things. **The tick box** (ruling 15): `set_employment_type(contractor, type)` flips one row both ways and refuses with a named reason — `conflict:open_offer:WO-1234`, `conflict:active_assignment:WO-1234`, `conflict:unpaid_invoice:CI-0007`, `conflict:unpaid_expense` — while anything in flight belongs to the other type; closed history never blocks; the change is a `contractor_events` row; flipping back to contractor re-derives `offerable`, so no verified insurance means no offers from that moment. The invite carries the same tick (`contractor_invites.employment_type`, `create_contractor_invite` gains the argument and `redeem_contractor_invite` honours it), so there is no separate add-employee screen. On `/contractors` the box is a column per row and a tick on the invite form, shown only while `employees_enabled` is on; the refusal is rendered beside the box in plain English. **Compliance for employees** (ruling 5) is two more `contractor_doc_kind` values, `white_card` and `working_at_heights`, reusing the document card, expiry reminders and staff verification; `ProfileForm` takes `capabilities` and drops company details, banking, the offerable card and the crew count for an employee, and its compliance card lists their tickets instead of insurance. The home page reminds an employee about a missing or expiring ticket and never mentions insurance or offers.

**Expenses only** (rulings 4, 13): `/portal/money` for an employee renders `ExpensesOnly` — jobs through the money-free RPC, the same `Expenses` component in `mode="employee"` with a **Company card / My own money** choice (company card the default), and the same $100 ask-first threshold. `contractor_expenses` gains `paid_with`, `reimbursed_at`, `reimbursed_by`; `expense_set_paid_with` records the choice right after `contractor_expense_submit` (a second small write, never silent if it fails — the claim then reads as personal, which lands on the office's list). Approved personal-card claims are **Employee reimbursements — owed back** on Payables → Costs, cleared with **Mark paid back** (`expense_mark_reimbursed` → status `paid`, event `expense_reimbursed`); company-card claims are job costs and never appear; nothing of an employee's ever rides an invoice. The tab reads **EXPENSES**; `/portal/money/[id]` and `/portal/requests` stay 404.

**The crew rule, finished:** `contractor_expense_submit`, `expense_preapproval_request`, `wo_start_walkthrough_mode` and `wo_generate_report_draft` are re-created from their live definitions with the lead-only test swapped for `wo_painter_on_job()` — any assigned painter may claim an expense and run the walkthrough (ruling 6, brief §3.4). **The customer sees the lead only:** the completion report page reads the work order's `contractor_id` (which `set_lead_painter` moves) through the sign-off token and prints "Your painter: <first name>"; the PC job page gains a **Crew** card listing every painter with their days and whether they have tapped Accept — the internal report. `e2e/employee-money-tab.spec.ts` drives the $140 claim through the portal, the approval, the Payables list and the mark-paid, the settings page, the tick box (refused with an open offer, flips a clean contractor and their portal, un-ticks to details-needed), and the lead change.

### Employed painters — Session 6: timesheets + job cost (17 Sep 2026)

An employee job carried no labour cost, so its GP read 100% (brief §3.8, ruling 10). Migration `20270163`: `timesheet_entries` (one row per painter per day on a job: `started_at`, `finished_at`, `break_minutes`, `source painter|pc`, `status open→submitted→approved|rejected`, `job_cost_id`) and `employee_cost_rates` (`cents_per_hour`, `effective_from`, history kept; **staff-only table, no painter policy at all**). A painter reads their own entries (`timesheet_entries_own`, hours only); nothing is client-writable. `timesheet_hours()` is the one hours rule (span less break, two places; `lib/timesheets/hours.ts` mirrors it for previews and the CSV). `timesheet_start(p_work_order_id default null)` clocks the employee on to the named job or today's assigned job (two jobs and none named → `error:pick_job`; one open day per painter by partial unique index); `timesheet_finish(p_break)` submits; `timesheet_record` is the office's own entry (source `pc`, lands submitted); **`timesheet_approve` posts ONE `job_costs` line** (`category 'labour'`, hours × `employee_cost_rate_on(painter, work_date)`, GST 0, `paid_with 'account'`, status approved) and pins it to the entry — idempotent, and it **refuses `error:no_rate`** rather than post an unpriced line; `timesheet_reject` carries a reason back; `set_employee_cost_rate` upserts by day and logs a `contractor_event` (the amount stays on the rate table). Screens: `app/portal/TimesheetCard.tsx` (Start day / Finish day on the home page and the job page, `capabilities.clocksOn`), `app/pc/timesheets` (the approval list, **Record a day**, allocated-vs-actual from the document's hours, and the payroll CSV at `app/pc/timesheets/export/route.ts` — staff-gated by `requireStaff`, hours only, 503 on a failed read), the **Cost rate** field on an employee's row of `/contractors` (`set_employee_cost_rate`), and the PC job page's **Labour (employees)** money item with GP = (contract − offer − approved labour) ÷ contract. `KNOWN_MONEY_KEYS` gains `cents_per_hour`/`costRateCents`/`amount_ex_cents`/`labourCents`; `e2e/employee-money.spec.ts` now also proves `employee_cost_rates` and `job_costs` return nothing to an employee; `e2e/employee-timesheet.spec.ts` is the acceptance (7.6 h × $52.50 = one $399.00 line; GP moves by exactly that; the CSV matches approved entries and carries no rate; the painter never sees an amount). The office's wall-clock times become instants through `Intl` on the day (never a written-down `+10:00`). Not done: the "timesheet awaiting approval > 24h" work item (S7, brief §3.9); the monthly bonus view (ruling 14, later).

### Employed painters — Session 7: attention items, notifications, time off, the switch (17 Sep 2026)

Brief §3.9 and ruling 11, the last session before the flag. **Work items** (`lib/crm/work-queue.ts`, derived, never stored): `employee_unaccepted` (an assignment with no Accept whose first day starts within 24 h Melbourne — "Call painter", weight 26, follow-ups), `leave_request` (an undecided leave/RDO — "Decide" → `/pc/timesheets#time-off`, approvals) and `timesheet_approval` (submitted days older than 24 h, one item per painter counting them — "Approve", approvals); `employee_reassign` (S3) is unchanged and now also fed by sick days. **Time off** (`20270164`): `contractor_unavailability` gains `declined_at`/`decline_reason`; `leave_request(kind, start, end, reason)` is the employee's only door (leave/RDO pending until `leave_decide`; **sick counts at once** and inserts the S3 `assignment_cant_make_it` event for every assignment it lands on, so ONE item covers both); `leave_cancel` for a request not yet started; `leave_decide` refuses `conflict:assigned:WO-…` rather than approve over a booked day. The portal calendar renders in a new `view` mode for employees with `TimeOffCard` (leave / RDO / sick today; Requested / Approved / Declined / Sick chips; cancel); the board labels a pending request "RDO — requested" and drops declined rows; PC Command → Timesheets gains **Time off requests** (`LeaveRow`, `decideLeaveAction`). **Notifications**, all through the one adapter and listed on Settings → Automations: `employee_lead_changed` (from `setLeadPainterAction`), `employee_variation_approved` (every employee on the job, hours only, from the customer's `/v/[token]` sign action beside the contractor's release text), `expense_decided` (from `decideExpenseAction`), `leave_decided` (from `decideLeaveAction`); each guarded once per fact by a `wo_events` / `contractor_events` row. **The switch**: `settings.employees_enabled` is now a tick at the top of `/contractors` (staff, through the settings table's own policy) — Tom flips production there; nothing else changes on flip, existing employees are never touched by "off". `e2e/employee-loop.spec.ts` is the employee full loop (two painters, variation applied by the trigger and both told, Mode A from the lead's job page, closed with no contractor invoice) plus the items, the RDO, the sick day and the switch; it runs beside `wo-full-loop.spec.ts` (the contractor's) in the same C1 run. That spec found one more hole: sign-off drafted a contractor invoice for the employee lead (the lead IS `contractor_id`); `20270165` recreates `contractor_invoice_draft` from its live definition with one guard — an employee answers `skip:employee`, so nothing reaches Payables for payroll to pay twice.

### Employed painters — Session 7b: days log themselves (17 Sep 2026)

Tom, 17 Sep: "the painters won't remember to clock in every day … it needs to auto clock their time on the job based on 07:30–15:30, unless the job is signed off earlier, or they have multiple jobs scheduled the same day. If they do overtime, they can log this." Migration `20270166`: `settings.timesheets` (`dayStart`, `dayFinish`, `breakMinutes`; `timesheet_day_setting()` reads it with defaults), `timesheet_entries.source` gains `'auto'` and a `note`; **`timesheet_autofill(day)`** (staff or the service role) inserts one submitted `auto` entry per employee on exactly ONE active assignment that weekday, with no entry yet for the day and no sick / approved leave / office block over it — 07:30→15:30 in Melbourne time, or to `wo_signoff.signed_at` when the job closed earlier that day, nothing when it closed before the day began; a painter on two jobs is counted and skipped (`ok:n:manual:m`); weekends are never filled; a day that has not reached the standard finish is refused. The evening `wo-sweep` calls it for today and the six days before (idempotent; `timesheetsFilled` / `timesheetsManual` in its response). **`timesheet_extra`** is the painter's overtime: a span on a job they are on, within the last 7 days, ≤ 8 h, refused on any overlap with their own entries. **`leave_record_for`** lets the office mark sick / leave / RDO / blocked from the board (`blockOutInput.kind`, the kind selector on an employee's lane): office-entered leave and RDO are approved at once; sick raises the same Reassign event. Screens: the portal card became **Your hours** — "a standard day is logged for you", **Log extra hours** (job, day, times, note), Start day behind a second tap for a two-job day; PC Timesheets gained **Standard day** (edit, **Approve all standard days (n)**, **Fill that day now**) and **Needs a manual day** (two jobs, nothing logged, last 7 weekdays); rows say standard day / logged by the painter / entered by the office. `RecordHours` defaults to 07:30.

## Contractor portal — insurance certificates carry their expiry (18 Sep 2026)

**A date typed after choosing the file never saved.** Tom, 18 Sep: the expiry "isn't transferring across even though it is filled in". The Insurance & licences card uploaded the moment a file was picked (`onChange` of the hidden input called `uploadDoc`), so the natural order — pick the file, then type the date — inserted the row with `expires_on: null` and it read NO EXPIRY. `app/portal/profile/ProfileForm.tsx` now STAGES the file (**Choose file** → name shown → **Upload**), and for an insurance kind (`expiryRequired()` in `lib/contractor/model.ts`: `insurance`, `workcover`) Upload stays disabled until the date is in, with the reason under the field. A row already on file with no date gets an inline date + **Save expiry** (the painter's own `update` grant on `expires_on`, 20260831). The database is the last line: `20270169` makes `contractor_doc_expiry_sane()` refuse an insurance / WorkCover row with no expiry on insert and on update of `expires_on` or `kind`; its read-back also counts the insurance rows already sitting without a date for the office to chase. Other kinds keep an optional date. `e2e/contractor-doc-expiry.spec.ts` pins all three (disabled until dated, refused by the trigger even through the service role, set-in-place on an existing row).

## Contractors — one painter's record, and removing a painter (18 Sep 2026)

Tom, 18 Sep: "be able to delete contractors that are unwanted" and "a detail page for each contractor, to show mobile number, number of contractors and all of their information, quality check data on record, and all of the jobs they have completed".

**The record**: `app/(app)/contractors/[id]/page.tsx`, staff-only through the `(app)` layout, reached by clicking a name in the list. Their details (mobile, email read from auth with the service client since `contractors` carries no email column, crew size, tier, ABN, GST, address, weekends, masked bank, RCTI), their paperwork with expiry and verification state, their **quality checks** (`wo_qa_checks` over their jobs, newest first, with a passed/failed tally) and their **jobs** — merged from both paths, because a contractor holds `work_orders.contractor_id` while an employed painter is on the job through `wo_assignments`. Every read destructures its error and names itself in one "couldn't read X" line rather than rendering an empty card. QA ordering falls back to `created_at`: a check recorded without a `checked_at` stamp otherwise sinks below the 25-row cut.

**Removing one** (`20270170`, `delete_contractor`): this could not be a plain delete. `work_orders.contractor_id` is **ON DELETE SET NULL** and nine tables CASCADE, so deleting a painter with history would silently strip every job they ever did of its painter, and take their offers, assignments, timesheets and insurance certificates with them, raising nothing. The RPC therefore refuses by name — `conflict:jobs:WO-…`, `assignments`, `offers`, `invoice`, `expenses`, `preapprovals`, `timesheets` — and the office suspends instead, which is already on the screen and keeps the record. Only a row that never did anything can go, which is what the request was for: a duplicate, a typo, an invite that went nowhere. The delete is **checked** with `get diagnostics` and answers `error:not_deleted` rather than reporting success on a statement that matched no row. The auth login is deliberately untouched. The UI asks for the word DELETE to be typed. `e2e/contractor-detail.spec.ts` covers the record, the refusal (asserting the job kept its painter) and the successful removal.

## Work orders — flagged at the walkthrough, put right, complete (17 Sep 2026)

**A fixed flag completes the job; nobody walks it twice.** Tom, 17 Sep: after a customer flag the painter's finish "goes back to the walkthrough bar which does nothing"; once the flagged areas are fixed, "send them to the customer with the completion report and deem the job finished". The old tail re-ran everything — `wo_contractor_finish` scheduled a fresh QA check where one was due, then a second pack and a second walkthrough for areas the customer had already approved. Migration `20270162000000_wo_complete_after_rectification.sql` adds `wo_signoff_kind` value `'rectified'` and `wo_complete_after_rectification(uuid)` (assigned contractor, staff or system): it requires an in-progress job whose sign-off row has a delivered pack and at least one area with `flagged_at` and no `rectified_at`, every rectification row done, and the normal gates (`wo_gate_blocked` in_progress→completion_prep and completion_prep→walkthrough: surfaces, variations, finishing-up list, open QA checks, colour codes). It then walks the machine — in_progress→completion_prep→walkthrough→closed via `wo_set_stage`, never a status write — stamps each flagged area `rectified_at` (keeping `flagged_at` and the note), completes the sign-off as kind `rectified` / name "Flagged areas put right", freezes the report with a new `rectified` list (area, note, fixes, dates), and fires the warranty, review follow-up, final-invoice draft and contractor draft exactly as `wo_sign` does. App: `completeAfterRectification` in `app/portal/jobs/[id]/tickActions.ts` calls it and sends the customer the same completion-report email a signature sends (`sendSignedReportEmail`, signer blank for this kind). The job page derives `flaggedAreas` from the sign-off row's `areas` (never stored twice); while any exist on an in-progress job the pinned `WalkthroughBar` and the `FinishUp` card both become "Fixed — send the report" (phase `rectified`), the same action through two doors. The customer's `/s/[token]` page and the PDF (`CompletionReport.tsx`, `reportHtml.ts`) gain "What you flagged, and what we did" (note, put-right date, that area's finished photos) and a completion line per kind via `completionLine()`. Pinned by `e2e/wo-rectified-completion.spec.ts`: anonymous customer flags, no bar and a gate refusal before the tick, one press closes, warranty `rectified`, the customer's link shows the section. Help: contractor step 20 + troubleshooting, PC step 19.

## Work orders — a withdrawn flag, and a signature that cannot half-land (17 Sep 2026)

**"Flag, then Happy with this straight after, then sign" used to leave a signed sign-off on a job stuck at In progress.** Tom, 17 Sep. The flag moved the job walkthrough→in_progress and raised a rectify row; the approve replaced the area's JSON (so every area read approved) but left the stage and the row; `wo_sign` wrote the signature, warranty, report and both invoice drafts, then `perform`ed the close and the machine refused it (in_progress→closed is not a transition) with nobody listening. Migration `20270164000000_wo_flag_withdrawn_and_sign_guard.sql`: (1) a new gated transition in_progress→walkthrough ("flag withdrawn"); (2) `wo_walkthrough_area` (body basis 20261028) treats an approve on a flagged, not-yet-rectified area as a withdrawal — the untouched rows that flag raised are deleted (rows already put right stay), the area keeps `approved_at` and gains `flag_withdrawn_at` + `withdrawn_note`, and when no rectify row is open and every surface is done the job returns to walkthrough as the customer (event `flag_withdrawn`); (3) `wo_sign` (body basis 20261119) returns `error:not_at_walkthrough:<stage>` before writing anything, and raises if the final close is refused so the whole signature rolls back; (4) a repair block puts any already-stuck job (signed sign-off, stage in_progress) through the same door and the read-back counts what is left (expect 0). The customer's sign action maps the new error to "your painter still has something to put right". Pinned by `e2e/wo-flag-then-approve.spec.ts` (Mode A on the painter's phone: flag, approve, sign → closed, no rectify rows, `flag_withdrawn_at`; and a job pulled to In progress refuses the signature with nothing written). Help: contractor troubleshooting, PC step 19.

## Contractor portal — the first-run tour no longer blacks out the screen (17 Sep 2026)

Tom, 17 Sep: "you can read the wording clearly where you click Next, but you can't see any of the screen behind." `.pt .tourwrap` in `app/portal/portal.css` painted a 72% black over the whole portal; the tour cards describe the very screen underneath, so it is now an 18% tint and the card keeps its cyan border and shadow for contrast. `e2e/help-tour.spec.ts` reads the overlay's computed background and pins the alpha at ≤ 0.3.

## Tom's batch of 17 Sep 2026 — eleven small things

**Invoice search.** `app/(app)/invoices/SearchBox.tsx` (one `?q=` needle, kept across the filter tabs) filters the per-job list on the customer's accepted name, the address and the title; the Payments dashboard (`app/invoicing/Dashboard.tsx`) gained a client-side box over the receivable rows, which now carry `customer`. Both screens surface `loadError` — the list page had been dropping it.

**Builder.** `builder_state.adminNotes` (staff-only textarea above Job settings; in the fingerprint and both save payloads; never on the snapshot or the work order). `builder_state.preparationHours` → `Adjustments.preparationHours` (`lib/pricing/estimate.ts`): hours × the job's charge-out rate into the subtotal and into `contractorHours`; the customer's Preparation line (the residual) carries it, and `computeWorkOrderDoc` writes it as a `preparation` **area first in `woDoc.areas`** so `send_offer`'s SQL hours sum, the painter's sheet and the pay all see it without a special case. `lib/pricing/context.ts adjustmentsFrom` mirrors it for the assistant. The Preparation sentence is now "Allowance for time/ materials …" (`lib/customer/snapshot.ts`); migration **20270166** re-creates `invoice_write_snapshot_lines` with the same words and rewords DRAFT invoice lines only. A walls row in a room-measured area carries `Surface.measureMode: "wall"` — the row shows Room L×W×H / Single wall W×H, and in wall mode W (`measureL`), H (`measureH`, seeded from the room height) and coats inline; pricing was already `measureL × measureH` when both are set, so nothing in `lib/pricing` changed for it.

**Save before leaving.** `app/components/useSaveBeforeLeave.ts`: a capture-phase click listener holds any same-origin anchor click while `dirty()`, runs `save()`, and `router.push`es where the click was going only when the save succeeded; plus `beforeunload` for the browser's own prompt. Used by `QuoteBuilder` (through the existing `dirtyRef` / `save`) and by `InvoiceDoc` (an open line or draft-total editor).

**Email replies.** `app/api/inbound/messages/route.ts` relays every stored reply to the office mailbox (`INBOUND_FORWARD_TO` or Settings → Company email) through `forwardEmail` in `lib/messaging/send.ts` — a plain send with the customer as Reply-To, no `messages` row, no reply token — AFTER the CRM row is written; a relay failure is reported, never allowed to lose the message. The whole path is inert until `REPLY_DOMAIN` + `MESSAGES_INBOUND_SECRET` are set.

**CRM dates.** `app/crm/DateField.tsx` — a month-grid picker over a `YYYY-MM-DD` value (UTC-pinned day arithmetic, Monday-first, min/max, Today) — replaces every native date input in the CRM (follow-up, snooze, log sheet, delay, visit, diary move). `CustomerPanel` seeds the follow-up and snooze boxes from the saved instants (Melbourne day) and follows them on refresh; the date had always saved, but the box reset to "tomorrow" on every visit and read as if it hadn't. e2e picks a day with `pickDay()` in `e2e/helpers.ts`.

**PC Command.** `variationsForApproval(input)` in `lib/workorder/console.ts` — pure, over the same `wo_variations` read the queue uses (now also selecting `category, comment, price_cents, raised_kind`) — feeds a **Variations for approval** section on `/pc` above "Needs you now": office-first (raised), then customer (priced), then painter (customer_approved), each with one link to `/pc/wo/[id]#variation-<id>`.

**Chat bubble.** `AssistantWidget`'s launcher sits at `bottom: calc(16px + var(--chat-lift) + safe-area)`; `.acct` sets `--chat-lift: 76px` under 900px (the fixed tab bar) and 0 on a laptop. The staff dock (`.pgdock`) reads `--dock-lift` the same way; `.invx` sets 76px under 768px for the invoice action bar.

## Customer estimate — colour callout rule + payment details on the PDF (18 Sep 2026)

**The callout leaves when there is nothing to consult on.** `allColoursChosen(snap)` in `lib/customer/snapshot.ts` reads the snapshot's `paints`: every non-prep topcoat must carry a colour name (or, on a multi-colour product, every entry in `colours[]` named or a colour match); prep and primers never count, and no topcoats at all is "not chosen". `CustomerEstimate` hides `.colourbox` (`data-testid="colour-consultation"`) when it is true. The process-steps line further down is unchanged.

**The PDF pays for itself.** The download is the browser's print of `PrintQuote` (`app/e/[token]/CustomerEstimate.tsx`); it now carries a **Payment details** box after the deposit line — payee + ABN from the snapshot's company, then account name / bank / BSB / account number from Settings → Invoicing (`settings.invoicing_bank`, the same row every issued invoice shows), and the quote reference. `settings` is staff-only under RLS, so `app/e/[token]/page.tsx` reads that ONE row through the service client server-side (`loadBankDetails`, tolerant: no row or a failed read prints the quote without the bank lines). New optional `bank` prop on `CustomerEstimate`; every other mount (builder preview, portal) passes nothing and prints as before. Spec: `e2e/estimate-colours-pdf-bank.spec.ts` (anonymous customer, print media emulated).

## Customer estimate — a SWMS attached to the job (18 Sep 2026)

**One PDF per estimate, downloadable beside the insurance card.** Tom: "add a separate attachment in the estimate to that particular job with a SWMS sheet — the customer can click to download it next to our public liability". `SwmsAttachment` (in `app/quote/QuoteBuilder.tsx`, under the Presentation picker in Job settings) uploads through the browser client to the presentations' `presentation-docs` bucket — already public-read / staff-write with a PDF MIME + size limit (20260821, 20260905) — under `swms/<estimateId>/<ts>-<name>`, validated first by the shared `checkUpload(file, "document")`. It is remembered as `builder_state.swms {path, name}` (fingerprinted, both save payloads) and published on save as `snapshot.swms {url, label}` via `estimateDocUrl()` in `lib/customer/snapshot.ts`. `CustomerEstimate` renders a **SWMS** trust card with a `download` link straight after the public liability card, and the printed quote notes that it is attached online. No migration; the presentation's own capability-card attachments are untouched (those are generic per presentation, this one is per job). Spec: `e2e/estimate-swms.spec.ts` (staff upload → state + snapshot + object; anonymous download; remove).

**Follow-up (18 Sep, 35 South Park Drive):** Tom's presentation already carries a "SWMS & site inductions" capability card beside "$20M public liability", with an empty sample slot — that card is where he looked. `PresentationBlocks` now takes `swms`; a capability card that `isSwmsCard()` (heading or attachment label says SWMS, whole word) renders **⤓ Download SWMS** to the job's PDF instead of the generic sample, and `CustomerEstimate` shows the trust-strip SWMS card only when `presentationHasSwmsCard(snap)` is false (both helpers in `lib/customer/snapshot.ts`). Also learned: `/e/<token>` 404s for a DRAFT — the builder's Estimate tab is the only preview until the estimate is sent.

## Contractors — the invitation is emailed from the platform (18 Sep 2026)

Tom: "send an invitation link to them when registering on the platform — via email". The invite itself is unchanged (`contractor_invites`, `create_contractor_invite`, `/join/<token>`, a week's expiry). New: `emailContractorInvite(inviteId)` in `app/(app)/contractors/actions.ts` — a staff server action (the table is staff-RLS, so a non-staff caller finds nothing) that refuses accepted / revoked / expired invites, builds one white-card email (`buildPlainEmailHtml`: who invited them, what the platform is for, the link, the expiry day in Melbourne time, the office phone) and sends it through `lib/messaging sendEmail` with `kind: "contractor_invite"`, so it is a `messages` row and delivery-tracked like every other send. On `sent` it stamps `emailed_at` / `emailed_count` (migration **20270168**, two columns, no RPC); `not_configured` is reported in words and never marked as emailed. `ContractorsManager`: "Email them the link now" (ticked by default) on the invite form → **Create & email invite**; each waiting row shows *emailed d/m (×n)* or *not emailed yet* with **Email the link / Email again**. Help: `docs/help/contractors/staff.md` (new feature folder). Spec: `e2e/contractor-invite-email.spec.ts` — deterministic with or without an email key, because the `messages` row exists either way.

## The board, the paint list, and what an employee is (18 Sep 2026)

Tom's four usability items, plus a third quality-check setting and one report, in one branch.

**An employee's block on the calendar reads like a contractor's.** `.sb .blk.assigned` was a translucent tint; it now carries the same solid treatment as an accepted contractor block (`schedule.css`), keeping the ★ lead marker and the dashed edge for a crew member who has not acknowledged yet.

**The unscheduled tray searches, and is ordered by the wait.** `ScheduleBoard` keeps a `traySearch` and filters on `${title} ${woRef} ${suburb}` (the three things staff know a job by), with a `tray-no-match` empty state. The order in `lib/scheduling/board.ts` is now `tray.sort((a, b) => a.acceptedAt.localeCompare(b.acceptedAt))` — longest wait at the top — where `acceptedAt` is `estimates.accepted_at` falling back to the work order's `created_at`. That replaced "not-yet-issued first"; a job needing issuing still says so on its card.

**The paint list searches and reads A-Z.** The rule is `paintOptions()` in `lib/workorder/materials.ts` (filter by Int/Ext type → filter by the search → sort A-Z, `en-AU`, base sensitivity), called from the Materials card in `app/quote/QuoteBuilder.tsx`. Its one invariant, which is why it is a tested function and not an inline chain: **the paint already chosen on a row is always kept**, whatever the type and whatever the search says. A `<select>` whose current value is missing from its options silently displays the first one instead — that is how every trim once read the wrong product (Tom, 30 Aug), and filtering must never be able to change what a job is quoted with. Tests: `lib/workorder/paintOptions.test.ts`.

**A third quality-check setting: none.** `contractors.requires_qa` was a boolean and could only say "first jobs" or "every job". Migration **20270171** adds `qa_mode ('first_jobs'|'every_job'|'none')`, backfilled from the boolean and kept in step with it by `set_contractor_qa_mode` (the old `set_contractor_requires_qa` is now a wrapper), and regenerates `wo_schedule_qa` from its live body with one added early return. What `none` deliberately does NOT override: `work_orders.qa_required`, ticked on one job when it was booked — that is the office asking for a check on that job in particular, and it still wins. The list button cycles the three and names the setting it is on.

**"Saulius Ginetas (employee) is coming up as not offerable, even though he should be."** The flag was right and the screens were wrong. `offerable` means "can be sent an OFFER", computed by `contractor_recompute_offerable` from a current, verified **public liability** certificate — which an employee is never asked for (`painterCapabilities().requiresInsurance === false`, ruling 5: they are covered by Paint Group's own policy). An employee is ASSIGNED, and `assign_job` never reads the flag, so nothing was ever blocked. But `/contractors` printed **Not offerable** in amber and **No current insurance** in red, and the board's **Ready for work only** filter hid every employee outright. Now: the list badge reads **Employee · assigned**, `compliance()` defers to `employeeDocReminders()` (their own tickets) for an employee, and the filter keeps employees whatever the flag says. The portal was already correct — both compliance cards sit behind `capabilities.acceptsOffers`.

**A filter nobody could click.** Found while testing the above: `.pc .sb .top { position: static }` threw away the header's `z-index: 40`, and because that header carries a `backdrop-filter` it is a stacking context whatever its position — so the Contractors filter popover hanging off it painted *below* the board's rows (`.crow` is `position: relative`) and every click landed on the lane behind it. It looked completely normal. `position: relative` restores the z-index without making it sticky in the console.

**An offer they turned down no longer locks a painter on the system.** Migration **20270172**: `delete_contractor`'s offers guard now trips only on an **accepted** offer. Tom could not remove demo painters because of `WO-OVERLAP2` — leftover test data named in `supabase/fixes/revert-forgery-test-acceptance.sql` — that one had been offered and had not taken. An unaccepted offer is not a record that outlives the painter: the job went elsewhere or is still waiting and keeps its own event trail. Jobs, assignments (released ones included), invoices, expenses, pre-approvals and timesheets still refuse by name.

Specs: `e2e/board-and-paint-usability.spec.ts` (all five items, as staff on the real board and builder) and a new case in `e2e/contractor-detail.spec.ts` (declined → deletes, accepted → refused by ref).

**The dates stay locked while the contractors scroll.** Tom, 18 Sep: "keep the month day and date locked at the top of the screen, so you can still see when dragging a job". The month bar and day row are now one `.hdr` wrapper, `position: sticky; top: 0` inside the timeline. Two things had to be true first. The header lives INSIDE the horizontal scroller (it must — it scrolls sideways with the columns) and a sticky element only ever pins to its own scrollport, so the timeline has to BE the scroller: `.sb .tl` is now `overflow: auto` with a height, and the lanes scroll inside it. And that height is MEASURED in `ScheduleBoard` (`--sb-space`, a `ResizeObserver` plus a resize listener, from the timeline's document-space top to the bottom of the window), not guessed — the console's tab rail, the board's own bar and the legend above it change height when they wrap. `position: sticky` on the timeline itself was tried and is wrong: a sticky box only holds while its containing block still has travel, and once the board is taller than the screen there is none, so it pins for a few pixels and then scrolls away with the header — exactly the bug. The timeline's top padding moved onto `.hdr` so the header pins flush; left on the scroller it was a 16px gap the lanes scrolled up through, above the dates. Under 900px the page simply scrolls, as the tray already does.

**Training videos (18 Sep, later).** Video 4 is now "Preparing for the final walkthrough", and the long one moved into the same list as "Updating your job in the system" — one numbered list of five in `docs/help/training/{staff,contractor,employee}.md`, no separate "Full walkthrough" section.

## Security hardening batch (18 Sep 2026)

Whole-repo audit against the `CLAUDE.md` rules; full findings in `docs/reference/2026-09-18-security-audit.md`. Dependencies: `next` 16.3.0 → 16.3.5 (two unauthenticated RCE advisories), `sharp`, `vitest`, `js-yaml`; `npm audit` is clean. New `lib/security/`: `trustedOrigin.ts` is the ONLY way to build the origin of a link we email — it reads the site URL from env then Vercel's forwarded host and never the caller's `Origin` header (which had let a sign-off caller choose the host the customer's token was mailed to); `tokenRouteLimit.ts` is one shared per-IP budget across every `/<door>/[token]` route, answered in `proxy.ts` before any database work (the CLAUDE.md "token routes are rate-limited" rule, previously unimplemented). `next.config.ts` now sends the baseline security headers on every response (frame-ancestors none, nosniff, strict referrer, HSTS). Token schemas that feed a PostgREST `or=` filter restrict the charset, not just the length (`app/s/[token]/actions.ts`, wizard submit). Migration `20270167` guards the two contractor-invoice attach functions that any signed-in user could call, revokes the two definer helpers that were PUBLIC-executable by default, and pins `company-docs` private. Vitest aliases `server-only` to `lib/testing/server-only-stub.ts` so service-touching modules can carry the tripwire and still be unit-tested.

## Customer estimate — item counts per room, and "More photos" (18 Sep 2026)

Tom: "when updating the number of items in an estimate (posts, windows, doors…) include the number so the customer can see how many we have counted per room or area", and "the customer sees 9 images even when more are attached — a button underneath, More photos, opens the rest". `SnapshotSurface` (`lib/customer/snapshot.ts`) gains optional `count`; `buildCustomerDoc` in `app/quote/QuoteBuilder.tsx` sets it through `countFor(area, surface)` — only when the rate item is per item (`surfaceCalc(...).isItem`, i.e. unit "Hours Per Item") and the count is a positive number — for a room's surfaces AND the `<li>` list of a room's optional substrates. Measured surfaces (m², lineal metres) and snapshots sent before this change carry no `count`, and every consumer tolerates its absence. `CustomerEstimate` (`app/e/[token]/CustomerEstimate.tsx`) prints it as a muted `× N` chip (`.s-count`, `data-testid="surface-count"`) after the label in the scope list — from two up only (`showCount`; Tom: "hide chip" for a single item; the snapshot still carries `count: 1`), and `PrintQuote`'s surface line reads "Doors × 4 (2 coats · product)" on the PDF. Photos: the section still shows the first nine (`PHOTOS_SHOWN`); when the areas hold more, a `More photos (N)` button (`.more-photos`, `data-testid="more-photos"`, `aria-expanded`) toggles a second grid (`data-testid="more-photos-list"`) with the rest, and reads "Fewer photos" while open. Component state only — nothing is written. No migration. Spec: `e2e/estimate-item-counts.spec.ts` (staff save writes the count into the snapshot and an anonymous customer reads "× 4" on Doors and nothing on Walls; a twelve-photo snapshot shows nine, the button names three, pressing it shows all twelve; nine or fewer shows no button). Help: `docs/help/estimator/customer.md`, `docs/help/estimator/staff.md`.

## Main's e2e job was red for two days, and only one of the three was a bug (18 Sep 2026)

`e2e (test project)` had failed on every completed main run since 16 Sep (141 passed, 3 failed, 4 flaky). It was easy to miss: the WORKFLOW-level `concurrency: ci-${{ github.ref }}` has `cancel-in-progress: true`, so each merge to main cancels the previous main run and most of them read "cancelled", not "failed". Three separate causes.

**1. The tenant photo text had silently lost its reassurance — a real regression.** A tenant gets an unexpected SMS from a painting company asking them to photograph their home, so the copy says who we are, who asked, and that it is nothing to do with their bond or their lease. `lib/portal/tenant-link.ts` still carried those words, and `lib/portal/tenant-link.test.ts` still passed — but nobody was sending them. The automations control screen (0bf15c6, 16 Sep) added a Settings-editable `tenantLinkSms`, `app/account/(portal)/quote/[id]/tenant/actions.ts` uses that template whenever it is non-blank, and `DEFAULT_MESSAGING.tenantLinkSms` shipped a terser line — never blank, so always winning. Fixed by moving the FULL wording into that default and making `tenantMessage()` render the same string through `renderTemplate`, so the two cannot drift again. The half-sentence a placeholder could not carry ("Northcote Property Co has asked us" vs "your property manager has asked us") is a new `{{who_asked}}` placeholder, listed in the automations registry and given a sample value in `lib/automations/controls.ts` so the Settings preview never shows a raw token. The new unit case asserts the DEFAULT TEMPLATE — the thing that is actually sent — carries the bond line, resolves every placeholder and stays inside two segments.

**2. Three journeys died on `estimates_created_by_fkey` — two e2e runs deleting each other's users.** `e2e/global-teardown.ts` deletes what the run created "since the marker", and A TIMESTAMP IS NOT OWNERSHIP: every row a CONCURRENT run created falls inside the same window. CI serialises itself (the constant `e2e-test-project` group, shared with the sweep); nothing serialised a LOCAL run against the same project, and this repo is worked in several checkouts at once. So a local run finishing mid-CI deleted CI's live anonymous users while their JWTs were still in the browser, and the next insert carried a `created_by` pointing at a user that no longer existed — surfacing to the customer as "Couldn't create the estimate", always late in the run (r5-editor, save-and-book, what-we-do). `e2e/run-lock.ts` now takes a Postgres session advisory lock in `global-setup` and releases it in `global-teardown` AFTER the delete walk; a second run is refused with an explanation rather than corrupting the first. The lock is held by the connection, so a crash or a killed job frees it with no stale state. **It must not be taken over the transaction pooler:** `E2E_DATABASE_URL` is Supabase's pooler on :6543, where two connections measured the same `pg_backend_pid()` and the second `pg_try_advisory_lock` returned true (a session's own lock is re-entrant) — a lock that excluded nobody. `lib/testing/session-pooled-url.ts` moves it to :5432, the session pooler, where it was measured to behave: different pids, second caller refused, free again when the first connection ends.

**3. The Estimates search failed on CI and passed locally — a pre-hydration click.** `Clear` is a `type="button"`, so before React attaches it does nothing at all: no error, no navigation, and Playwright reports a `toHaveURL` timeout rather than a missing element, which reads like a product bug. `app/(app)/estimates/SearchBox.tsx` now carries `data-ready="1"` once mounted (set on the frame after mount, not synchronously in the effect), the same honest go-signal the wizard uses, and the spec waits for it before clicking. No migration for any of this.

## The pre-start list on every job — employee or contractor (18 Sep 2026)

Tom: "in PC command the pre-start checklist has been removed from employees — it still needs to happen for both." No code branches on employment type anywhere near it: `app/pc/wo/[id]/page.tsx` renders the **Pre-start** card when the job is at that stage AND has rows, and the rows had exactly one way of being made — the `wo_events_seed_checklists` trigger, which fires on a *stage_changed* event into `offered` or `pre_start`. A work order is issued straight into `offered` by an insert, so nothing seeds then; the list was built by the move INTO pre-start, and `assign_job` makes that move only `if v_first and v_wo.stage = 'offered'`. Any job that missed that one chance (a painter added to a job already under way, a job assigned from another stage) kept no list — and because `wo_gate_blocked` counts *unticked required items*, an empty list read as "nothing left to tick" and `wo_autostart_sweep` walked the job into In progress past a screen nobody ever saw. The same shape as the invoicing read failure and the missing RLS policy: an empty array is not proof of "nothing to do". Migration **20270173** gives the seeder two more doors — `wo_orders_seed_checklists` (at issue) and `wo_assignments_seed_checklists` (the employee path, whatever the stage and whichever painter) — and makes the gate REFUSE a job whose pre-start list does not exist, in words: "the pre-start list has not been built for this job yet". One idempotent seeder, three triggers, not three seeders. The office's page seeds on view at `offered`/`pre_start` alongside the tick-list and QA self-heals already there, and draws a **list not built** card rather than nothing if that ever fails; the painter's **Ready to start?** card no longer reads a missing list as "everything is ticked" (`listBuilt`). `e2e/employee-prestart.spec.ts` is the spec that was missing: every test we had reached pre-start through `completePreStart`, which walks whatever rows it finds — on a job with none it ticks nothing and returns happily, so an empty list and a finished list were indistinguishable.

## Dark or light in the contractor portal (19 Sep 2026)

Tom: "a switch for the contractor portal to be in dark or light theme to match with other themes." The portal joins the CRM, Projects and Payments on the switch they already share — the same `app/components/ThemeToggle.tsx`, the same `crm_theme` cookie (`lib/theme/cookie.ts`) and the same token names — rather than growing a second way of deciding what the app looks like. `app/portal/layout.tsx` reads the cookie on the SERVER and puts `data-theme` on `.pt`, so the first paint is already the right palette; the toggle rides in the header with `rootSelector=".pt"`, so a press swaps it with no round trip. Employees get it too: the painter portal is this shell with different tabs.

**The palette is a token block, but three surfaces needed restating.** `app/portal/portal.css` was written dark-only, so the page behind the phone column, the sticky header and the fixed tab bar carried near-black literals instead of tokens, as did a handful of dark-mode-only text colours (the `.err`/`.ok` banners, the offered and office-blocked calendar days, the progress bar's track) and the accent washes, which are alphas of the DARK accents and all but vanish on white. Those are restated under `.pt[data-theme="light"]`; everything else in the file already reads a token and follows for free. `--soft`, `--green` and `--accent` are defined in the light block ONLY — each is used somewhere with a `var(--x, literal)` fallback, so defining them in dark would have changed screens nobody asked to change.

**The job screen was the real work.** `/portal/jobs/[id]` embeds `WorkOrderDoc`, which is the `.wo` surface with its own token set: left alone it sat as a black slab between a light header and a light tab bar — worse than no switch at all. `app/w/workorder.css` gains a light token block scoped to `.pt[data-theme="light"] .wo` (plus a `.wo[data-theme="light"]` half for the day the token link wants one), which is nearly all it needs because that file is written in `var()` and `color-mix` — the accents re-derive themselves. The token link (`/w/[token]`), the crew share, the staff "as contractor" preview and the quote builder are deliberately NOT in that selector and keep the dark sheet they were designed as. `app/components/finish.css` is shared by both surfaces and hard-codes three colours it could not tokenise; the chip's pale-cyan label on a pale-cyan wash disappeared entirely in light, and is restated for a light host. Its header comment used to claim the file "never hard-codes a colour" — it does, and now says so.

**The logo swaps with the palette.** The portal painted a single white-lettering mark, which is invisible on a light header. `getCompanyContact()` (`lib/portal/data.ts`) — the whitelisted service read the portal uses because `settings` is staff-RLS'd — now returns `logoUrlLight` alongside `logoUrl`, falling back to the main mark when only one is configured, and the header carries both with `[data-theme]` choosing. Same pair and same discipline as `loadLogos()` on the staff surfaces.

No migration, no schema, nothing stored server-side: the choice is a cookie plus localStorage on that browser. Spec: `e2e/portal-theme.spec.ts` — asserts the palette as COMPUTED colour (a `data-theme` no stylesheet answers is exactly the failure worth catching), that a reload still serves light (the cookie, not just a class flipped in the browser), that it holds across Jobs, Calendar, Profile and Help, and that the two logos swap and survive a server render. Help: `docs/help/portal-theme/{contractor,employee}.md`.

## A refused e2e run must delete nothing (19 Sep 2026)

The run-lock (18 Sep) stops two runs sharing the test project. It does not stop the *teardown* of the run it just refused: **Playwright calls `globalTeardown` whenever `globalSetup` was invoked, thrown or not.** A refused run had written no marker of its own, so `global-teardown.ts` fell back to `RUN_MARKER_FILE` — `pg-e2e-run-marker.json` in the machine's temp dir, shared by every checkout and worktree and outliving the run that wrote it — found the PREVIOUS run's timestamp, and deleted every row created since. Measured, not hypothetical: on 19 Sep a refused local run deleted 22 users, 12 estimates and 3 accounts belonging to the run that held the lock and was still going. The lock refused the run, correctly, and the teardown then did the exact damage the lock exists to prevent — the same `estimates_created_by_fkey` shape as 16 Sep, from the other end.

The rule is **ownership, not recency**. `global-setup.ts` stamps a fresh `RUN_ID` (a `randomUUID`) into `process.env.E2E_RUN_ID` and into the marker it writes, alongside the window. `lib/testing/teardown-window.ts` is the pure decision: the environment is trusted first (same process, same run); the marker file is used ONLY when it carries this run's id; everything else — no run id at all (global-setup did not complete here), a marker from another run, a marker with no id because an older checkout wrote it, a marker naming this run but carrying no start time — deletes nothing and says why. It fails closed by construction: a run that cannot prove it recorded the window owns no rows. `lib/testing/teardown-window.test.ts` pins all of it, the refused-run case first.

Proven on the test project, both directions: with a peer process holding the advisory lock, a run is refused and the teardown reports "deleting nothing — global-setup did not complete in this process" with `auth.users` unmoved at 9,038 (the old code would have deleted 327); with the lock free, a run still reports "created 1, deleted 1 user, left 0". No migration.

## The test project was filling up, and the sweep was never sized to catch up (19 Sep 2026)

Measured, not estimated: 8,711 run-created users, of which **8,290 were already older than the three-day cutoff** — eligible that minute. The sweep deleted **200 a day**. That is a 41-day tail with no new leakage, and there was plenty of new leakage. Nearly half the backlog (4,014 users) came from 9–10 Sep, the run-up to the 11 Sep outage. Four changes, none of them to product code.

**The leak was cancelled CI runs, and it was the normal case.** `.github/workflows/ci.yml` carried workflow-level `cancel-in-progress: true` on `ci-${{ github.ref }}`. On a branch that is what you want; on `main` every merge killed the previous main run mid-e2e, so its `globalTeardown` never ran and a whole run's users, estimates and accounts were left behind. **Six of the eight main runs before 19 Sep were cancelled that way.** It is now `cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}` — branches still cancel superseded runs, main runs finish and clean up after themselves, and the e2e job's own constant `e2e-test-project` group still serialises them so they queue rather than overlap.

**The sweep now takes the same advisory lock an e2e run does** (`scripts/c1/session-url.mjs`, the plain-JS twin of `lib/testing/session-pooled-url.ts` — `node scripts/c1/hygiene.mjs` cannot import a `.ts` module, and `session-pooled-url.test.ts` imports both and pins them equal, key included, because a lock taken on a different connection or a different key silently excludes nobody). It deletes by AGE, and a live run's rows become old enough to qualify while it is still using them — "a timestamp is not ownership" from a third direction. CI could not collide (the sweep workflow shares the e2e job's concurrency group) but a LOCAL run has nothing in common with a GitHub concurrency group, and this repo is worked in several checkouts at once. Only `sweep` takes it: `teardown` is spawned BY `global-teardown`, from a process that already holds it, and taking it again would refuse the run's own cleanup. A sweep that finds the lock held **skips green** with a line saying so — a red job there would train everyone to ignore it.

**With that lock in place the grace period had no job left to do**, so the age cutoff drops 3 days → 1 and the batch 200 → 1,000. The old 200 was chosen when a single auth-user delete measured 13.5 s, before its hot FKs were indexed; it now measures ~0.15 s, so 200 was spending 30 seconds of a 20-minute budget. `hygiene.yml` gains a `budget_min` input for clearing a backlog by hand (batch 9000, budget_min 45 — the walk is chunked, each chunk its own transaction, so stopping on the budget is safe and the next run resumes at the oldest row left).

**And the tripwire now reports what actually grows.** It thresholds users, because users are what the delete walk is bounded by — but those 8,711 users were carrying 66,168 estimates, 31,654 properties and 27,225 accounts, so the one number it printed understated the load about eightfold. The hangers-on are reported beside the total, explicitly outside the threshold. Verified against live CI traffic: with a real e2e run holding the lock, `sweep` exited 0 having deleted nothing, and `count` printed "carrying estimates 66,209, accounts 27,229".

## Home dashboard v2 · 0a — the send action now writes what the dashboard will read (19 Sep 2026)

The dashboard (`docs/briefs/claude-code-brief-home-dashboard-v2.md`) is a reader, so the build starts with capture. `20270175` adds `estimates.sent_by_user_id` (set once by `send_estimate`, server-owned — not in the authenticated column grant, backfilled from the `sent` event's `payload.by`), `estimates.lead_source` and `accounts.lead_source` (the CRM's `SOURCES` vocabulary from `lib/crm/attribution.ts`, mirrored in `public.lead_source_keys()` and pinned by `lib/estimate/dashboardCapture.test.ts`), `accounts.category` and `presentations.category_label` (blank → the name, by trigger). Lead source flows account ⇄ estimate by trigger: the wizard's `first_touch_recorded` event fills the account and every blank estimate of it; an estimate inherits its account's source at birth or link; a staff pick fills an account that has none (`unknown` = "Not recorded" never propagates). `send_estimate` refuses without a lead source (`error:lead_source_required` → the builder's picker under Job settings), and the send firing `estimates_capture_to_account` gives the account its category from the ticked presentation's label — first send wins, never overwritten. `/api/estimates/downloaded` (token-authorised, rate-limited, same answer for every token) writes the `downloaded` estimate event when the customer presses Download. What was already there and is deliberately not duplicated: `valid_until` IS the brief's `expires_at` (written at send, read by `crm_lapse_estimates`); `presentation_id` is the builder's per-estimate tick (the "one per job type" tick in the presentations summary was never built — no tick reports as "Uncategorised"); `question` events are the brief's `question_asked`. Spec: `e2e/dashboard-capture-estimates.spec.ts`.

## The workmanship warranty: approved, non-transferable, and on the estimate (19 Sep 2026)

Tom's four rulings in one line each: approve the August draft and take the DRAFT watermark off; the warranty **does not transfer** to a new owner; **two years for everybody**, with no per-estimate switch; and the customer should read it **on the estimate they are deciding on**, beside the public liability and SWMS cards.

**The words moved into `lib/warranty/terms.ts`** — nine clauses, the promise, the limit, the ACL line and a one-paragraph version for the printed quote, all parameterised by the warrantor's details. Before this the terms existed once, as JSX inside the portal's `WarrantyTerms.tsx`; putting them on a second surface would have forked them, which is the failure this repo keeps legislating against. Both surfaces now render the module, and `lib/warranty/terms.contract.test.ts` is the no-fork proof: it reads both components' source and fails if either imports nothing from the module, or if a sentence unique to the terms reappears inside a component. Clause 8 is the one change from the draft — Option A, personal to the customer, not assignable, with the ACL carve-out kept so the clause cannot be read as taking away a statutory right.

**On the estimate** (`/e/[token]`) a fourth trust card sits after public liability and the SWMS card — `snap.proof.warranty`, which every snapshot has carried since the beginning and nothing rendered. It is a **download, not prose**: Tom's follow-up was "please have workmanship warranty as an attachment with this information, rather than written directly on the estimate", so the card opens `/e/[token]/warranty` — the terms as their own document, with **Download as PDF** (the portal's `PrintButton`, reused rather than forked), exactly the shape of the SWMS attachment beside it. The quote stays a quote: `print-warranty` on the paper version is one paragraph that states the fact, says it does not transfer, carries the prescribed ACL line and points at the attachment, and `warrantyAttachmentLine()` is unit-pinned never to grow into the terms.

The attachment is **token-scoped rather than a global `/warranty` page**, for two reasons: its clause text is built from `snap.company`, so an estimate sent months ago shows the warrantor details it was sent with — a token surface rendering snapshot data, as the rule requires — and an unknown token 404s there exactly as it does on the estimate. It deliberately avoids the `.wrap` class, because the print sheet hides `.wrap` to swap in the paper quote and this page has to print as itself; `.docpage` has its own black-on-white print block. No migration and no new snapshot field: the warranty is universal, so there is nothing per-estimate to store.

**The watermark** is `settings.warranty_terms.approved`, read by `getPortalAftercare`; Settings → Documents ticks it by hand and `20270174000000_warranty_terms_approved.sql` sets it on both projects in one paste, merging rather than replacing the row and reading it back so "applied" is not assumed. The switch and the watermark code stay exactly as they were — approving is a value, not a deletion.

**What was deliberately NOT built:** a per-estimate warranty switch, and a per-job term field. Both were proposed after Tom asked whether the warranty could be dropped for jobs like real-estate touch-ups; he ruled the other way ("active for everybody"), so `years` stays the literal 2 in `wo_sign`, `wo_close_without_walkthrough` and `wo_complete_after_rectification`, and §3 decision 8 of the brief is closed rather than open.

Specs: `e2e/estimate-warranty.spec.ts` (anonymous customer — the card's place in the trust row and that it points at the attachment, the terms NOT being on the quote, the attachment's clauses and warrantor details, an unknown token 404ing, the no-transfer clause, and the printed pointer) and the warranty assertions in `e2e/portal-aftercare.spec.ts`. Help: `docs/help/warranty/{customer,staff}.md`.

## Home dashboard v2 · 0b — who is speaking, and whether the customer is still waiting (19 Sep 2026)

`20270176` adds `messages.sender_role` (customer · staff · system · assistant · unknown) with one rule in two places — `deriveSenderRole` in `lib/messaging/record.ts` for every send through `recordMessage`, `message_sender_role()` in Postgres for direct inserts (the portal mirror) and the backfill; `lib/messaging/senderRole.test.ts` reads the migration and pins the kind lists. `unknown` is only a legacy outbound row nobody signed; it keeps counting as a reply so no old thread is resurrected, and no new row is ever unknown because every send site now names its kind (`magic_link`, `assistant_handoff` added). The account is the thread: `crm_account_facts.last_inbound_at` / `last_staff_reply_at` are maintained by `messages_touch_reply_facts` (insert and attach) — a `system` or `assistant` send, a failed or suppressed one, never moves the reply clock — and the work queue's `message_unanswered` source uses the same rule (`buildMessageItems` ignores system/assistant touches). Reads: `customer_thread_opened(estimate ids)` marks mirrored staff replies read with `readSource = portal`; it runs inside `get_estimate_thread_by_token` (the token chat) and from `lib/portal/messages.ts` (the portal); a Resend `email.opened` sets `read_at` with `readSource = email_open, readIsBestEffort = true` in `updateMessageStatus`, never over a portal read. Spec: `e2e/dashboard-capture-messages.spec.ts` (customer → chase → still waiting → staff reply → read).

## The sweep could never run on a busy day (19 Sep 2026, later)

The backlog clear dispatched right after the hygiene fixes merged — batch 9000, budget 45 — **was cancelled while it waited, by nobody.** `hygiene.yml` shared the `e2e-test-project` concurrency group with the CI e2e job so the two could never overlap. But **GitHub keeps only ONE pending run per concurrency group, and a newly queued run displaces the pending one**; `cancel-in-progress: false` protects the entry that is RUNNING, not the one waiting. The sweep sat pending behind an e2e job, the next CI run joined the group, and the sweep was cancelled. On a day with merges that is every time — which is most of why an 8,700-row backlog existed while every scheduled sweep reported success: the nightly one runs at 03:00 Melbourne when nothing else is queued, so it survived, and did its 200.

The sweep now has **its own group** (`hygiene-sweep`). What keeps it away from a live run is the advisory lock it takes, which is strictly better than the shared group ever was — the group only ever covered CI, and the runs that actually collide come from the several local checkouts this repo is worked in.

And it now **waits** for a run rather than bouncing off it (`--lock-wait-min`, default 12): a suite is 20–40 minutes and the sweep has all night, so giving up on the first refusal produces a string of green sweeps that deleted nothing — the same failure as the backlog itself, one level up. Verified against live CI: `sweep --batch 200 --lock-wait-min 2` logged "waiting up to 2 min for it to finish…", waited, and exited 0 with "still holds the test project after 2 min. Nothing was deleted".

## Housekeeping gives way (19 Sep 2026, later still)

Giving the sweep its own concurrency group fixed the starvation and created a worse problem: it could now run beside CI, and it held the e2e run lock for the WHOLE sweep. A 45-minute backlog clear therefore refused every e2e run that started underneath it — `acquireRunLock` fails, it does not wait. Measured the hard way: CI runs 667 and 669 failed that way while a dispatched clear was running, with Tom mid-session. A tidy-up job took out real work.

**The sweep now works in SLICES and drops the lock between them** (`DEFAULTS.sliceUsers`, 50 — two chunks, ~20 s). It is safe to work in slices because **the age cutoff, not the lock, is what keeps the sweep off a live run's rows**: nothing younger than `--age-days` is ever selected and a run's rows are minutes old. The lock only has to cover the moment a delete is actually running. Between slices it releases, pauses 500 ms, and re-acquires, so a run waiting on the lock gets it within a second or two. When it cannot get the lock it **gives way** — reported as `GAVE WAY to an e2e run`, exit 0 — and the waiting budget (`--lock-wait-min`) is spent across the whole sweep, so it can ride out one suite and carry on.

**It polls for the gap every 2 seconds, not every 15.** The gap the sweep needs is the one between a run's teardown and the next run's `global-setup`, which on a busy afternoon is seconds wide; a 15-second poll walked straight past them and the sweep gave way for its entire budget without deleting a row — measured twice, 400 and 600 batches, both `deleted 0`. The probe is one `pg_try_advisory_lock`.

**And a run now retries a held lock briefly before refusing** (`ACQUIRE_RETRY_MS`, 45 s, `e2e/run-lock.ts`). The only thing a run should ever meet is a sweep slice, and failing instantly on one would turn housekeeping into a red CI run. It stays short on purpose: against a real concurrent RUN (20–40 minutes) nothing changes — it still refuses with the same explanation — and a run that waits minutes for another run is worse than one that tells you to come back.

The asymmetry is the whole design: a run is someone waiting for an answer, the sweep is housekeeping that has all night.

## Home dashboard v2 · 0c — the loop writes down when, how long, which attempt, and whether a review came back (19 Sep 2026)

`20270178` (B3). `wo_tick_surface` writes `wo_events` 'all_surfaces_done' once, on the tick that leaves no non-removed surface undone (backfilled from `state_changed_at` where every surface is done). `booking_offers.booked_end_date` is frozen at acceptance by trigger; `end_date` keeps moving (the painter's finish date, reschedules), and a grown span on an accepted booking writes 'booking_extended' with `days_added` — a shifted span does not. `wo_qa_checks.attempt_no` = 1 + the failed checks before it, by trigger and backfill. `review_requests` (one row per job, staff RLS) holds `sent_at`/`sent_via` and `received_at`/`rating`; `wo_review_requested` and `wo_review_received` are a person's ticks (the review-request automation is still `planned` in the registry; ⚑B2 keeps "received" manual until the Google API), surfaced on the PC job page as `ReviewCard` at walkthrough and closed. Worked hours are **opt-in per contractor** (`contractors.capture_worked_hours`, `set_contractor_capture_worked_hours`, the button on /contractors): when on, the portal's `FinishUp` asks days and hours, pre-filled from the booking through `scheduleDays` and `worked_day_hours()` (a SECURITY DEFINER read of the staff-only Settings row, default 8), and `wo_enter_worked_hours` upserts `wo_worked_hours` (source 'entered', refused with `not_asked` for anyone not opted in — the flag is enforced server-side, not by the screen); the entry rides the self-invoice PDF as a no-amount reference row. `lib/reporting/workedTime.ts` is the ONE function every tile will read: `entered` verbatim, else `schedule` = booked days (the painter's working week respected) × day length, stopping at the last tick and capped by the booking's hours allowance when the job finished early; `coverageLine` is the sentence a tile must show beside a blend, and `isCalibrationEvidence` keeps the calibration table to entered rows. Verified, not built: `wo_photos.taken_by`, `contractor_expenses.contractor_id`, `messages.actor_profile_id` and `wo_events.actor` already name who, so "silent contractor" derives without a new column. Spec: `e2e/dashboard-capture-workorders.spec.ts`.

## Home dashboard v2 · 0d — roles and the figures the office types in (19 Sep 2026)

`20270179` (B7). Roles sit beside the existing staff model (20270106: `profiles.is_owner` is the master, `profiles.staff_access` hides areas): `profiles.staff_roles staff_role[]` (owner · admin · pc · sales · finance), changed only by the master through the same guard trigger. `dashboard_roles()` is the caller's effective set (master = all five, non-staff = none); `has_dashboard_role(...)` and `dashboard_sees_money()` (⚑2: owner or admin) are what RLS and, from session 1, every money-bearing route and export gate on. `lib/reporting/roles.ts` is the app-side twin — `effectiveRoles`, `sectionsFor` (the union, ⚑1), `seesMoney`, `MONEY_SECTIONS` — pinned against the migration's enum by `roles.test.ts`. `sales_targets` (month, target, optional category/salesperson for later — ⚑9 v1 = month total) and `marketing_spend` (month × channel from the CRM's lead-source vocabulary — ⚑5) are readable and writable by owner/admin ONLY; a sales login's select returns an empty list, its insert 42501. The four thresholds (⚑7 silent days 3, ⚑8 anomaly 25%, ageing edges 7/30) are numeric Settings rows `dashboard_*`. Screens: role ticks on Settings → Staff logins (`StaffAccountsManager`, `staffActions` carry `roles`); a Settings → Dashboard folder (`DashboardSettings`) rendered only when `dashboard_sees_money()` says so. Help: `docs/help/dashboard/staff.md` (the per-role dashboard help files come with session 6). Spec: `e2e/dashboard-settings-roles.spec.ts`.

## The run lock now says who is holding it (19 Sep 2026)

A local run was refused with *"another e2e run already holds the test project… a local one is usually a peer checkout's `./scripts/c1/run-e2e.sh`"*. There was no such run. The process table was empty, CI was idle, and only a `pg_locks` query gave the real answer: the **hygiene sweep** held it, 26 minutes into clearing the backlog. Three things contend for this lock — a local e2e run, a CI e2e run, and the sweep — and the message only knew about two of them, so it asserted the wrong one with confidence.

**The reason nothing could name the holder is the pooler, one layer deeper than the trap already documented in `run-lock.ts`.** Both holders passed `application_name` to `new pg.Client({…})`, which sends it in the STARTUP PACKET — and Supabase's pooler replaces it. Every lock-holding connection read back as `"Supavisor"` in `pg_stat_activity`. A runtime `set_config('application_name', …)` survives; measured both ways on the test project. So each holder now stamps `pg-e2e-lock:<kind>:<ci|local>:<ISO minute>` on its own connection after connecting, and a refusal reads it back and says which one it is. `lockHolderName` / `describeLockHolder` / `LOCK_HOLDER_QUERY` live in the twins (`lib/testing/session-pooled-url.ts` and `scripts/c1/session-url.mjs`) that already had to agree, and the pin test covers the new pair too.

**A second, quieter error came out of the rehearsal:** `pg_stat_activity.backend_start` is the POOLED BACKEND's age, not the holder's. A connection that had held the lock for one second reported `00:44:27`, because the session pooler handed it a 44-minute-old backend. So the elapsed time in the message is computed from the timestamp the holder wrote into its own name, and a connection age is only ever printed as a connection age, with a sentence saying it is not the lock's.

An unnamed holder — an older checkout, for as long as one exists — reads as *"something that did not record what it is"*. It never guesses. Proven live against the real lock while the old-code sweep held it, and against a named holder on a spare key. No migration, no product code.

## Home dashboard v2 · session 1 — the reporting core and the /home shell (19 Sep 2026)

`lib/reporting/core.ts` is the contract every later session plugs into. A metric is a `MetricDef`: key, kind (`period` moves with the range and compares with the previous period of equal length — a partial month against the same days of last month, a whole month against the whole previous month; `now` is a state count that ignores the range and says "right now"), section, a definition string beside it (a metric without one fails `core.test.ts`), unit + GST basis, roles, an `aggregate` (`count` or `{ sum: column }` — the value is never typed by hand, so a tile equals its rows by construction), CSV columns and a pure `select(input, range)`. `runMetric` is the ONE gate: it checks roles inside the function (`ForbiddenError` → 403 from any caller) and returns `{ value, compare, rows, definition }`. Melbourne days come from an `Intl` formatter, never `toISOString().slice(0,10)`. `registry.ts` lists every metric (`sales.estimates_sent`, `sales.sales_cents`, `sales.sales_count` in session 1), `metricsForSection`, and `SWITCHES_ON` — the honest text a section shows until its module ships. `seed.ts` is the deterministic golden dataset (60 estimates, 3 categories, 2 salespeople, 20 work orders, 30 payments) the tests recount by hand. `load.ts` (server) fetches roles through `dashboard_roles()` and the estimate rows for the range plus its comparison, every read with `error` surfaced as `loadFailures` — the page shows a "could not be read" notice, never a zero. `strip.ts` builds the needs-doing strip from the evaluators that exist (work queue by GROUP: money → finance, follow-ups → sales, messages → all; PC console cards → pc; owner/admin all), no list logic of its own. `/api/reporting/export` is the one CSV route (metric key + range → the metric's rows and columns, streamed with a BOM, CSV-injection neutralised, `X-Metric-Value` header = the tile). `20270180` adds `metrics_daily` (owner/admin read, service write) and `/api/cron/metrics-daily` (16:00 UTC, `CRON_SECRET`) rolls every period metric for the day just ended with the same functions — a cache, never a second definition. `/home` (`app/(app)/home`, the `home` area first in `STAFF_AREAS` and the rail) renders the mockup: header + chips (query params, so the URL is the state), strip, sections for `sectionsFor(roles)` in order, tiles (`HomeTiles`: press → rows + i + Export CSV + Open list). NOT yet: /home as the post-login landing — 64 specs pin `/estimates` after sign-in; the flip is session 6's polish with a spec sweep. Spec: `e2e/dashboard-home.spec.ts` (four logins → four homes; finance's sales export = 403; tile = CSV rows).

## The live-progress phone on the customer estimate (19 Sep 2026)

Brief `docs/briefs/claude-code-brief-estimate-live-progress-v4.md`, mockup `design/reference/estimate-live-progress-mockup-v4.html`; no migration. Between the scope of works and the paint section, `app/e/[token]/page.tsx` renders `ProgressSection` only when the sent snapshot carries `presentation.blocks` and `lib/progress-preview/context.ts` (service-client read by share token: `estimates.source`, the linked account's `account_type`/`name`, the property's references, and the `website_content` settings row) says the estimate is eligible — wizard-built ones never are. `lib/progress-preview/templates.ts` is every word (two messaging sets — trade account → commercial, else residential — the "Example of your live updates" label, the two "For illustration only" lines, photo tags, the commercial banned-word list); `build.ts` is the pure `buildProgressPreview` over the customer payload (address split the way `suburbOnly` does, area groups that never repeat inside one update, the estimate's OWN photos in order ≤2 per update never twice, exterior wording, escaping by construction: plain text only). The phone (`ProgressPhone.tsx`, client) renders the portal's own `app/account/(portal)/JobTimeline.tsx` through its new `sample` prop — feed-only, precomputed items and public URLs, never a storage signature (`jobTimelineSample.test.ts` mocks the signer to throw) — and reveals its items on the mockup's timings; plays at 40 % in view, loops after 6.5 s, stops when hidden, `prefers-reduced-motion` = final state in CSS and state, hidden from print. The Demo painter is `website_content.demoPainter` (a painter's NAME from Settings → Website, resolved by `demoPainterFor` only with a photo). Tracking: `/api/estimates/progress-preview` (token-authorised, rate-limited, same answer for every token) writes `estimate_events` `progress_preview_<started|completed|replayed|cta_clicked>` and the CRM event `estimate_progress_preview`, once per type per load except replay. Spec `e2e/estimate-live-progress.spec.ts` (anonymous customer, nine cases, restores `website_content`); walk seed `scripts/c1/seed-live-progress.mjs`; help `docs/help/live-progress/`. **20 Sep (Tom, F14 in the brief): the phone moved behind one glowing card.** `app/e/[token]/LiveUpdatesCard.tsx` (client) is a `.cap.cap-live` button appended by `PresentationBlocks` (new `liveUpdates` prop) to the presentation's first capability panel — "A few extra details" on the live presentations — or to a panel of its own when there is none; pressed, it mounts the `ProgressSection` node under the cards (`.cap-live-panel`, full grid width) and fires `cta_clicked`; the hero button and the step-4 link are gone. The builder's ESTIMATE preview rides the same path (QuoteBuilder still hands `progressPreview` to `CustomerEstimate`). Same day: **"Ask a question" opens the live chat as a pop-up** — `CustomerEstimate` keeps one `chatOpen` state; the hero button, the accept panel's Message us/Open chat and the `#chat` deep link all open the same `.chatpop` (fixed, bottom-right, above the sticky bar) around the existing `chatUi`; the separate `ask` form and its `ask_estimate_question` call are removed from the page (the RPC stays). And **the staff chat dock's pill no longer disappears when nothing is open** (`StaffChatDock`: "Live chat" with no badge), so it is in the corner of every staff shell. Specs `e2e/estimate-ask-chat.spec.ts` + the reworked `estimate-live-progress.spec.ts`. **Later on 20 Sep — the chat reaches the office.** `POST /api/estimates/chat` (token-authorised, rate-limited) replaces the page's direct RPC call: `lib/estimates/chat.ts` posts through the same `post_estimate_message_by_token`, then raises the staff alert `office_estimate_chat` (registry + `STAFF_EVENTS`, per-person routing under Staff logins, `staff_notifications` once-only guard; nobody routed → the office address is emailed), recorded with the estimate so a reply can route back. The page's after-hours note is `lib/messaging/officeHours.ts` (Mon–Fri 08:30–16:30 Melbourne, Intl-derived, decided in the browser; the server tags the alert with the same rule). The customer's bottom bar gains **Chat with us** (same pop-up). The staff dock lists estimate threads: `/api/agent/inbox` appends `kind: "estimate"` rows (customer line in the last 3 days; Waiting until a staff reply) and `StaffChatDock`'s `EstimateDockThread` reads via `app/components/estimateChatActions.ts` and replies through the builder's `replyToEstimateChatAction`, whose body moved to `lib/estimates/chatReply.ts` (`postStaffChatReply`: insert + the customer's text/email) so the dock, the builder and `app/api/inbound/messages` (an emailed reply from a staff address to the alert's `reply+` token → `stripQuotedReply` → staff reply on the chat) share one implementation. Help `docs/help/estimate-chat/`.

## Home dashboard v2 · session 2 — PC Command and Contractors, from the evaluators that exist (20 Sep 2026)

No migration. `MetricInput` grew two slices, loaded once per page by `loadDashboard` in `lib/reporting/load.ts`: `console` (the PC console's own `ConsoleInput` and `buildQueue` cards from `loadConsole` — one read shared by the needs-doing strip and the tiles — plus `crm_account_facts` awaiting-reply rows and the signed-off jobs' materials budget vs matched supplier invoices, computed with `materialsBudgetCents` and the pricing context loaded once per rate card, not per job) and `contractors` (the 0c capture: `all_surfaces_done` events joined to their accepted booking and any `wo_worked_hours` row, QA checks with `attempt_no`, accepted offers with their timings, variations, submitted expense claims, the two Settings numbers). `metrics/pc.ts` — eleven tiles, all `now` except the two materials figures — reads only that slice: the SLA, silent and QA-due tiles list the console's cards by key prefix, the stage tiles partition its work orders, so /home and /pc cannot disagree; `pc.test.ts` is the tripwire (same input through `buildQueue` and through the metrics, card for card, and the stage tiles summing to `pulseTiles().openJobs`). `metrics/contractors.ts` — finished on time against the booking's CURRENT end (`countWhere`, "of 11 · 73%"), silent from the console's quiet-site flags at `dashboard_silent_contractor_days`, QA passed first time, offers within 24 h, variations per finished job, expense claims pending, and days/hours through the ONE `workedTime` function with `coverageLine` on the tile and `sourceLabel` on every row — the schedule source counts the BOOKED days only, so an overrun is not a fact it holds. The core gained `Aggregate` variants (`countWhere`, `ratioPct`) and a `note(rows, value, input, range)` per metric, so "8 of 11" and "actual on 4 of 11 jobs" are derived, never typed. Spec: `e2e/dashboard-pc.spec.ts` (a PC login; every count tile equals its rows; the fixture job in progress, finished on time, hours entered by the painter; the one export route; 403 on a sales metric).

## Home dashboard v2 · session 3 — Sales, the funnel and Activity (20 Sep 2026)

No migration. Three more slices on `MetricInput`, loaded by `loadDashboard`: `sales` (presentations → category labels, staff names, `sales_targets` as RLS returns them — a sales login gets none and no card — twelve months of accepted totals by Melbourne month, the viewer and Mine/Team, which defaults to Mine for a sales-only login), `funnel` (`wizard_drafts` started in the window and the estimates they became), `activity` (`crm_events` in the window with the account name, plus the viewer's roles and filters). `metrics/sales.ts` gained `conversion` (a cohort by month SENT, `shareWhere` → %), `aovByCategory` and `bySalesperson` (`display: "rows"` — the mockup's list cards, rendered by `HomeTiles` beneath the tiles; the core's new `divide` aggregate makes the tile the overall average). `metrics/target.ts` is the target card's pure `buildTarget` (sales this month vs the Settings row, pace = share of the month's days gone, no target → "no target set" — acceptance 7; twelve months for the chart), drawn by `TargetCard` as one-axis bars (actual in the deeper paint tone with direct labels on the current and peak month, target as the raised surface behind, a legend, hover tooltips, and a table toggle — the dataviz method's contrast relief). `metrics/funnel.ts` counts a cohort of sessions started in the range per step from what is captured today (started_at, email on the draft, an estimate id, the estimate's sent/viewed/accepted) — B2's per-step stamps and the self-serve tier are named as not captured, never guessed; `wizardSessions` is the exportable row list. `metrics/activity.ts` reads `crm_events` ONLY, reusing `lib/crm/timeline.ts`'s labels (no second timeline from the five source tables); `familyOf` groups event types, `FAMILIES_FOR_ROLE` scopes them (PC jobs/visits/messages, sales estimates/wizard/visits/messages, finance money/messages, owner/admin all), the page's chips and search are URL state and the export carries the same filters (`who`, `family`, `q` on the one route). Spec: `e2e/dashboard-sales.spec.ts` (a sales login: Mine/Team, funnel, no target; an anonymous customer opening an estimate appears on Activity within 5 s; family + search + filtered export; the master's target card and chart).

## Home dashboard v2 · session 4 — Invoicing, from /invoicing's own read (20 Sep 2026)

No migration. `loadInvoicingSlice` in `lib/reporting/load.ts` calls the /invoicing dashboard's own `loadDashboard` (`app/invoicing/data.ts`: the latest 400 invoices with their payments in slices, and the contractor invoices) and converts with its `toDerive` / `toDerivePayments`, so the Home tiles and the /invoicing pulse tiles are computed from the same rows at the same instant; on top it reads the job start dates behind open deposits, the succeeded payments that landed in the window (period tiles), and the two `dashboard_ageing_edge_days_*` settings. `metrics/invoicing.ts` (owner, admin, finance): `openRows` is the outstanding set exactly as `dashboardTiles` counts it (`OPEN_STATUSES`, `invoiceBalanceCents`, `invoiceIsOverdue` — the invoicing module's own functions), so Outstanding and Overdue equal the dashboard tile cent for cent (`invoicing.test.ts` is the tripwire against `dashboardTiles` and `payablesTiles`); Overdue's note ages the balances by the Settings edges; Contractor invoices to pay is the payables "approved" total with to-approve on the line; Unsent is drafts by kind; Deposits unpaid inside 7 days of start joins the open deposits to their job's booked start; Received is payments by `paid_on` in the range split by method (cash was already a method in the record-payment flow — ⚑B3 needed no change); Average days to pay a final counts finals paid in full in the range from issue to last payment (`divide` over a unit column). Spec: `e2e/dashboard-invoicing.spec.ts` (a finance login; Home vs /invoicing at the same instant; the fixture's overdue final in the 8–30 bucket; the one export route; sales metric 403).

## Home dashboard v2 · session 5 — P&L and Marketing, owner/admin only (20 Sep 2026)

`lib/reporting/metrics/pl.ts` and `metrics/marketing.ts` add the two money sections (⚑2: `roles: ["owner","admin"]` on every def, refused inside `runMetric` → 403 on the export route; the page never reaches them for other roles). No migration. The P&L is ex GST on the **Settings basis**: `BASIS_CHIP` on every note; overhead = Settings "Weekly fixed costs" × `weeksIn(range)`; marketing = `marketing_spend` rows for the months that have them (`monthsIn` pro-rates a partial month) else "Weekly marketing" × the uncovered weeks — when MYOB lands the loader swaps its inputs and nothing in the metrics changes. **One read for signed-off jobs**: `load.ts` `loadClosedJobs` returns `ClosedJobRow` (the engine's `priceEstimateTotals` on the estimate behind the job → `est`; contractor invoices approved/paid `subtotal_ex_cents`, supplier `material_costs` inc→ex, `job_costs.amount_ex_cents`, approved `contractor_expenses` ex → `actual`), and the PC materials card is `materialsRowsOf(closedJobs)` from the same rows — no second evaluator. `marginRows` = contract (net subtotal) − third-party − actual cost, with the engine's `marginCents` beside it; `netRows` is a rows card. Marketing: `spendIn(input, range)` is the one spend function (recorded / settings / mixed basis); cost-per-accepted and spend-vs-sales are one row PER ACCEPTANCE carrying an equal share of the spend (the earlier blended+channel row mix double-counted and was replaced), with the per-channel and twelve-month views as rows cards; repeat customers come from `PlSlice.repeatAccounts` (accounts accepted in the window with an acceptance before it — derived in the loader, never a flag). **Anomaly cards**: `strip.ts` `anomalyCards(periodResults, thresholdPct, compareLabel)` turns any period tile ≥ `dashboard_anomaly_threshold_pct` off its comparison into an "Amber · trend" card, appended through `buildStrip({ …, extra })` and role-picked like every other card (owner/admin only). Tests: `metrics/pl.test.ts`, `metrics/marketing.test.ts` (golden seed + hand rows, the ⚑2 refusals per role), `e2e/dashboard-pl.spec.ts` (owner sees both sections + the basis chip + the trend card from a $9m acceptance; pc/sales/finance 403 on six metrics and never see the sections). Help: `docs/help/dashboard/staff.md`; manual: `docs/manual-tests/dashboard-s5-pl-manual.md`.

## Home dashboard v2 · session 6 — finish: landing, definitions, streaming strip, full loop, indexes (20 Sep 2026)

`homeForRole` (`app/auth/actions.ts`) sends staff to **/home**; 87 e2e specs' sign-in expectations widened to `/\/(home|estimates)/`. Every tile carries its own **i** (`HomeTiles.tsx`, `tile-info-<key>` → `tile-definition-<key>`), beside the rows-card and drill "i". **The strip streams**: `loadDashboard` no longer awaits the CRM work queue — it returns `queue` as a promise and the page renders `<NeedsDoing>` inside `<Suspense>`; the sections render on the loaders' critical path (one wave of independent reads, then console-slice + P&L) and the strip fills in when `buildWorkQueue` (fifteen sequential round trips, ~2 s) resolves. Same evaluator, same cards. `data-timings` on the home root carries per-loader ms; `e2e/dashboard-home.spec.ts` logs them and enforces `total < 1500` when `E2E_PERF_GATE=1` (the shared test project's load varies, so the number is always logged and only gates on request). Measured warm as an owner on the test project after the indexes: 0.9–1.4 s (was 3.3–3.4 s). Migration `20270183000000_dashboard_range_indexes.sql`: `wizard_drafts(started_at)`, `crm_events(occurred_at)`, `payments(paid_on) where succeeded`, `estimates(accepted_at)`, `work_orders(stage, stage_entered_at)`. `lib/reporting/csv.test.ts` pins the 10k-row stream (many chunks, BOM once, RFC 4180). `e2e/dashboard-full-loop.spec.ts` drives a job through sent → accepted → booked → live → variation → sign-off → invoice → payment and, after every step, reads the affected metrics through the export route as owner, PC, sales and finance (`X-Metric-Value`) asserting exact deltas and 403s. Help: `docs/help/dashboard/pc.md` is new (PC Command + Contractors moved out of `staff.md`); the brief's `docs/help/dashboard-<role>.md` naming cannot be indexed (the help system's roles are staff/pc/contractor/customer), so owner, sales and finance views live in `staff.md`. **Not done from the brief:** the 25k-account seed was wiped from the test project on 20 Sep (Tom's call, CI time), so the performance gate ran on the live test data (4.7k estimates), not the volume dataset; a real phone pass is Tom's (manual step 5) — the 375 px pass here was headless against the mockup.

### Home dashboard: the period follows you, and a job can be left out (Tom's batch, 20 Sep 2026)

**The period.** Tom: "I can't filter any of the dashboard by date — month, week, quarter, year or custom (calendar pops up for start and end date)." The chips are now `week · month · quarter · year · custom` (`RANGE_PRESETS`, `lib/reporting/core.ts`); the session-1 names (`this_month`, `last_30`, `ytd`) still resolve through `parsePreset` so old links and CSV URLs keep working, and an unknown name is a 400 on the export route, never a guess. A `Range` may carry its own `compare` — a week against the same weekdays of the week before, a quarter or year against the same day-count of the one before (`samePartOfPrevious`), a custom range that is exactly a quarter or a year against the whole one before — and `previousRange` honours it, so the month rule is no longer assumed everywhere: `rangeShortLabel` ("Aug", "Q2 26", "2025", "7–12 Sept", "24 Aug – 6 Sept") replaced the two places that formatted the comparison as a month name (the tile arrow and the trend card). Custom is the CRM's mini calendar, lifted to `app/components/DateField.tsx` with its own `datefield.css` (the CRM file re-exports it — one component, two surfaces) inside `app/(app)/home/RangePicker.tsx`: From and To pickers and Apply, which pushes `/home?preset=custom&from&to`. "Across all dashboards" = the choice persists: `RangePicker` writes the `dash_range` cookie (`lib/reporting/rangeCookie.ts`, a preference, parsed never trusted) and the page reads it whenever the URL names no period, so a drill, a section link or tomorrow's sign-in comes back to the same period. Tests: `core.test.ts` (every preset, the legacy names, the labels), `e2e/dashboard-home.spec.ts` (Week/Quarter/Year chips, the calendar picking 3rd–10th of last month, the URL, the cookie surviving a bare `/home`, a legacy export name, a refused one).

**Left out of the dashboard.** Two asks, one mechanism: "remove 1/41 Devoy Street and 13 Leamington Crescent from the dashboard data completely, they were tests", and "the numbers in the targets section are incorrect". The second had a cause the pack proves: every one of the 35 PaintScout booked jobs imported on 16 Sep is ALSO in the Airtable history import as an accepted estimate — 18 by quote number, the rest by account and total — so each of those sales counted twice (the September copies alone: $16,500, $13,120, $6,107, $6,008 …). Deleting is the multi-table purge behind RESTRICT edges (`prod-purge-order`); a mark is reversible. Migration `20270184000000_reporting_exclusion.sql`: `estimates.reporting_excluded_at / _reason` (partial index), `estimate_set_reporting_excluded(uuid, boolean, text)` (staff or service role — the builder's Job settings tick box, `setReportingExcludedAction`), and `reporting_exclude_import_duplicates(p_apply)` which finds and marks the history copy by the rule above and lists what it did (re-runnable; `marked=false` on a second pass). `lib/reporting/exclusions.ts` is ONE read — the marked estimate ids, their work orders (id + wo_ref) and their invoices — loaded in `loadDashboard`'s first wave and applied after it to every slice: estimates, closed jobs, the console input (work orders, offers, variations, updates, sign-offs, quiet sites, collections), the contractor rows, the twelve-month sales history (now kept as rows with ids and re-bucketed), the funnel's estimates, the invoicing slice (invoices, payments, contractor invoices by wo_ref, the period's payments) and the P&L payments (which now select `invoice_id`). A failed exclusion read is a load failure the page shows, not an empty set that quietly counts everything. Not filtered: the CRM activity feed and awaiting-reply (account-keyed, not money). The two test jobs are marked by hand on production (the SQL is in the PR); the duplicates by one `select * from reporting_exclude_import_duplicates()`.

**Imported jobs to the tray, and offer reminders** — see the two paragraphs above (`20270185`, `scripts/import/release-to-tray.ts`) and the automations inventory (`contractor_offer_reminder`, 12 h and 20 h after the offer, SMS, never between 22:00 and 04:59 Melbourne, answered/lapsed offers stop it; `lib/automations/sweeps/moneySignoff.ts` `offerReminders`, off the half-hour campaign sweep).

### Recorded sales months, the financial year, and the 20 Sep reporting audit (Tom's second batch, 20 Sep 2026)

**Recorded months.** "The previous sales data is incorrect — update the last 12 months to Aug 26 to match PaintScout; all future sales data to be based off accurate signed jobs." The months sold in PaintScout do not reconcile with the imported Airtable history (dates and statuses drifted), and PaintScout is the book of record for them, so `20270186000000_sales_history_months.sql` adds `sales_history_months(month pk, sales_cents, accepted null, source, note)` — staff read, money roles write — typed once on Settings → Dashboard → **Recorded sales** (owner/admin). `lib/reporting/recorded.ts` is the one rule: a recorded month REPLACES the platform's accepted estimates for that month wherever a sale is counted — Sales $ and Sales (number) (`acceptedRows` drops the platform rows in a recorded month and adds one row per recorded month, pro-rated by days when a custom range covers part of it; the tile stays the sum of its rows), Contracts signed (÷ 1.1), Spend vs sales and its trend, and the target card's bars (`salesHistory` in the loader merges recorded months over the platform's history). Conversion, AOV, by-salesperson and by-source stay per-estimate and say so. A month with no row is the platform's own signed jobs — every month from the cutover on, with no setting to forget.

**Financial year.** "Adjust our financial year for sales to July–June — when I input sales goals for January it should update to Jan 2027." `lib/reporting/financialYear.ts` (July start, named by the year it ends). The **Year** chip is now the financial year to date, compared with the same stretch of the FY before; a custom range that is exactly a FY compares with the previous one and labels "FY 25/26". The target card draws the FY the month sits in (July → June, target-only bars for the months ahead, recorded months in the lighter paint) and a "FY so far" line; Settings' target picker is a FY select plus that FY's twelve months, so January in FY 2026/27 saves as 2027-01-01.

**The audit** (`lib/reporting`, 20 Sep, nine confirmed defects, all fixed): (1) every capped read that could return the first 1000 rows now pages — `pageAll` in `load.ts` over signed-off jobs (was 300), payments (both copies, one had no order), crm_events, crm_account_facts (which dropped the NEWEST inbound first), wizard_drafts, the repeat-customer acceptances, and the exclusion ids; (2) `closed_on` and every `accepted_on`/`submitted_on` are Melbourne days, not UTC dates (a sign-off at 9 am AEDT on 1 Oct was landing in September's margin); (3) the target card's "% of month gone" for a past partial month is the days the range covers, not 100%; (4) `who=mine` now narrows Estimates sent, Sales $ and Sales (number) too — a sales login saw the team's sent count beside their own conversion; (5) the repeat-customer rule uses an account's earliest acceptance anywhere, so an earlier acceptance inside the comparison period counts; (6) the nightly rollup no longer stores `activity.events = 0` (the feed is not a figure; its slice is not loaded there); (7) Spend vs sales and its trend divide ex-GST spend by ex-GST sales, labelled. Still to do from the audit: the /invoicing read caps (400 invoices / 200 contractor invoices — the invoicing module's own read, shared with the dashboard).

## A handover job takes its lines and hours from the PaintScout work order (22 Sep 2026)

Tom: "update the following accepted estimates with their work order information so I can send the jobs out" — three jobs the Airtable Zap had delivered with the quote's area prices and no lines (`external_ref.hours_pending`, C-1). The lines are on the PaintScout **work-order** share page, and the page prints everything the sheet needs: every area (with its metres), every line with quantity, coats, product, litres and hours, the per-area prep/painting split, the Total Hours banner and the products with PaintScout's estimated litres. `lib/import/booked/workorder-text.ts` is the pure reading of that text (options and media ignored; a heading with neither lines nor hours stays a heading; an hours-only area is crew work). `lib/import/booked/fill.ts` joins it to the imported estimate: each work-order area takes the price of the first unconsumed quote area with the same name — repeated names in order, because PaintScout prints a second pass over a side as a second area on both documents — an area with hours and no twin goes in at $0 with a warning, a quote area the work order lacks keeps its price as a line, the discount rides along, and the page's banner must equal its lines. The result is the same `BookedJob` the pack loader builds from, so `buildBookedJob` (now carrying a per-line `product` and a `materials` list onto the sheet) proves the signed subtotal and total to the cent over the new scope, the one build path. `scripts/import/fill-work-order.ts parse|check|run <url|file>…` loads the page headless (Playwright), prints the join, and writes through `import_booked_job_set_scope` (migration `20270187`, service role only): builder_state, sent_snapshot and external_ref (`hours_pending → false`, the link) on the estimate — refused unless the signed money is unchanged — the work order's `wo_snapshot` (keeping any start date, notes, contractor or coloured materials the office set since), the tick list re-seeded from the new sheet (allowed only while nothing is ticked, at `offered` or `pre_start`), and a `scope_imported` wo_event. A filled job is skipped on a second run (`--refill` rewrites it). `docs/imports/substrate-name-map.json` is the pack's line-name → rate-code map, committed because a new job needs it and it names no customer. Covered end to end in `e2e/airtable-import.spec.ts` (Part C: the Zap record, then the filler on the page text, then the sheet as the painter sees it) and by unit tests on the parser and the join. Runbook: `docs/imports/README.md`; script for Tom: `docs/manual-tests/import-fill-work-order.md`.

### The level of finish on a job sheet that is already out (Tom, 23 Sep 2026)

Tom, mid-schedule: "I have updated the level in the revise working scope — but it is still coming up as a level 3, even though its a level 2." It was still coming up as Level 3 because nothing could ever have changed it. `work_orders.wo_snapshot` is written from the accepted estimate's `builder_state->'woDoc'` in exactly two places (`20260901` on accept, `20260904` on issue); that estimate is frozen by `estimate_frozen_guard` (`20261116`); the revision builder writes `wo_working_scopes.working_state`, which no reader of the job sheet has ever looked at; and **no variation RPC has ever written `wo_snapshot`** (grep the four variation migrations: zero hits). So a level changed in the revision builder moved the money through a signed variation and left the painter's sheet — the offer card, `/w/[token]`, the portal jobs list — saying PG-3, full prep, filled, sanded, sealed and caulked, on a job sold as PG-2 light sand and spot prime. There was no path from "we agreed Level 2" to what the contractor is held to.

`20270189000000_wo_set_finish_level.sql` is that path, in the shape `wo_set_material` (`20261231`) established for the same reason — the contractor reads the SNAPSHOT, so an office correction lands there or it may as well not have happened. `wo_set_finish_level(work_order_id, modifier_code)` is staff-only, refuses a closed or unissued job, takes the human label off `modifiers` (never off the wire, so the sheet reads what the estimator's own dropdown reads), and maps FIN-n → PG-n. **FIN-1 is refused, not mapped**: it has no PG equivalent on purpose, and calling a FIN-1 job PG-2 would hold a painter to more prep than the customer paid for. Areas cascade on the rule the builder already assumed — `onAreaFinish` stores nothing for an area on the job's level "so changing the job level still cascades" — so an area with no override of its own follows the job down, an overridden area keeps its code, and `finishOverridden` is recomputed against the new level, so an override that now agrees with the job stops reading as a difference. `applyFinishLevelEdit` (`lib/workorder/finish.ts`) is the document-side half in TypeScript, and `lib/workorder/finishLevelEdit.test.ts` tests it directly while pinning the SQL by reading the migration (17 tests: the cascade, the FIN-1 refusal in both halves, staff-only, the rate-card label, no writes to money or the estimate, anon revoked, the `_prod_migrations` line, the lock timeout).

The control is `FinishLevelCard` on the PC job page (`app/pc/wo/[id]`), beside Materials, hidden once a job is closed; `setFinishLevel` in `app/pc/actions.ts` validates with zod and revalidates the portal and the job page. **Money is deliberately not in it.** The level multiplier is priced and signed as a variation in the revision builder, which is what keeps the ledger's "accepted + Σ signed variations" reconciling to the cent — so the card says in words that the price does not follow, and names the areas that will keep their own level before you save. `e2e/wo-finish-level.spec.ts` proves it where it counts: the contractor's own token sheet, read with no session, says PG-3; the office corrects it; the same anonymous sheet says PG-2, the overridden area still says PG-4, and PG-3 is gone.

**Left alone deliberately:** the revision-mode save omits `woDoc`/`woOptions` from the state it writes (`QuoteBuilder.tsx` — compare the revision branch with the normal save), so `working_state.woDoc` is a stale copy of the accepted document. Nothing reads it — `working_state` is consumed only by `diffRevision` (blocks and adjustments) and by the builder in revision mode, which recomputes the work-order document live — so writing a recomputed doc into the state the variation diff runs over would be risk without a reader. If a "promote the working scope to the job sheet" step is ever built, it should recompute rather than trust that field. The same class of gap still stands for `crew_notes`, `access_notes`, `hours_overrides` and `area_finish`: all are live columns staff can edit after issue, and none reaches the contractor's sheet, which is built from the snapshot alone (`app/w/[token]/page.tsx` overlays only status, start date and ticks). Only materials and now the finish level have a door.

### Photos the office attaches to a job that is already out (Tom, 23 Sep 2026)

"How do I attach photos to an accepted job so the contractors can see in their work order?" — you couldn't. The job sheet's photos are `wo_snapshot.areas[].photos`, frozen from the accepted estimate, the same wall as the level of finish. Work-order photos existed, but **neither contractor surface was ever passed them**: `/portal/jobs/[id]` and `/w/[token]` both rendered `WorkOrderDoc` with no `photos` prop, while the staff builder's job-sheet tab *does* (`QuoteBuilder.tsx`) — so a photo added after acceptance was visible to the office and invisible to the painter. It looked attached and wasn't. On a PaintScout handover, where the estimate carries no photos at all, there was nothing to show a painter ever, which is the case that prompted this ("we need to add photos to all the jobs coming in from paint scout").

`20270190000000_wo_reference_photos.sql` adds a `reference` value to `wo_photo_kind` — a photo that TELLS the painter something (the elevation the scaffold goes on, where the gear lives, the colour to match) rather than recording what they did, so it is its own kind and not a caption convention: the sheet groups by kind, and the painter's record stays theirs. `wo_record_reference_photo` is **staff-only at the database**, because `wo_record_photo` is granted to every authenticated caller and would let a contractor file one as though it came from us; `wo_delete_reference_photo` refuses any row that is not `reference`, so the office can never delete the painter's own evidence through that door. `get_work_order_office_photos_by_token` serves the anonymous `/w/[token]` sheet (the anon key has no read on `work_orders` or `wo_photos`): the token is the only key, it returns storage **paths**, and the route signs them with the service client *after* the RPC has said which paths are allowed. Its body compares `kind::text` deliberately — a `LANGUAGE SQL` body is planned at creation and Postgres refuses to plan against an enum value added in the same transaction ("unsafe use of new value"), which is exactly how the first apply failed. Reads needed no new policy: `wo_photo_access(work_order_id)` already gates row and object for staff, the assigned contractor and the customer, and asks about the work order, not the kind.

The split is made once, in `lib/workorder/photos.ts`: `officePhotos()` / `officePhotosForArea()`, with `WorkOrderDoc` rendering `officeShots` in a **From the office** section above the scope and `siteShots` (everything else) in the existing Site photos section, so nothing double-renders. Both contractor surfaces now pass photos — the portal through the contractor's **own session** (RLS scopes it; no service client) filtered to `reference`, the token sheet through the RPC above. Staff attach them on `ReferencePhotosCard` (`/pc/wo/[id]`, above the Level of finish card, hidden once closed): area picker off the job sheet's own headings or "Whole job", caption, and the same sign → PUT → sniff-on-ingest upload path as every other photo, with `/api/wo/photos` routing `kind: "reference"` to the staff-gated RPC. `lib/workorder/referencePhotos.test.ts` (14) tests the filter directly — including that it returns empty rather than everything when there are no office photos, the failure that would hand a painter their own before shots back — and pins the SQL by reading the migration. `e2e/wo-reference-photos.spec.ts` proves it where it counts: the painter's own token sheet with no session gains the captioned photo, and the painter's seeded `before` and `qa` shots do **not** appear in that section.

**Follow-up the same day** ("the contractor needs to see them"): two painter-facing surfaces were missed by the first pass. **Painter's view** (`/pc/wo/[id]/as-contractor`) — the office's mirror of the contractor's page, and therefore the first place the feature looked broken — now reads reference rows through the staff session and passes them; and the **crew link** (`/crew/[token]`) gets its own anonymous read, `get_work_order_office_photos_by_crew_token` (`20270191`), keyed by `work_orders.crew_token` exactly as `get_work_order_by_crew_token` is, paths only, service-signed after the RPC has allowed them. A reference photo is an instruction about the work, which is precisely what the crew whitelist exists to carry. All four surfaces a painter can hold a sheet on — portal, `/w/`, crew link, and the office's own view of it — now agree; `e2e/wo-reference-photos.spec.ts` walks all four and repeats the leak test on each.

## Passwords by hand + reset links (24 Sep 2026)

Tom: "allow to manually update passwords and send reset links for contractors" and "for staff members as well", plus "when a staff member is deleted I am unable to re-create the same staff member". One server-only module, `lib/auth/adminPassword.ts`, serves both roles: `setPasswordForUser` (service-client `updateUserById`), `sendPasswordResetLink` (the portal's existing magic link from `lib/portal/auth.ts`, with `next=/reset-password` — one implementation, never a second mailer) and `findAuthUserByEmail` (`generateLink` answers with the user and sends nothing; `listUsers` paging is the last resort, since the test project's anon sessions broke it). Callers decide who may ask: `settings/staffActions.ts` (`setStaffPasswordAction`, `sendStaffResetLinkAction` — master user only, staff profile only) and `contractors/actions.ts` (`setContractorPasswordAction`, `sendContractorResetLinkAction` — any staff, the contractors row read through the caller's session so RLS answers the permission question). UI: a Password strip on each row of Settings → Staff logins; a **Their login** card (`ContractorLogin.tsx`) on the painter's page, shown once they have a `profile_id`. The link lands on `app/reset-password/` — a role-neutral page that saves through the user's own session (`auth.updateUser`, the customer portal's SetPassword pattern) and sends them home by role. `app/account/auth/route.ts` now joins a verified click to a customer account chain ONLY for a customer-role profile: staff and painters clicking a link must not mint an `accounts` row for an office address.

**Re-creating a removed staff login.** `removeStaffAction` falls back to ban + demote when rows they created refuse the delete (`estimates.created_by` is NO ACTION), which leaves the email taken and `createStaffAction` refusing it. Now, on "already registered", create looks the user up by email and — only when it is BANNED, the marker of a removed login — lifts the ban, sets the new password, and makes it staff again under the same auth id, so what they filed before stays theirs. A live login with that address (a customer, a never-removed staff member) still gets the refusal. Specs: `e2e/settings-staff.spec.ts` (password by hand, reset landing, no customer account for a staff address, remove → same address restored) and `e2e/contractor-login-tools.spec.ts`. Help: `docs/help/logins/{staff,contractor}.md`.

## Tom batch 24 Sep: drag dates, editable start, "customer approved", one email logo

Five small items, no migration. **Board** (`app/pc/schedule/ScheduleBoard.tsx`): the drag ghost now carries the dates the drop would book (`ghostDates`, set in `updateTarget` from the same `addWorkingDays`/`endFor` arithmetic the drop uses, testid `ghost-dates`), and the booking sheet's start date is an `<input type="date">` (`booking-start`) that snaps to the painter's working week and re-checks the block-out; day cells carry `data-day`. **Revision panel** (`app/quote/RevisionPanel.tsx` `signedVariationState`): a `contractor_accepted` change reads "customer approved" — the status name is the painter's, the approval was the customer's. Approved line items reaching the painter's work order was already true (20270193 tick rows + the sheet's Changes to the scope) and is re-proven by the existing specs. **Email logo**: `company_profile.logoUrlEmail` (Settings → Company → Logo for emails, a logo with its own background so mail-client dark mode cannot invert it) and `lib/messaging/logo.ts` `emailLogoUrl()` — every one of the 19 email-building sites picks its logo through it (email → light → main), replacing the hand-written `logoUrlLight || logoUrl` at each. Spec: `e2e/schedule-drag-dates.spec.ts`.

## The working scope's contractor rate is the painter's rate (24 Sep 2026)

Tom: "if I adjust the contractor rate in the revision working scope before I send it out to them in the schedule, the rate the contractor sees is the new rate." Two gaps: `wo_draft_revision_variation` priced every change's contractor delta at the GLOBAL Settings rate (ignoring the estimate's "Contractor rate" override), and `work_orders.contractor_payment_cents` was fixed at issue. Migration `20270194000000_revision_contractor_rate.sql`: the draft RPC takes `p_contractor_rate_cents` (default null → global rate; the old 10-arg signature is dropped so PostgREST sees one function), and a new staff RPC `wo_sync_contractor_pay(estimate, base_cents, rate_cents)` moves an UNSENT job's base pay and reprices its engine-priced revision variations (never a PC's manual deduction), refusing with `ok:live` when `wo_has_painter`. The two figures come from ONE place, `lib/revision/contractorRate.ts` `revisionContractorPay(accepted, working, ctx)`: rate = the working scope's override else the card's; base = the ACCEPTED scope priced at that rate (changes ride on top as variation deltas, so base + deltas = the working scope at the new rate, nothing counted twice). `saveWorkingScopeAction` calls the sync after every save and reports `pay` to the builder's save message; `draftRevisionVariationsAction` passes the rate. Spec: `e2e/revision-contractor-rate.spec.ts`.



## Revision changes: photos optional, no painter round trip (24 Sep 2026)

Tom: photo attachments on a revision-scope change are optional, and a change the customer signs must not go to the contractor for approval "and then back to the customer again". Photos: the send buttons in `app/quote/RevisionPanel.tsx` and `sendVariationForSignatureAction` no longer wait on a `wo_photos` row per addition (the 1 Sep rule is reversed; the upload button stays, labelled optional). Round trip: migration `20270195000000_revision_changes_no_painter_roundtrip.sql` re-creates `wo_customer_sign_variation` so a row with `revision_block_ref` folds in (`contractor_accepted` at the signature, event `variation_added_to_job`) whether or not `wo_has_painter` — 20270192 only did this with nobody on the job. Painter-RAISED variations keep release → accept; a removal on started work still waits on the PC's deduction. The contractor is told by text — new automation `contractor_variation_added` (`variationAddedSms`, `lib/contractor/notify.ts` `notifyVariationAddedToJob`, called from the sign action beside the release notifier). `e2e/revision-contractor.spec.ts` now asserts the fold-in and that the release/accept RPCs have nothing left to do.
\n
## Quality-check repair and overrides, staff sign-off, photo rules, revision colours (24 Sep 2026)

Tom's 24 Sep batch, four migrations. **`20270196000000_wo_qa_recheck.sql`** fixes "function public.wo_qa_open_count(uuid) does not exist": 20270173 had copied the gate body from the never-merged `fix/qa-recheck` branch, so production's `wo_gate_blocked` called a function nothing created and every last PASS died routing the job. The 20270112 design lands on main under the new number: `wo_qa_checks.retry_of`, `wo_qa_open_count` (null or unsuperseded fail = open), `wo_record_qa`'s FAIL spawns its re-check, `wo_contractor_finish` / `wo_contractor_confirm_prep` / `wo_qa_route_passed` / `wo_book_walkthrough` read the predicate, backfill for parked fails. TS twin `lib/workorder/qa.ts` (`openQaChecks`, `qaAllClear`, `staffSignsOff`); the PC and painter job pages read `retry_of` in a separate, error-checked query. **`20270197000000_wo_qa_waived_staff_completion.sql`**: `work_orders.qa_waived` + `wo_set_qa_waived` (removes unlogged checks; a job parked at qa routes on), `wo_schedule_qa` honours it, `wo_set_qa_required` / `wo_add_qa_check` clear it; `wo_staff_signs_off(wo)` = a passed check exists — such a job is the OFFICE's to sign: `wo_staff_complete` rides `wo_staff_sign` with the staff member's own name, `wo_signoff_sweep` skips these jobs (no customer nudges, and the 0 h rung IS the pack email), the console's "Call the customer" card skips them (`staffSignoffJobs`), the painter's page hides the walkthrough bar/start; `wo_close_without_walkthrough` now also closes from the `walkthrough` stage (cancels booked walkthroughs) so "Walkthrough not required" pressed late no longer strands a job — the flag is a button on `WalkthroughCard` from the offer stage, and `StageAdvance`'s walkthrough→closed button routes to the right RPC (no-walkthrough close / staff completion / plain move). **`20270198000000_wo_photos_optional_short_jobs.sql`**: `wo_surfaces.photos_optional` + `wo_set_surface_photos_optional` (PC: `PhotosOptionalToggle` on the static list, a per-row button in `TickList` with `canWaivePhotos`); `wo_photo_scope(wo)` = `'job'` when the booked span ≤ `photoMinimums.shortJobDays` (default 3) — one before + one finished photo for the whole job; `wo_tick_surface` counts gates over photo rows under that scope, mirrored by `photoScopeFor` / `tickNeedsBeforePhoto` / `tickNeedsAfterPhoto` in `lib/workorder/surfaces.ts`. **`20270199000000_wo_sync_scope_colours.sql`**: the revision builder's working-scope save now carries `woDoc` (the computed sheet); `wo_sync_scope_colours(estimate)` folds its colour fields into `wo_snapshot` materials/surfaces and the `colours` mirror (a named colour is confirmed; a new product×colour is added only when a surface painted in it is on the job), called from `saveWorkingScopeAction` beside the pay sync — the customer's Colours tab, the painter's sheet and the PC Materials card all read the snapshot, so all three agree. Specs: `e2e/wo-qa-recheck.spec.ts`, `e2e/wo-qa-overrides.spec.ts`, `e2e/wo-photo-rules.spec.ts`, `e2e/revision-colours.spec.ts`; `wo-full-loop` steps 6–8 no longer flip checks through the service client.

## Photo rule reverted to per-area; painter update texts; customer check-in items (25 Sep 2026)

Tom: every area keeps its own before and finished photo "unless we tick otherwise". **`20270200000000_wo_photo_rules_per_area.sql`** redefines `wo_tick_surface` without yesterday's short-job scope (the per-line `photos_optional` exemption stays) and drops `wo_photo_scope` / `wo_has_job_photo`; `lib/workorder/surfaces.ts` loses `photoScopeFor` and the scope parameters, `TickList` its `photoScope` prop. **The rhythm of a job** now lives once in `lib/workorder/jobRhythm.ts` (pure): `jobDays` (booked working days, weekends only if the painter works them), `dayAt` (N% through, never day 1 or the last day on 3+ days), `painterUpdateRungs` (1–2 days: day 1 07:30 + day 2 15:30; 3–6: day 1, 50%, last; 7+: day 1, 30%, 60%, last — all 15:30 Melbourne via `melbourneInstant`) and `customerCheckins` (1–2 days: after; 3–6: 50%; 7+: 35% and 70%). **Painter texts**: automation `contractor_job_update_reminder` (registry; template `contractorJobUpdateSms`; quiet-exempt because 07:30 precedes the sending hours), run by `lib/automations/sweeps/jobReminders.ts` off the half-hour campaign sweep — `runLadder` per job with the anchor at day 1 07:30, every painter on the job texted (contractor + `wo_assignments`), "still needed?" = stage still pre_start/in_progress/completion_prep; `stillNeeded.ts` carries the same checker for held messages. **Office check-ins** are work items, never stored: kinds `job_checkin` (weight 30, customer-visible — high importance) and `job_followup` (14) in `lib/crm/work-queue.ts`, built by `buildJobCheckinItems` from a bounded `work_orders` read (booked, last day within a fortnight); a mid item appears the morning of its day and is due 5 pm, an after item the next business morning after a 1–2 day job's last day, kept ten days; Today tags them Check-in / Follow-up. Specs: `e2e/automation-job-reminders.spec.ts`; units `lib/workorder/jobRhythm.test.ts`, `lib/automations/sweeps/jobReminders.test.ts`, `lib/crm/work-queue-jobs.test.ts`.

## Supabase Security Advisor hardening (25 Sep 2026)

Tom asked for the Supabase "errors" to be looked at and the account secured: the Security Advisor showed 2 errors and 742 warnings on production. **`20270201000000_security_advisor_hardening.sql`** (report: `docs/reference/2026-09-25-supabase-security-advisor.md`) moves the two intentionally-SECURITY DEFINER views (`wo_visible_jobs`, `customer_quote_lines`) into a new `private` schema so they are not API-exposed (policies keep working — they bind by oid), pins `search_path` on the 37 functions that lacked one, revokes `anon` from every definer function except the 42 a token page or RLS policy needs, revokes `authenticated` from trigger functions and 27 internal-only helpers, drops the seven `to public` listing policies on public buckets, and sets default privileges so **a new function in `public` is callable only by `service_role` until its migration grants `execute` explicitly** — the rule now in CLAUDE.md. Advisor after the paste: 0 errors; the ~300 remaining warnings are the RPCs the app calls with a user session, each self-guarded. Two dashboard toggles are Tom's: leaked-password protection (turn on), anonymous sign-ins (stay on — the wizard needs them).

## Schedule board: day cells aligned to the header; a crew member's own days (26 Sep 2026)

Tom: "when hovering over a date to drop, the dates don't line up". Measured live on the test stack: lane cells were 73px apart against 64px header columns — `.pc .lane` in `app/pc/pc.css` (the Projects console's flex-column lane, `gap: 9px`) leaks onto the board's `.lane`, which shares the class name and has lived under `.pc` since the 8 Sep theme work; the lane also sat in a single 64px grid track. `schedule.css` now pins `.pc .sb .lane { gap: 0; grid-column: 2 / -1 }`; `e2e/schedule-drag-dates.spec.ts` asserts the hot cell's box equals its header cell's box. **Crew days** (Tom: "sometimes the job doesn't require 2 painters to be on at the same time"): the assignment sheet on `ScheduleBoard.tsx` gains a start/end date pair + **Save days** (`assignment-start` / `assignment-end` / `assignment-dates-save`) that calls the existing `reassignDatesAction` → `reassign_dates`, which re-spans the work order to the crew's earliest start and latest end and clears the painter's Accept; the override reason field is shared with Add a painter. Help: `docs/help/scheduling/staff.md` step 17.

## Videos beside photos on the work order (26 Sep 2026)

Tom: painters may upload videos as well as photos from the Variations and Photos & notes cards. No schema change — a video is told from a photo by its **storage path extension**: `POST /api/wo/photos` now takes the file's `contentType` and names a video object `.mp4` / `.mov` / `.webm` (`videoExtensionFor`, photo paths stay bare as every older row is), and the ingest reads only the first 64 bytes of the staged object through a signed URL + Range request (`headBytes`, so a 100 MB clip never passes through the function), then requires the bytes to agree with the name (`sniffVideoKind` in `lib/extract/normalise.ts` — ISO-BMFF video brands / `qt  ` / EBML — kept separate from `sniffKind` so plans and bills still refuse video). Size caps: photos 25 MB, videos `MAX_VIDEO_UPLOAD_BYTES` 200 MB. **`20270201000000_wo_photos_bucket_video.sql`** adds the three video MIME types to the bucket's `allowed_mime_types` and lifts its `file_size_limit` to 200 MB — Storage checks the request's content-type against that list before the bytes land, so without it every video PUT was refused (found by the spec on the test project). `WOPhoto.media` (`isVideoPath`) drives `PhotoGrid` (poster `<video>` + play badge, `data-media`) and `PhotoLightbox` (`<video controls>`, streamed by signed URL); the customer's `lib/portal/photos.ts` signs a video without the image transform and the account grid plays it. Spec: `e2e/wo-photos.spec.ts` (a progress clip renders and opens); units in `normalise.test.ts` / `photos.test.ts`.

## One uploader for site media; a drawn sign-off; the remote gate explained (28 Sep 2026)

Tom: painters hit an error attaching after-photos (Franklin St); a customer (71 Orrong Cres) could not sign off. **Uploads**: `lib/workorder/uploadMedia.ts` is the one sign → PUT → ingest path for TickList, SitePhotos, Variations and QaCheck (four copies before, each swallowing storage's reply into "check your signal"). It declares the file's type to storage explicitly — a phone often hands over a File with an empty `type`, which the bucket's allowed-types list then refuses — falling back to the extension and then JPEG (the ingest still reads the bytes), reads a storage refusal back into a plain line (`uploadFailureText`), and always surfaces the server's own message. The ingest (`/api/wo/photos` PUT) falls back to a full download when the Range read returns nothing for a photo and reports the case. **Sign-off**: `20270202000000_wo_sign_drawn_signature.sql` adds `wo_signoff.signature` and `wo_sign_drawn(token, signature, device)` — the shared `SignaturePad` replaces the typed-name box on `/s/[token]` (`sign-pad`, `signed-signature`); the signer's name is the accepted estimate's, resolved server-side. The same migration softens `wo_sign`'s Mode B gate: the customer's own link is refused (`walkthrough_first`) only while a final walkthrough is BOOKED for today or later and the office has not opened it; `signAction` now says what that refusal means instead of a blank error. Specs draw (`drawSignature`) where they typed.

## Delete a drafted customer update (29 Sep 2026)

Tom: drafts pile up on jobs that have since completed and it is too late to send them. **`20270203000000_wo_dismiss_update.sql`**: `wo_dismiss_update(update, reason)` deletes a drafted/approved row outright (a `dismissed` status would block the day's next draft — `wo_updates` is unique per job and date), refuses a SENT one (`already_sent`), and logs `update_dismissed` on the job with who, why and the text; `wo_dismiss_updates_for_closed_jobs()` clears every unsent draft on a closed job. Updates tab: `UpdateCard` gains a two-press **Delete** (`delete-<id>`, then "Yes, delete it") and a "job completed — too late" line when the job is closed; `ClearClosed` at the top offers **Delete them all** when any drafts sit on closed jobs; the list read now surfaces its error. Actions `dismissUpdate` / `dismissUpdatesForClosedJobs`. Spec: `e2e/wo-updates.spec.ts` "deleting drafted updates".

## Tom's 29 Sep batch: payments views, estimate numbers, second contact, line materials, leave reminder (29 Sep 2026)

Fourteen items on `feat/tom-batch-29sep`. **Payments** (`app/invoicing/Dashboard.tsx`): three chip rows — Status (with a new **Outstanding** = open status + balance > 0), Milestone (`invoices.kind`) and Due window — plus a **Views** row whose entries are named combinations (`VIEWS`, "Final payments outstanding" = outstanding × final); all three ride the URL (`f`, `k`, `d`), counts are cross-filtered, and a sum line totals the visible balances. Rows carry `kind`, `outstanding`, `dueIn` from `page.tsx`. **Estimates list** opens on All (`DEFAULT_LIST_FILTER` in `lib/estimate/displayStatus.ts`). **Estimate numbers** (`20270204000000_estimate_numbers.sql`): `estimates.number` integer, unique, from `estimate_no_seq` by a before-insert trigger, backfilled in creation order; `get_estimate_by_token` now returns it (drop + create, anon/authenticated re-granted); `lib/estimate/number.ts` formats it to four digits. Shown in the builder's dark bar left of the title, the Estimate ID card, the list, the customer page ("Estimate 0042", EST- token code only when null), the warranty page; matched by the Estimates search and the CRM global search. Invoices keep their `INV-` prefix (a Settings → Invoicing numbering value). **Contacts** (`20270205000000_contacts_landline_secondary.sql` + `Contact` in `app/quote/company.ts`): `landline`, `secondary_name/email/phone`; the modal lists Mobile before Company; `contactFieldProblems` validates the landline (`isAuLandline`) and the second person. `sendEmail` takes `to: string | string[]` (`recipientList`, first address on the row, the rest in `meta.alsoTo`); the estimate Send dialog's `alsoTo` (zod, `deliver()` fans out SMS per number), `sendInvoiceEmail/Sms`, `deliverCustomerUpdate` and the variation send all include the second person; the snapshot carries `contactEmail2/contactName2`. Automated sweeps still address the primary only. **Builder** (`QuoteBuilder.tsx`): `useSaveBeforeLeave` gained `ask` — the builder shows Save and continue / Leave without saving / Stay (the 17 Sep silent save stands for callers without `ask`); dirty no longer needs a row id; the revision save now resets the fingerprint (before, every link after a working-scope save was held forever); the capture button saves first. Scroll memory per folder level (`scrollMemo`) replaces the scroll-to-top effect. **Line materials**: `LineBlock.materials[]` (product, litres, $/L override, sheen, colour, note) priced in `lib/pricing/estimate.ts` `priceLine(l, {productsByName, markup})` → `lineMaterialsCents` added to the line's price (cost + markup) and cost; `lineMaterialRows` feeds `computeWorkOrderParts` (a third `lineFilter` arg; option fragments carry their own) and `computePaints` (note or heading as usage). **Search** boxes on Estimates and Invoices debounce 350 ms into `?q=` with no button. **Chat dock** (`StaffChatDock.tsx`): `pg-dock-volume` (0–100) drives the chime's gain. **Schedule**: `.blk.assigned` gets a light-theme ink. **Inbound email** (`lib/messaging/forwarded.ts` + `app/api/inbound/messages/route.ts`): a message from the office mailbox with no reply token is read as a forward — `forwardedOrigin` pulls the customer's address, subject and words out of the Gmail / Outlook / Apple header block, the row is recorded against that customer, and no copy is relayed back to the mailbox.

## Uploads to public buckets need a reader policy (30 Sep 2026)

Tom: "unable to add photos to new products — it says it violates the policy". The 25 Sep hardening (`20270201`) dropped the `for select to public` policy on the seven public buckets to close anonymous listing; Storage's upsert upload (`upload(path, file, { upsert: true })`, used by every browser uploader in Settings, the builder's SWMS box and the portal logo) reads the object under RLS before writing, so with no select policy at all the upload dies with the RLS violation. **`20270206000000_bucket_read_for_uploaders.sql`** adds `<bucket>_uploader_read`: `for select to authenticated using (bucket_id = … and is_staff())` for product-photos, estimate-media, presentation-media, presentation-docs, campaign-media, showcase-media, and `to authenticated` alone for contractor-logos (its write policy). Anonymous listing stays closed (read-back asserts no anon/public role). `e2e/product-photo-upload.spec.ts` uploads a photo as staff. Lesson for the advisor: a public bucket's select policy is not only about listing — the uploader is a reader too.

## Why uploads sat on "Uploading…" — the ingest's Range read (30 Sep 2026)

Found while proving the four-step page on C1: `app/api/wo/photos/route.ts` PUT (the ingest) reads the first 64 bytes of the staged object through a signed URL with a `Range` header to sniff its signature. Inside the Next runtime that `fetch` (the framework's patched one) never resolved — the server log showed the handler stop after `auth` for ever, and "The destination stream closed early" once the client gave up. Every upload through the app could hang there; the 28 Sep "one uploader" work had already added a `download()` fallback for an EMPTY Range read, which this is not. Fix: `headBytes` uses `node:https` directly (unpatched), takes the first chunk, destroys the socket, 8 s cap. The handler also times its phases and logs `[wo.photos.ingest] slow` with the split when a request takes over five seconds. Measured on C1 afterwards: head about 0.8 s, record about 50 ms.

## The painter's job in four steps; photos per job (30 Sep 2026)

Tom: contractors struggle with the job page; before photos should be one **Step 1 · upload before photos** button that takes many photos or short videos from the camera or the phone and sends them in one batch; after photos per job ("take photos of all rooms or all sides"); the loose photo card labelled for questions only. **`20270207000000_wo_photos_per_job.sql`**: `wo_has_job_photo(wo, kind)`; `wo_tick_surface` refuses the first tick with `error:before_photo_required:job` until a `before` photo exists anywhere on the job (no per-heading gate, no after-photo gate on ticks) — and, fixed on the way, checks ownership with `wo_painter_on_job` again (crew could not tick since 20270178) and writes the `all_surfaces_done` event again (dropped in 20270198); `wo_contractor_finish` refuses `error:after_photos_required` until a `completion` photo exists (a job of only "photos not required" rows is exempt). `lib/workorder/surfaces.ts`: `gatedRows`, `jobNeedsBeforePhotos`, `tickNeedsBeforePhotos`, `jobNeedsAfterPhotos` replace the per-heading helpers. **`app/components/wo/BatchUploader.tsx`**: multi-select picker (no `capture`), queue with per-file progress through `uploadWorkOrderMedia`, Done runs them in order, failed files keep a Retry, `router.refresh()` when the last lands. `app/portal/jobs/[id]/page.tsx` renders a `steps` strip (`data-step`) and the four cards: Step 1 uploader (or a collapsed "add more"), the `TickList` (prop `hasBeforePhoto`; shows `tick-locked` and refuses taps client-side), Step 3 uploader once every working row is done, `FinishUp` with `blockedBy` (button disabled + `finish-blocked` line) until an after photo exists; `contractorFinish` maps the new code. `SitePhotos` is "Got a question, or found something?" — progress photos only, with a hint that before/after go in Steps 1 and 3. Console (`app/pc/wo/[id]`) passes `hasBeforePhoto` from an unlimited one-row query. `CompletionReport` shows job-wide after photos for a flagged area when none is tagged to it. Fixtures: `photosIn(db, wo)` in `e2e/fixtures/woLoop.ts` for specs that mark everything done by hand. Spec: `e2e/wo-steps.spec.ts`.

## Payment date, cents on the job's payments page, two "back" fixes (1 Oct 2026)

Tom's four: (1) **Payment date when recording a payment.** `invoice_record_payment` already took `p_received_on date` (20270155); `recordPaymentAction` now accepts an optional `receivedOn` (yyyy-mm-dd, zod) and passes it, and both record sheets (`app/invoicing/job/[estimateId]/MoneyView.tsx`, `app/invoicing/inv/[id]/InvoiceDoc.tsx`) carry a `<input type="date">` (`record-date`) defaulting to `melbourneDate(new Date())`, max today. No migration. (2) **Cents on the job money view**: the stage rail and the money strip use `fmt2`, not `fmt0`; `fmt0` is gone from that file. (3) **Scheduler keeps its place**: `ScheduleBoard` saves `window.scrollY` and the timeline scroller's `scrollLeft/Top` to `sessionStorage` (`pc-schedule:scroll`, rAF-throttled, written synchronously on `pagehide`) and restores once on mount, because the estimate links are full navigations. Those links also carry `&from=/pc/schedule?from=…&days=…` so the builder's top-left link (`lib/navigation/backTo`) reads "Back to the schedule" and returns to the same window. (4) **Money view goes back where it came from**: `app/invoicing/job/[estimateId]/page.tsx` reads `?from=` through `parseBackTo` and passes `backTo` to `MoneyView`, whose crumb (`money-back`) uses it; the Payments dashboard (`urlFor`/`jobHref`, filters intact), Payables cost rows and the `/invoices` list set it. Without it the crumb is PC Command as before. Specs: `e2e/invoicing.spec.ts` (date saved, cents, crumb), `e2e/board-and-paint-usability.spec.ts` (scroll restored, back link).

## Area photos on the job sheet opened at thumbnail size (1 Oct 2026)

Tom: "when contractors view photos in the work order they are coming up as small tiles". The tap-to-enlarge lightbox (16 Sep) was working — but `AreaPhotoStrip` renders `PhotoLightbox` INSIDE its `.area-photos` div, and `app/w/workorder.css` sized the thumbnails with `.wo .area-photos img { width: 72px; height: 72px }`, which also matched the lightbox's `<img>` and, being more specific than `.wolightbox img`, won: the "full size" photo was a 72px tile. The rule is now `.wo .area-photo img` (the tile button only; the print grayscale rule likewise), and the tiles are 96px. `e2e/wo-area-photo-lightbox.spec.ts` asserts the enlarged image's computed sizing is the lightbox's own (`object-fit: contain`, not a fixed 72/96px box). No markup or component change; the shared grid (`PhotoGrid`) was never affected because its tile rule is scoped by `.shot`.

## Offered amount, estimated hours on the job sheet, Google Calendar connect from the live host (1 Oct 2026)

Tom's three: (1) **The offer's amount was blank** for Jacob (DJ Decor) and 19 of the last 60 issued jobs: only `issue_work_order` copied `woDoc.contractorPaymentCents` into `work_orders.contractor_payment_cents`; the work orders that acceptance and the import paths create carry the figure in `wo_snapshot` only, and `send_offer` read the column alone → `booking_offers.payment_cents` null → "Your price —". **`20270208000000_wo_pay_from_snapshot.sql`**: `wo_base_pay_cents(work_orders)` (column, else document; no grant), a BEFORE trigger `t_wo_fill_pay_from_snapshot` that fills the column from the document on insert/update, `send_offer` rebuilt on the helper, and a backfill of work orders then live/accepted offers. `OfferBar` (`app/portal/jobs/[id]`) now labels the figure **Offered amount** (`offer-amount`) and shows "—" rather than hiding it. (2) **Estimated hours**: `lib/workorder/hours.ts` (`estimatedHours`, `formatHours`) is the one sum of surface hours; the scheduler tray (`lib/scheduling/board.ts`) and the job sheet's new top fact `wo-estimated-hours` ("Estimated hours", in those words) both use it. (3) **Google Calendar connect**: `gcalEnv(origin)` builds the redirect URI from the request's own host (explicit `GOOGLE_REDIRECT_URI` still wins), `exchangeCode(code, redirectUri)` echoes it, and the callback's failures carry `?why=<code>` which `GoogleSyncCard.failureNote` turns into a sentence (state_cookie, state, no_session, no_refresh, exchange, missing_env, google_*). Google's non-cancel `error` values are no longer swallowed as "denied". Setup doc: `docs/gcal-setup.md` (one redirect URI per host; consent screen External + In production). Spec: `e2e/offer-accept.spec.ts` asserts offer pay = document pay, the labelled amount and the hours fact on the job page.

## Booking confirmed lane on Project progress (1 Oct 2026)

Tom: a job whose painter has accepted should not sit in Pre-start for weeks; only jobs due to start within seven days belong there, the rest wait in a new **Booking confirmed** lane between Offer and Pre-start. It is a **display split of `pre_start`, not a new stage**: the `wo_stage` enum, the transition table, the gates and the sweep are untouched. `lib/workorder/stages.ts` gains `LANES` (seven: offered, booking_confirmed, pre_start, in_progress, qa, walkthrough, closed), `LANE_LABELS` (renumbered 01–07) and `laneFor(stage, startDate, today)` — `pre_start` lands in Booking confirmed when the start date is missing or more than `PRE_START_WINDOW_DAYS` (7) calendar days after today, in Pre-start otherwise (including past-due starts). `today` is the Melbourne date; the day difference is done on yyyy-mm-dd strings so no zone can shift it. `/pc/flow` buckets by `laneFor`; the stage rail on `/pc/wo/[id]` lights the lane, and `StageAdvance` heads its card with the lane. `STAGE_LANES` remains for surfaces that know only the stage (job-sheet badge, invoice rows) and now shares its labels with `LANE_LABELS`. Pinned by `stages.test.ts` (window boundaries, month boundary, null start) and `e2e/pc-console.spec.ts` ("Booking confirmed lane": two pre_start fixtures 20 and 3 days out, then the far one pulled to day 7).

## Office alerts: estimate declined, estimate expired (1 Oct 2026)

Tom: "staff to receive email if an offered estimate is rejected / expires". Two new office alerts on the existing path (master switch in Settings → Automations, per-login routing under Staff logins via `profiles.staff_notify`, once-per-entity through the `staff_notifications` claim in `notifyStaff`): `office_estimate_declined` and `office_estimate_expired` — `lib/staff/notifyEvents.ts`, `lib/automations/registry.ts`, wording in `lib/messaging/config.ts` (`officeEstimateDeclined*`, `officeEstimateExpired*`), `valid_until` added to `SAMPLE_VARS`. The sends live in **`lib/estimate/lifecycleNotify.ts`**. Decline: the customer's `/e` page declines through the `decline_estimate` RPC with no server seam, so after it succeeds the page pings **`/api/estimates/declined`** with its token (the accept-ping pattern); the route acts only on an estimate whose status IS declined. Expiry: `runCrmSweep` (`lib/crm/sweep.ts`) calls `notifyOfficeOfLapsedEstimates` straight after `crm_lapse_estimates`; the RPC returns a count, so the ids come from the `status_changed → expired` rows it writes in `estimate_events` over the last 3 days — a send that failed one day is retried the next, and the claim makes a re-read a no-op. No migration. Tests: `lib/estimate/lifecycleNotify.test.ts`; `e2e/estimate-declined-expired-alerts.spec.ts` (anonymous decline on `/e`, then the cron route with its secret for the lapse, both asserting the guard row); `e2e/staff-alerts.spec.ts` lists the two switches.

## Contacts: the CRM mirrored, a search bar on the Contact card, no unsaved contact (4 Oct 2026)

Tom: a search bar at the top of the estimate's contact window, every CRM customer in the Contacts list, and a contact used on an estimate always saved to Contacts. Migration `20270210000000_contacts_from_crm_accounts.sql`: `contacts.account_id` (unique where set, SET NULL on delete so a merge never loses an office-typed row) and `contacts_sync_from_account(accounts)` — the ONE rule that turns an account into a Contacts row: find by account, then by `lower(email)`, then by `phone_e164_au(phone)`; fill only the blanks of a found row; otherwise insert, splitting a residential name into first/last (a trade name becomes the company) and taking the account's latest property as the address. An AFTER trigger on `accounts` (insert, and update of name/email/phone) runs it, so the wizard, Quick add, the builder's account link and the imports all land in Contacts with no second code path; the backfill in the same file runs it once over every existing account (read-back expects `accounts_without_contact = 0`). The function is SECURITY DEFINER and granted to nobody. `ContactModal` (`app/quote/EstimateHeader.tsx`) replaces the dropdown with a search box that asks the SERVER — `searchContactsAction` (`app/quote/actions.ts`, zod, staff session, eight rows, `error` surfaced in the box) over the `or()` filter from `lib/contacts/match.ts` (`contactSearchOr`: first/last name, company, email, suburb; a phone by typed digits against the stored generated `phone_digits` / `landline_digits` columns, since an `or()` filter cannot strip spaces on the column side). The builder no longer loads the Contacts table at page time: with the CRM mirrored in, that read passed PostgREST's 1,000-row cap and anyone past the first thousand surnames was unfindable (the first e2e run caught it). The modal has one action: **Use on estimate** inserts or updates the Contacts row FIRST and only then calls `onContact`; a refused save (validation, RLS, network) keeps the modal open, so `builder_state.contact` can no longer hold a person who is not in Contacts. The e2e fixture `destroyAccountChain` and the hygiene sweep (`OWNED` gains `public.contacts.account_id`; `fkAction` purges an owned SET NULL child) remove the mirrored row with its account. Pinned by `lib/contacts/match.test.ts`, `lib/testing/hygiene.test.ts` and `e2e/estimate-contact-search.spec.ts` (search by name and phone, the always-save path, the trigger).


## Wizard estimator = Settings → Estimator; one strip on the booking page; a lone wall line is 100% (5 Oct 2026)

Tom: "update your estimator details in the wizard to Tom Roman", the name shown twice behind **Book a time**, and
"I have to click what % of wall area even though I have only ticked weatherboards". Three small fixes, no migration.
`lib/wizard/estimator.resolveEstimator` keeps the staff-patch match first but its Settings fallback now reads
`company_profile.estimatorName` / `estimatorPhone` (the Estimator section — the person every estimate says it was
prepared by) and only then the Project coordinator; `estimator.test.ts` pins it. `/estimate/book` dropped its own
`EstimatorStrip` — `ReachStrip` already renders the strip (and now takes `suburb`), so the name appears once
(`finalise-gate.spec.ts` counts it). `lib/wizard/sides.wallSharePct` is the one rule for a wall line with no share
written: alone it is 100, in an unchosen split 0 each; `wallSumPct`, `syncWallMeasures`, `normaliseShares` and
`sidesView` all read it, so the gate and the card agree and a weatherboard-only side confirms untouched
(`sides.test.ts`, `sides-editor.spec.ts`). The card's 0% line now asks for the split in words.

## Pergola on the outside screen, priced on its top; condition answers explained; the wizard goes light (5 Oct 2026)

Tom's batch. (1, 2, 4) **Pergola** is a tile under "Any other areas being painted?" on the exterior quick look
(`EXT_STANDALONE`, `targets: "pergola"`) and on the page set's "What are we painting?"; ticking it asks the top's
length and width and a **Confirm** (quick look `ExteriorQuickLook.pergola`, state `exterior.pergola`), and the gate
refuses Continue until it is confirmed. The card's Pergola row is "Hours Per Item", so the size is priced as
item-equivalents through ONE helper, `lib/pricing/pergola.ts` (`PERGOLA_ITEM_M2` = 10 m² of top per card item;
`pergolaItemsForTop` → `qtyOverride`, which the engine never scales; the line is relabelled "Pergola — top approx.
L × W m"). `scope-editor.applyPergolaSize` does the write for the wizard's submit (`exteriorAnswers`, which also
drops the "measure on site" deferral) and for the sides editor's new `set_pergola` action (length, width, Confirm
under the Freestanding extras card; `CustomerExteriorView.pergola` reads it back). The old per-number stepper is
gone for pergolas; the Extras page keeps balustrades only. (3) The three **condition** answers carry a line of
meaning each — the wizard's cards and the sides editor's chips (`Chip` takes `hint`). (5) **Light mode**: `.wz`'s
token block is light (`color-scheme: light`, `--bar` for the sticky bars, the `--wz-*` aliases defined so no dark
fallback can win), every hardcoded dark value in `wizard.css` became a token, the drawings' hexes moved to light
equivalents, the chat bubble is overridden light inside `.wz` only (the marketing site stays dark), and the header
prefers the light-background logo (`logoUrlLight`, then `logoUrl`).

**Next step from In progress on the PC console (6 Oct 2026).** Two live jobs sat at In progress with every box ticked
and nothing the office could do: `confirmPrepStaff` (`app/pc/actions.ts`) ran the painter's finish and passed only its
`error:gate:` refusals on, so a finish refused for want of the job's after photos (`error:after_photos_required`, Tom's
30 Sep rule) was dropped and the confirm that followed answered `not at prep`. Now every finish result is handled and
said in words, and a success revalidates the job page (`StageAdvance` also calls `router.refresh()` so the ticks, lists
and rail move with the card). `StageAdvance` takes a `readiness` prop computed in `page.tsx` from the same rows the
gates read (surfaces left, `jobNeedsAfterPhotos`, required finishing-up items, unsettled variations) and draws a
**Before the next step** list above the one routed button, so the reason is visible before the press. Two office
routes past the after-photo gate: a console `BatchUploader` (`kind="completion"`, staff may call `wo_record_photo`)
and a waiver — migration `20270215000000_wo_after_photos_waiver.sql` adds `wo_staff_waive_after_photos(uuid, text)`
(staff only, needs a reason, writes a `wo_events` row of type `after_photos_waived`; the event is the record, there is
no column) and re-creates `wo_contractor_finish` to honour `wo_after_photos_waived()`. The painter's rule is unchanged.
Spec: `e2e/wo-stage-advance.spec.ts` ("the office's next step from In progress"). Diagnostic for a stuck live job:
`node scripts/diag/wo-next-step.mjs "<address>"` (read-only).


**Check-ins worked from PC Command (6 Oct 2026).** Tom: "move all job check-ins out of the CRM system and into PC
Command." Still one queue: `lib/crm/work-queue.ts` gains `homeOf(kind)` ("crm" | "pc"; `job_checkin` and
`job_followup` are PC-homed), `crmItems`/`pcItems`, and `buildPcWorkItems(supabase, now)` — two bounded reads (the
check-in work orders, the dismissals) returning `{ items, failure }`. `buildWorkQueue` builds every kind as before
(the keys are what dismissals hang off) and then assembles `crmItems(...)`, so Today, the tab badge and the home
dashboard no longer carry check-ins. `app/pc/page.tsx` renders the PC items as cards at the top of its queue with
**Open the job** and `app/pc/CheckinDone.tsx` (**Rang them** = dismiss for good, **Tomorrow** = one day), both
through the CRM's own `dismissWorkItem` → `crm_dismiss_work_item`. No migration. Spec `e2e/pc-checkins.spec.ts`;
units in `lib/crm/work-queue-jobs.test.ts`.

**Final invoice skips a variation already billed (6 Oct 2026).** 568 Collins Street: the last quality-check pass
routed the no-walkthrough close, whose `invoice_draft_final` wrote a line for every signed variation — including
one already on an issued progress invoice — and `invoice_lines_variation_once` (§3.1) refused, rolling the pass
back with "duplicate key value violates unique constraint". Migration
`20270216000000_final_invoice_skips_billed_variations.sql` re-creates `invoice_draft_final` (20270156 body) with one
predicate: a variation with a live (`not parent_void`) line on another invoice is not written again; the ledger has
already netted what that invoice took, and the "Less previously invoiced" adjustment balances the draft. Spec
`e2e/invoice-final-variation-once.spec.ts` closes a fixture job whose variation sits on an issued progress invoice.

**Contractor GST goes on top (7 Oct 2026).** The offered amount on a job (hours × rate) is EX GST, but every
contractor-invoice writer backed GST out of it (`gst_from_inc_cents`), so a registered painter on 38.5 h × $65 was
paid $2,502.50 with $227.50 of it called GST instead of $2,502.50 + $250.25. Migration
`20270218000000_contractor_gst_on_top.sql` adds `contractor_invoices.claimed_ex_cents` — the ex-GST figure an invoice
claims against the agreed job amount — re-creates `contractor_invoice_draft` / `_request` / `_submit` / `_approve`
from their live bodies with `gst_on_ex_cents` when registered (zero when not), freezes the new column in the guard,
and re-points `contractor_invoice_invoiced_cents` at `Σ claimed_ex_cents` so "what remains" is GST-independent
(submit also regains the 20261121 remainder rule the 20261127 rewrite had dropped). Then it backfills EVERY existing
row, drafts through paid — the stored work figure re-read as ex, GST on top where the row was registered,
reimbursements untouched — with a read-back that lists each changed row and the top-up now owed on anything already
paid. Screens follow the columns: the contractor's invoice page (`app/portal/money/[id]`) shows Subtotal (ex GST) /
GST (10%) / Total (inc GST), the claim composer labels its figures ex GST and "+ GST" on the button, the PDF's claim
line is `claimed_ex_cents`. Pinned by `lib/invoicing/ciStateMachine.test.ts` (every writer: `gst_on_ex_cents`, no
`gst_from_inc_cents`) and `e2e/contractor-invoicing.spec.ts` ($95,000 → $9,500 GST → $104,500).

**PC Command batch (Tom, 7 Oct 2026).** Migration `20270220000000_variation_painter_approval_qa_route_client_notes.sql`.
(1) **The painter approves a client-approved change.** `wo_customer_sign_variation` (20270195 body): with a painter on
the job a signed revision addition is no longer folded in — it is released (`released_at`) and waits at
`customer_approved` for the painter; with no painter it folds as before. New `wo_contractor_decline_variation(id, note)`:
status `declined` + `contractor_declined_at` / `contractor_decline_note` (new columns, so the customer's signature on the
row still says who approved it), the approval's untouched tick rows removed, event `variation_contractor_declined`; the
gate no longer waits on it. Portal `Variations.tsx` shows "Variation approved by the client" with amount + hours, a big
Accept and a small Decline that opens the note box (`declineVariationAction`); the console gets
`variation-painter-declined:<id>` (`consoleData` now also reads declined rows with `contractor_declined_at`), the PC
variation card names the decline, and `staffVariationDeclinedByPainter` sends `office_variation_declined`. `/v/[token]`
treats a painter-declined signed row as the customer's approval. (2) **Quality check with no check** — `wo_qa_route_passed`
routes a zero-check qa job like a pass (`none_scheduled` on the event) instead of `ok:0` for ever; `scripts/diag/wo-next-step.mjs`
gained a qa VERDICT (unlogged / failed-without-recheck / variation gate / colour match / already signed). (3 + 4) **Office
alerts** `office_update_drafted` (from `draftUpdateFromTodaysTicks` and the sweep's draft backstop, entity `<wo>:<day>`)
and `office_update_due` (`lib/automations/sweeps/customerUpdateDue.ts`, the console card's rule as a sweep, entity
`<wo>:<day>`), both routed per staff login through `profiles.staff_notify` — Tom ticks Email + Text for Felipe. (5)
**Client updates** on the PC job page: `ClientUpdates.tsx` + `addClientUpdateNote` → staff-only `wo_add_client_update_note`
(wo_events `client_update_note`) and `logCrmEvent(note_added, origin client_update)` on the customer's account; the timeline
is derived from sent/approved `wo_updates` + those events. Spec `e2e/pc-painter-approval-7oct.spec.ts`; units
`console.test.ts`, `customerUpdateDue.test.ts`.

**QA waiver clears a legacy fail (7 Oct 2026, 25 Bunney Road).** WO-WNWJXGTV sat at qa from 17 Sep: its only check was
logged FAIL before 20270196 made a fail spawn its re-check, so no `retry_of` row existed and `wo_qa_open_count` counted it
open for ever; the 6 Oct "Quality check not required" waiver only deletes UNLOGGED checks. Migration `20270221` re-creates
`wo_qa_open_count` with one clause: a job with `qa_waived` has nothing open (the fail stays as history). Pinned in
`e2e/pc-painter-approval-7oct.spec.ts`; the diag names the waiver as the way out.

**Estimator wizard batch (Tom, 7 Oct 2026).** Eight asks on the customer wizard, no migration. (1) The plan read is one
vision call (`lib/extract/model.ts`), so its latency is the model's; the fix is on the screen: `QuickLook.tsx`'s rooms step
shows a **reading panel** (`ql-plan-reading-panel`, with a `ql-plan-skip-wait` way past it) while `planPending` and no plan
rooms have landed, instead of the starter list — a tick on a guessed name never matched the plan's names. (2)
`buildDraft` gains `opts.planRead`; the read route and the submit plan branch pass it, and `PLAN_NEVER_PAINTED`
(carport, sauna, store / storage / storeroom) skips the room by its printed name whatever the model classified it as — a
customer-typed "Storage" room (add_room, starter list) is untouched. (3) The rooms-step preview is `PlanViewer` (zoom
slider, + / −, wheel, drag) and `PlanViewer` learns pinch-to-zoom from two tracked pointers. (4 + 6)
`applyCupboardDefaults` (`lib/wizard/rooms-loop.ts`) answers the cupboard question at tree build: kitchen / vanity /
laundry **No**, bedroom robe doors **Yes** with the standard 2, the robe line tagged `ai_assumed`/`included`; called after
the submit merge and on `add_room`. (5) `FALLBACK_TYPICALS.storage` = 2 × 1.25 m (walk-in robe) and the seed gains the
`room_type_defaults` row (`npx tsx scripts/seed-extraction-settings.ts` on prod re-seeds it; the fallback already applies
where the row is absent). (7) The sweep's Add room takes a typed name alone (`roomTypeForName` guesses the kind, the hint
says which), and `openNewRoomRef` opens the new card with the size form up and scrolls its header into view. (8)
`room_dims` takes an optional `heightM` (2–6 m, per room): `applyRoomDims` sets H, drops the H assumption and marks
`customer.heightAdjusted`, which `confirm_height` (the job-wide chip) now skips; `RoomLoopView` carries `heightM` /
`heightAdjusted` and the card shows "· 2.7 m ceilings". Pinned by `lib/wizard/tom-batch-7oct.test.ts` and driven by
`e2e/customer-journey/tom-batch-7oct.spec.ts` (the plan test needs the gitignored regression plan).

**An accepted job clears the customer's follow-ups; employee days approve themselves (Tom, 7 Oct 2026).** Migration
`20270219000000_accept_clears_followups_timesheets_auto_approve.sql`. CRM: `estimates_crm_lifecycle` (20270152 body) nulls
`accounts.followup_due_at / followup_note / snoozed_until` when an estimate turns `accepted` — every acceptance path runs
through the trigger — with a guarded backfill of reminders set before an acceptance (dated by the `followup_set` event).
The DERIVED follow-ups stay derived: `lib/crm/work-queue.ts` reads the latest acceptance per account (90 days) into an
`acceptedAt` map and `answeredByAcceptance()` suppresses a quiet quote, callback or online-estimate item asked for at or
before it (a quote sent after the acceptance is a new job and is chased). Timesheets: `timesheet_auto_approve` (NO grant —
run by the writers) is the 20270163 approve body without the staff check, `approved_by` null = approved by the rule;
`timesheet_finish` / `_record` / `_autofill` / `_extra` call it on the row they write. A day no cost rate covers stays
`submitted` (the one thing the Timesheets page still lists; `timesheet_approve` is unchanged for it); the 16-hour overnight
close still waits. The `timesheet_approval` work item is gone (kind, weight, group, builder, read, Today label). Specs
`crm-quote-followup` (+ acceptance), `employee-timesheet`, `employee-loop` test 6; help for timesheets pc/employee and crm staff.

**A painter's request priced in the working scope IS that request (Tom, 7 Oct 2026 — 12A Cavell Court).** Migration
`20270222000000_variation_request_priced_in_scope.sql`: `wo_draft_revision_variation` gains `p_source_variation_id`
(old 11-arg signature dropped) and `wo_variations.request_priced_at`. The job page's *Price it in the builder* link
carries `&variation=<id>`; `app/quote/page.tsx` loads that raised row (`revisionRequest` → `QuoteBuilder` → `RevisionPanel`
banner, testid `revision-request`) and `draftRevisionVariationsAction` passes it to the RPC, which writes the first
addition INTO the painter's own row (status priced, block ref, offer token, money; comment = painter's words + change
title; `request_priced_at` set) instead of inserting a draft beside it — one record, so the console, the work queue, the
portal chip and the stage gate need nothing new. A standing draft for the block is cancelled in favour of the request;
a change netting to zero puts an adopted request back to `raised` (event `variation_request_unpriced`), never
cancelled. Notifications: `contractor_variation_released` / `contractor_variation_added` carry an email rendition
(`variationReleasedEmail*`, `variationAddedEmail*` in `lib/messaging/config.ts`); `lib/contractor/notify.ts` returns a
`PainterNotifyOutcome` and records `<type>_notified` only when something went out, else `<type>_notified_skipped`
with the dispatcher's reason (Cavell showed "notified" over no message because the painter had no mobile and the
automation was SMS-only). `remindPainterVariationAction` (staff) re-sends from the card (*Remind the painter*).
Spec `e2e/variation-request-priced-in-scope.spec.ts`; repair for Cavell in `supabase/fixes/cavell-court-variation-to-painter.sql`.

**Contractor mobile: office-editable, required to join (7 Oct 2026).** Nine jobs' `contractor_job_update_reminder` texts
were claimed and never sent because three painters had no `contractors.phone` and only the painter could add one — and the
dispatcher's `nobody` outcome is not recorded. The office now types it on the painter's page: `ContractorMobile`
(`app/(app)/contractors/[id]/`) over `setContractorMobileAction` (zod, `isAuMobile` or empty, user session so
`contractors_staff_all` is the gate, revalidates the page). Joining requires one: `JoinForm` refuses to create the account
without a full mobile and writes it to the painter's own row (`contractors_self_update` + the 20261223 column grant) right
after `redeem_contractor_invite`. On `/portal/profile` the mobile cannot be cleared or half-typed, and with none on file the
page carries a `mobile-required` notice and the company and bank saves refuse until it is added. No migration. Specs:
`contractor-detail` (office edits, half number refused, cleared = amber), `contractor-join-mobile` (real invite, refused
without one, on the row with one), `contractor-portal` profile test (blank → refuse other saves → save → cannot clear);
`help-tour` fills the new field. Help: contractors/staff.md (+ Their mobile), contractors/contractor.md (new).
`scripts/diag/job-update-reminders.mjs` (read-only) lists every booked job's reminder claims against the texts actually sent.

**Contractor bank details: click to reveal (7 Oct 2026).** The painter's page served only `bank_bsb` + `bank_account_last4`
and nothing could show the rest: `contractor_get_bank(uuid)` (definer, is_staff() or self) existed since 20260822 but
20270201 listed it as internal-only and revoked EXECUTE from authenticated. `20270223_contractor_bank_reveal` recreates it
(same gate; a staff reveal of someone else's account inserts `contractor_events` `bank_viewed` {last4} with the actor) and
re-grants it to authenticated. `ContractorBank` (`app/(app)/contractors/[id]/`) renders the masked row as a button;
`revealContractorBankAction` (zod, user session) calls the RPC on the click and the decrypted number lives only in client
state until Hide. A 42501 before the migration is pasted reads as "needs migration 20270223". Spec: `contractor-detail`
(server render never carries the number; reveal, hide, event row). Help: contractors/staff.md (+ Their bank details).

**Finish standards as data (8 Oct 2026 — standards / painter status / call backs brief, Step 1).** The approved painter guide
`docs/standards/finish-standards-v1.json` is the ONE source of the words. `20270224000000_finish_standards.sql` makes
`standards_versions`, `standards_blocks` (the eight rule pages as jsonb), `standards_surfaces`, `standards_checks` (one row
per surface, per level, per check — 159 at Version 1) and `standards_surface_codes` (rate-card code → surface), all RLS'd
to staff + any painter with a login (`is_staff() or current_contractor_id() is not null`); a customer reads nothing, nobody
but the service role writes. `scripts/seed-standards.ts` loads the file (idempotent, then re-reads through the app's own
reader and refuses unless the tables equal the file); the code map is `lib/standards/codes.ts` (fretwork has no rate code;
Stucco / Cement Sheet / Concrete → render and Soffits → eaves are judgement calls flagged for Tom). `lib/standards/`:
`source.ts` (file → rows → model), `model.ts` (`resolveSurface` — a line's `code`, else its label as a rate code, else as a
surface name, the area's `side` or its sibling lines deciding interior vs exterior; `standardsLinksFor`, `tapeCheckRequired`,
`levelOf("PG-3") → 3`), `read.ts` / `load.ts` (every read keeps its error; a failure renders "could not be loaded", never an
empty list). New snapshots carry `WOSurface.code` and `WOArea.side` (QuoteBuilder; the crew whitelist copies them); issued
jobs resolve by label. Screens: `app/components/standards/StandardsViews.tsx` + `standards.css` (tokens only, both shells);
portal `/portal/help/standards[/<surface>?level=&job=|/s/<section>]` (under the existing HELP tab, a static segment beside
the markdown guides; pinned card on `/portal/help` and a Home card), PC `/pc/standards[...]`. "What we expect ›" per surface
line on the painter's tick list (`TickList.expectHref`), the job sheet (`WorkOrderDoc.standardsLinks`) and the PC tick list,
each locked to the AREA's level with "See other levels"; a line with no mapped standard shows no link. The PC quality-check
card lists the same links (`QaCheck.expect`, ruling S12). `settings.small_job_hours` (numeric envelope, default 16; read by
painters through `small_job_hours()`) drives **Tape check required / not required** on the job sheet (ruling S9).
`FINISH_LEVELS` (`lib/workorder/finish.ts`) now holds the guide's three level summaries (names "Clean, tidy repaint / Our
standard finish / Premium finish"), pinned to the file by `lib/standards/source.test.ts`; `FinishChip` shows them and links
to the standards. Variation chips gain `bogging`, `stain_blocking`, `additional_coats` (ruling S11); the three duplicate
label maps collapsed into `variationCategoryLabel(code, audience)` in `lib/workorder/variations.ts`, and
`draftRevisionVariationsAction` passes the painter's own category when pricing their request (it used to overwrite it with
`extra_scope`). Cleaned up on the way: `/portal/help` and `/portal/help/[feature]` now read the EMPLOYEE guides for an
employed painter (they always used `rolesFor("contractor")`); `TickList`'s unused `workOrderId` prop; the dead
`work_order_surfaces` table (20260818) dropped. Specs: `e2e/standards.spec.ts` (painter on a phone in both themes, PC,
RLS through each role's token); unit `lib/standards/*.test.ts`. Help: standards/{contractor,employee,pc}.md.
Diag: `scripts/diag/standards-unmapped-lines.mjs`. Manual script: `docs/testing/standards-step1-manual.md`.

**Finish standards sign-off and the offers gate (8 Oct 2026 — standards / status / call backs brief, Step 2).**
`20270225000000_standards_signoff.sql`: `standards_acks` (one row per painter, version, section; six = confirmed; staff
read all, painter reads own, writes only through `standards_ack_section`), `contractors.standards_invited_at` /
`standards_grace_until` (RPC-written), `settings.standards_rules` {graceDays 7, reminderDays [2,4,6], reminderHour 9,
pcCardDay 7}, and the ONE rule `standards_status_of(contractor)` → not_required | confirmed | employee_unsigned |
not_invited | grace | blocked (mirrored by `standardsStatusOf` in `lib/standards/acks.ts`, pinned by test). The required
version is the newest published MATERIAL one; a wording-only version requires nothing new (S7). `send_offer` (20270208 body)
returns `error:standards_not_signed` for a blocked painter and `t_booking_offers_standards_gate` refuses the insert on any
other path. `redeem_contractor_invite` invites a new painter with NO grace (sign-off is onboarding); `standards_invite`
(office) starts the grace; `standards_publish_version` re-invites everyone not confirmed on a material version (⚑18);
`standards_statuses()` serves staff and the service role. Painter: `/portal/standards/confirm` (intro → six sections with
`SignoffStep` → confirmation; resumable from the first unticked; `PortalTabs` hidden on the route; Home redirects there
while blocked and shows an amber card while grace runs); the confirmed date/version on Home, Help › standards and the
profile. On the sixth tick `completeStandardsConfirmation` (service, `after()`) renders `lib/standards/pdfHtml.ts` through
`renderHtmlToPdf`, uploads to `contractor-docs` (under the painter's own folder, the 20260831 rule), inserts a `contractor_documents` row of kind `standards` (new enum value,
not removable by the painter) and emails it attached (`contractor_standards_confirmed`). Messages 1, 2, 4 are
`contractor_standards_invite` / `_reminder` / `_new_version` in the registry (`lib/standards/notify.ts`, every send leaves a
`contractor_events` row with the dispatcher's outcome). `lib/automations/sweeps/standardsReminders.ts` runs the ⚑17 ladder
(entity = painter@inviteInstant, so a re-invite is a fresh ladder) and the new-version message from the campaign sweep
(`?only=standards`). PC: work-queue kind `standards_unsigned` (PC-homed; `buildStandardsItems` from `standards_statuses`;
card from day pcCardDay with `StandardsRemind`); Contractors list `Standards:` line + Send standards invite / Invite N
(`inviteStandardsAction`, `inviteAllStandardsAction`, `remindStandardsAction`); the painter page's Finish standards row
(`ContractorStandards`); the board's `Lane.standardsStatus` greys the Send offer button with "Standards not signed".
Specs: `e2e/standards-signoff.spec.ts`; unit `lib/standards/acks.test.ts`. Help: standards/{contractor,employee,pc},
contractors/staff. Inventory rows 11–14.

**Call backs: one record, four ways in (8 Oct 2026 — standards / status / call backs brief, Step 3).**
`20270226000000_wo_callbacks.sql`: `wo_callbacks` (work order, `painter_id` = who did the job via `wo_callback_painter` —
the lead assignment else the contractor — `fixed_by_painter_id`, `source` qc_fail | walkthrough_fail | customer_call |
scheduler, `reason` workmanship | not_workmanship, `reported_on`, description, `status` open → booked → fixed → done | void,
`appointment_id` = the return visit in `wo_appointments`, `qa_check_id`), RLS staff + the painter it is about or booked to
fix, writes only through the RPCs: `wo_callback_log` (every route; a scheduler visit on a job with one already open JOINS
it and answers `ok:<id>:attached`; writes the visit itself since the job may be closed; links photos by id; sets
`wo_signoff.outcome = failed_callback` for route 2; sets the invoice hold), `wo_callback_book`, `wo_callback_mark_fixed`
(painter or fixer, photo required), `wo_callback_close` (staff — the only thing that ends it, ⚑22), `wo_callback_set_reason`
(staff, logged), `wo_callback_void` (`has_dashboard_role('owner')`, reason required). C10 through the existing hold:
`invoices.chase_hold_kind` ('call_back' | 'office'); `wo_callback_hold(wo, on)` sets `chase_hold_reason` + kind on the
job's open invoices and clears only kind `call_back`, only when no call back on the job is still open — a staff dispute
hold survives. `wo_signoff.outcome` (passed | passed_after_fix | failed_callback) is derived by trigger at signing (C3:
`rectified`, or any area with `rectified_at` / `flag_withdrawn_at` → passed_after_fix). `wo_photo_kind` gains `callback`
and `wo_photos.callback_id`; `wo_painter_on_job` now counts an appointment holder, so the fixer can upload. Pure
`lib/callbacks/model.ts` holds the words and `callbackScored` (workmanship AND reported ≤ sign-off + 7 — Step 5 reads it);
`load.ts` the reads (errors kept). PC: `CallbackPanel` on the job page (route 3 form; route 2's "Is a call back required?"
from the sign-off's flagged areas; every call back with Book / Move the visit, Mark not workmanship, Confirm and close,
owner Void); `QaCheck` asks "rectify today, or a call back?" after a logged FAIL (route 1, linked to the check); the
schedule board's Extra visit sheet has a **Call back** tick (route 4, `logCallbackAction` with source scheduler). Flow:
a **Call backs** column above the river only while one is open (not a stage), **Call back** and **Invoice chasing paused**
tags on job cards. Queue (registry, PC-homed): `walkthrough_flagged` (critical once the flag's day has passed unsigned;
"No, fixed and signed today" = dismiss), `callback_unbooked`, `callback_visit_soon`, `callback_fixed`. Painter:
`CallbackCard` on the job page and a Home list (what is wrong, the office's photos, the return visit, "Fixed — add a
photo" → `markCallbackFixedAction`); message 7 `contractor_callback_booked` on booking (`lib/callbacks/notify.ts`, once per
visit day). Never touches contractor pay. Specs: `e2e/callbacks.spec.ts`; unit `lib/callbacks/model.test.ts`. Help:
call-backs/{pc,contractor,employee}. Inventory row 15. The WO-loop brief carries a note that Flow now has a non-stage column.

**Reminder moments, follow-up texts and "No work today" (8 Oct 2026 — standards / status / call backs brief, Step 4).**
The schedule stays in `lib/workorder/jobRhythm.ts` (Step 0 confirmed it matches the brief's §4.2). What was missing was the
MOMENT: `20270227000000_reminder_moments.sql` gives each one a row — `wo_reminder_moments(work_order_id, kind
day1|day1_pm|day2|mid|mid30|mid60|last, day, due_at, sends_count, last_sent_at, answered_at, answered_event,
skipped_reason no_work|rescheduled|not_sent)`, unique per (job, kind), read by staff and the painters on the job, written
only by the sweep (service) and the RPCs — and `wo_day_flags` (R10). Pure `lib/workorder/reminderMoments.ts`:
`planMoments(days)` from the planner, `sendTimes` (⚑5: 7:30 → 10:30, 1:30; 3:30 → 5:30, 7:00 from
`settings.job_update_rules`), `decideSend` (only on the moment's own day, only unanswered and unskipped, up to maxTexts,
each at or after its slot, nothing after `lastSend` 19:00 + 5 min grace), `reconcilePlan` (dates that move re-date moments
that have not happened; a texted, answered, skipped or past moment never changes; a plan that no longer carries a rung
skips it as `rescheduled`; a day that went by with no text is `not_sent`, never a miss), `momentState`. The sweep
(`lib/automations/sweeps/jobReminders.ts`, campaign sweep every half hour, `?only=moments`) plans every open job's rows
then sends: claims the row (`sends_count` compare-and-set) before texting every painter on the job with text 1, 2 or 3
(`contractorJobUpdateSms`, `…Sms2`, `…Sms3`), writes `reminder_moment_sent`. The ladder/claims engine is no longer used for
this automation (`jobUpdateLadder` and its test removed; `scripts/diag/job-update-reminders.mjs` reads moments). The
ANSWER is a trigger on `wo_events` (`surface_tick`, `photo`, `all_surfaces_done` by a contractor or the system): it stamps
the earliest open moment of that Melbourne day — one update answers one moment (⚑3, ⚑4) — and writes
`reminder_moment_answered`. R10: `wo_set_no_work_day(wo, day, reason)` (staff; today or a past day) flags the day and skips
its moments, texts sent or not; `wo_clear_no_work_day` undoes it; both write events. PC: `NoWorkDay` card on the job page
(moments with states + the control) and the same control on the schedule board's block detail; painter: `UpdateMoments`
card on the job page (the mockup's "App updates on this job"). Credits (R9, ⚑6) are DERIVED from these rows by the Step 5
evaluator, never stored. Spec: `e2e/automation-job-reminders.spec.ts` (rewritten: plan, not_sent, text 1, text 2, answered
stops it, max three, No work, closed job, both screens); unit `lib/workorder/reminderMoments.test.ts` (1, 2, 5 and 9-day
schedules, the slots, the window, reconciliation). Help: work-orders contractor/employee/pc. Inventory row 16.

**Painter status — the evaluator (8 Oct 2026 — standards / status / call backs brief, Step 5).**
`20270228000000_painter_status.sql`: `painter_job_results` (one per scored job: pending|clean|not_clean, reasons, hours,
counts_for_bonus, signed_on, and the counts behind it — checks done/passed first time, moments scored/answered,
callbacks scored, credits applied), `painter_status` (one per painter: colour new|green|yellow|orange|red, streak,
best_streak, measures, bonus_counter, line) and `painter_bonuses` (one review per trigger job, due → with_owner →
approved|declined → paid; approval flow is Step 7). Staff read all; a painter reads their own results and status;
bonuses are owner/admin/PC only. NOTHING writes those tables but `painter_status_write(painter, results, status,
bonus_reviews)` — staff or service — which diffs and emits the §5 events on `contractor_events` (`job_result_set` with
the previous row, `status_changed` {from,to}, `bonus_review_raised`), deletes results no longer scored, and flags a
bonus whose qualifying job changed. The rules are one Settings row, `painter_status_rules` (launchDate 2026-10-08,
windowDays 7, greenRun 4, newJobs 4, lookback 10, minSample 5, bonusEvery 4, smallJobHours 16, bonusDefaultCents).
`lib/painterStatus/evaluate.ts` is PURE and the only place a result, colour or count is computed: `scoreJobs` (a job
is scored from its sign-off day, pending until sign-off + windowDays, then clean or not from its checks, its moments
and its call backs — a skipped or not_sent moment counts nowhere), `applyCredits` (R9/⚑6: an update on a booked day with
no moment credits a miss, the same job first, then later jobs within the lookback), `colourFromSummaries` (shared by
the live evaluation and `colourFromEvents`, the event-log rebuild, so the two cannot drift), `evaluatePainter` (streak,
best streak, steps to Green, the bonus counter at 4 clean qualifying jobs while Green, the one line). Pinned by the
twenty-four §4.6 golden cases plus idempotence and rebuild in `evaluate.test.ts`. `lib/painterStatus/run.ts` loads the
facts (a contractor's accepted closed jobs; an employee's LED jobs; an employee who never led has no row), evaluates,
and calls the writer. It runs from the daily `wo-sweep` (every active painter — this is what seeds everyone New at
launch and finalises pending results when their window passes), from `campaign-sweep` every half hour for painters
whose jobs saw an event in the last 35 minutes (`?only=status` runs everyone), and in `after()` from the call-back
actions and `recordQa` (§4.4). `wo_schedule_qa` now reads `painter_status.colour` (§4.5 / R12–R13): New → the first
jobs as before, Green → nothing automatic, Yellow → every third closed job, Orange and Red → every job; `qa_required`
and the every-job setting still win; `wo_qa_checks.trigger` says why each check exists. `wo_add_qa_check` gained
`p_kind mid|spot` and the PC quality-check card a **Spot check this job** button. `/pc/status` is the plain staff table
of the rows (the Contractors view is Step 7). WO-loop brief decision 1 ("established contractors: none") is replaced
by this cadence.

**Every paint on every list, searchable (8 Oct 2026).** `paintOptions` (`lib/workorder/materials.ts`) no longer filters by the row's Interior/Exterior type: the Materials rows, Other paints, a line's materials and the Edit Surface Product field all offer the whole catalogue A-Z, narrowed by a search matched against name, brand, finish, category and internal alias, and the chosen paint is never filtered away. `SurfaceEditor` in `app/quote/QuoteBuilder.tsx` gained its own search box (`surface-paint-search`) over the Product select (`surface-paint-pick`). Unit: `lib/workorder/paintOptions.test.ts`. Spec: `e2e/materials-all-paints.spec.ts`.

**The painter's traffic light (8 Oct 2026 — standards / status / call backs brief, Step 6).**
Everything the painter sees is READ from `painter_status` and `painter_job_results` through their own session;
`lib/painterStatus/mine.ts` is the loader and `lib/painterStatus/copy.ts` the words (status names, the Home line, the
perks per colour with the employed-lead variant, the tips table keyed by colour × weakest measure, the colour key, the
measure lines as counts). Nothing in the portal computes a colour or a count. `20270229000000_painter_status_visible.sql`
puts ⚑21 in the database: `painter_status_visible()` reads `painter_status_rules.statusVisibleToPainters` and the two
own-row policies require it, so "switch off" means the rows do not exist for painters — no card, no page (404), no text.
An employed painter who never led a job has no row (Step 5) and therefore no UI (R17). Screens: `app/portal/StatusCard.tsx`
on Home (lamp + word + line + steps bars, the whole card links to `/portal/status`), `app/portal/status/page.tsx` (My
status: reason line, steps or streak with the bonus counter as "n of 4" and never an amount, what you get, measures, the
last-10 dots with `JobDots.tsx` as the one client piece, tips, how the colours work), `app/components/status/TrafficLight.tsx`
(four lamps red→green in a housing; New rings it blue; `aria-label` carries the word). Tokens appended to `portal.css`:
five lamp colours the same in both themes, five text-safe colours per theme (`--t-*`), the pulse (`pt-pulse`, 1.9 s) and
ring, both off under `prefers-reduced-motion`; amber, clay and emerald keep their meanings. Messages: `contractor_status_changed`
(message 6, three templates — Green, Green for a lead, any other change) sent from `runPainterStatus` when the writer reports
a previous colour different from the new one and the switch is on; and the Green wording of the third reminder text
(`contractorJobUpdateSms3Green`), chosen per painter in `jobReminders.ts` from `painter_status.colour`. Spec:
`e2e/painter-status-screens.spec.ts` (five colours as a contractor, reduced motion, light theme, the employed lead and
the crew employee, the switch). Help: painter-status contractor/employee. Inventory row 17.

**Search bars (1 Oct 2026).** PC Command has a project search in its top bar on every console page: `app/pc/PcSearch.tsx` (client, ⌘K / "/" focus, same shape as the CRM search) asks `app/pc/api/search/route.ts`, which runs two bounded reads through the staff session — `work_orders` on `wo_ref` and the snapshot's `jobTitle`/`jobAddress`, and `estimates` (with `work_orders!inner`) on title, the customer's name and the job address in `builder_state`, or `number` when the needle parses as an estimate number — merges them by work order, open jobs first, and each hit opens `/pc/wo/[id]`. Styles are the `.pc .gsearch` block in `app/pc/pc.css`. The Contacts page (`app/(app)/contacts/page.tsx`) filters on the server from `?q=` with one `or()` over name, company, email, phone (with and without spaces) and city, keeps the read's `error` on screen, and takes its needle from `SearchBox.tsx` (the Estimates search shape: debounce, Enter, Clear, `data-ready`). Specs: `e2e/pc-search.spec.ts`, `e2e/contacts-search.spec.ts`. Help: `docs/help/work-orders/pc.md` (Finding a project), `docs/help/contacts/staff.md`.

## Desk check leaves Today once an estimate is sent; "Not this one" is one tap (8 Oct 2026)
Tom: "Fix price without a visit needs to automatically go out of the CRM once an estimate has been sent", and "Not this one" on it "just needs to close". The desk-check source in `lib/crm/work-queue.ts` now drops an open `confirmation_requests` row when a send came AFTER the ask — `deskCheckAnswered(row, sends)`, fed by `readDeskCheckSends` (sliced reads of `estimate_events` type `sent` for the asked-about estimates, and `estimates.sent_at` for the same customers, both from the oldest open ask). The builder's ordinary Send never touched `confirmation_requests`, which is why the card stayed. Still derived, nothing stored; a send before the ask does not count; a failed read keeps the cards and is listed in `counts.truncated`. `buildDeskCheckItems` takes the sends as an optional fifth argument (`lib/portal/waiting.ts` passes none and is unchanged). On CRM Today, `DismissControl` takes `oneTap` — for `desk_check` items only (`oneTapFor` in `app/crm/today/page.tsx`) a tap calls the same `dismissWorkItem` for good with a recorded reason; every other kind keeps the presets + reason form. No migration. Spec `e2e/crm-desk-check-close.spec.ts`; unit `lib/crm/desk-check-queue.test.ts`.

**Fill from work order admits an untouched in_progress job (1 Oct 2026).** `20270208000000_import_set_scope_in_progress.sql` re-creates `import_booked_job_set_scope` with `in_progress` in its stage check; the worked-rows guard (any tick or rectification → `skip:worked`) is the refusal that matters and is unchanged. Prompted by 74 Champion St (quote 3666), moved to in_progress before its hours arrived.

**A cancelled final walkthrough can be rebooked (8 Oct 2026).** `20270241000000_walkthrough_rebook_after_cancel.sql` re-creates `wo_book_walkthrough` (20270196's body) with the `error:qa_first` refusal narrowed to the FIRST final on a job: when any earlier `wo_walkthroughs` row of kind `final` exists (booked, cancelled, missed or done) the date was already agreed with the client, so it can be rebooked or moved while a quality check is open. The 23 Aug ruling ("no final sign-off date until the checks pass") predates the 25 Aug change that books the final on the booking sheet, before any check exists — so the refusal had come to bite only rebooks, and cancelling a final on a job with an open check (12A Cavell Court, PS-3156) was a one-way door. Sign-off is unaffected: it still needs the `walkthrough` stage, which `wo_gate_blocked` will not reach with a check open. The WalkthroughCard Cancel button gained `walkthrough-cancel-<id>`; spec `e2e/wo-walkthrough-rebook.spec.ts`; read-only diag `scripts/diag/wo-walkthroughs.mjs "<address>"`.

**Messages between the office and a painter, per project (9 Oct 2026).** `20270249000000_wo_painter_messages.sql` adds `wo_message_threads` (ONE per work order per painter, `unique (work_order_id, contractor_id)`, with read and "last told" times per side and generated `staff_unread` / `painter_unread`) and `wo_messages` (text ≤ 4000 and/or ≤ 6 photo paths, author side, `notify_status`/`notify_detail`, and `source`/`source_id` for another module to post once). RLS: staff read all; a painter reads only their own thread on a job they are on, asked by the definer helpers `wo_message_painter_ok` / `wo_message_thread_mine` (built on `wo_painter_on_job`, so employees and return-visit painters count); customers and anon nothing. authenticated has SELECT only — writes are `wo_message_post` (decides the caller's side, validates the photo paths, and under the thread's row lock decides whether the other side is told: once per 10-minute burst unless they read the thread in between, `wo_message_ping_due`, TS twin `pingDue` in `lib/workorder/messageModel.ts`) and `wo_message_mark_read`; `wo_my_message_threads()` lists a painter's threads with unread counts. Photos sit in the PRIVATE `wo-messages` bucket at `<work_order_id>/<contractor_id>/<file>`, with storage policies on the same helper (`wo_message_object_ok`); upload is sign (server action) → PUT from the phone (`putToSignedSlot` in `lib/workorder/uploadMedia.ts`, same shrink/progress/stall timer as site photos) → the bytes are sniffed on Send (`stagedHeadBytes`). One component, `app/components/wo/MessageThread.tsx` with `mode` staff | painter, renders on `/pc/wo/[id]` (painter tabs, `?painter=`) and `/portal/jobs/[id]`; the portal Home's Messages card names each thread by job ref + SUBURB only (the address is looked up server-side for the RPC's job ids and reduced with `suburbOnly`). Readers: `lib/workorder/messagesLoad.ts` (caller's session, photo URLs signed through it). Staff → painter: `notifyPainterMessage` (`lib/contractor/notify.ts`, automation `contractor_message`, Text/Email/Both, sending hours; a held text is dropped by `stillNeeded` once the painter has read the thread) records the OUTCOME on the message and as `message_notified` / `message_notified_skipped` on the job, and hands the burst back when nothing went out. Painter → staff: the PC work item `painter_message` (`lib/crm/work-queue.ts`, homed on PC, cleared by the staff side's read or reply) plus the optional `office_painter_message` staff alert (Staff logins → Painter message; nobody ticked by default; deliberately not tagged with the estimate, so an emailed reply can never land in the customer's estimate chat). **One route to the painter:** a site check-in note sent to the painter (20270248) is delivered as an office message in this thread — `deliverSiteVisitNote` (`lib/workorder/siteNoteMessage.ts`, called by `sendSiteVisitNote` in `app/pc/actions.ts`) picks the lead painter (`leadPainterId`), copies the note's photos from `site-visit-photos` into the thread's folder with the staff session (`storage.copy` with `destinationBucket`), and calls the staff-only definer `wo_message_post_from('site_checkin', note id, painter, paths)`, which reads the words from the note itself and files them once per note through the same internal `wo_message_insert` (not callable by anyone) as `wo_message_post`; the burst rule and `notifyPainterMessage` then tell the painter, and the note's `sent_outcome`/`sent_detail` take that outcome in words (`noteOutcomeFor`: sent or held = sent, batched = covered by the text just sent, not reached / off = skipped). This replaces `notifySiteVisitNote` and the portal's "Notes from Paint Group" section; `wo_site_visit_note_shared` and the painter's read policies on the note tables stay (they expose nothing the thread doesn't, and 20270248 is live) but no screen reads them any more. Spec `e2e/pc-contractor-messages.spec.ts` (and the joined flow in `e2e/site-checkins.spec.ts`); help `docs/help/painter-messages/{pc,contractor,employee}.md`; manual test `docs/manual-tests/pc-contractor-messages-9oct.md`.

**Fill from work order: `--for` and `--area` (1 Oct 2026).** `scripts/import/fill-work-order.ts --for <pageQuote>=<jobQuote>` fills the job handed over under one PaintScout quote number from a work order printed under another (9/552 Lonsdale St: job 3083, work order 3096); `external_ref.work_order_quote_no` records the page's quote. `--area <woArea>=<quoteArea>` (`FillOptions.areaAliases` in `lib/import/booked/fill.ts`) lets a work-order area with no same-named price take a named quote area's price — an explicit alias wins over a same-named block, so a refill is not fooled by the $0 block an earlier fill wrote, and a leftover $0 block is dropped. Unit-pinned in `fill.test.ts`.

**What the colour changes — offers, payment terms, bonus (8 Oct 2026 — standards / status / call backs brief, Step 7).**
`20270230000000_status_offers_payment_bonus.sql`. **Red (⚑8):** `painter_status` gains `offers_cleared_at/by/reason`;
`painter_offers_blocked(painter)` is true for a Red with no clearance; `painter_clear_red(painter, reason)` (owner only,
`has_dashboard_role('owner')`) records "Spoken with, offers allowed" and the `red_clearance_given` event; the writer
resets the clearance when the colour next changes. The block lives in `send_offer` (`error:red_no_clearance`), in the
`booking_offers` insert trigger (the last line of defence) and in a new `wo_assignments` trigger on `is_lead`, so
`set_lead_painter` and `assign_job` refuse a Red employee as lead the same way. The board sorts lanes Green → Yellow/New →
Orange → Red (`STATUS_ORDER` in `lib/scheduling/board.ts`) and shows the colour in words on every lane; the re-offer
picker sorts the same way and leaves an uncleared Red out. **Payment terms (R11, ⚑14, ⚑23):** `business_days_after(date, n)`
counts Monday–Friday less `visit_booking_rules.publicHolidays`; `contractor_invoice_draft` reads the painter's colour AT
sign-off — Green → `due_on` = 3 business days after the signed day (`painter_status_rules.greenTermsBusinessDays`),
`terms_kind 'green_fast'`; otherwise the default `contractorTermsDays`. `contractor_invoice_hold_fast_terms(ci, reason)`
(staff) puts that one invoice on the default date — never later — with `terms_kind 'held'` and a `payment_terms_held`
event; `contractor_invoice_release_fast_terms` puts the fast date back. Payables shows the terms chip and the Hold /
Release buttons (`app/invoicing/Dashboard.tsx`); the `payment_hold` queue card says release or keep. **Bonus (⚑9, ⚑13; Tom
8 Oct on payment):** `bonus_hand_over(id)` (PC's "Tell Tom": due → with_owner), `bonus_decide(id, approve, amount_cents,
note)` (owner; approve refuses with `error:approvals_off` while `painter_status_rules.bonusApprovalsEnabled` is false —
ships OFF until ⚑10/⚑11), `bonus_claim(id)` (the contractor: raises a SUBMITTED `contractor_invoices` row,
`auto_draft_source 'bonus'`, one line, `claimed_ex_cents 0` so it never eats the job's remainder, GST by registration; the
normal approve → pay → remittance path follows and `t_contractor_invoice_bonus_paid` marks the bonus paid). A painter reads
their own approved/paid bonuses (`painter_bonuses_own`) and nothing else; owner/admin/PC read all; customers none. Screens:
`ContractorStatusPanel` on `/contractors/[id]` (colour, Red clearance form for the owner, bonus reviews with Tell Tom /
amount / Approve / Decline), `BonusClaimCard` on the painter's Money tab (amount + Claim now; an employed lead reads "next
pay run"), five PC queue cards (`painter_orange`, `painter_red`, `bonus_due`, `bonus_changed`, `payment_hold` in
`lib/crm/work-queue.ts` `buildPainterStatusItems`, PC-homed; Orange and changed-review cards dismiss through the one
`crm_dismiss_work_item`). Messages: `contractor_bonus_approved` (message 8 — the amount and how it is paid, two wordings),
`office_bonus_review` and `office_painter_red` (message 9 — owner alerts via `STAFF_EVENTS`, sent from the evaluator run).
Payroll: `payrollCsv(rows, bonuses)` adds a `bonus_cents` column and one row per approved employee bonus decided in the
range (⚑11) — the only money on that file. Spec: `e2e/status-offers-payment-bonus.spec.ts`.
**Finish date of a running job, from the board (8 Oct 2026).** An in-progress block on `/pc/schedule` is not draggable (its start stays). Its sheet, and an accepted contractor booking's sheet, now carry a **Finish date** box (`finish-date-row` in `app/pc/schedule/ScheduleBoard.tsx`) that calls `setFinishDateAction` (`app/pc/schedule/actions.ts`, zod `setFinishDateInput` in `lib/validation/booking.ts`). The action snaps the date to the painter's next working day from their stored `works_saturday/works_sunday` (`addWorkingDays`), then calls `wo_contractor_set_finish_date` — the one function that owns the finish date, also used by the painter's portal — which moves the accepted booking's `end_date` and `work_orders.end_date` together, re-books a booked final walkthrough on the new day with its time, and logs `finish_date_changed`. `after()` reconciles the painter's Google Calendar (`reconcileForWorkOrder`) and re-sends the walkthrough invites. `20270245000000_schedule_end_date_in_progress.sql`: `move_booking` refuses a different start on an accepted booking whose job has started (`error:started`) and now writes `work_orders.end_date` as well as the start (it used to leave the work order's end on the old day); `reassign_dates` refuses to move an employee's start once the job has started and their first day has passed. `reassignDatesAction` now reconciles the lead's Google Calendar too. Employee crew start boxes lock in the sheet under the same rule. Spec: `e2e/schedule-end-date-in-progress.spec.ts`.

**PC Command: pre-start lists, soonest-first Pre-start, notes on reminders (8 Oct 2026).** Migration `20270243000000_pc_prestart_lists_and_work_item_notes.sql` adds two staff-only tables, each written only through a staff-checked definer RPC: `wo_prestart_lists` (one row per job — `materials`, `equipment`; `wo_set_prestart_list`) and `work_item_notes` (a ≤280-char note keyed by a dashboard reminder's derived key, e.g. `colours:<wo id>` or a `job_checkin:…` key; `pc_set_work_item_note`, empty note deletes). Notes are words ABOUT a key, like `work_item_dismissals` — the reminder itself is still derived, never stored. Reads in `lib/workorder/pcNotes.ts` return a `failure` line rather than an empty result. The job page passes `PrestartListBox` (two textareas, under "Materials ordered" / "Equipment movements booked") into `Checklist` through a new `extras` slot — saving never ticks; the tick stays the gate. The dashboard (`app/pc/page.tsx`) loads every drawn key's note and renders `WorkItemNote` inside each card — in batches of `NOTE_KEYS_PER_READ` (100) keys per `in` filter since 21 Oct 2026, because one filter over a few hundred keys is a GET URL past the request limit and PostgREST answers 400 (the test project drew "could not be read" over every card; `lib/workorder/pcNotes.test.ts`). The Pre-start lane on `/pc/flow` sorts by `bySoonestStart` and lights `startAlert` (start within `PRE_START_ALERT_DAYS` = 3 Melbourne calendar days, today included, or passed and unstarted) as the orange `.job.soon`; both pure helpers live in `lib/workorder/stages.ts` with unit tests. Spec: `e2e/pc-prestart-materials-order-notes.spec.ts`. Help: `docs/help/work-orders/pc.md`. Manual test: `docs/manual-tests/pc-prestart-materials-order-notes-8oct.md`.

**Morning heads-up for painters + the customer's defect-tape text (8 Oct 2026).** Two automations in the registry, each with its own switch and wording, both planned by the one planner `lib/workorder/jobRhythm.ts` from the booked working days (`jobDays`, the painter's works_saturday / works_sunday). `contractor_job_update_morning`: `painterMorningHeadsUps` = every 15:30 moment's day that has no 07:30 moment of its own; `headsUpDue` (`reminderMoments.ts`) opens a 07:30–12:00 Melbourne window (`settings.job_update_rules.headsUp` / `headsUpUntil`); `sendHeadsUp` in `lib/automations/sweeps/jobReminders.ts` skips a day whose moment is answered or skipped, claims `automation_claims(contractor_job_update_morning, wo, '<moment>:<day>')`, sends SMS/email to every painter through `sendAutomation`, and writes each painter's `outcomeWord` to `wo_events` `reminder_morning_sent`. The sweep now runs when either switch is on; with the 3:30 reminders off it reads moment rows without planning them. `customer_defect_tape`: `customerDefectTapeRungs` = 3–6 days → `am` + `pm` on the day two working days before the last; 7+ → `am` three working days before; `lib/automations/sweeps/defectTape.ts` reads `work_orders.start_date/end_date` (the scheduler's columns) every sweep and again before the claim, windows from `settings.defect_tape_rules` (09:00–12:00, 15:30–19:00), claims once per job per rung, sends through the dispatcher with sendKind `job_defect_tape` (the customer's *job* switch), and writes `wo_events` `defect_tape_sent`. Both have `stillNeeded` checkers for a held / approve-first copy. Called from `app/api/cron/campaign-sweep` (`?only=moments`, `?only=defect`); the half-hour cron lands on :00/:30 Melbourne in both AEST and AEDT, so 07:30, 09:00 and 15:30 are exact ticks. No migration. Specs: `jobRhythm.test.ts`, `reminderMoments.test.ts`, `sweeps/defectTape.test.ts` (3/4/6/7/10-day jobs, weekends, the 4 Oct clock change), `e2e/automation-morning-defect.spec.ts`. Manual script: `docs/testing/morning-defect-texts-manual.md`.

**PC Command: colours from our list + further instructions for the crew (8 Oct 2026).** The Materials card on `/pc/wo/[id]` (`app/pc/wo/[id]/MaterialsCard.tsx`) now mounts the builder's own `app/components/ColourPicker.tsx` over the `colours` table inside its "Adjust colour / litres" form; picking fills the free-text name and hex, which stay editable, and saving still goes through `wo_set_material`. `ColourPicker` gained optional `label` and `testId` props (one component, no fork) and now reports a rejected list read instead of showing "No matches.". The work order's "further instructions for the crew" stays ONE column, `work_orders.crew_notes`: `20270244000000_wo_crew_notes_follow.sql` adds a BEFORE trigger (`t_wo_crew_notes_to_snapshot`) that copies the column into `wo_snapshot.crewNotes` whenever the column changes, or whenever a snapshot is rewritten while the column holds text, so every contractor surface (`/w/[token]`, `/crew/[token]`, the portal job page, the offer card), which all render the snapshot, reads the current note whichever door wrote it (the builder's direct `patchWorkOrder`, or PC). `wo_set_crew_notes(work_order_id, notes)` is the PC door: staff only, closed refused, 4,000-character cap, one `crew_notes_edited` wo_event carrying lengths only. `CrewNotesCard` on the job page calls it through `setCrewNotes` in `app/pc/actions.ts`, and shows an amber line when an issued sheet disagrees with the column (a builder edit made after issue before this trigger existed). No backfill: the read-back counts those jobs and the next save settles each one. Tests: `e2e/pc-colour-list-crew-instructions.spec.ts` (anonymous `/w/[token]` assertions), `lib/workorder/crewNotes.test.ts` (pins the SQL).

**Quality checks in the calendar, before the final; site check-ins (8 Oct 2026).** Migration `20270247000000_qa_check_scheduling.sql` gives `wo_qa_checks` a `scheduled_time` and owns the one placement rule, `wo_qa_place_open_checks` (the open main `final` check, not a re-check, goes on `wo_working_day_before(final)` — Mon–Fri, `visit_booking_rules.publicHolidays` skipped — keeping its time, else 09:00). It runs from two triggers, never from the doors themselves: `t_booking_offers_qa_at_booking` (an offer turning `accepted` runs the existing cadence `wo_schedule_qa` — `wo_contractor_is_new`, the office flag, the status colours — then places the check, falling back to the booked last day when no final exists) and `t_wo_walkthroughs_qa_follows` (any booked/moved final row, whichever function wrote it). A cancelled final moves nothing. Staff set/move/clear a check with `wo_qa_set_schedule`; `wo_add_qa_check` gained `p_time`; both refuse a time not before the booked final or a day already gone (`wo_qa_when_problem`). The TS twin of the rule and the refusals is `lib/workorder/qaSchedule.ts`. The calendar invite is `lib/workorder/qaCheckInvite.ts` — a reconciler on the walkthrough-invite pattern (stable UID `qa-check-<id>`, SEQUENCE per sent invite, CANCEL when a dated check disappears), sent by email + `.ics` to whoever has the new staff alert `office_qa_check_invite` ("QA invite", email only) ticked, every outcome recorded as a `qa_check_invite` wo_event; it runs at the end of every `sendWalkthroughInvites` (so every door that moves the final reconciles it), from the PC actions, after an accepted offer (`notifyOfferRespondedAction`) and in the daily `wo-sweep`. PC Command shows the checks through the one work queue: `buildQaCheckItems` in `lib/crm/work-queue.ts` (kinds `qa_check_due` on the day, `qa_check_final_cancelled`, both homed `pc`); the console's 5c card keeps only "Quality check to do" for a job parked at the qa stage. The PC job page lists each check with its day, time and invite outcome (`app/pc/wo/[id]/QaSchedule.tsx`, loader `lib/workorder/qaScheduleLoad.ts`); "Add a mid-job check" is now "+ Add a site check-in" (kind `mid`, day and time), and a due check-in can be recorded while the job is in progress.

**Site check-ins are their own thing — Felipe's visits, notes, photos (9 Oct 2026).** Tom: "logged just for Felipe", "shouldn't hold jobs back", "isn't documented as pass or fail, but progress notes can be made with the option to send to the painter, and also attach photos". Migration `20270248000000_site_checkins.sql` moves site check-ins OUT of `wo_qa_checks` into `wo_site_visits` (day, time, `visited_at`, and its calendar-invite history in `invite_log` — not in `wo_events`, which the job's painter and customer can read), `wo_site_visit_notes` (several per visit, author + time, `send_to_painter`, the dispatcher's `sent_outcome`/`sent_detail`) and `wo_site_visit_photos` in a private bucket `site-visit-photos` (`<wo>/<visit>/<file>`; the `wo-photos` bucket lets the job's painter and customer read every object). A separate table rather than a new kind because every reader of `wo_qa_checks` — `wo_qa_open_count`, `wo_qa_route_passed`, the stage gate, the fail text, the painter-status evaluator (`lib/painterStatus/run.ts`), the customer timeline — would otherwise have to learn to skip it; kind `mid` stays the cadence's pass/fail mid-job check (now labelled "Mid-job check"). RLS: staff read all; a painter reads only notes sent to them (and their photos) on a job they are on, via the definer helper `wo_site_visit_note_shared`; customers and anon nothing. Writes are staff-only definer RPCs (`wo_add_site_visit`, `wo_site_visit_set_schedule`, `wo_remove_site_visit`, `wo_site_visit_mark_visited`, `wo_site_visit_add_note`, `wo_site_visit_share_note`, `wo_site_visit_record_photo`); `wo_add_site_visit` reuses `wo_qa_when_problem` and does not clear `qa_waived`. Open office-added `mid` checks created since 20270247 move with the same id (so Felipe's calendar entry continues). The invite reconciler `lib/workorder/qaCheckInvite.ts` reads visits as kind `visit` ("Site check-in"), the `wo-sweep` includes due visits, and PC Command gets `site_visit_due` (`buildSiteVisitItems`, homed `pc`, cleared by Mark visited). UI: `app/pc/wo/[id]/SiteVisitsCard.tsx` (loader `lib/workorder/siteVisits.ts`), photo upload `app/api/wo/site-visits/photos` (sign → PUT → sniffed ingest; the Range read is now shared in `lib/workorder/stagedBytes.ts`), send to the lead painter, outcome on the note (since 20270249 delivered as a message in the painter thread — see "Messages between the office and a painter"). The painter's job page no longer lists mid/spot check days (`painterSeesQaDate`); the residential timeline's "Quality check passed" now reads only kind `final` (`lib/portal/data.ts`).

**Variation approved email + office reject (8 Oct 2026).** The customer's signature on `/v/[token]` (`signVariationAction`, and the older approve path in `respondToVariationAction`) now awaits `sendVariationApprovedConfirmation` (`lib/workorder/variationApprovedEmail.ts`): one email per offer token, listing the approved changes and the net, to the estimate's contact (builder contact, else `sent_snapshot.contactEmail`; second contact copied), through `sendEmail` with kind `variation_approved` (the customer's "job" switch applies). The outcome is on the job's record — `variation_approval_confirmed` {offer_token, to} or `variation_approval_confirmation_skipped` {offer_token, reason} — and either one is the once-guard. It sits outside the automation dispatcher for now, because `lib/automations/registry.ts` and `lib/messaging/config.ts` were being changed on another branch; giving it a registry entry and an off switch is the follow-up. The office's reject: `20270240000000_variation_office_reject.sql` adds `wo_variations.office_rejected_at / office_rejected_by / office_reject_note` and the staff-only `wo_office_reject_variation(p_variation_id, p_note)`, which moves only a `raised` row to `declined` (declined_reason = the reply, so the employee read already shows it) and logs `variation_office_rejected`. `app/pc/RejectVariation.tsx` (one component, used on PC Command's Variations for approval and on the job page's raised cards) calls `rejectVariationAction` (`app/pc/variationRejectActions.ts`), which then sends the reply through `notifyVariationRejected` (`lib/contractor/notify.ts`): a MANUAL send by text and email to the painter who raised it (else the job's painter), recorded as `variation_rejected_notified` {channels} only when a channel actually sent, else `variation_rejected_notified_skipped` {reason}, and reported back on screen in words. The painter's job page shows **Not going ahead** with the reply (`office-rejected-<id>`). Unit: `lib/workorder/variationApprovedEmail.test.ts`. Spec: `e2e/variation-approved-email-and-reject.spec.ts`.

**PC Command → Contractors (8–9 Oct 2026 — standards / status / call backs brief, Step 8).**
One model, two screens. `lib/painterStatus/contractorsView.ts` is PURE: `buildContractorsView(inputs, now)` turns painters,
`painter_status` rows, status-change events, bonuses, open call backs, standards statuses, job results and jobs into
`rows` (one per active painter — colour or null, the reason line, streak, checks "3/3", app "11/12", call backs, trend from
`trendOf`, `offersBlocked`, tags, the last ten results, the staff-only bonus history, the jobs a spot check can go on and
the finished jobs a call back can be logged against; Red first, Green last) and `counts` for the strip — counted off the
same rows, never a second query; `contractorsView.test.ts` pins strip = list. `lib/painterStatus/contractorsLoad.ts`
fetches the inputs for a staff session in one `Promise.all` and reports each failed read. `app/pc/contractors` (the
**Contractors** tab, replacing Step 5's plain `/pc/status`) renders the strip and `ContractorRows` (client: expand, tap a
dot for why, **Spot check** → `addQaCheck(kind 'spot')` on a job under way, **Log call back** → the finished job's
`#callbacks` card — never a fifth route). The home dashboard's Contractor section reads the SAME model: `loadDashboard`
loads `painterStatus` through `loadContractorsView` and `lib/reporting/metrics/contractors.ts` gains `contractors.on_green`
("4 of 11 evaluated", drill = the rows), `contractors.open_callbacks`, `contractors.bonus_due`, `contractors.standards_unsigned`.
Spec `e2e/pc-contractors.spec.ts` (strip = list per colour, the row in words and counts, the sheet, spot check, log call
back, the dashboard tile equals the strip). Help `docs/help/pc-contractors/pc.md`. No migration.

**The full loop and the hardening (9 Oct 2026 — standards / status / call backs brief, Step 9).**
`e2e/status-full-loop.spec.ts` is the two-story acceptance: the happy path (blocked until the standards are signed →
signs the six sections on the phone → offered → four clean jobs New → Green → first lane on the board and a 3-business-day
sign-off due date → four more clean 16-hour jobs → one bonus review) and the failure path (a first-time quality-check fail
fixed the same day → Yellow; a flagged walk-through that becomes a call back → Yellow; a customer call back on day 5 →
Orange; one on day 9 → outside the window, that job clean and the colour held), the colour read back from the real sweep at
every point and the event log replaying the same sequence; then the customer role reading none of the seven new tables.
`lib/painterStatus/boundary.test.ts` greps `app/` and `lib/` for any insert / update / delete / upsert on
`painter_job_results`, `painter_status`, `painter_bonuses`, `wo_callbacks`, `wo_reminder_moments`, `wo_day_flags` or
`standards_acks` outside their RPCs (the reminder sweep is the one allowed planner of moment rows), for any Client Component
that names one of those tables, and for any hand-set colour, result or amount. CLAUDE.md gains the standing rules this build
taught: one evaluator / one writer, "sql done" is a claim until the ledger says so, and check CI after every push.

**Customer journey green again after S6 (9 Oct 2026).** S6's "details first" gate (e9f11d1c) left ~36 customer-journey specs timing out on the new last question; each now calls `passGateIfShown` (`e2e/customer-journey/drive.ts`, which answers with a unique mobile and reports whether the gate showed). Three product faults the run exposed are fixed: `quickNext` in `app/wizard/WizardApp.tsx` builds the COMMERCIAL state whenever the walk has a `com_job` step (keyed on the last screen, every commercial job since 7 Oct submitted through the household derivation and a warehouse lost its floor); `TalkSheet` takes a `place` (suburb, postcode) and sends it with a request or message so it is zoned without waiting for the draft autosave; `scrollCardToTop` (`app/estimate/scope/scrollCard.ts`) re-checks after 700 ms so a newly opened room lands with its name in view. The 5 Oct condition-chip accessible-name fix (f2ed34f0) is folded in.

**Filled handover jobs: pay and materials budget (9 Oct 2026).** `lib/import/booked/workorder-text.ts` reads each line's printed materials $ (`materialCents`) and the job-level estimate's $; `lineMaterials` in `lib/import/booked/build.ts` puts PaintScout's product, litres and $/L on each imported surface, so the engine's materials cost (the PC page's budget) is PaintScout's estimate while the price override keeps the customer's total. A $0 offered amount is a blank: the sheet's pay is priced from the hours. `fill-work-order.ts --contractor-rate <$/h>` writes the working scope's Contractor rate and sets the pay to hours × rate. Migration `20270250` (with `20270251`: a `pay_override` from `--contractor-rate` replaces the earlier pay) keeps an old pay only when > 0, sets `work_orders.contractor_payment_cents` from the new sheet unless it holds a real figure, resets an open `wo_working_scopes` copy (20270252: deleted, since its accepted_state is guarded; the next Revise scope reopens it from the new scope), and refuses (`skip:variations`) when the job has a live variation.

**Wizard UI refresh S1 — the shell on every path (9 Oct 2026).** The quick look and the commercial screens wear the refreshed shell (brief `docs/briefs/claude-code-brief-wizard-ui-refresh.md` §5, §7.1–§7.2; mockup `design/reference/estimator-wizard-redesign-mockup.html`). `app/wizard/WizardHeader.tsx` is the one slim header — logo, step rail, phone number, chat icon, Save & book, a 3px progress stripe, and on a phone "Step 2 of 6 · The place" with a bar. The rail is `railFor(stepsFor(...), step)` from `app/wizard/stepRail.ts`, which only NAMES steps (an exhaustive `Record<QuickLookStep, …>`) and never orders them; `app/wizard/stepRail.test.ts` walks every home path and every segment (inside, outside, both, hospital) against `stepsFor()`, which is why `vitest.config.mts` now includes `app/wizard/**/*.test.ts`. `QuickLook.tsx` lays each step out as `.wz-stage` — the questions in `.wz-pane` (640px) and an empty `.wz-side` (430px, sticky) that S2 fills with the pictures — with Back and Continue inside the column (a fixed bar on a phone), a "why not yet" line when Continue cannot be pressed, and "Talk it through" as a compact card under the nav. ⚑ 10: `ChatWidget` takes `place="header"` and renders as the header's icon (`lib/wizard/ui-flags.ts` holds that and the other refresh switches). Hints are sentence case under the question with an "Optional" tag; segment-row kickers and route tags stored in capitals are sentence-cased in CSS only (Tom, 9 Oct). Tokens on `.wz` move to the brief's palette (cyan darkened to #0A7C8E for AA; `--paint` #3BD8E9 with `--onpaint` for the primary pill); every new rule hangs off `.wz-head`, `.wz-stage` or `.wz-wrap--stage`, so the editors, the range screen and the older staff page list (⚑ 21) are unchanged until their own sessions.

## Card payments are a Settings switch; the customer's Pay button opens the bank-details box (4 Oct 2026)

Tom: a button in Settings to add or remove Stripe payments, Stripe off for now, and the Pay button opening a box with the deposit or payment amount, our bank details and the invoice number as the reference. No migration: the switch is `invoicing.cardPaymentsEnabled` in the `invoicing` settings key, read by ONE helper (`lib/invoicing/cardPayments.ts`, `cardPaymentsEnabledFromSettings` — exactly `true`, nothing else, so a missing key is off). `createCheckoutSession` (`lib/invoicing/stripe.ts`) refuses with `switched_off` before it mints anything, and the checkout route turns that into a friendly 503, so an old card link can never charge after the office turns cards off; the webhook is deliberately NOT gated, so a payment or refund already in flight still lands. The customer page (`app/i/[token]/page.tsx`) offers the card option only when the switch is on AND `STRIPE_SECRET_KEY` is set. `PayBox` (`app/i/[token]/PayBox.tsx`, client) is the single **Pay $balance** button and its `<dialog>`: the due label by invoice kind, the amount, the bank rows from `invoicing_bank`, the invoice number as the reference with a Copy button, and — only when cards are on — the card form with the surcharge disclosed, which moved out of `PayPanel` (now the post-checkout confirmation states alone). `InvoiceSheet` takes a `payBox` slot that REPLACES its static "How to pay" box on screen; print/PDF and every staff preview pass none and keep the static box, so the paper still carries the bank details. `InvoicingSettings` gains **Card payments (Stripe)**: one button, **Add card payments** / **Remove card payments**, which merges the key into `invoicing` the moment it is pressed, with an amber note when the switch is on but the server has no key. Pinned by `lib/invoicing/cardPayments.test.ts`, the `stripe.contract.test.ts` switch pin, and `e2e/invoicing.spec.ts` (the Pay box as an anonymous customer, the print page's static box, the 503, the Settings button round-trip); `e2e/stripe-live.spec.ts` turns the switch on for itself and off again. Help: `docs/help/invoicing/{staff,customer}.md`.

### What we expect — one drop-down document (9 Oct 2026)
`app/components/standards/WhatWeExpect.tsx` is now a single `<details>` closed by default at the top of the
painter's job (`/portal/jobs/[id]`) and PC Command's job (`/pc/wo/[id]`, incl. the quality-check stage).
Opened, it reads as one document: `groupExpectations()` in `lib/standards/model.ts` folds the per-line
`expectationsFor()` list into one section per standard per level (Walls · Level 3 with every room it covers),
so a job with walls in six rooms shows the walls checks once, not six times. No migration, no data change.
Manual test: open a job with several rooms → one closed "What we expect on this job" row → tap it → each
standard once with its rooms as chips → "Open the full standard ›" lands locked to the job's level.

**Wizard UI refresh S2 — the live picture, Your job so far, Talk it through in the picture column (9 Oct 2026).** `QuickLook`'s right-hand column (`aside.wz-side`, `ql-side`) now carries three pieces. `app/wizard/PictureCard.tsx` picks the picture for the step — `pictures/HousePicture.tsx` on Address and Place (property type, storeys that lift the roof, inside lights the windows), `pictures/RoomPicture.tsx` on Job, Condition and the details step (each surface its own shape with `data-s` / `data-on`, painting in or out as it is ticked, the last one touched outlined and explained in the caption; the Condition step shows the room "today" with its marks), `pictures/PlanMap.tsx` on Rooms (one block per room, dashed when left out; the floorplan viewer `ql-plan-preview` moved in here, zoomable) — in a fixed 4:3, `aria-hidden` box with a one-line caption. `app/wizard/JobSoFar.tsx` restates each answered step with a Change link (`WizardApp.quickGo`, back only). `app/wizard/TalkCard.tsx` is the one "Talk it through" (`ql-talk`, `ql-book`, `ql-call`, `ql-message`), naming the estimator `resolveEstimator` gives the `/estimate` page (Settings → Estimator before an address; nobody when unset). On a phone the column is `display: contents`: the picture sits above the question, Your job so far is hidden, the talk card sits at the foot — CSS order, never a second copy. Option cards gain pictograms (`pictures/pictograms.tsx`); Inside / Outside / Both are picture cards; the Job step lists surfaces Walls first. ⚑ 1 (colour try-on) stays off.

**Wizard UI refresh S3 — the range screen on every path (10 Oct 2026).** `app/wizard/Reveal.tsx` is laid out to brief §7.4 under `.wz-reveal--v2`: row 1 is the range card (the kicker with the customer's first name, a "Guide · within N%" pill from `payload.bandPct`, the range — the existing roller reveal kept as the one motion, no count-up — GST line, part ranges for "both", the commercial note, the basis sentence) beside the doors (`.wz-doors`, Tighten my price the one cyan card, order and visibility unchanged); then the dark estimator strip (`EstimatorStrip`, restyled only inside `.wz-rv-sign`); then two cards — What we've assumed (still `reveal-assumed-toggle`) and Why people choose us (⚑ 5: the homepage's own claims — `getGoogleReviews()` rating and count, the `promise.row_4` copy; commercial swaps the warranty line for "Certificates and SWMS with every quote"; anything unavailable is left out) — with ⚑ 2's "A job like yours" off; then What we'll do in two columns. The ladder (`reveal-tiers`) is bars: Guide (its width follows the live band, ⚑ 11), Detailed, and Confirmed only for a home-inside job — outside, both and commercial get two bars and "Then a visit…" (`reveal-tiers-visit`), as `lib/wizard/ladder.ts` rules. The header after the details is `WizardHeader` with `after` — Guide range → Room by room / Side by side / Area by area / Rooms and sides → Fixed by (the resolved estimator). On a phone everything stacks and `reveal-dock-tighten` sits in a bottom bar. `/estimate` passes `trust` and `WizardApp` passes the first name.

**Wizard UI refresh S4a — the editor's frame (10 Oct 2026).** `app/estimate/scope/ScopeEditor.tsx` keeps every card and action but changes its frame (brief §7.5): `.sc-freeze` is now only the slim `WizardHeader` (the after-the-details rail: Guide range → Room by room / Area by area / Rooms and sides → Fixed by the estimator), pinned; the page is `.sc-ed`, the cards on the left and a sticky right rail `.sc-rail` — the price card (`price-card`: tier chip and next step, the range with `range-width`, a band of the range now over a dashed outline of the guide range it opened with, `.il-prog` unchanged, a checklist, and the ONE `.sc-stick` with Finalise and Book), Your home (the real plan through `PlanPanel` when there is one, otherwise `PlanMap` of the rooms, amber until checked), and the estimator card (`EstimatorStrip`, outside `main`). On a phone the rail is `display: contents`: the price card is a dark sticky strip under the header, the plan sits first, the `.sc-stick` is the bottom bar. `scrollCard.ts` counts that strip so an opened card lands below it. No room-card internals changed (S4b).

**Wizard UI refresh S4b — the room cards (10 Oct 2026).** Inside `.sc-ed`, a room card carries a number badge (a tick once checked) and, when checked and closed, a one-line summary of what is painted (`roomSummary`, the tiles' own counts); only the OPEN card (`.open`) has the amber border. The open card reads as three numbered blocks — the size (with `RoomOutline`, a small to-scale drawing beside "Is about … right?"), what we're painting (tiles in `TILE_ORDER`, Walls first, via `sortTiles`; counted and share tiles span two columns when on), and cupboards and robes — then the existing extras, extra prep and Confirm. Pills and tags are sentence case (⚑ 7: "Check this room" / "Checked ✓"); the size kicker keeps its words in the DOM (a spec reads them) and is sentence-cased in CSS. Classes the specs drive (`.il-hd`, `.il-first`, `.il-size`, `.il-cup`, `.il-pill`, `.il-confirm`, `.sc-tl`, `.sc-st`) are unchanged.

**Wizard UI refresh S5 — home outside (10 Oct 2026).** The Outside step's "On the house" is two columns of picture cards and "other areas" are tick chips (`ExteriorPickTiles` `chips`); the picture card (`PictureCard`) shows `pictures/OutsideHousePicture.tsx` on Outside (and an outside job's gate) — each ticked element (`data-e`) takes its fresh coat, each other area (`data-x`) pops in, material sets the texture, storeys the upper floor, the colour answer the wall tone — and `pictures/TopView.tsx` on Sides (edges `data-edge`, states on/off/todo/ok/skip). `SidesEditor.tsx` (exterior-only page) now uses S4's frame: `.sc-freeze` with `WizardHeader`, `.sc-ed.sd-ed` with the cards in `main.sc-wrap` and `.sc-rail` holding the price card (checklist: questions, sides checked, last checks; `.sd-prog` and `.sd-cta` kept), "Your home from above" (`.sd-visual`: `TopView` you can tap, the geometry chips) and the estimator. Embedded in a "both" job it keeps its stack inside the room editor. The price band's position math is `app/estimate/scope/rangeBand.ts`, shared by both editors.

**Wizard UI refresh S6 — home, both (10 Oct 2026).** A "both" job's editor is one stacked page in `ScopeEditor.tsx`: the inside (details, rooms, extras, last checks), then the embedded `SidesEditor` under "Now the outside, one side at a time" (`#outside`). The room editor owns the ONE open card for the whole page — `SidesEditor` takes `openKey` / `onOpenKey` (side keys as `side:<key>` in `openCard`) and reports its `SidesView` up through `onState`; checking the last room opens the first side still to check (`openFirstSide`). Two jump links (`both-jump-inside` / `both-jump-outside`) scroll, never hide. The price card shows five rows (whole home, rooms, outside questions, sides, last checks ×4) and "Your home" the plan with `TopView` under it (tap a side to open it). The ranges are unchanged — no part tiles in the editor. Separately, `app/components/clientId.ts` replaces bare `crypto.randomUUID()` in the address lookup and the customer estimate page (it throws on http and on iOS before 15.4).

**Wizard UI refresh S7 — commercial (10 Oct 2026).** `PictureCard` takes the chosen segment and answers (`com`): Areas shows `pictures/AreaPlan.tsx` (one row per kind of area, labels from the segment's `counts` and the ticked `also` areas), Building and a warehouse's Job show `pictures/WarehousePicture.tsx` (ticked `whSurfaces` take their coat, the height label from `WH_HEIGHTS`), an area segment's Job shows the room painted from `commercialSurfaceKeys` (the segment row's own chip → surface map), and from the Space step on the building is `pictures/SegmentBuilding.tsx`, keyed by segment key. `BriefDone` is the Booked screen: a large tick, the time and address, and "What happens next" — the brief done, then `bookSteps()`, the same list the Book screen shows. No segment wording lives in a component.

**Wizard UI refresh S8 — the supporting screens (10 Oct 2026).** One sheet pattern in `wizard.css` (`.wz-sheetback` / `.wz-sheet`): a 480px panel from the right at ≥901px, a bottom sheet below, close in the corner (`.wz-sheet-x`) — used by `TalkSheet`, `SaveAndBookSheet` and `FinalisePrompt`; the header chat panel and the editor's `AssistantWidget` (restyled under `.wz` only) open the same way. `ContactCard` and `ReachStrip` stay inline in their pages. `HardStop` is one centred 720px card; `Sent` uses the Booked layout (`.wz-bigtick`, `.wz-next`); Book a time and the holding page are centred cards. `handoffSteps` (lib/wizard/finish-line.ts) no longer prefixes "Usually" to the turnaround setting. `e2e/customer-journey/ui-refresh-coverage.spec.ts` opens every customer row at 1440px and fails on the old shell.

**Wizard UI refresh S9 — Finalise, the visit page, clean-up (11 Oct 2026).** `Finish.tsx` is two columns (`.wz-fin-main` left: the range card and what you've told us; `.wz-fin-side` right, sticky: "Make it a fixed price", the estimator, the call line); one column on a phone. The visit page (`app/estimate/visit`, root `.wz-vpage`) shows every state as one centred card. The plain `header.wz-top` on the end-of-journey pages takes the shell's 64px and 1240px frame. `.wz-dots`, `.wz-steps`, `.wz-rather` are gone from the CSS and every component, and `.wz .wz-wrap` no longer caps every page at 640px. Help: `docs/help/estimator/customer.md` and `commercial.md` rewritten from the real screens. The plan ends here; performance (Lighthouse mobile under 90) is a separate clean-up.

**Quick look: the page follows its step when the list changes (10 Oct 2026).** `WizardApp`'s `page` is a position in `stepsFor(...)`, and an answer can change the list in front of it — commercial "Both" picked on the Space screen adds the `both` step at the front, which dropped the customer back on Place (their next Continue only returned them to Space). A layout effect now keeps the page on the step it was showing, by name, whenever the list changes and the page did not. Pinned by `e2e/customer-journey/commercial-both-continue.spec.ts`.


**Visit request: one answered confirmation (10 Oct 2026).** Offering a time on `/crm/visit-requests/[id]` used to show a client-side "Booked …" line from `OfferTime.tsx`, but the action's `revalidatePath` re-rendered the page into the answered paragraph and unmounted it — whether staff ever saw it was a race (the `visit-requests.spec.ts` "staff offer a time" test failed on it). Now the server-rendered `request-answered` box is the only confirmation: `loadAnsweredSummary` (`lib/visits/requests.ts`) reads the booked visit, its estimator, and whether the `time_offered` automation actually reached the customer (`messages`) or is waiting (`automation_holds`); `lib/visits/answeredSummary.ts` turns that into the staff wording (pure, unit-tested) and never claims a send that did not happen. `OfferTime` just calls `router.refresh()` on success. No migration.

**One auth lookup by email (11 Oct 2026).** `lib/auth/userByEmail.ts` is the only way the app, the scripts and e2e find an auth user from an email: `lookupAuthUserByEmail` (found / not_found / invalid_email / error — a failed lookup never reads as "nobody") and `authUserIdByEmail` (id, null, or a throw). One `generateLink({ type: "recovery" })` call, sends nothing; never `magiclink`, which CREATES a missing user. It replaces every `listUsers({ perPage })` + `.find()`, which read page 1 only — GoTrue lists newest first, so older logins fell off once anonymous wizard users passed the page. Callers: the trade Team invite (`app/account/(portal)/team/actions.ts`, which on production could not invite any long-standing login), staff re-create (`settings/staffActions.ts`, was `adminPassword.findAuthUserByEmail`, magiclink + capped paging — removed), the trade account create (`settings/tradeActions.ts`), the seed scripts (the `.mjs` ones import the `.ts` file directly under Node 24 type stripping, so it has no runtime imports but zod) and `e2e/helpers.ts`. `lib/auth/userByEmail.test.ts` also fails on any `.listUsers(` left in app/, lib/, scripts/ or e2e/. Manual test: as a trade org admin, Team → invite an email that already had a login long ago → "Invited ✓" and the person appears under People.

**Hygiene reaches the stamped journey addresses (11 Oct 2026, PR #245).** The wizard signs a customer in anonymously and then attaches the typed email, so `is_anonymous` flips to false and the user matched neither run marker. 535 customer-journey users (`e2e-return-<ms>`, `e2e-scroll-<ms>`, `ui.refresh.brief.<width>.<ms>`, `e2e-reach-visit-<ms>`, `ui.cover.brief.<ms>`, all `@example.com`) had piled up on C1 at 15–35 a day, past 1,000 users. `RUN_EMAIL_PATTERNS` in `scripts/c1/hygiene-rules.mjs` names exactly those addresses (anchored, the 13-digit `Date.now()` stamp and `@example.com` required), and `runUserSql()` turns them plus `is_anonymous` and `pg.e2e.%` into the ONE `RUN_USER` clause the sweep, the teardown and the tripwire count all use. Patterns are written in the regex subset JS and Postgres agree on, so `lib/testing/hygiene.test.ts` (`isRunUser`) proves the strings the runner sends, including that every seeded login (`pg.demo.*`, `pg.*@gmail`) is refused. A NEW spec uses the `pg.e2e.` prefix rather than adding a pattern. The tripwire line's second number is now "e2e logins" (every non-anonymous run user). Trap found on the way: C1 is reached through the transaction-mode pooler (:6543), so a session `SET` (even `default_transaction_read_only = on` for a "safe" probe) stays on the pooled backend and breaks the next client's writes; use `SET LOCAL` inside a transaction, or the session pooler (:5432).

**Trade account create matches by email only; Team invitees choose a password (11 Oct 2026).** `createTradeAccountAction` (`app/(app)/settings/tradeActions.ts`) called `ensureAccount` with the phone, and `crm_find_account` ranks a phone match after email: Tom's demo login for info@modvs.com, typed with his own mobile, turned the existing tjhroman+crm.ashwood customer account into the trade organisation (renamed, made trade, owned by the new login). It now looks the account up by email alone and writes the phone onto it afterwards; `e2e/settings-trade-create.spec.ts` pins it. The Team invite's email comes from `lib/portal/teamInvite.ts`: a login the invite created lands on `/reset-password` ("Choose a password"), an existing login just opens the workspace and keeps its password. `scripts/diag/trade-takeover.mjs` (read only) shows what a phone match did to an account and prints the repair SQL. Manual test: Settings → Trade accounts → create with a new email and a phone already on another customer → a new account appears in Current trade accounts, the other customer unchanged.

**Wizard first paint: Lighthouse mobile ≥ 90 on /estimate and /estimate/scope (11 Oct 2026).** Measured on the C1 stack with Lighthouse 12.6.1 (mobile, simulated throttling), twice per page: /estimate 82 → 92, /estimate/scope 89 → 92 (LCP 4.6s → 3.3s and 3.6s → 3.3s). Four changes, in the order they paid. (1) `app/globals.css` opened with an `@import` of Google Fonts' Martian Mono CSS, so every page's first paint waited on a second origin (~690ms simulated) — and the wizard never uses that face (its `--wz-mono` resolves to Geist Mono through `--font-mono`). Martian Mono is self-hosted in `app/fonts/martian-mono/` (Google's own twelve `@font-face` blocks, verbatim, four OFL variable files), so PC, CRM, portal, /e, /w and invoices keep the same face by the same name and nothing blocks. (The fontshare `@import` above it was already absent from the built CSS before this change; left as it was.) (2) The server reads that need only the request go out together — `app/estimate/page.tsx` (company, segments and the user at once; then the reference rows, trust copy, estimator and booking rules in one `Promise.all`) and `lib/wizard/customer-scope.ts` (segments and the trade account alongside rules/pricing/documents; the estimator alongside the visit slots). (3) `WizardApp` marks the quick-look step the page LANDED on `.wz-landing`, which switches off the `wzrise` entrance for that screen only (cleared the first time the step changes): the fade held the largest text back half a second and Lighthouse then charged every script to the largest paint. (4) The wizard's components load supabase-js on first use through `lib/supabase/lazyClient.ts` (`browserClient()`) instead of importing `lib/supabase/client.ts` — `WizardApp`, `CustomerResult`, `RoomSpots`, `SideNote`, `PeelingPhotos`, `useLiveConversation` — taking ~60KB gzipped out of the first load. `e2e/customer-journey/first-paint.spec.ts` pins all three first-paint conditions as an anonymous customer. Not done, with numbers: `wizard.css` is 24.8KB gzipped and the provably cascade-safe consolidation (identical selectors, same media context) saves 315 bytes; zod 4 classic (~64KB gzipped, the next biggest first-load piece) arrives through `lib/wizard/state.ts`, `segments.ts`, `crm/attribution.ts` and `pricing/systems.ts`, which the server validates with — moving the client off it is a refactor of those modules, not a perf patch.
Manual test: open /estimate on a phone in a private window → the first screen appears without its usual rise-in, every later step still rises in; Continue enables once the session connects (supabase now arrives just after the page wakes); on a staff page that uses mono figures (PC Command, an invoice) the numbers are still Martian Mono; open a customer estimate's editor and add a photo to a room spot and a side note → both upload.

**Revision builder: undo or revise one change; no phantom Preparation-hours change (12 Oct 2026).** 28 Logan St's revision panel read "Pricing adjustments changed · −$453.20 · 4 hr" with nothing edited: `QuoteBuilder`'s live preview built the working state from a hand-picked key list that omitted `preparationHours` (and `hourLoading` / `sizeUpliftDisabled`), so `diffRevision` saw the accepted 4 h of Preparation as removed. The preview now diffs `revisionCurrentState` = the loaded working scope with the live builder fields over it — the same shape `save()` writes, so the screen and the server's drafting diff agree. The server action was always right (it diffs the saved scope). Each row of the panel now carries **Revise** (opens that area/line, or scrolls to Job settings) and **Undo change**: `lib/revision/revert.ts` (`revertChange`, pure) puts that one blockRef back to the accepted scope — a changed block to its accepted copy, an added block out, a removed block back after its nearest surviving predecessor, `adjustments` = the `ADJUSTMENT_KEYS` copied from the accepted state — and the builder saves the working scope on the next render. No migration. Tests: `lib/revision/revert.test.ts`, `e2e/revision-undo.spec.ts`.
Manual test: open 28 Logan St → Revise scope → the panel reads "The working scope matches the accepted estimate". On any job, remove an area and add another in Revise scope → two rows → **Undo change** on the removal → confirm → that row goes, "Saved ✓ (working scope)", the other row stays; reload → still one row. **Revise** on the remaining row opens that area.

**Tom batch 12 Oct 2026: views on the estimates list, a Home strip you can close off, the follow-ups email and the pre-start texts.** (1) `estimatePill` (`lib/wizard/journey.ts`) no longer labels an open visit request "Sent · needs a visit": the pill keeps the customer's view count ("Viewed 3×" / "Sent · not opened yet", last opened on the mono line) and "Needs a visit" rides as the pill's new optional `flag`, drawn as a chip under the title in `EstimatesTable.tsx`. State stays `sent_visit`, so the Book action is unchanged. (2) The Home strip (`lib/reporting/strip.ts`) drops `waiting` (future-dated) work items, `pickStrip` returns the real total beside the 12 shown, and every work-queue or console card carries a `dismiss` — `app/(app)/home/StripDismiss.tsx` closes it through the source's OWN dismissal (`dismissWorkItem` → `crm_dismiss_work_item`, `dismissCard` → `wo_dismiss_card`), both of which now `revalidatePath("/home")`. No new list, no new store: one work queue. (3–5) `lib/automations/sweeps/officeDigests.ts`, run from the half-hourly `campaign-sweep`: `office_followups_digest` emails tom@paintgroup.com.au Mon–Fri from 08:00 with `status = 'sent'` estimates whose `sent_at` fell on the Melbourne day 3 days back (Monday also covers Wed/Thu, whose mark fell on the weekend); `office_prestart_due` texts (via `notifyStaff`, routed by the new **Pre-start** Staff-logins tick) at 14:00 on a business day the number of jobs at offered/pre_start starting within 2 business days, and a FINAL one for the next business day, whose pre-start list is missing or has a required tick open. Business days = `nthWorkingDayAfter` (`lib/time/workingDays.ts`), holidays from `visit_booking_rules`. Each is once a day by a `staff_notifications` guard row; `?only=office&force=1&dry=1` previews the lists with nothing sent or claimed. No migration. Spec: `e2e/tom-batch-12oct.spec.ts`.
Manual test: (1) Estimates → a sent estimate whose customer asked for a visit reads "Viewed N×" with a "Needs a visit" chip under the title. (2) Home → the heading counts every card; press Not now → For good → a reason → Close it on a customer card, or Done on a job card → it goes and stays gone after a reload and on CRM Today / PC Command. (3) Settings → Staff logins → tick Pre-start (text) for Felipe and Tom. (4) With CRON_SECRET: `curl -H "authorization: Bearer $CRON_SECRET" "https://paint-group-platform.vercel.app/api/cron/campaign-sweep?only=office&force=1&dry=1"` shows today's follow-ups list and the pre-start counts without sending; the real email arrives on the next weekday after 8 am, the texts after 2 pm.
**Revise scope reaches the painter: hours-only changes, the pre-offer sheet, the office's "customer approved" alert (12 Oct 2026).** Migration `20270253000000_revise_scope_reaches_painter.sql`. (1) 73 Kerferd Rd: a working-scope change that moves contractor hours but not the customer's price (`lib/revision/hoursOnly.ts` — `hoursOnlyChange`, and `revisionCredit`: fewer hours at the same price is a credit, not a positive row) used to be drafted as a $0 offer for the customer and never reached the painter. `saveWorkingScopeAction` now runs `draftRevision(…, "hours_only")` after every save, and `wo_apply_hours_only_change` approves the row without a signature (`hours_only = true`, out of the customer's offer): with a painter on the job it is released to them (portal card "Change to your hours", `notifyVariationReleased`); with nobody it folds into the sheet. The builder confirms before a revision save that moves contractor hours (`saveRevisionChecked`, engine totals vs the last save). (2) Before anyone has the job, `wo_customer_sign_variation` (20270220 body) ends with `wo_fold_scope_into_sheet`: `wo_snapshot` becomes the sheet the office drafted from (`priced_inputs.sheet` = the builder's `woDoc`, which every draft now carries), keeping the BASE `contractorPaymentCents` (the rows carry the deltas; `send_offer` adds them), and the folded rows get `in_sheet_at` — filtered out of `scopeChangesFrom`, the portal/as-contractor variation cards, `get_work_order_scope_changes_by_token` and `employee_variations`. No sheet on the draft (pre-20270253) → no fold, the old "In the job" list stands. (3) `office_variation_approved` staff alert (`staffVariationApprovedByCustomer`, once per signing, keyed on the offer's first row) from `signVariationAction`; registry + editable wording; routed by Settings → Staff logins (**Change approved**).
Manual test: (a) a job a painter has → Revise scope → change a surface's Painting (hr) on a fixed-price surface → Save → the box names the hours and the contractor's price → OK → "new hours sent to the painter to approve"; the painter's portal shows **Change to your hours**. (b) a job nobody has → add an area → Save & draft → sign the link as the customer → the job sheet (/w link) shows the new area and no "Changes to the scope". (c) tick **Change approved** for Office under Settings → Staff logins → sign a change → info@ gets the email.

**Nine e2e specs red on main: three real faults, the rest stale or never-green specs (12 Oct 2026).** Seen while building `fix/revision-contractor-hours-sync`; main CI skips e2e on main pushes, so they sat unseen. **App:** `wo_contractor_decline_variation` (20270220) and `wo_office_reject_variation` (20270240) both `set … declined_at = now()` on `wo_variations`, a column that only ever existed on `estimates`; plpgsql compiles the body without checking, so every painter Decline and every office Reject since 7/8 Oct failed with 42703 (production read-only check: column absent, zero `variation_contractor_declined` / `variation_office_rejected` events ever). Migration `20270254000000_wo_variations_declined_at.sql` adds the column; both bodies are right once it exists. `lib/workorder/variationColumns.test.ts` reads the whole migration history and fails on any `update public.wo_variations set <col>` whose column no `create table` / `add column` made. The portal's four variation actions (`app/portal/jobs/[id]/variationActions.ts`) now `reportError` an RPC error instead of only showing "check your signal" — that branch is what hid this. The variation photo input carries `data-testid="variation-file"`. **Third fault:** `app/quote/page.tsx` read the painter's request for Revise scope with `profiles:raised_by(name)`, but `wo_variations.raised_by` references `auth.users`, not `profiles` — PostgREST answered PGRST200 on every load since 7 Oct, the read was reported best-effort and dropped, so the builder never adopted the request (`sourceVariationId` stayed undefined) and every "Price it in the builder" drafted a second row beside the painter's: the 12A Cavell Court fix never worked on production (read-only: zero rows with `request_priced_at`). Now the row is read with `raised_by` and the name is its own checked read from `profiles`. **Specs, brought up to the app:** `revision-contractor` (a revision change signed while a painter is on the job is ASKED since 20270220 / 20270253 — an addition is released for Accept, a removal waits on Acknowledge); `employee-loop` (an approved variation is a tick row since 20270193 and must be ticked before prep; and a job that PASSED a quality check is signed off by the office since 24 Sep, so the lead's own-device walkthrough now runs on a waived job via the evidence pack — where the approved change is its own **Variations** area for the customer to approve); `employee-variation` + `wo-variations` (the photo label has read "📷 1 added" since 26 Sep, and `input[type=file].last()` now hits another uploader); `invoice-final-variation-once` (its fixture variation was `customer_approved`, which the close gate has always counted as waiting — Collins St's was accepted); `variation-request-priced-in-scope` (saved the working scope before anything opened it — `wo_open_working_scope` is what Revise scope calls first — and its job had no `woDoc`, so it was a draft the painter's portal 404s); `revision-contractor-rate` (the hand-built estimate had no `builder_state.woDoc`, so acceptance made a draft job with no pay; and the rate field is in the Calculations panel, which it never opened); `pc-painter-approval-7oct` (its console-card locator `.card, .qcard, [data-card-key]` never matched the `div.al` cards — now `card-<key>` — and the describe is serial, so one failure no longer re-runs `beforeAll` and makes the gate tests look broken; the Bunney Road test removes the check the PC page scheduled when the test before opened the job). `variation-approved-email-and-reject` was right and passes with the column.
Manual test (after Tom pastes 20270254 and the deploy): a painter on a job with a client-approved change taps Decline → writes a note → Send to the office → the chip reads DECLINED — WITH THE OFFICE and PC Command shows "Painter declined an approved change"; on PC Command a RAISED variation → Reject → reply → "Rejected — texted and emailed your reply to …"; a RAISED painter request → Price it in the builder → the blue "Pricing <name>'s request" line shows, and drafting moves THAT card to PRICED with no second row.

**Payments merge prework: one overdue instant, Pause reminders, definer guards, money deep links (12 Oct 2026).** Migration `20270255000000_invoice_chase_hold_rpc_definer_guards.sql`. Tom's ruling: an invoice is **overdue from midday Melbourne on the day after its due date**. `lib/invoicing/ledger.ts` has `overdueFrom(dueOn)` and `isOverdue(invoice, now: Date)`, and every caller now passes a clock: `derive.ts` (`ageInfo`, `dashboardTiles`, `agedBucketsCents`, `paymentStages`, `stageDots`, plus the new `melbourneToday`), the CRM work queue, CRM facts, the portal builders (`now` on their inputs) and the reporting slice (`InvoicingSlice.now`). The chase sweep's `invoiceChaseable` used to keep its own copy, which flipped at midday ON the due date; it now calls `isOverdue`, and rung 1 (+1 day from the due-date midday) lands on the same instant. The work queue's and CRM facts' `toISOString().slice(0,10)` days are now Melbourne days. Pause/Resume reminders goes through `invoice_set_chase_hold` (staff, open invoices, kind `office`; a call-back hold refuses), because the old direct update had no UPDATE grant and never worked. It writes `reminders_paused` / `reminders_resumed` events. `invoice_draft_deposit` now refuses anyone but the service role or staff; it and the two contractor attach-PDF helpers lose the authenticated grant that 20270201 had blanket-restored. Links: `/invoicing?tab=payables` and `/invoicing#payables` become `?tab=pay`; the job view honours `?tab=invoices|costs`; the staff "contractor invoice in" email goes to `/invoicing?tab=pay`, and `app/invoicing/ci/[id]/page.tsx` redirects the old 404 links there.
Manual test (after Tom pastes 20270255 and the deploy): open a job with a sent, unpaid invoice → Invoices tab → Pause reminders → type a reason → the button reads Resume reminders, and its tooltip shows the reason → Resume. From PC Command, the work order's costs link opens on Costs. An invoice due yesterday reads "Due yesterday" before 12:00 and "1 day overdue" after.

**Sign-in links survive mail scanners: opening /account/auth spends nothing, the tap does (13 Oct 2026).** A customer on live.com.au got "expired or already used" on all seven sign-in links we sent him on 12 Oct; each had been redeemed 15–30 s after delivery by Microsoft's link scanner (outlook.com / hotmail / live open every link in a new email to check it), so his own tap always came second. `app/account/auth/route.ts` (verify on GET) is replaced by `app/account/auth/page.tsx` — a one-button page, "Open my account" (or "Continue" when `next` is `/reset-password`) — and `app/account/auth/actions.ts` `redeemLinkAction`, a POST that runs the same verifyOtp → staff/painter role check → `ensureMembership` → redirect the route did. Emailed URLs are unchanged, so links already in inboxes still work. No migration. e2e: `portal-shell.spec.ts` "a mail scanner opening the link first does not spend it"; every spec that signs in by link now goes through `openMagicLink()` in `e2e/fixtures/portal.ts`. Diag: `scripts/diag/magic-link-expired.mjs <email>` (read-only: the login, its sessions, account seats).
Manual test (after the deploy): on /account/login request a link to an outlook.com/hotmail address you own → open the email → the page says Open your account with one button → press it → you land in the account. Then open the same email's link again → press the button → "expired or was already used" with the resend box.
**Payments merge, Step 1: one derived money row per job (12 Oct 2026).** `lib/invoicing/jobMoney.ts` (pure) turns accepted jobs, their invoices, payments, variations, contractor invoices and open supplier documents into one row per job. Each row carries the contract, paid and balance from the ledger rules, three payment slots (deposit · progress · final) with a state (`over · need · noinv · sent · draft · uninv · later · paid · none`), the next action, what is collectable now, a health and a To-chase section. The page totals come from the same rows: the four blocks, the seven-lane strip (the `/pc/flow` lanes via `laneFor`) and the headline figures; `headlineSentences` writes the sentence. Leftover drafts ($0, or a deposit draft beside a final) are hidden by rule and never deleted. Loader: `app/invoicing/jobMoneyData.ts`. The raw JSON (staff only) is at `GET /api/invoicing/job-money`, and the Step 2 page renders exactly that. No migration. Build ledger: `docs/briefs/payments-merge-ledger.md`.
Manual test: signed in as staff, open `/api/invoicing/job-money`. `headlineText` reads like "N jobs have no deposit in…", `blocks.customers.outstandingCents` equals the old Payments Outstanding tile, and each row's `balanceCents` equals that job's money view balance.

**A contractor RATE change skips the customer; an HOURS change never does (13 Oct 2026).** Tom corrected 20270253: hours go to the customer first, then the painter; the rate goes straight to the contractor. Migration `20270254000000_revision_rate_skips_customer.sql`. The app no longer calls `wo_apply_hours_only_change` (left in the database, unused); `draftRevision` drafts every change for the customer, and the 20270253 rows the painter had not answered were cancelled in the migration (untouched tick rows removed). A rate change on a job a painter has is a PAY CHANGE held on `work_orders` (`pay_change_rate_cents/_from_rate_cents/_base_hours/_from_cents/_to_cents/_sent_at`, agreed rate in `contractor_rate_cents`, backfilled from the last `contractor_pay_synced` event) — never a `wo_variations` row, so no customer surface, signing link or invoice can carry it. `wo_sync_contractor_pay` takes `p_accepted_rate_cents` + `p_base_hours` (`revisionContractorPay` returns them): no painter → pay follows as before and stamps the rate; painter on the job → `ok:pay_change_sent` (from = base + agreed variations, to = from + agreed hours × rate difference; unagreed changes re-rate now), `ok:pay_change_withdrawn` when the rate goes back, employees skipped. `wo_contractor_answer_pay_change` (the job's contractor or staff): Accept moves the base by base hours × difference and re-rates the agreed revision changes still at hours × rate; Decline (note required) restores the unagreed ones. Portal: `PayChangeCard` ("Change to your rate"), `answerPayChangeAction`, `notifyPayChangeSent` (the "Variation waiting on you" automation), `staffPayChangeDeclined` (the Change declined alert). Builder: `lib/revision/saveWarnings.ts` — the confirm before a save that moves hours or rate, and the save message per sync answer.
Manual test: a job a contractor has → Revise scope → Calculations → Contractor rate 80 → Save → the box says it does not go to the customer → OK → "new rate sent to the contractor to accept"; the contractor's job page shows **Change to your rate** → Accept → their pay for the job moves. Change Preparation hours instead → the box says it goes to the customer first; Save sends nothing to the painter; Save & draft makes the customer's offer.

**Payments merge, Steps 2–8: one Payments page, the job panel, the switch-over (13 Oct 2026).** `/invoicing` (`app/invoicing/page.tsx`, components in `app/invoicing/payments/`, styles in `payments.css` ported from `design/reference/payments-merged-v3-mockup.html` by `scripts/design/scope-mockup-css.py`) is the one money screen: a headline and four blocks — Customers (To chase / By job stage / All jobs, search incl. invoice numbers, aged bar, one-press Paid with Undo, cash, send with due date, deposit adjust, Message through the Customer chats dock), Contractors (sections by state, Approve / Paid with Undo, paid reference and date, RCTI, Green hold/release, and the Expenses queues), Materials (To check with Confirm / Record as a cost of any category / Not for a job / Delete–Restore, to approve, to pay by supplier, No job yet) and Activity (views folded). Every figure is `lib/invoicing` — `jobMoney.ts` (rows, blocks, headline), `materials.ts`, `expenses.ts`, `activity.ts`, `jobProfit.ts` — and the page's files only format (`jobMoney.boundary.test.ts`). The job panel (`JobPanel.tsx` + `PanelClient.tsx` + `panelData.ts`) is the same component over the page (`?job=`) and at `/invoicing/job/[id]`: Money in (every invoice with its payments and actions) and Money out and profit (cost rows with Approve / Paid). Migrations 20270256–60 (quick actions with Undo, message log, contractor actions, materials, final redraft) are additive. Step 8d deleted `Dashboard.tsx`, `PayablesCosts.tsx`, `JobSearch.tsx`, `MoneyView.tsx`, the old page, `/invoices`' list and their dead actions, loaders and lib helpers; `/invoicing/payments` and `/invoices` redirect, `?tab=pay` maps to Contractors, and `invoicing.css` keeps only the shell and the invoice document's rules (scoped to `.invdoc`). Manual test: Payments → a job's address → the panel → Money out → profit; Contractors → Approve → Paid, with reference…; Materials → Record as a cost…; `/invoices?q=Kite` lands on All jobs.

**Materials: the job picker shows each job's price (20 Oct 2026).** Two jobs at one address looked identical when matching a supplier invoice or receipt. `pickerJobs` in `app/invoicing/payments/labels.ts` now carries `priceLabel` — the job money row's `contractCents` (accepted total adjusted for variations) formatted there, no page-side arithmetic — and `PickJob` has it, so every picker in `ActionsClient.tsx` (Pick a job / Other job / Assign to a job / Record as a cost / Snap a receipt) lists `stage · customer · $price` under the address. No migration. Test: `e2e/payments-materials.spec.ts` asserts the price on both pickers. Help: `docs/help/invoicing/staff.md`.

**Work-order materials: conservative order, estimate litres, per-area paint, estimate cost on PC (13 Oct 2026).** Tom: the job sheet's materials "don't add up to the estimated materials … should be rounded down … can sizes 1, 2, 4, 10 or 15"; trim over-calculated. Cause: `roundUpLitres` (`lib/workorder/snapshot.ts`) rounded each product × colour row UP to the next tin of [1,2,4,10,15,20], so 4.1 L froze as 10 L and 15.5 L as 20 L, while the estimate's materials cost is exact litres (wastage included) × price. Replaced by `orderLitres` (whole litres rounded DOWN, minimum 1 L for any paint at all) and `cansFor` / `cansLabel` (fewest 15/10/4/2/1 L cans adding up exactly — 20 L is 2 × 10, not 15 + 4 + 1). `aggregateMaterials` (`lib/workorder/materials.ts`) now also freezes `estimatedLitres` on each row, and the builder freezes `litres` on every painted `WOSurface`. `areaMaterials` groups an area's surfaces by colourKey for the sheet's **Materials for this area · estimate** list; `rowEstimatedLitres` takes the larger of the row figure and its surfaces' sum (an option merged by `wo_apply_selected_options` sums only order litres). The crew whitelist (`lib/workorder/crew.ts`) carries the litres and the surface colour. Staff side: `materialsBreakdown` (`lib/pricing/estimate.ts`) is the engine's step-10 litres and cost per surface (keyed `${areaId}:${surfaceId}`) and per line material; `materialRowEstimates` (`lib/workorder/materialsBudget.ts`) sums them into the frozen sheet's rows. `MaterialsCard` shows Estimate · cost · cans, flags a sheet frozen under the old round-up, and **Use estimate, rounded down** fills the litres field for `wo_set_material`. `PrestartPaintEstimate` labels the same rows under the pre-start's Materials item. Cost never reaches the contractor's sheet. No migration; sheets already issued keep their frozen figures until re-issued or adjusted on PC Command. Spec: `e2e/wo-materials-conservative.spec.ts`; unit: `lib/workorder/orderLitres.test.ts`, `materialsBudget.test.ts`.
Manual test: open a job in PC Command → Materials: each row reads "Estimate N L · cost $… ex GST · cans …"; an older job's row shows the amber "job sheet orders more than the estimate" → Adjust colour / litres → Use estimate, rounded down → Save to job sheet → open the /w link: the order, the cans and "Estimate N L" beside the paint. Issue a new work order from the builder → the /w sheet lists "Materials for this area" under each area. Move a job to pre-start → the Materials ordered item lists the paint estimate and its total cost.

**Leftover drafts (payments-merge §6.1, §6.2; 13 Oct 2026).** Migration `20270261000000_leftover_drafts.sql` changes `invoice_draft_final` alone (read on production: every $0 draft was a final drafted with nothing left, and six jobs carried an unsent deposit draft beside a final): with nothing left to invoice it drafts no final, returns `ok:nothing_left` and removes an unsent deposit draft; when it drafts a final it removes the job's unsent deposit draft (the final already includes it). Both removals happen only at the first drafting (sign-off); a redraft never removes a deposit draft. Only drafts are deleted. Existing rows stay hidden by `isLeftoverDraft` until Tom approves the list `scripts/diag/leftover-drafts.mjs` prints (read-only; it also prints the guarded delete). Manual test: sign off a job whose deposit was never sent → one final for the whole contract, no deposit draft.

## Customer update greeting + painter's last tick on Updates (14 Oct 2026)

Tom: "Good morning/evening" confused customers (the draft is composed at the tick, read whenever the office sends), and the email/SMS each added their own hello in front of it. `lib/workorder/updates.ts` `greeting()` now returns **Hi <first name>** (or "Hi there") regardless of the hour, and exports `opensWithGreeting(text)`; `lib/workorder/sendUpdate.ts` drops its "Hello X," paragraph and the SMS "Hi X, an update on your painting at …:" prefix when the text already greets (a hand-written update that starts straight in still gets one). `/pc/updates` reads `source_tick_ids` and, in one `wo_events` query for the page, shows **Painter's last update to this job: <Melbourne date/time>** per card (`ticked-<id>`; "No tick on record" for a hand-inserted draft; the read's error is shown, not swallowed). No migration. Specs: `e2e/wo-updates.spec.ts` (greeting + the line), `e2e/pc-console.spec.ts`; units `lib/workorder/updates.test.ts`.

**12 Demo Street — the practice job and its wall (14 Oct 2026 — induction / demo-property brief, Step 1).** `20270262000000_demo_property.sql`: one `is_demo` flag on `estimates`, `work_orders` and 30 child tables (every table the office, money, reporting, status and sweep code reads without going through the work order by id), copied from the parent by a BEFORE INSERT trigger (`demo_flag_copy`, `demo_flag_copy_invoice`, `demo_flag_copy_wo`) so a variation, invoice, expense or call back raised later on the demo job carries the flag without being told. `demo_property_seed(p_contractor_id)` is the template (interior, Level 3, 40 h over 5 days, 2 bedrooms + lounge + hallway, 22 tick rows, a live `offered` booking, no customer); it is idempotent (`exists:<id>`) and callable by staff for any contractor or by a contractor for themselves (ruling I4). `demo_property_reset` deletes the RESTRICT-keyed children, the estimate (cascade) and re-seeds in one transaction, writing `contractor_events demo_reset`. `booking_offers_standards_gate` lets a demo offer through (Module 2 precedes the Module 5 sign-off). **The wall in TypeScript is `lib/demo/scope.ts` — `realOnly(query)` — and nothing else:** every list read of a flagged table in `app/` or `lib/` outside the contractor's own screens, the token pages and per-job actions goes through it (or filters `is_demo` where the typed builder goes too deep for tsc: `lib/automations/dispatch.ts`, `lib/gcal/sync.ts`); `lib/demo/boundary.test.ts` greps for the ones that do not — a read by id is exempt, because the painter and the office must be able to OPEN the demo. Screens: the Jobs tab shows the practice job under a **Demo** heading (or "Start the practice job" when there is none), Home shows it as its own card, Requests tags the offer, and both job pages (portal and `/pc/wo/[id]`) carry `app/components/demo/DemoControls.tsx` — one component, `mode` portal | pc | staff | start — with the banner and **Reset demo**; the staff contractor record has Set up / Reset. The demo job is left out of Google Calendar sync (ruling 8), the status evaluator, PC Command, the schedule, the dashboard, Payments and every sweep, proven in `e2e/demo-property.spec.ts` by raising a demo variation, contractor invoice, expense and call back on it and reading the same counts before and after. No robots yet (Step 2); employees get their demo with the worker induction (Step 3a). `scripts/seed-demo-loop.ts --destroy` no longer touches it (`is_demo = false`). Manual test: as a contractor, Jobs → Start the practice job → the banner → Reset demo; as PC, open `/pc/contractors` and `/invoicing` before and after — nothing moves.
**PC Command's Contractor figure includes accepted variations (14 Oct 2026).** 73 Kerferd (PS-3613): Tom approved two painter requests in PC Command for the contractor only ($240 + $360, no customer price) and sent two revision changes the customer signed ($402 + $201 to the painter). The painter's portal and the /invoicing job panel counted all four ($5,040 + $1,203), but the PC job page's money strip read `work_orders.contractor_payment_cents` alone — the base offer — and its Variations tile sums customer prices, so contractor-only approvals showed nowhere and Est. GP read high. `app/pc/wo/[id]/page.tsx` now takes the Contractor figure from `contractorAdjustedCents` (`lib/workorder/contractorPay.ts`, the portal's rule) with a "$base + $N variations" line, and Est. GP from `jobProfit` (`lib/invoicing/jobProfit.ts`) on `adjustedContractCents` (contract + approved customer variations), the adjusted contractor pay and approved employee labour — replacing the page's own inc-GST arithmetic. No migration. Spec: `e2e/pc-contractor-pay-variations.spec.ts`.
Manual test: PC Command → 73 Kerferd Street → the money strip reads Contractor $6,243 with "$5,040 + $1,203 variations" under it; Variations + $1,172 (what Marcus signed).

**12 Demo Street — the practice job and its wall (14 Oct 2026 — induction / demo-property brief, Step 1).** `20270262000000_demo_property.sql`: one `is_demo` flag on `estimates`, `work_orders` and 30 child tables (every table the office, money, reporting, status and sweep code reads without going through the work order by id), copied from the parent by a BEFORE INSERT trigger (`demo_flag_copy`, `demo_flag_copy_invoice`, `demo_flag_copy_wo`) so a variation, invoice, expense or call back raised later on the demo job carries the flag without being told. `demo_property_seed(p_contractor_id)` is the template (interior, Level 3, 40 h over 5 days, 2 bedrooms + lounge + hallway, 22 tick rows, a live `offered` booking, no customer); it is idempotent (`exists:<id>`) and callable by staff for any contractor or by a contractor for themselves (ruling I4). `demo_property_reset` deletes the RESTRICT-keyed children, the estimate (cascade) and re-seeds in one transaction, writing `contractor_events demo_reset`. `booking_offers_standards_gate` lets a demo offer through (Module 2 precedes the Module 5 sign-off). **The wall in TypeScript is `lib/demo/scope.ts` — `realOnly(query)` — and nothing else:** every list read of a flagged table in `app/` or `lib/` outside the contractor's own screens, the token pages and per-job actions goes through it (or filters `is_demo` where the typed builder goes too deep for tsc: `lib/automations/dispatch.ts`, `lib/gcal/sync.ts`); `lib/demo/boundary.test.ts` greps for the ones that do not — a read by id is exempt, because the painter and the office must be able to OPEN the demo. Screens: the Jobs tab shows the practice job under a **Demo** heading (or "Start the practice job" when there is none), Home shows it as its own card, Requests tags the offer, and both job pages (portal and `/pc/wo/[id]`) carry `app/components/demo/DemoControls.tsx` — one component, `mode` portal | pc | staff | start — with the banner and **Reset demo**; the staff contractor record has Set up / Reset. The demo job is left out of Google Calendar sync (ruling 8), the status evaluator, PC Command, the schedule, the dashboard, Payments and every sweep, proven in `e2e/demo-property.spec.ts` by raising a demo variation, contractor invoice, expense and call back on it and reading the same counts before and after. Employees get their demo with the worker induction (Step 3a). `scripts/seed-demo-loop.ts --destroy` no longer touches it (`is_demo = false`). Manual test: as a contractor, Jobs → Start the practice job → the banner → Reset demo; as PC, open `/pc/contractors` and `/invoicing` before and after — nothing moves.

**The demo robots and the checklist (14 Oct 2026 — induction brief, Step 2).** Inside the practice job the office and the customer are robots, and nothing special runs for them: the robot is a staff login, **Paint Group robot** (`scripts/create-demo-robot.ts`; email in `settings.demo_rules.robotEmail`, migration `20270263`), that the server signs in by a one-time link (`lib/demo/robot.ts` — `generateLink` + `verifyOtp`, no password anywhere) and uses to call the SAME RPCs a person would; the customer side needs no login — the job's own token links. The replies (`lib/demo/robots.ts`) are scheduled from `after()` in the server action that handled the painter's tap, `settings.demo_rules.robotDelayMs` later (⚑7, 5 s): the fastest cron is five minutes, so this is the only sub-minute path. Hooks: `raiseVariationAction` → `wo_price_variation` (robot) → `wo_customer_sign_variation` (token) → `wo_release_variation` (robot) → waits for the painter's Accept; `notifyOfferRespondedAction` → an acknowledgement on the thread, no staff alert, no QA invites, and `/api/appointments/confirm` sends nothing for a demo; `startWalkthroughMode` → the customer approves every other room and flags the hallway; `completeAfterRectification` on a demo does NOT close the job (ruling 6) — `demoFixed` checks the rectification rows are done and the customer withdraws the flag on a second walk, so the painter signs on their phone like any job; `submitContractorInvoiceAction` → `contractor_invoice_approve`; `submitExpenseAction` → `contractor_expense_decide`; `postMessageAction` (painter side) → "your Project Coordinator will call you today"; `setFinishDate` (now with a **reason**, ruling 4 — `wo_contractor_set_finish_date(uuid, date, text)`, the two-argument overload dropped) → "Noted". Every robot message is a real `wo_messages` row through `wo_message_post`, so it shows where a real reply would; the office is never alerted about a demo. `contractor_invoice_submit` skips the profile/bank checks on a demo invoice (ruling 5). **The DEMO text** (ruling I12, ⚑4): `lib/demo/prompt.ts`, registry key `contractor_demo_prompt`, template `contractorDemoPromptSms` ("DEMO: Please update your job in the app today. {{link}}"), sent only by **Send demo prompt** on the PC job page's demo banner; it plants a `wo_reminder_moments` row for today on the practice job, which the painter's next tick or photo answers through the existing trigger. The practice job is outside every sweep, so nothing else ever texts it. **The checklist** is derived, never stored: `lib/demo/checklist.ts` (pure — the "On your phone" steps per module) over `lib/demo/checklistLoad.ts` (the job's own rows); the painter sees it under the banner, the facilitator sees every practice job on **PC Command → Induction** (`/pc/demo`). Proven in `e2e/demo-robots.spec.ts` (every module in order, robots answering, the grid filling). Not yet: Request more, contractor-raised No work today and sharing with a worker (Steps 3a/3b).

**Counts on the painter's job sheet (14 Oct 2026).** Tom: "make it clearer on the number of doors, windows etc per room". The customer's estimate has shown "Doors × 4" since 18 Sep; the work-order document never carried the number. `WOSurface.count` (`lib/workorder/snapshot.ts`) is the same figure the builder's `countFor` gives the customer snapshot (per-item substrates only — the rate item is "Hours Per Item" — and only a real count), frozen by `computeWorkOrderParts` in `app/quote/QuoteBuilder.tsx` and carried through `crewDoc`. The painter's sheet (`app/w/WorkOrderDoc.tsx`, every variant) shows it beside the name from ONE up — "Doors" with no number is the ambiguity being removed, so the customer page's hide-at-one rule is deliberately not applied here. The tick lists read it too, without the number ever entering `wo_surfaces.label`: `surfaceCountsByKey(doc)` (`lib/workorder/surfaces.ts`) maps the frozen document's counts by `surface_key`, and the portal job page, PC Command's scope card and the Painter's-view preview each attach it to `SurfaceRow.count` for `TickList` to render ("tick-count-<id>"). Standards matching, variation tick rows and the heal all keep matching bare labels. No migration; sheets frozen before today simply show no count until the builder re-saves and the work order is re-issued. Tests: `lib/workorder/surfaces.test.ts`, `lib/workorder/crew.test.ts`, `e2e/estimate-item-counts.spec.ts` (the builder freezes it into `woDoc`), `e2e/wo-surface-counts.spec.ts` (anonymous `/w/[token]` and the painter's tick list).
Manual test: open an estimate with doors counted in a room → Save → Issue work order → the /w link reads "Doors × 4" beside the row and nothing beside Walls → start the job as the painter → Scope & ticks shows the same × 4 on the row.

**Counts, measurements and every photo on the job sheet (15 Oct 2026).** Tom: the contractor's work order "isn't showing the number … of the doors, windows etc", "there are also no measurements", and "it doesn't show all of the photos". Three causes, three fixes. (1) The 14 Oct count was frozen by the builder in the browser, so every sheet issued from an estimate saved before that deploy — every job then on site — had none. Migration `20270272000000_wo_snapshot_counts_dims.sql` adds `wo_doc_with_surface_counts(estimate_id, doc)` (no grant; a helper), which fills a missing `count` from `builder_state->'blocks'` by surface key under the builder's own rule (the rate item's unit is `Hours Per Item`, own side then the other, the estimate's rate card else the active one) and a missing `dims` from the block's L/W/H; `issue_work_order` now passes the document through it, and the paste backfills every existing `wo_snapshot` once. (2) Measurements: `WOArea.dims` (`{l,w,h}` metres, `w` 0 for a single plane) and `WOSurface.qty`/`unit` (`"m²"` for the M2 units, `"lm"` for Lineal Metres — the priced quantity, one decimal, never on a per-item surface) are frozen by `computeWorkOrderParts` (`measureFor`) and carried by `crewDoc`. The sheet shows `dimsLabel` beside the area name (`area-dims-<id>`) and `measureLabel` at the head of the surface's meta line (`surf-measure-<key>`); `describeArea` puts the dims first on the tick list's heading line. The quantity is NOT backfilled by SQL — it is pricing's `computeQuantity`, which lives in `lib/pricing` and nowhere else — so older sheets show the area's dimensions and new issues the surface size too. (3) `app/w/WorkOrderDoc.tsx` passed `a.photos.slice(0, 8)` to `AreaPhotoStrip`; the cap is gone. Tests: `lib/workorder/surfaces.test.ts` (`dimsLabel`, `measureLabel`, `describeArea`), `lib/workorder/crew.test.ts`; e2e `e2e/wo-sheet-counts-dims-photos.spec.ts` (a draft work order issued through the RPC from a stale `woDoc` comes out with counts and dims; the anonymous `/w` page shows "× 4", "4 × 3 × 2.4 m", "33.6 m²" and all eleven photos). Help: `docs/help/work-orders/{contractor,employee,pc}.md`.
Manual test (after the paste): open any live job's /w link → each counted row reads "Doors × N" and each area carries its size beside its name; an estimate re-saved in the builder and re-issued also reads "38.4 m²" under Walls; an area with nine or more photos shows them all.

**A rate change sent to the painter uplifts each hour once (14 Oct 2026).** Migration `20270264000000_pay_change_no_double_uplift.sql` replaces `wo_sync_contractor_pay`'s hours sum. 73 Kerferd (PS-3613): base $5,040 (84 h at $60); the office set $67 in Revise scope on 13 Oct at 00:55 — before 20270254 went live at 02:16, when the sync left a job with a painter untouched (`ok:live`, no event) — so the rate reached nobody. Re-saving now sends the painter a pay change, but the 20270254 body summed every agreed revision row at `hours × coalesce(own rate, agreed)`, which also matched the two rows the office had drafted AT $67 ($402, $201), so the "after" figure read $6,894 instead of $6,831. Now only rows still at the agreed rate (`coalesce(contractor_rate_cents, v_agreed) = v_agreed` and delta = hours × agreed) are uplifted. `wo_contractor_answer_pay_change` was already right (it moves the base by base hours × difference and re-rates only old-rate rows). Contract test `lib/workorder/payChangeUplift.contract.test.ts`; spec `e2e/pay-change-no-double-uplift.spec.ts` recreates Kerferd.
Manual test (after Tom pastes 20270264): 73 Kerferd → Revise scope → Save (no edits) → the save message says "new rate sent to the contractor to accept"; Abdullah's job page shows Change to your rate $60 → $67, pay $6,243.00 → $6,831.00 → Accept → PC Command Contractor $6,831.

**The demo robots and the checklist (14 Oct 2026 — induction brief, Step 2).** Inside the practice job the office and the customer are robots, and nothing special runs for them: the robot is a staff login, **Paint Group robot** (`scripts/create-demo-robot.ts`; email in `settings.demo_rules.robotEmail`, migration `20270263`), that the server signs in by a one-time link (`lib/demo/robot.ts` — `generateLink` + `verifyOtp`, no password anywhere) and uses to call the SAME RPCs a person would; the customer side needs no login — the job's own token links. The replies (`lib/demo/robots.ts`) are scheduled from `after()` in the server action that handled the painter's tap, `settings.demo_rules.robotDelayMs` later (⚑7, 5 s): the fastest cron is five minutes, so this is the only sub-minute path. Hooks: `raiseVariationAction` → `wo_price_variation` (robot) → `wo_customer_sign_variation` (token) → `wo_release_variation` (robot) → waits for the painter's Accept; `notifyOfferRespondedAction` → an acknowledgement on the thread, no staff alert, no QA invites, and `/api/appointments/confirm` sends nothing for a demo; `startWalkthroughMode` → the customer approves every other room and flags the hallway; `completeAfterRectification` on a demo does NOT close the job (ruling 6) — `demoFixed` checks the rectification rows are done and the customer withdraws the flag on a second walk, so the painter signs on their phone like any job; `submitContractorInvoiceAction` → `contractor_invoice_approve`; `submitExpenseAction` → `contractor_expense_decide`; `postMessageAction` (painter side) → "your Project Coordinator will call you today"; `setFinishDate` (now with a **reason**, ruling 4 — `wo_contractor_set_finish_date(uuid, date, text)`, the two-argument overload dropped) → "Noted". Every robot message is a real `wo_messages` row through `wo_message_post`, so it shows where a real reply would; the office is never alerted about a demo. `contractor_invoice_submit` skips the profile/bank checks on a demo invoice (ruling 5). **The DEMO text** (ruling I12, ⚑4): `lib/demo/prompt.ts`, registry key `contractor_demo_prompt`, template `contractorDemoPromptSms` ("DEMO: Please update your job in the app today. {{link}}"), sent only by **Send demo prompt** on the PC job page's demo banner; it plants a `wo_reminder_moments` row for today on the practice job, which the painter's next tick or photo answers through the existing trigger. The practice job is outside every sweep, so nothing else ever texts it. **The checklist** is derived, never stored: `lib/demo/checklist.ts` (pure — the "On your phone" steps per module) over `lib/demo/checklistLoad.ts` (the job's own rows); the painter sees it under the banner, the facilitator sees every practice job on **PC Command → Induction** (`/pc/demo`). Proven in `e2e/demo-robots.spec.ts` (every module in order, robots answering, the grid filling). Not yet: Request more and contractor-raised No work today (Step 3b).

**Worker logins (14 Oct 2026 — induction brief, Step 3a; ruling 3).** Every painter on a job does the induction, so every worker gets a login — a small one. `20270265000000_worker_logins.sql`: `contractor_users(contractor_id, profile_id unique, role owner|worker, name, mobile, inducted_at, removed_at)` and `wo_worker_shares(work_order_id, contractor_user_id, unshared_at, is_demo)`; `profiles.role` stays `contractor`. **The wall:** `current_contractor_id()` is not taught about workers — every money read in the database (work orders, offers, contractor invoices, variations, events, the status tables, call backs, message threads) is gated on it and a worker has no `contractors` row, so all of them stay shut; `wo_variations_read` and `wo_events_read` add `not is_worker()` explicitly. Workers get their own helpers, `current_worker_id()` / `is_worker()` / `wo_worker_on_job(wo)`, OR-ed into exactly what a shared job needs: the private `wo_visible_jobs` view (which backs the `_read` policies on surfaces, photos, checklists, updates, QA checks, sign-off), `wo_photo_access` (the bucket), and the `wo_tick_surface` / `wo_record_photo` gates (`actor_kind = 'worker'`, `actor = auth.uid()` — the tick is under the worker's own name and counts for the contractor's job; `wo_reminder_moment_answer` counts it). Reads: `worker_me()` (the session) and `worker_jobs()` (the shared jobs, `jsonb_strip_money` on the document — no money column in the row). Writes: `worker_register` (links the auth user the server made), `worker_remove` (revokes at once — every worker read and write checks `removed_at`), `worker_share` (the owner's job, their worker; `settings.worker_rules.inductionGate`, ⚑15, OFF until Step 5). The login: a worker has a mobile, not an email — `app/portal/workerActions.ts` makes a confirmed auth user with a synthetic address (`worker-<id>@workers.paintgroup.com.au`, never mailed), mints the customer-style magic link (`mintMagicLinkUrl`, `lib/portal/auth.ts`) and **texts** it through the adapter (`contractor_worker_invite`; a share texts `contractor_worker_job_shared`; inventory 16c/16d). In TypeScript the worker is a `PainterKind` with its own capability set (`lib/painters/capabilities.ts` — every flag off but `isWorker`; `hasCalendar` is new and hides the Calendar tab), `ContractorSession.worker` is set by `worker_me`, and the portal branches on `capabilities.isWorker` only: Home lists shared jobs, Jobs reads `listWorkerJobs()` (`lib/contractor/workerJobs.ts`), the job page returns `app/portal/jobs/[id]/WorkerJob.tsx` — the same `WhatWeExpect`, `BatchUploader`, `TickList` and `WorkOrderDoc variant="crew"` the contractor's page uses, composed for a worker. The contractor's side is one component, `app/portal/WorkersCard.tsx` (mode `account` on Jobs: add / text the link again / remove; mode `job` on a job: share switch per worker). Staff see the crew with its induction state on the contractor's record. The crew link (`/crew/[token]`) is kept beside it until Tom retires it (§7 item 7). Proven in `e2e/worker-logins.spec.ts`: the worker reads only the shared job's rows, no money table answers, a removed worker is locked out at once, and a tick lands under the worker's name.

**PC Command shows a rate change waiting on the painter (14 Oct 2026).** After 20270264, 73 Kerferd's $67 went to Abdullah as a pay change; PC Command kept showing the agreed $6,243 with nothing to say a change was pending, which read as the rate change having failed. `app/pc/wo/[id]/page.tsx` now reads `pay_change_rate_cents / _from_rate_cents / _to_cents / _sent_at` and, while one is open, draws "$N waiting on <painter> to accept $old/h → $new/h" (`money-pay-change-pending`) under the Contractor figure. No migration. Spec: second describe in `e2e/pc-contractor-pay-variations.spec.ts`.
Manual test: PC Command → 73 Kerferd (until Abdullah answers) → under Contractor $6,243 an amber "$6,831 waiting on … to accept $60/h → $67/h".

**Portal gaps — materials, no work today, certificates later (14 Oct 2026 — induction brief, Step 3b; rulings I5, M4, M10).** Three things painters phoned about are now a button on the job and a card on PC Command, through the one work queue. `20270266000000_portal_gaps.sql`: `wo_material_requests(work_order_id, contractor_id, item, quantity, note, status requested|ordered|declined, reply, replied_at, is_demo)` written only by `wo_request_material` (the painter on the job, stage live) and `wo_material_request_reply` (staff; `wo_events material_request_replied`); `wo_day_flags.flag` widened to `no_work_requested` / `no_work_declined` with `decided_at/by`, written by `wo_request_no_work_day` (painter; today or yesterday Melbourne; one row per day) and `wo_decide_no_work_day` (staff — confirm deletes the request and calls the existing `wo_set_no_work_day`, so the moment-skipping logic has one home; decline flags the day `no_work_declined`); `contractors.certificates_deferred_at` set by `contractor_defer_certificates` (own row, `contractor_events certificates_deferred`). Painter side: `app/portal/jobs/[id]/MaterialsRequest.tsx` and `NoWorkToday.tsx` (`gapActions.ts`), shown when the job is committed and live, never to workers; Home's certificate action item carries `app/portal/DeferCertificates.tsx`. Office side: `app/pc/wo/[id]/MaterialRequests.tsx` (reply box) and the Confirm/Decline row on `NoWorkDay.tsx`; PC Command draws the three kinds `material_request` (4 h), `no_work_requested` (2 h) and `insurance_missing` (standing — every active contractor with `offerable = false`, i.e. no verified unexpired certificate, with the count of `certificate_reminder_sent` events) from `lib/crm/work-queue.ts` readers that filter open rows so the cards clear themselves. The reminder is `lib/automations/sweeps/certificateReminders.ts` on the campaign sweep (`?only=certificates&force=1` is the hand run): the standards ladder shape on `settings.certificate_rules` (days 2, 4, 6 at 9 am), `contractor_certificate_reminder` (inventory 16e, template `certificateReminderSms`), stops when `offerable` turns true. Demo: the robot office answers a materials request (ordered) and confirms a no-work day (`lib/demo/robots.ts`), and the checklist gains M4 and M10. Proven in `e2e/portal-gaps.spec.ts` and the two robot steps in `e2e/demo-robots.spec.ts`. Manual test: as a contractor on a live job, Materials → Request more; as PC, the card → Reply → Ordered; back on the painter's job the line reads Ordered. No work today → Rained off; as PC, Confirm; the day's moments show skipped.

**The sign-in email also carries a numeric code (14 Oct 2026).** The same live.com.au customer kept landing on "expired" — 13 links by 14 Oct, each spent by Microsoft's scanner ~19 s after send — so the email now shows the code `generateLink` returns beside the link (`email_otp`, the same single-use token as `hashed_token`; its length is the project's "Email OTP length" setting — 8 on the test project — so nothing assumes 6), and the **Check your email** state of `/account/login` has a **Sign-in code** box. `verifyCodeAction` (`app/account/login/actions.ts`) runs `verifyOtp({ type: "email", email, token })`; a wrong or stale code returns to the same page with `error=code`. The post-verify steps the link's tap and the code share — staff/painter role check, `ensureMembership` for customers — are one helper, `afterVerifiedSignIn` in `lib/portal/auth.ts`. A scanner can open a link; it cannot type a code. No migration. e2e: `portal-shell.spec.ts` "typing the emailed code signs in; a wrong code is a plain line, never a dead end"; fixture `magicCodeFor()`.
Manual test (after the deploy): /account/login → your email → the email shows a bold code under the button → on the Check your email page type 000000 → "That code didn't match" with the box still there → type the real code → your account opens.

**Induction content and language (15 Oct 2026 — induction brief, Step 4; rulings I8, ⚑2, ⚑3).** The induction is data, and the only translated text in the platform is what a painter reads and ticks to confirm: the thirteen modules' Read-and-confirm lines, ticks and titles, the worker extras (⚑17), and every sentence of the six finish standards sections. **The source of the English words is `docs/induction/induction-v1.md`** (re-exported from the induction doc, the PDF beside it) in a loader format `lib/induction/source.ts` parses — per module `## Module N · Title (M min)`, `### Read and confirm` numbered lines, `### Tick`, `### Worker version` with `Lines:` and `Extra:`; a file that breaks the format throws with the module named (`source.test.ts` pins the counts). **Translation files** are `docs/induction/translations/<code>.json` — one per language, the SAME keys as `en.json` (`m03.s4`, `m03.tick`, `m02.w1`, `m01.title`, and `standards.levels.intro`, `standards.surfaces.walls.checks.1.l3` … from `lib/standards/strings.ts`, which flattens the English standards model and lays a map back over it); `en.json` is generated by `scripts/induction-strings.ts` and `lib/induction/translations.test.ts` fails on a missing, stray or blank key, on en.json drifting from the sources, and on a file that is a copy of the English. The six non-English files are machine first passes for Tom's team to test (⚑3); Dari and Farsi are separate files (⚑2). `20270267000000_induction_content.sql`: `induction_languages(code, live …)` (seven rows, English always live), `induction_versions(version_kind full|refresher|worker, version_no)`, `induction_modules`, `induction_blocks(module_id, line_key, kind, audiences, language, text)` — one row per line per language, `standards_strings(version_id, language, key, text)`, and `contractors.induction_language` / `contractor_users.induction_language` (null = not chosen), written only by `induction_set_language` (contractor or worker session; refuses a language that is not live). `scripts/seed-induction.ts` loads it all, idempotently, checks every file against en.json first, and reads back through the app's own readers refusing to exit 0 unless the English equals the file and every language is complete. **Reading:** `lib/induction/read.ts` (`readInduction(supabase, language)`) returns the modules with the language's text and English behind it, listing every `missing` key; `lib/induction/load.ts` reports the misses once per request (`induction.i18n.fallback`) — a missing string falls back to English and is logged, never blank. The standards do the same through `lib/standards/load.ts`: `loadStandards()` is now the session's own view — the English model with `standards_strings` laid over it for the painter's language (`lib/standards/localize.ts`); the structure (keys, levels, codes) is always the English model's, so every link and lookup is unchanged, and the sign-off, Help → standards and the job's What-we-expect read in the painter's language with no per-page change. **Screens:** `/portal/induction/language` (the first screen — one button per offered language, native name large; `induction_languages_offered()` is the one anon-callable read, so the join form offers the same list), `/portal/induction` (the modules, worker version for a worker login), `/portal/induction/[module]` (the lines with `lang`/`dir` on the translated text only; the chrome stays English and left-to-right; Module 5 links to the six sign-off sections; an amber line counts any English fallbacks); Home and Help carry an Induction card (Home asks for the language until chosen); the profile shows the choice with Change language; the staff contractor record shows it; Settings → Communications → Induction languages is the live switch (`induction_language_set_live`, staff only, English always on). Ticks, the practical check, completion and the gate are Step 5. Proven in `e2e/induction-language.spec.ts`: a non-live language is not offered and the RPC refuses it; Spanish renders the module list, a module and a standards section in Spanish with `lang="es"`; a deleted Spanish row shows English, marked, with the rest Spanish; the app and the demo stay English; English again puts the words back. Manual test: as a contractor, Home → Choose your language → Español → Induction → Module 3; then Help → Finish standards → The three levels; Profile → Your language → Change language → English.

**Drive helper passes the Tighten details sheet (15 Oct 2026).** `e2e/portal-shell.spec.ts`'s first spec timed out after `door-tighten`: under the "range first" gate order (R7) the gate never runs, the keep door files an EMAIL only, and `contactKnown` in `app/wizard/WizardApp.tsx` needs name + email + mobile — so Tighten my price opens `TalkSheet` in `details` mode ("A few details first") before the scope editor, exactly as `gate.spec.ts` asserts. The C1 test project had been left on `range_first` by an earlier gate run (its `afterAll` puts the rule back, a cancelled run does not), which is why the spec was red on a clean main. `driveNoPlanWizard` (`e2e/customer-journey/drive.ts`) now calls `passDetailsSheetIfShown` after the tighten click: waits for the sheet or the editor's `.sc-r`, fills `talk-name`/`talk-email`/`talk-mobile` with the walk's contact and presses Continue when the sheet is there, returns without touching anything under "details first". No wizard change — the second ask is the designed behaviour. Specs that click `door-tighten` directly (`what-we-do`, `retail-send`, `trims-base`, `tom-batch-15sep-evening`, `holding-and-honest-defaults`, `ui-refresh-baseline`) still assume details first and will need the same helper if C1 is on range first.

**Customer updates carry the photos the office attached (14 Oct 2026).** Tom: "clients are unable to see photos attached in the updates section." The job page composer let the office pick up to 8 site photos; `deliverCustomerUpdate` put them in the email and nothing recorded which photos belonged to the update, so `lib/portal/timeline.ts` drew the customer's card with whatever before/progress/completion photos were taken the day it was SENT. Migration `20270268000000_update_photos.sql` adds `wo_updates.photo_ids uuid[]` and gives `wo_send_update(p_update_id, p_photo_ids default '{}')` the chosen ids (kept only where `wo_photos.work_order_id` is the same job, at most 8, in the order chosen; the old one-argument overload is dropped so PostgREST never sees two). `sendCustomerUpdateAction` passes them; `deliverCustomerUpdate` falls back to the row's ids. The portal reads `photo_ids` (`lib/portal/data.ts`), fetches any attached photo the 40-row gallery window or its kind filter would have missed, and `TimelineUpdate.photo_ids` puts them on the update card first, with the day-grouping skipping ids already attached so no photo renders twice. Unit: `timeline.test.ts` "photos the office attached ride the update…". e2e: `e2e/update-photos.spec.ts` (staff attaches a three-day-old photo on the job page → the customer's card shows it once).
Manual test (after Tom pastes 20270268 and the deploy): open an in-progress job → Send the customer an update → tap a photo taken on an earlier day → Send → sign in as that customer → Your project, day by day → the update card shows that photo; the earlier day has no extra "Before photos" card for it.

**Cancel an unpaid deposit and invoice in full (15 Oct 2026 — 8 Penderel Court).** Migration `20270269000000_invoice_final_in_full.sql`, additive. The job was signed off with its 50% deposit (INV-0052) sent and viewed but never paid; the final drafted at sign-off netted that deposit off, so nothing could raise ONE invoice for the whole job — Invoice in full drafts the balance only, and the row's primary stays ✓ Paid on the deposit because `sent` outranks `uninv` in `jobMoney.ts`. The sent, unpaid deposit (or progress) card in the job panel now carries **Cancel, invoice in full** (`PanelClient.tsx`, `finalInFullAction` in `app/invoicing/actions.ts`), which calls `invoice_final_in_full(estimate, reason)`: staff only; refuses `has_payments` when any cent has landed on a deposit or progress claim (the ordinary final nets that off) and `nothing_to_cancel` when nothing sent and unpaid exists; otherwise voids every issued/sent/viewed deposit and progress invoice through `invoice_void` (number burnt, `voided` event, lines' `parent_void` mirror), deletes their unsent drafts, and drafts the final through `invoice_draft_final` — one transaction, and a refused void raises. The final then goes out through the ordinary Send. Spec: `e2e/payments-final-in-full.spec.ts` (staff flow, the customer's cancelled and final links, the two refusals, anonymous refusal). Help: `docs/help/invoicing/staff.md`.

**Induction sign-off: ticks, the practical check, completion and the gates (15 Oct 2026 — induction brief, Step 5; rulings I1, I5, I9, I13, ⚑1, ⚑5, ⚑9, ⚑15, ⚑17).** The standards sign-off became the 13-module induction. `20270270000000_induction_signoff.sql`: `induction_acks(profile_id, version_id, module_key, section_key, language)` — one row per login per module, keyed by the auth user because a worker has no contractors row; Module 5 for a contractor IS the six `standards_acks` rows (one writer, `induction_ack_module('m05', section)` delegates to `standards_ack_section`), for a worker login six `induction_acks` rows with a section. `induction_checks(profile_id, version_id, task_key, result pass|not_yet, checked_by)` — the facilitator practical check, five tasks for a contractor, three for a worker, none for the refresher, written only by `induction_check_record` (staff). `contractors.induction_kind full|refresher` (every contractor on the books when the file ran became refresher once, via a `refresherAssignedAt` stamp in `settings.induction_rules`; a painter who joins later is full) with `induction_invited_at / induction_grace_until` (the refresher is invited by the office, `induction_invite`, with the standards grace days). **The modules of a kind** are `induction_modules_for(kind)`: full = every module but `m00`; refresher and worker = the modules whose English lines carry that audience (`lib/induction/source.ts` writes `audiences` from the markdown: the refresher is Module 0 "What is changing" — new, refresher-only — plus 3, 5, 6, 7, 8, 9; the worker set is ⚑17). **The one gate rule** is `induction_gate_of(contractor)` → ok | induction_incomplete | check_not_passed, mirrored word for word by `lib/induction/status.ts inductionGateOf` (pinned by `status.test.ts`): full needs the ticks and the check; refresher needs the ticks once invited and the grace has ended, never the check; `settings.induction_rules.offerGate` off, or no published version, is ok for everyone; a tick older than `reTickMonths` (12, ⚑9) bites only with `expiryBlocks` on (⚑, default off). `send_offer` and the `booking_offers` trigger read it after the standards check (no path around the RPC). **The share gate** `worker_rules.inductionGate` is ON: `contractor_users.inducted_at` is written by `induction_worker_maybe_induct` when a worker login has ticked every worker module AND passed the three-task check, and nowhere else. **Completion** is derived (`induction_completed_at`): the last tick writes one `induction_completed` event per version and `app/portal/induction/actions.ts` hands `lib/induction/notify.ts completeInduction` to the background — the PDF of every line ticked, in the painter's language (`lib/induction/pdfHtml.ts`, `lang`/`dir` on the document), saved as `contractor_documents` kind `induction` under the contractor (a worker's under their contractor, named for them) and emailed to a contractor (`contractor_induction_complete`) or texted to a worker (`contractor_worker_induction_complete`); the refresher invite is `contractor_induction_invite` (inventory 16f–16h). The standards PDF at the sixth section is now in the painter's language too. **Versions:** `induction_publish_version(no, changed_modules, note)` publishes a version the seed loaded, copies every ack and check from the previous version except the changed modules, and puts the note on those (`induction_modules.change_note`), so a material change clears exactly that module's tick for everyone (§5) and the painter reads what changed first. **Screens:** `/portal/induction` lists the modules of the login's kind with Ticked / Next, the progress bar and the completion screen (what is still to come: the check, insurance); `/portal/induction/[module]` shows the lines, the "On your phone" steps of that module LIVE from the practice job (`lib/demo/checklist.ts` rows by module number, `myDemoWorkOrderId`), Module 5's six sections with their tick state (a worker ticks each here; a contractor on the sign-off), the "What changed" note, and `TickStep` (one tick, Next disabled until ticked, resumable); Home's Induction card carries the progress chip and the gate line. Staff: `app/(app)/contractors/[id]/ContractorInduction.tsx` on the record (kind, progress, the check as a Pass / Not yet pair per task, Invite to the refresher, Switch kind) and under each worker in *Their crew*; PC Command → Induction grid has a Ticks column (`induction_statuses()`). Proven in `e2e/induction.spec.ts`: a new painter joins in Spanish, signs the standards, ticks every module (one on the phone), the event and completion screen; an offer is refused at the RPC and by the table (`error:not_offerable` → `check_not_passed`) until the five tasks pass, then allowed; the e2e painter on the refresher keeps offers before the invite and in grace, loses them after, ticks the six refresher modules (no check), offers resume; a worker cannot be shared until ticks AND the three-task check, then `worker_inducted` and the share goes through; a version bump keeps 12 of 13 ticks. Manual test: as PC, open a new painter's record → Induction → press Pass on five tasks; as the painter, Home → Induction → Module 1 → tick → Next; Module 5 → the sections; the completion screen; as the contractor with a worker, share a real job (refused) → the worker ticks and the check passes → share again.

**Booked labour (15 Oct 2026, Tom: 12 First Avenue).** Every calendar working day an employed painter is booked onto a job is a work day costed at the standard day's hours × that painter's cost rate on the day, from the moment it is booked. The rule is `lib/invoicing/bookedLabour.ts` (pure, tested): for each non-released `wo_assignments` row of an employee, each Monday–Friday in the range (public holidays from `settings.visit_booking_rules`) that no counted labour `job_costs` row covers (via `timesheet_entries.job_cost_id`) becomes a projected source `booked:<painter>:<date>` at `timesheet_day_setting()` hours × `employee_cost_rate_on`; a rejected day is not worked; a painter with no rate is reported, never priced at $0. `jobProfit` takes `projectedLabour` into the Own painters line and, with `employeeJob` (`wo_is_employee_job`), draws no contractor line — the snapshot's `contractorPaymentCents` on an employee job is the estimate's labour budget, and counting it had put a second labour cost on all 15 employee jobs. Readers: `app/invoicing/data.ts loadBookedLabour` feeds the Payments job panel (`panelData.ts`, note `pm-labour-note`, tag `job-cost-booked`) and the PC job page's strip (`money-labour`, `money-labour-booked`, `money-labour-norate`; Contractor reads "—"). Migration `20270274` makes `set_employee_cost_rate` run `timesheet_auto_approve` over the painter's waiting days (`ok:<from>:posted:<n>`) and backfills the days whose rate had since arrived. Audit: `scripts/diag/booked-labour-audit.mjs --prod` (read-only) lists every job's booked days × rate against the labour the panel shows. Proven in `e2e/employee-timesheet.spec.ts`.

**The full room and the wall, proven after every feature (15 Oct 2026 — induction brief, Step 6).** `e2e/induction-room.spec.ts` is the story the brief asked for and the regression every later induction change runs against: three new painters inducted at once by one facilitator — each joins through `redeem_contractor_invite` as their own session, picks English, Farsi and Spanish, and gets 12 Demo Street set up on their account by staff; the three practice jobs run side by side and the facilitator's grid (`/pc/demo`) shows three rows, each on its own step with its own Ticks count; one painter resets mid-session and only their row starts again; the Farsi painter ticks Module 3 on a page whose translated text carries `lang="fa" dir="rtl"` while the page chrome and their demo job stay English (`<html lang="en">`, "12 Demo Street", no Persian in the banner or the title); a worker is registered under the third painter, the demo is shared with them before any induction (⚑8 — the share gate skips demo jobs), and they tick the ten worker modules and the six standards sections as their own session in Spanish, pass the three-task check, and `inducted_at` is written. Then the money story again with every feature in place: a demo variation, contractor invoice, expense, call back and materials request change no count on PC Command (the gap cards included), the Payments headline or the Contractors strip, and the status sweep writes no `painter_job_results` for any of the three demo jobs. Last, the customer role reads nothing from any table the build added — `induction_acks`, `induction_checks`, `induction_versions`, `induction_modules`, `induction_blocks`, `induction_languages` (its read policy tightened to painters and staff by `20270272000000_induction_languages_rls.sql`; the join page and the picker read through the anon-callable `induction_languages_offered()`), `standards_strings`, `wo_material_requests`, `contractor_users`, `wo_worker_shares` — nor any demo work order. MYOB has only a connect/callback route; payables are the Payments read, which is demo-walled by `jobMoneyPage` → `realOnly`. CLAUDE.md gained the standing rule for all of it (the induction is data, the demo is walled, the gates live in two RPC helpers).

**Project progress: the booked start date on every card (15 Oct 2026).** Tom: "write the start date in the boxes so we can see when it is booked in". `startDateLine(startDate, lane, today)` in `lib/workorder/stages.ts` turns the job's yyyy-mm-dd start date into **Starts Tue 20 Oct** (Offer, Booking confirmed, Pre-start lanes) or **Started Tue 6 Oct** (every later lane), naming the year only when it is not this year; the date is formatted from its parts in UTC so no zone can shift it a day, and a missing start date draws nothing. `/pc/flow` renders it as `.job .sd` (`data-testid="start-<id>"`) under the money line on every card. No migration. Unit tests in `stages.test.ts`; `e2e/pc-console.spec.ts` ("Booking confirmed lane") asserts the line on the 20-day and 3-day fixtures. Help: `docs/help/work-orders/pc.md`.

**12 Demo Street — photos, measurements, pre-start ticked, start date auto-approved (15 Oct 2026 — Tom, after walking the practice job).** `20270275000000_demo_job_gaps.sql` re-creates the demo template and snapshot and the seed. The house is now five rooms (a Kitchen joins the two bedrooms, lounge and hallway — Tom supplied five photos), 27 tick rows, still 40 h over 5 days; every area carries `dims {l, w, h}` and every per-item surface (Doors, Window frames) a `count`, in the same `wo_snapshot` shape `20270272` freezes on a real job, so the sheet reads "3.6 × 3.2 × 2.7 m" and "Doors × 3" through the existing `lib/workorder/surfaces.ts` helpers with no screen change. **Photos:** five office (reference) photos, one per room, are shared files at `demo/reference/<room>.jpg` in the private `wo-photos` bucket — uploaded once per project by `scripts/seed-demo-photos.ts` (test / `--prod`, reads the bucket back) from `docs/demo/photos/` — and the seed writes one `wo_photos` row of kind `reference` per room pointing at them; a new storage policy `wo_photos_demo_select` lets any signed-in painter sign a `demo/` path (the files are five empty rooms), while the rows stay scoped to the job by `wo_photo_access`, so they show under FROM THE OFFICE on the painter's own practice job only. **Pre-start:** the seed writes the three colours as confirmed on `work_orders.colours` and ticks every seeded pre-start item, so Start is never blocked by a list the slides do not mention; the before-photo gate is untouched. **Start date:** `RescheduleRequest` now pings `notifyOfferRespondedAction` like the offer card does, and for a `proposed` offer on a demo job the action calls `demoStartDateProposed` (`lib/demo/robots.ts`) — the robot office approves through `resolve_proposed_offer`, the same RPC a PC clicks, and says so on the thread; a real job still waits for staff. Proven in `e2e/demo-robots.spec.ts` (the new start date approved and the end date moved with it; the list ticked, five office photos, dims and counts on the sheet) and `e2e/demo-property.spec.ts` (27 rows). Manual test: as a contractor, Jobs → Start the practice job → the five photos under From the office and "3.6 × 3.2 × 2.7 m" on Bedroom 1 → accept the offer → Request a new start date → a date → Send → within seconds the robot says "New start date approved" and the pending card is gone → Start job (not blocked).

**Videos from the office to the painter (19 Oct 2026 — Tom: "we are getting a lot of videos from clients which we want to forward on from whatsapp").** No new surface and no migration: the painter's own cards have taken a video since 26 Sep and every reader already tells a video from a photo by the storage path's extension (`isVideoPath`), so the painter's sheet, the crew link and Painter's view drew a play-badge tile the moment a `reference` row carried one. The gap was only `ReferencePhotosCard` (`/pc/wo/[id]`): it accepted `image/*`, never sent `contentType` on the sign request, so a clip got a bare photo name and `/api/wo/photos` refused its bytes as "not a photo". The card now accepts video, sends `declaredUploadType(file)` (`lib/extract/normalise.ts` — the browser's type, else the name's extension, because a file saved out of WhatsApp can arrive typeless; the ingest still sniffs the staged bytes so a wrong guess is refused, never filed), and renders a video row as a small in-place player with `data-media="video"`. Caps unchanged: photos 25 MB, videos 200 MB. Proven by the new case in `e2e/wo-reference-photos.spec.ts` (office attaches an MP4 → video row on the card → video tile on the anonymous `/w/` sheet that opens in the lightbox → same tile on the crew link) and `lib/extract/normalise.test.ts` (typeless `WhatsApp Video ….mp4` → `video/mp4`, `.jpg` stays undeclared). Help: `docs/help/work-orders/{pc,contractor,employee}.md`. Manual test: save a WhatsApp video to the desktop → job page → Photos and videos for the painter → choose it → it plays on the card → open the job-sheet link in a private window → From the office shows a tile with ▶ → tap → it plays.

**Back to the induction from the practice job (16 Oct 2026 — Tom).** A painter following a module's "On your phone" steps switches to 12 Demo Street and needs an obvious way back. The portal job page, for a demo job only, reads the painter's own induction position (`loadMyInduction` → `nextModule`) and passes `inductionHref` to `DemoControls`, which in `portal` mode draws a cyan **← Back to the induction** button in the banner (`demo-back-induction`) — the next unticked module, or the list once all are ticked. Never on a real job, never in the office's `pc` mode. Proven in `e2e/demo-property.spec.ts` (first test). Manual test: as a contractor, Induction → a module → Open 12 Demo Street → the banner's Back to the induction → lands on that module.

**The induction is the one path to the standards while it is open (16 Oct 2026 — Tom).** Home used to send a new painter straight to the standalone standards sign-off (full screen, "blocked") before they had seen Module 1, and when they reached Module 5 it was already ticked. Now `app/portal/page.tsx` reads the painter's induction position once (`loadMyInduction`) and, while it is open — full or refresher, not complete — neither draws the **Read and confirm the finish standards** card nor redirects a `blocked` painter: the amber induction card is the one prompt and Module 5 reaches the same six sections in order. Both return once the induction is complete, which is how a later standards version is re-confirmed. Nothing underneath changed: one writer (`standards_ack_section`), the confirm page still goes full screen when blocked, and `send_offer` still refuses `standards_not_signed` (redundant for a painter on the full induction, whose offers wait on `induction_gate_of` anyway). `e2e/standards-signoff.spec.ts` and `e2e/induction.spec.ts` now expect a new painter to land on Home with no sign-off card. Manual test: invite a painter, join → Home shows the Induction card and no standards card → Induction → Module 5 → the sections.

**Videos in the estimate (19 Oct 2026 — Tom: "make sure vids can be added in the estimate").** No new field: the estimate's media is a list of public `estimate-media` URLs frozen into `sent_snapshot.areas[].photos` and `builder_state.woDoc.areas[].photos`, and a video rides that list told apart by its extension. The one definition is `lib/media/video.ts` (`isVideoUrl`, `imagesOnly`, `videoExtensionForMime`); `lib/workorder/photos.ts isVideoPath` now delegates to it, so the painter's private paths and the estimate's public URLs answer the same question the same way. `20270276000000_estimate_media_video.sql` widens the **estimate-media** bucket (images only, 10 MB since `20260905`) to the three video types the painter buckets already take at 200 MB — the bucket is the real guard, the client check (`lib/uploads/validate.ts mediaKindOf` → `checkUpload(f, "video")`) only words the refusal. The builder's `MediaUploader` (`QuoteBuilder.tsx`, every area / surface / line photo box) accepts both, skips the browser downscale for a clip, names the object with a video extension from its type (or its name, for a typeless WhatsApp save) and draws a small player. Readers: `CustomerEstimate.tsx` `MediaTile` (a `<video class="ph">` in the same grid cell, hidden in print), `AreaPhotoStrip` on the work-order sheet (poster + play badge, `data-media`, lightbox plays it), and `lib/progress-preview/build.ts` drops videos from the demo phone's photo pool (`imagesOnly`) because its bubbles are `<img>`. Tests: `lib/media/video.test.ts`, the new `build.test.ts` case, `e2e/estimate-video.spec.ts` (builder MP4 → snapshot URL → anonymous `/e/` video tile; a frozen clip on the anonymous `/w/` sheet plays from the lightbox). Help: `docs/help/estimator/{staff,customer}.md`, `docs/help/work-orders/contractor.md`. Manual test: open an estimate → an area's **Room photos** → **+ Photo / video** → a saved WhatsApp clip → it plays in the box → Save → open the customer link in a private window → the clip plays under "Your property, as we saw it".

**Walkthrough with an open variation, the quality-check strip, and the painter's two-business-day text (19 Oct 2026 — Tom).** Three small things. (1) `20270277000000_walkthrough_with_open_variations.sql` redefines `wo_gate_blocked` (20270173 body verbatim, one arm changed): a variation at raised / priced / customer_approved refuses a forward move only while a surface in scope is not `done` — with every area ticked the painter finishes and starts the walkthrough and the office decides the variation in its own time (an undecided one is never on the final invoice). `blockedReason(open, surfacesLeft)` in `lib/workorder/variations.ts` is the TS twin and the PC job page's readiness list shows the variation as a note once the ticks are in; `e2e/wo-walkthrough-open-variation.spec.ts` proves both doors. (2) A required main quality check is a work item from booking until its day — `qa_check_to_book` in `lib/crm/work-queue.ts` (the QC row reader now takes undated checks too), in three states (undated · dated but no final booked · booked before the booked final), homed on PC and drawn by `app/pc/page.tsx` as the strip at the TOP of PC Command rather than a card in Needs you now; on the day it hands over to `qa_check_due`, at stage `qa` to the console's own card. `e2e/pc-qa-to-book.spec.ts`. (3) `contractor_finish_reminder`: `lib/automations/sweeps/finishReminder.ts` off the half-hour campaign sweep (`?only=finish`), planned by `painterFinishReminderDay` / `walkthroughDayOf` in `lib/workorder/jobRhythm.ts` (two business days — `workingDaysBefore` in `qaSchedule.ts`, public holidays skipped — before the booked final, else the booked last day), claimed once per job per walkthrough day, sent 07:30–12:00 (`finish_reminder_rules`), outcome on the job as `finish_reminder_sent`; templates `contractorFinishReminder*` in `lib/messaging/config.ts`. `e2e/automation-finish-reminder.spec.ts`.

**Two painter cards off PC Command (19 Oct 2026 — Tom: "remove the reminders in PC command for painter not signing finish standards"; "remove 'no public liability on file' alerts from pc command").** `buildPcWorkItems` no longer reads or builds `standards_unsigned` or `insurance_missing`; `app/pc/StandardsRemind.tsx` and both card branches are gone. The kinds stay declared (old dismissal keys, the CRM tag map). The standards and certificate reminder texts (`lib/automations/sweeps/standardsReminders.ts`, `certificateReminders.ts`), the Contractors list's Standards line and the PC Contractors tab's "Not signed" count are untouched. `e2e/standards-signoff.spec.ts` and `e2e/portal-gaps.spec.ts` now assert the cards' absence.

**Remind me… on every PC Command card (19 Oct 2026 — Tom: "add a reminder date, to be able to close off an alert and for it to pop back up at a later date").** No new store: `remindLater` in `app/pc/actions.ts` writes one dated row through the existing `crm_dismiss_work_item` (until 6:00 am Melbourne on the chosen day, reason `Remind me on <date> (PC Command)`), and the item is derived again when the date comes. A work item uses its own key (the queue already honours `until`); a console card uses `pcCardSnoozeKey(workOrderId, cardKey)` in `lib/workorder/console.ts`, which `loadConsole` reads back as `snoozedKeys` and `buildQueue` filters alongside the permanent `card_dismissed` events. `app/pc/RemindLater.tsx` is the control, drawn on every card branch of `app/pc/page.tsx` and on the quality-check strip. `e2e/pc-remind-later.spec.ts` proves both kinds go and come back.

**Movements — schema, RPCs and seed (19 Oct 2026 — Session 1 of `docs/briefs/movements-build-plan.md`, brief v2.2 §3.1, §5).** One record for the thing that moves: a chip IS a `movements` row — `status = tray` with no assignee and no day until it is dropped on a lane (`assignee_kind` supplier | person, `assignee_table` profiles | contractors, `due_date`, `half`, `time`, `sequence`). Migration `20270279000000_movements.sql` creates the seven enums, `movements`, `movement_items`, `wo_material_lines` (the materials list as lines — one list behind the estimate, the job page and the tray), `equipment_items` (tagged individually from `equipment_tag_seq`, no location column: location is derived from the last done movement by `equipment_item_location`), `supplier_branches` hanging off `vendors` by brand, `supplier_branch_accounts` (staff-only, never in a file), `wo_logistics_decisions`, the `movements` settings row (warehouse = `company_profile` address + its `visit_suburbs` centroid, `nearKm` 7, `boardPeople` empty) and the demo-wall triggers. **Only RPCs write it**: `movements_sync_for_wo` (chips from the jobs — one paint chip per product brand from the Materials rows in `wo_snapshot`, one per unmerged line, one rubbish question; never touches a placed chip except `source_changed_at`; closed jobs get return chips for stranded gear) runs from a trigger on `work_orders` (snapshot materials change, issue, close) and the line RPCs; `movement_create / place / unplace / mark_ordered / set_status / redate / set_time / set_sequence / update / send_run_plan (stub) / painter_done`, `material_line_add / update / remove / merge`, `material_request_accept`, `wo_logistics_decide`, `equipment_item_*`, `supplier_branch_upsert / set_account`. The lane rules live in `movement_place` (supplier lane refuses our own gear and a non-delivering branch; `blocked_by` must be done; staff-style drops book on placing, pickups and supplier orders stay `planned` until Ordered ✓), `colours_first` in `movement_mark_ordered`, auto returns in `movements_after_booked`. Painters read through `movements_for_painter` / `supplier_branches_for_painter` (the §5 column limits — Postgres column privileges are per role and staff share `authenticated`, so no painter policy sits on a base table); customers read nothing. `app/pc/movements/actions.ts` is the zod boundary over every RPC; `lib/movements/types.ts` names the enums; `lib/movements/boundary.test.ts` greps `app/` and `lib/` for direct writes and hand-set statuses; `lib/demo/scope.ts` lists the four job-linked tables. Seeds: `scripts/seed-suppliers.ts` (CSV → vendors + branches, centroids paged past the row cap, UNVERIFIED rows inactive) and `scripts/seed-equipment.ts` (refuses without `EQUIPMENT_SEED_CONFIRMED=1`, maps the template categories by name and refuses what it cannot map). `e2e/movements-rpc.spec.ts` asserts every transition and refusal through each role's own session. No screen yet (Sessions 4–6).


**Exterior wizard v2 — S1, the data and the model (19 Oct 2026; brief `docs/briefs/claude-code-brief-exterior-wizard-v2.md`, ledger `docs/briefs/exterior-v2-progress.md`).** The drawn house is one optional object on the wizard state, `exterior.v2` (`lib/wizard/state.ts`: shape, size band, row position, the ticked parts and extras, the wall material(s) and a record per side with its own width, height, parts on/off, material, counts, condition, size answer and checked flag). The shapes and their typicals are `lib/wizard/exterior-typicals.ts` — nine rows (weatherboard, Californian bungalow, brick veneer, double storey, townhouse, unit, period terrace, modern, something else) with the silhouette, typical lengths, wall height, gable rise, usual shared sides and the size-band scaling; the same list seeds the new `exterior_typicals` table (`20270278000000_exterior_typicals.sql`, RLS on, anon + authenticated read, staff write; `scripts/seed-exterior-typicals.ts`), every row `source = proposed` until Tom replaces it. **One model**: `lib/wizard/exterior-model.ts exteriorV2Nodes` turns `v2` + typicals into the same `Exterior - Front/Right/Rear/Left` and `Exterior - Extras` nodes the quote, work order and sides editor already read, writing every quantity onto the existing surface fields (`measureL`/`measureH`, `qtyOverride`, `count`, `sharePct`) so `lib/pricing` prices it unchanged — walls by storey and per-side material, gable triangles, rakes on the fascia line, verandah posts / ceiling / handrail, per-side window and door counts, the extras by stated size — and raises a deferral for anything it cannot price honestly (shingles, "something else", aluminium or unsure windows, a not-sure size, iron lace). `applyExteriorAnswers` builds from it when `v2` is present (the 12 × 14 scaffold and the whole-job extras are the older sessions' path and never run beside it); `applyExteriorQuickLook` derives the v1 fields every older reader prices from (`quickLookFromV2`) and `exteriorQuickLookFromState` reads the house back for resume. `confirmedSidesMap` feeds the envelope so a checked, sized side narrows the band and a "not sure" side does not. Tests: `exterior-model.test.ts` (the golden bungalow line by line, acceptance 1–5a and 7), `exterior-v2.test.ts` (round trip, tree, envelope narrowing). No screen reads `v2` yet — S2 adds the first.

**Exterior wizard v2 — S2, Your home and the picture (19 Oct 2026).** Behind the `exteriorV2` flag (`lib/wizard/ui-flags.ts exteriorV2On()`, `NEXT_PUBLIC_EXTERIOR_V2=1` — on in `.env.test.local` and the CI e2e job, off in production until Tom flips it after S6), `stepsFor()` puts a `home` step between the place and the outside questions on every home outside and both path: "What kind of home is it?" (`app/wizard/ExteriorHome.tsx` — nine shape cards with their own silhouettes, the size band, and for a townhouse, unit or terrace where it is in the row). The answers are `exterior.v2` through the quick look's `onOutside({ v2 })`; `houseOfShape` and `reseedSides` (the model) seed the four sides from the shape's typicals at the band, shared sides not painting. The picture card draws the front elevation (`app/wizard/pictures/Elevation.tsx` — the mockup's `elevation()` and `typeThumb()` ported as string-built SVG, scale `min(280 ÷ w, 150 ÷ (h + rise + 0.6), 46)`, every part a `.e[data-e][data-on]` group, "next door" on each shared side) with the typical sizes in the caption. Until the Painting step ships (S3) a house with no parts is a shape and a size only: `applyExteriorQuickLook` leaves the v1 fields to the old outside screen, and `applyExteriorAnswers` lays the old scaffold **sized from the drawn house** (its widths and wall height replace 12 / 14 × 2.6). The typicals are read once by `lib/wizard/exterior-typicals-db.ts loadExteriorTypicals` (the estimate page, the scope store's refs, the submit route) with its `error` handled and the built-in list as the fallback. Tests: `lib/wizard/exterior-v2-home.test.ts`, `e2e/customer-journey/exterior-v2-home.spec.ts`; the specs that walked straight to the outside step pass the home step through `passHomeStepIfShown` in `drive.ts`.

**Exterior wizard v2 — S3, Painting and About it (20 Oct 2026).** Under the `exteriorV2` flag the one old outside screen is replaced by two: `app/wizard/ExteriorPaint.tsx` ("Tap everything we're painting" — the parts in the four groups of `PART_GROUPS`, the nine extras, nothing pre-ticked, the verandah family offered once the verandah is ticked; `togglePart` / `toggleExtra` in the model) and `app/wizard/ExteriorAbout.tsx` ("Tell us about what you ticked" — cards only for ticked parts: the wall material(s) by storey, painted or bare brick, the vertical-timber stain note, the gable fill, the window type with the drawings, the garage, the posts, the extras' sizes, then the same colour cards and access chips as before; `aboutMissing` is the Continue gate). The picture is a control: `Elevation` takes `onPart` and a tap on a `g.e[data-e]` toggles the chip (acceptance 9). The old "Which sides?" screen stays until S4 but now drives `v2.sides[k].paint` (`setSidePaint`); the old `outside` step is off the path and kept for resume. Once a part or extra is ticked `exteriorV2Answered()` is true: `applyExteriorQuickLook` derives the v1 fields from the house (`quickLookFromV2`), `applyExteriorAnswers` prices the model's tree, and the range, restatement and sides editor read the drawn house. `stepsFor()` home outside / both: `home, paint, about, sides`. Specs that drove the old screen: `answerOutsideQuick` in `drive.ts` answers either path with the plainest house; `exterior-quick-look`, `exterior-batch-15sep`, the UI-refresh S5 block and the baseline outside journey are skipped under the flag until S6 rewrites them. Tests: `lib/wizard/exterior-v2-paint.test.ts`, `e2e/customer-journey/exterior-v2-paint.spec.ts`, `exterior-v2-about.spec.ts`.

**Exterior wizard v2 — S4, Each side, the gate and the guide range (20 Oct 2026).** Under the flag the "Which sides?" screen is replaced by the per-side confirm (`app/wizard/ExteriorSides.tsx`, brief §7.4): four tiles, the picture turned to the current side with a compass in the card head (`PictureCard` `sideAt` / `onSide`), per side the whole-house parts that land there as chips (`sideListParts`), "+ Add something on this side" from the rest of the list (`sideAddableParts`, `toggleSidePart` writes the side's `off` / `add`), the side's own wall material (`setSideMaterial`, tagged Same as the house / Different from the rest), "Not painting this side" (`setSidePaint`; shared sides start that way) and "Looks right — next side" (`confirmSide`; any change un-confirms). Continue needs `allSidesConfirmed` (acceptance 8a). On the range screen an outside job on the drawn house gets `app/wizard/ExteriorRangeRows.tsx` — one row per painted side (`w × h m · what was counted`) and one for around the house, read off `exteriorV2Nodes` so the words come from the same tree as the price — the "Not in this number" line (`notInThisNumber`, ⚑ 4 shingles), `range-width` as the number alone, and the doors in the brief's order (Tighten my price first, with the walk-around words; Book a site visit; Speak with us; Send us a message). Tests: `lib/wizard/exterior-v2-sides.test.ts`, `e2e/customer-journey/exterior-v2-sides.spec.ts`, `exterior-v2-range.spec.ts`.

**Exterior wizard v2 — S5, Tighten, the detailed range and the editor after it (20 Oct 2026).** On the drawn house the Tighten door opens the walk-around inside the wizard (`app/wizard/ExteriorWalk.tsx`, brief §7.6): the same tiles, picture and compass as Each side, the same parts and walls lists (`SidePartsAndWalls`, shared with `ExteriorSides.tsx`), then per side the window and door counts (`setSideCounts`), the size question (`setSideSize` — Looks right / Adjust it in 0.5 m and 0.3 m steps / Not sure keeps the typical and stays assumed, ⚑ 13), the condition (`setSideCond`, ⚑ 1) and "Check this side" (`checkSide`, only after the size answer — acceptance 11). "See my range" sends the whole `v2` to the estimate's edit route as ONE action, `ext_walk` (`app/api/estimates/[id]/wizard-edit/route.ts`): the server rebuilds the exterior side and extras nodes from it through `rebuildExteriorNodes` (each side keeps its node id and the customer's own words; the access node and everything else stay), swaps the model's deferrals, writes the house back into the stored wizard state, takes the worst side's condition into the one Condition slot exactly as the loop's card does and names the peeling sides for the work order, then re-prices — the range comes back as the customer payload the reveal already draws. `Reveal` reads **Detailed** when the band is inside the mid band (`DEFAULT_BANDS.midPct`), marks each checked side's row, turns the walk door into "Change a side" with Book a site visit primary (⚑ 14) and adds "Change anything else" to the sides editor (§7.7), which opens on the rebuilt tree with the sizes confirmed and the condition card answered. `isWallLine` no longer counts a gable end as a wall. Tests: `lib/wizard/exterior-v2-walk.test.ts`, `e2e/customer-journey/exterior-v2-tighten.spec.ts`.

**Exterior wizard v2 — S6, the finish (20 Oct 2026).** The plan's six sessions are built behind `exteriorV2` (`NEXT_PUBLIC_EXTERIOR_V2=1`): on, every home outside and both job walks Your home → Painting → About it → Each side → Details → the guide range → the walk-around → the detailed range → the sides editor, all from the one drawn house on `exterior.v2` and the one model (`lib/wizard/exterior-model.ts`); off, nothing has changed. The old outside screen and the old Which-sides screen stay in `QUICK_LOOK_STEPS` for one release so a draft saved before the flag resumes on them (`stepsFor()` never lists them when the flag is on). The two specs that drove the old screen (`exterior-quick-look`, `exterior-batch-15sep`), the UI-refresh S5 outside block and the baseline's outside journey are rewritten to the new screens, each retired assertion named with its ruling in the S6 PR and the ledger; `docs/help/estimator/customer.md` and `staff.md` describe the new path and what the estimator receives; the "after" screenshots of the whole path sit beside the "before" set in the S0 worktree. Production turns it on when Tom sets the variable on Vercel (⚑ 17); until then production runs the old screens and the old specs' skips do not apply there.

**Invoice date and due date on every invoice (20 Oct 2026 — Tom).** No migration; `issued_on` / `due_on` were already stamped by `invoice_issue`. The customer sheet (`app/i/[token]/InvoiceSheet.tsx`, whose Chromium print is the PDF) kept the due date only while the invoice was open; it now shows Issued and Due on every non-draft invoice, paid included. The staff invoice page (`app/invoicing/inv/[id]/InvoiceDoc.tsx`) gained an Issued row beside Due. The Payments job panel's invoice cards (`JobPanel.tsx`, `issuedOn` added to `PanelInvoice` in `panelData.ts`) carry "Invoice date … · Due …" under the number (`invoice-dates`), and the meta line no longer repeats the due date. Proven on a paid invoice in `e2e/invoicing.spec.ts`. Help: `docs/help/invoicing/staff.md`, `customer.md`.
**Exterior wizard v2 — S7, Lighthouse on the new screens (20 Oct 2026).** Measured as an anonymous customer on the C1 build (Lighthouse 13.5 mobile, three runs, median), each step reached by driving the wizard there and reloading — the resume restores it, so the reloaded screen is what scores; a converted draft does not resume, so the range has timespan/snapshot numbers, not a score (`docs/briefs/exterior-v2-progress.md`, "Lighthouse (S7)"). Two changes. (1) A RESUMED step is a landing step: `WizardApp` raises `resumeLandingRef` in the restore and the landing-step logic marks the restored screen `.wz-landing`, so it paints still instead of rising in 0.45 s later (Chrome timed the largest paint to the end of that fade); every step after it still rises. (2) The screens after the questions — `Reveal`, `ExteriorWalk`, `CustomerResult`, `TalkSheet`, `BriefDone` and the six commercial screens in `QuickLook` — are `next/dynamic`, prefetched a moment after the customer is on a step that leads to them, so `/estimate`'s first load no longer carries them (first screen 93 → 98; the reloaded question steps 85–86 → 87–88). `Elevation` and `TypeThumb` memoise their markup on their inputs. Both first-paint conditions are pinned in `e2e/customer-journey/first-paint.spec.ts`. The reloaded steps stop at 87–88 because Lantern charges a hydration-rendered paint every first-load script (react-dom 71 KB, zod 4 classic 64 KB, the session chunk 60 KB on mount, the wizard ~85 KB gzipped); the three levers that would move them — zod/mini on the client, the anonymous session connected after the restored paint, server-rendering the resumed step — are behaviour or contract changes recorded in the ledger for Tom.

**12 Demo Street never has a quality check (20 Oct 2026 — Tom: the walk-through did not come up after the last tick).** `wo_schedule_qa` books a final quality check at accept for a new painter (`qa_mode first_jobs`) or every job (`every_job`), and did so on the practice job; `wo_contractor_confirm_prep` then routed the finished demo to the `qa` stage to wait for the office, and a passed check would have had the office sign it off with no walk-through at all — which is the whole of Module 9. `20270281000000_demo_no_quality_check.sql` re-creates `wo_schedule_qa` (from 20270228) with one early return for `is_demo` and deletes every check already booked on a practice job; a practice job already at the `qa` stage has nothing to route it on and is reset from the banner. Proven in `e2e/demo-robots.spec.ts`: the painter is put on `every_job` for the run and the accept books no check, so M9 reaches the walk-through. Manual test: as a contractor on every_job, Reset demo → accept → tick every surface → after photo → Start the walkthrough → the customer walks.

**Exterior wizard v2 — S8, the switch is the code (21 Oct 2026).** `lib/wizard/ui-flags.ts exteriorV2On()` is now true by default and false only when `NEXT_PUBLIC_EXTERIOR_V2=0`, so the drawn-house outside path (S0–S6) is what production serves from this merge, with no Vercel variable to set. Tom's ruling on ⚑ 17: the variable was never set on Vercel and staff kept seeing the old tick-box outside screen from "Start with the wizard", which takes the same customer-mode `/estimate` path as a customer; "merge into the current exterior section" means the default flips in code. `=0` is a one-release off switch that pairs with the old `outside`/`sides` screens still in `QUICK_LOOK_STEPS` for resume; both leave together in the parking-lot clean-up. The ten exterior specs skip on `=== "0"` instead of `!== "1"`; `exterior-v2-home.test.ts` pins the default. Manual test: production, signed in as staff, Estimates → New → Start with the wizard → Outside → Continue past the address → "What kind of home is it?".

**CI e2e completes for merged work (21 Oct 2026).** Since 20 Sep a push to main skipped the e2e job for every commit whose message began "Merge pull request #", on the theory that the PR's run had tested the tree; but a merge fires the `closed` event that cancels the PR's run, every PR here is merged within minutes, and from 13 Oct no e2e run completed in CI at all — a suite-wide red hid for a week. `.github/workflows/ci.yml` now has a `main-proof` job (seconds, no lock, built-in token, `scripts/ci/pr-e2e-proof.mjs`, pinned by `lib/ci/pr-e2e-proof.test.ts`) that earns the skip from four API answers, each fail-closed: the pushed commit has two parents, main's old tip is an ancestor of the PR head (so the merge tree is the tree the PR run built), a pull_request run into main on that head concluded success, and its "e2e (test project)" *job* concluded success (the `closed` run reports success with every job skipped). Anything short of that runs e2e on main, in the same constant `e2e-test-project` group, so it queues behind an in-flight run and never races it; pull_request and dispatch runs are unchanged. The second half is the run lock: a cancelled runner is killed with its Postgres session still holding the advisory lock for ~2 h of TCP keepalive, and no `if: cancelled()` step can release it, so `lockHolderName` now stamps `GITHUB_RUN_ID` into `application_name` (`pg-e2e-lock:e2e:ci:run-<id>:<time>`, both twins) and `e2e/run-lock.ts isStaleCiHolder` asks GitHub's public run endpoint, read-only, whether that run is `completed`; only then does the refused run end the dead session (`pg_terminate_backend`, same role) and take the lock. A holder with no run id, a local holder, a run still in progress, a 404, a rate limit or a network error all refuse exactly as before. The first main run after this merges is the proof.

**Exterior wizard v2 — S9, Tom's six on the live drawn house (21 Oct 2026).** The picture (`app/wizard/pictures/Elevation.tsx`) now has TWO scales: `sx` across (250 px at 10 m plus 5.5 px a metre, inside 150–316, or 280 with a neighbour drawn) and `sy` up (the shape's wall plus its tallest roof fit the frame, the same on every side and at every size) — so a bigger size draws a wider house instead of a smaller one, the long sides are no longer squashed, and every opening keeps a readable size. Windows are laid out in the wall either side of the front door and clear of a garage (a wall too small for that spreads them anyway rather than losing one), so the count always fits; the door keeps clear of a garage too. A `Gable ends` tick on a hip, skillion or parapet shape lands on the FRONT (`defaultSidesForPart`), where it draws as a cross gable and prices as one — it used to land nowhere. The window and door − / + steppers moved from the walk-around into `SidePartsAndWalls` (`ExteriorSides.tsx`, shared with `ExteriorWalk.tsx`), so Each side has them and the guide range reads them. There is no "Looks right — next side" tap: moving off a side confirms it (`confirmSide` on the tile jump, the tile ticks) and Continue confirms every painted side (`confirmAllSides` in `WizardApp`), replacing the refusal; `allSidesConfirmed` stays for the walk. Pinned by `lib/wizard/exterior-v2-picture.test.ts` (gable on a hip front; wall height equal across sizes and sides; nine windows and a door inside a bungalow's front with no overlap; counts; confirm-all) and the rewritten third test of `exterior-v2-sides.spec.ts`; the other specs' confirm loops are gone. Manual test: Outside → weatherboard home → tick walls + gable + windows + doors → the front shows a gable; About how big → Very large: the house gets wider, not smaller; Each side → Right: the wall is as tall as the front; + on windows: they appear inside the wall; tap Back then Continue with nothing else — the range screen.

**The subcontractor agreement in the portal (21 Oct 2026 — contractor-agreement brief, Steps 1–7).** The Independent Contractor Agreement is data: `docs/agreements/subcontractor-agreement-v1.md` (the corrected docx of 21 Oct, beside it in `source/`, converted clause by clause with explicit numbering and `{{contractor.abn}}`-style merge tokens; `lib/agreements/source.ts` parses it into blocks and lifts the schedules out; `source.test.ts` pins the wording by SHA-256, so a changed word is a new file and a new version; `scripts/seed-agreement.ts` loads `agreement_versions`, 20270284, and refuses to rewrite a version anyone has signed). **One renderer** — `lib/agreements/render.ts` — draws the portal page and the PDF from the same blocks and values; the preview marks the signing-time fields as slots and throws on any other blank, and `wordingHash` (the preview's SHA-256) travels with the submit so the sign action refuses a document that changed under the contractor. **One signed row per contractor** — `contractor_agreements` (20270285: snapshot `merged`, signature path, IP, user agent, `body_sha256`, countersignature, `commencement_on` / `expires_on`), written only by `agreement_sign` (the contractor's session; profile checked, idempotent per version, countersigned in the same transaction, a renewal supersedes), `agreement_upload` (staff; a paper copy, source `uploaded`) and `agreement_attach_pdf` (once, like invoices); `contractor_doc_kind` gains `agreement` and the document row points at the agreement row. **The gate** is `agreement_gate_of` — ok | agreement_unsigned | agreement_expired, mirrored word for word by `agreementGateOf` in `lib/agreements/status.ts` — read by `send_offer` and the `booking_offers` trigger (20270286) after the induction gate and nowhere else; `contractors.agreement_kind` is `existing` for everyone on the books when 20270285 ran (offers flow until `agreement_request` starts the grace window, `settings.agreement_rules.graceDays`, ruling 14 pending) and `new` otherwise; `agreement_requested_at` is Schedule D for an existing contractor (ruling 5), the accepted invite's date for a new one, and `agreement_next_term_of` gives both the RPC and the screens the same Schedule D and M. Screens read `agreement_status` / `agreement_statuses`: `/portal/agreement` (read, tick, `SignaturePad`, Sign; signed → their copy with Download through the session-scoped `pdf/route.ts`, another contractor's id a 404), the Profile card, the Home action tile, the Contractors list line with Request signature, the record page's section with Add signed agreement (`uploadAgreementAction`, `checkUpload`, `<cid>/agreements/upload-<uuid>`), the `Agreement not signed` tag on `contractorsView` and the dashboard metric, and the `agreement_unsigned` / `agreement_expiring` work items (`buildAgreementItems`, never stored). `lib/agreements/pdf.ts` renders once from the snapshot with the drawn PNG and the company signature from private storage (`contractor-docs/company/signature-tom.png`; typed text until it exists) and `notify.ts` emails the copy to the contractor and the office (registry `contractor_agreement_signed`, `office_agreement_signed`, `contractor_agreement_request`). Proven by `e2e/agreement.spec.ts` (a fresh contractor on a phone-sized flow; one row, one document, the PDF within 30 s, idempotency, RLS through contractor, staff, customer and anon; the office asking, the gate biting in the RPC and the trigger, the paper upload). Open rulings carried in the brief: 3 (address), 4 (Key Personnel), 7 (GST line), 8 (entity type), 9 (legal check), 11 (who scans the paper copies), 12 (re-sign on a material change), 13 (Attachment B), 14 (grace length). Manual test: `docs/testing/subcontractor-agreement-manual.md`.


**The walkthrough goes ahead before the quality check (21 Oct 2026 — Tom: book the final walkthrough even if a quality check is required; if it has not passed, still let the contractor start the walkthrough).** `20270284000000_walkthrough_before_quality_check.sql` changes three rules and nothing else: `wo_book_walkthrough` no longer answers `qa_first` (a final is booked whenever it is agreed with the client; the check follows it by the 20270247 trigger); `wo_gate_blocked`'s open-check arm now holds only the move straight to `closed` from `completion_prep` / `qa` (the no-walkthrough path), not the move to `walkthrough`; and `wo_start_walkthrough_mode` accepts a job parked at `qa` — it calls `wo_deliver_evidence_pack` (stage to walkthrough, sign-off row, customer token) and records `walkthrough_before_qa` before minting the two-hour session. The finish still routes an open-check job to `qa` (the office keeps its lane, card and `qa_check_to_book` strip), the check stays open and is logged as before (a pass on a job already walking routes nothing, `wo_qa_route_passed` is `ok:0` off the qa stage), and a PASSED check is still the office's sign-off (`staffSignsOff`). The painter's job page (`app/portal/jobs/[id]/page.tsx`) computes `walkBeforeQa` (stage qa, walkthrough required, no pass yet) and then shows the pinned `WalkthroughBar` at phase walkthrough with `qaOpen`, the `WalkthroughStart` card, and a notice that says the check does not hold them up. Proof: `e2e/wo-walkthrough-before-qa.spec.ts`; `wo-qa-ruling`, `wo-qa-recheck` and `wo-walkthrough-rebook` updated to the new rule; `lib/workorder/walkthroughBeforeQa.test.ts` pins the migration.

**Exterior wizard v2 — S10, Tom's fourteen (21 Oct 2026).** The picture (`Elevation.tsx`): under a verandah the ground-floor windows are laid out in the bays between the posts, never the door's bay, so posts and windows are spaced together; a weatherboard home's typical is `verandah: "none"` (migration `20270287` says the same to `exterior_typicals`) so no porch or posts draw until the verandah is ticked; shutters are a pair a window, flush with each frame. The talk-it-through card (`TalkCard.tsx`) floats bottom-right on every wizard page — the card on a laptop, a "Talk it through?" pill above the Continue bar on a phone (`ql-talk-toggle`). **Which sides are we painting?** is asked on About it (`ExteriorAbout.tsx`, `setSidePaint`); Each side shows a tile only for a ticked side, looking at a side confirms it (`confirmSide` in an effect), and Continue refuses until every ticked side has been seen. **Tighten my price opens the customer editor on every path** (`WizardApp` `onTighten`): the walk-around step (`ExteriorWalk.tsx`, `walking`) is retired and unreachable, kept one release with the v1 screens; the band after Tighten is the editor's own confirm loop. In the editor (`SidesEditor.tsx`): "A few questions first" glows (`sd-glow` on `.sd-card[data-side="cond"]:not(.done)`) until answered; the three paintwork chips carry a swatch (`CondArt`); the access question is asked after the paintwork and the rot (nothing pre-fills it); under a side's windows the sizes are in words and `+ Add a different sized window` (`side-add-window-<key>`) is in plain sight. `lib/wizard/sides.ts applySideDims` / `mirrorDims` now run `followSideLength`: a fascia, gutter or eaves line whose metres equalled the old width (and was not typed by the customer) takes the new one. Pinned by `lib/wizard/exterior-v2-batch-21oct.test.ts` and the rewritten `exterior-v2-tighten.spec.ts`. Manual test: Outside → Weatherboard home: no porch; tick verandah + posts + 6 windows: windows sit between the posts; tick shutters: a pair on each window; About it → untick the right side → Each side has three tiles, Continue refused until each is seen; the range → Tighten my price → the editor, the questions card glowing, paintwork → rot → access all asked; type 10 m on the front → its fascias read 10 m; confirm every side → the range within a few percent.

**The walkthrough goes ahead before the quality check (21 Oct 2026 — Tom: book the final walkthrough even if a quality check is required; if it has not passed, still let the contractor start the walkthrough).** `20270284000000_walkthrough_before_quality_check.sql` changes three rules and nothing else: `wo_book_walkthrough` no longer answers `qa_first` (a final is booked whenever it is agreed with the client; the check follows it by the 20270247 trigger); `wo_gate_blocked`'s open-check arm now holds only the move straight to `closed` from `completion_prep` / `qa` (the no-walkthrough path), not the move to `walkthrough`; and `wo_start_walkthrough_mode` accepts a job parked at `qa` — it calls `wo_deliver_evidence_pack` (stage to walkthrough, sign-off row, customer token) and records `walkthrough_before_qa` before minting the two-hour session. The finish still routes an open-check job to `qa` (the office keeps its lane, card and `qa_check_to_book` strip), the check stays open and is logged as before (a pass on a job already walking routes nothing, `wo_qa_route_passed` is `ok:0` off the qa stage), and a PASSED check is still the office's sign-off (`staffSignsOff`). The painter's job page (`app/portal/jobs/[id]/page.tsx`) computes `walkBeforeQa` (stage qa, walkthrough required, no pass yet) and then shows the pinned `WalkthroughBar` at phase walkthrough with `qaOpen`, the `WalkthroughStart` card, and a notice that says the check does not hold them up. Proof: `e2e/wo-walkthrough-before-qa.spec.ts`; `wo-qa-ruling`, `wo-qa-recheck` and `wo-walkthrough-rebook` updated to the new rule; `lib/workorder/walkthroughBeforeQa.test.ts` pins the migration.

## Customer update in sections (21 Oct 2026)

Tom: "the messages still aren't clearer". `composeUpdate` in `lib/workorder/updates.ts` now writes blank-line-separated blocks — greeting line, *Here is today's progress (<Melbourne long date>):*, **Finished today** bullets (one per area, `plainSurface()` turns tick labels into words: *Windows × 3* → *3 windows*, *Walls — weatherboard* → *walls (weatherboard)*), **Prepped and ready for paint** bullets, a photos line, a fixed sign-off. A section the day did not earn is omitted. `smsSummary(text)` is the text-message form (greeting + bullets flattened to one line, sign-off dropped, 240 chars) and replaces the 180-char slice in `sendUpdate.ts`; the email already rendered `white-space:pre-line`. Line breaks now also render on the Updates card (`.pc .draft`), the job page's latest-update box, and the customer portal timeline (`JobTimeline.tsx`); the card no longer appends "Photos attached (N)" when the text already names its photos. No migration. Units: `lib/workorder/updates.test.ts`; e2e `e2e/wo-updates.spec.ts`.

**Paint on every substrate, no hours on the painter's sheet (21 Oct 2026 — Tom: "add the paint for each substrate in the work orders for the contractors — currently it is only something we see, not them"; "remove the estimated hours from the work order, so they can just see and tick off the list of tasks").** No migration and no new data: the frozen `WOSurface` already carried `product`, `finish` and the resolved colour, and the sheet printed only the bare product in the small-print. `lib/workorder/surfacePaint.ts paintLabel()` is the one phrase — "product · sheen · colour", or "Colour to be confirmed" in the Materials section's own words, null for a line with no paint — and `app/w/WorkOrderDoc.tsx` draws it with the swatch under every surface name (`surf-paint-<key>`) on every variant, and under each row of Materials & colours the substrates it goes on (`mat-substrates-<rowKey>`, from the existing `substratesFor`, the same pairing the PC Materials card shows). `lib/workorder/crew.ts` now whitelists `finish` on a surface and `finish` + `colourKey` on a material so the crew's copy reads the same. **Hours are office-only:** the renderer computes `office = Boolean(edit)`, and only the builder's work-order view (the one caller that passes `edit`) still shows the Estimated hours fact, the per-surface Hours column with its "incl. prep", the Condition extra-prep line and the "~N h" on an approved change; the contractor token page, the portal job page (contractor and employee), the crew link and the staff "Painter's view" all render as the painter does. The tape-check line still reads `estimatedHours(doc)` against the Settings threshold, so the data stays on the document — nothing was stripped from the snapshot, the crew doc or any RPC. The offer card's **Calculated labour hours** (Requests) is untouched: that is the offer, not the work order. Proof: `e2e/wo-paint-per-substrate-no-hours.spec.ts` (anonymous painter by token: paint lines, substrate chips, no hours anywhere in the response); `airtable-import` and `offer-accept` updated from "sees the hours" to "sees no hours"; `condition-hours-golden` still proves the builder's view shows them. Manual test: `docs/manual-tests/wo-paint-no-hours-21oct.md`.

**Hours leave the CREW's copy only (21 Oct 2026, later the same day — Tom: "confirming that the subcontractors can still see the hours, it is just the painters they share it with that can't").** The gate in `app/w/WorkOrderDoc.tsx` is `showHours = variant !== "crew"`, replacing #343's `office = Boolean(edit)`: the contractor's own link (`/w/[token]`), their portal job page, the staff Painter's view, the employee's page and the builder's view all show the Estimated hours fact, the per-surface Hours with "incl. prep", the Condition line and the "~N h" on a change again; the crew link (`/crew/[token]`) and the worker login (`WorkerJob`, variant crew) show none of them. The crew document still carries the hours (`crew.ts` is unchanged) because the tape-check rule reads them. The Requests offer card keeps *Calculated labour hours* — the `fix/offer-card-no-hours` branch (641717e4) was withdrawn unmerged. `e2e/wo-paint-per-substrate-no-hours.spec.ts` now proves both sides from one issued job: every hour on `/w/`, none on `/crew/`; `airtable-import` and `offer-accept` are back to asserting the contractor's hours.

**A "use server" module exports async functions and nothing else (21 Oct 2026).** `app/pc/movements/actions.ts` gained `export const RUN_PURPOSES` in PR #346; dev, typecheck and lint passed, and the production build threw `A "use server" file can only export async functions, found object` at module evaluation — every server action in that server chunk died with it (the crew link, the revision draft, …), which the C1 e2e showed as two unrelated-looking timeouts. PR #348 (another session, the same night) moved the constant to `lib/movements/evaluate.ts` and imported it; this change adds the guard. `lib/next/useServerExports.test.ts` walks every tracked `"use server"` file and fails the unit run on any non-async export.

**A quality check is logged before the painter has finished (22 Oct 2026 — Tom: "so a quality check can be ticked off before all the boxes have been ticked, so we can quality check before a job is finished").** No schema or RPC changed: `wo_record_qa` never tested the stage, the check rows exist from `wo_set_qa_required` / the page's cadence self-heal, a mid-job FAIL's `wo_set_stage(in_progress)` is the no-op it always was, and a job whose checks have all passed already skipped the Quality check lane at `wo_contractor_confirm_prep` (open count 0). The gate was the PC job page, which drew an UNLOGGED card at In progress only when a dated site check or spot check's day had come (`checkInDue`, 8 Oct). `app/pc/wo/[id]/page.tsx` now draws every check from In progress (and the hidden prep stage) with `early` on `QaCheck`, which adds "before the finish" to the heading, a `data-early` attribute and a line saying what a pass or fail means; `recordQa` (`app/pc/actions.ts`) reads the stage and `wo_qa_open_count` after a plain `ok:pass` and says the job will skip the lane when the painter finishes. Proof: `e2e/wo-qa-before-finish.spec.ts` (fail mid-job → rectification on the list, re-check drawn; pass mid-job → still In progress, no pack; finish → `completion_prep>walkthrough`, `wo_staff_signs_off` true). Help: `docs/help/work-orders/pc.md` 13b, `contractor.md` 14a. Manual test: `docs/manual-tests/qa-before-finish-22oct.md`.

**Estimates search filters on the client (23 Oct 2026).** Tom: "the search bar crashes and retypes as you are typing". The box debounced each pause into `router.push(?q=…)`; the App Router keys the page segment by its search params, so every pause swapped the whole page for `app/(app)/loading.tsx` and mounted a NEW box holding the needle from 350 ms earlier — focus lost, the letters typed in between gone. The needle never changed what the page read, only what it kept, so the filter moved to where it belongs: `lib/estimate/search.ts` (`filterEstimateRows` with the estimate-number match, `filterWizardSessions`, `filterWaitingItems`, unit-tested) is applied by the three tab tables (`EstimatesTable`, `WizardSessionsTable`, `WaitingTable`) through `useSearchNeedle()` (`useSearchParams().get("q")`), and `SearchBox.tsx` only writes `?q=` with `history.replaceState`, which Next feeds into `useSearchParams` with no request. A deep link still paints filtered on the server (the same hook runs during SSR of this force-dynamic page); the empty lines (`estimates-search-empty`) moved into the tables; `EstimatesTable` takes `empty` for the no-rows box. Spec `e2e/estimates-search-typing.spec.ts` types one letter every 450 ms and asserts every letter, the focus, the URL and zero page fetches. No migration.

**Paint Home — Session 1, brand plumbing (24 Oct 2026 — `docs/briefs/paint-home.md` §3, §8.1).** Paint Home (painthome.com.au) is a second shopfront on the same business, built as a THIRD audience of the Session 8 mechanism, never a fork: `lib/marketing/audience.ts` gains `painthome`, resolved by hostname (`painthome.com.au`, `www`, and `painthome.localhost` for dev and the e2e — no env, no cookie), whose root the proxy rewrites to the new static route `app/(marketing)/painthome/page.tsx` (same `HomePage`, same thirteen components); `/painthome` on a dev host serves it locally (the Settings preview, C1), anywhere else it 301s to the domain, so the Paint Group hosts never answer for Paint Home and nothing on them changed. `lib/marketing/brand.ts` is the ONE brand record (`brandFor(audience)`: name, tagline, domain, phone, legal line, "powered by", the painter "since" line, accent colour, LocalBusiness `@id` — Paint Home's own under Paint Group's `parentOrganization`), with Settings → Company → **Brands** (`BrandsSettings.tsx` / `brandsActions.ts`, one `settings` row `brands`, `lib/marketing/brandServer.ts getBrand`) as its editable face; the nav, footer, How-it-works phone line, painter cards, reviews credit, metadata (own `metadataBase`, canonical, `PAINTHOME_INDEXABLE` robots — also an `X-Robots-Tag` rule by host in `next.config.ts`), the OG image (`painthome/opengraph-image.tsx`) and favicon (`painthome/icon.tsx`) all read it; `TelLink` takes the number from `AudienceProvider`, which now carries the brand. The mark is `design/reference/paint-home-logo-{dark,light}.svg`, copied as path data into `lib/marketing/paintHomeLogo.ts` (pinned to both files by its test) and drawn inline by `PaintHomeLogo.tsx`. The palette (§1a) is one CSS block, `.mk [data-brand="painthome"]`, laid over the shared tokens (`ink → slate`, `paper → stone`, `warm → sage-pale`, `cyan → teal`, Switzer everywhere, `--brand` = the logo cyan driven by `--brand-primary`); Paint Group's tokens are untouched. On Paint Home: no trade lane, no "For business" link, no business chip, `/work` lists homes only with the Paint Group URL as canonical (⚑ P9), and every wizard hand-off carries `brand=painthome` + `src=painthome_home_hero|cta` (`estimateHref` `brand` option) — the wizard reads it in Session 3. The words are the `home` set (`DEFAULT_COPY.painthome = HOME_COPY`) until Session 2 seeds Paint Home's from the prototype. Tests: `audience.test.ts`, `hosts.test.ts`, `estimateLink.test.ts`, `brand.test.ts`, `paintHomeLogo.test.ts`; `e2e/marketing/painthome.spec.ts` (anonymous, phone: header, brand, no Paint Group links, hand-off; the Paint Group site untouched; Settings → Brands live within a minute). Help `docs/help/paint-home/`. No migration. Tom: add `painthome.com.au` + `www` to the Vercel project.

**Paint Home — Session 2, the words (24 Oct 2026 — `docs/briefs/paint-home.md` §4, §8.2).** The Paint Home copy set is `lib/marketing/copy/painthome.ts`, taken from the prototype (which wins over the brief: the tagline is the H1) and pinned by `painthome.test.ts` — none of "business / commercial / agent / PO / portfolio / trade" outside the big-job answer, "Paint Group" in exactly one string (the end of *Who is Paint Home?*; the nav small print, the reviews credit and the footer make the page's four), no exclamation marks, no slang or system words, every self-typing example under the $12,000 ceiling. `20270299000000_paint_home_content.sql` admits `painthome` to `site_content.audience`, adds `showcase_jobs.featured_rank_painthome` (one holder per rank, cleared in `lib/showcase/actions.ts` like the business rank) and seeds the 117 rows (`scripts/gen-site-content-seed.ts painthome`). The schema (`copy/schema.ts`) gained `hero.chip_interior/chip_exterior`, `estimator_examples.example_4_*` and `example_N_scope`, `reviews.lead`, `faq.q_9/a_9/q_10/a_10`; `missingKeys(copy, audience)` takes per-audience optional keys (Paint Home has no trade lane, other-site link, mode chips or reviews fallback; the other two have no scope chips). On Paint Home the hero's chips are a SCOPE — `AddressField chips="scope"` (Inside / Outside, events `scope_interior` / `scope_exterior`, the ghost lights the example's scope) and `onSubmit(address, mode, scope)`; the hand-off carries `scope=interior|exterior` beside `brand=painthome`. The cards: `rankShowcaseJobs(jobs, "painthome", maxHighCents)` — home jobs with a price at or under `wizard_policy.remoteConfirmCapCents` (read in `HomePage` through `getSettingValue`), by `featured_rank_painthome` then newest, never commercial; the Showcase editor has the third rank. Settings → Website copy has the Paint Home tab (`SiteCopyEditor` takes a partial map; preview `/painthome`); the FAQ renders up to ten entries and the FAQPage JSON-LD follows; the marketing 404 (`not-found.tsx`) reads the audience and renders the request's brand. Spec `e2e/marketing/painthome.spec.ts` (five journeys: words + four mentions + scope hand-off; the Paint Group site untouched + a Paint Home 404; Brands; the ceiling on the cards; the Paint Home copy tab). Help `docs/help/paint-home/` updated. Tom pastes `20270299`.

**Paint Home — Session 3, the wizard brand branch (24 Oct 2026 — `docs/briefs/paint-home.md` §5, §8.3).** ONE wizard, two doors shut. `lib/wizard/brand.ts` is the pure branch: `WizardBrand` (`paintgroup | painthome`), `propertyKindsFor` / `jobTypesFor` (Paint Home: no commercial kind, no "both" — ⚑ P6, two estimates) and `allowedForBrand` (a shut door is refused however it arrived: seed, resume, URL), `paintHomeTier` (the phone-close tier: `call` when the top of the range is at or under `wizard_policy.remoteConfirmCapCents` — ⚑ P7 — with no must-see guardrail reason and no `requires_site_check`; otherwise `visit`), `paintHomeEstimatorIntro` ("Sarah, who'll be checking your price.") and `PAINT_HOME_WORDS`; `brand.test.ts` is the route test — no `com_*` / `segment` / `both` step is reachable from any Paint Home answer. The brand is decided on the server (`lib/wizard/brandServer.ts wizardBrand`: the request's audience — the wizard is served under painthome.com.au, ⚑ P5 — or `?brand=painthome`; `wizardTitle` puts the brand's name in every `/estimate/*` title), parsed by `parseEstimateIntent` (`brand`; a business mode on a Paint Home hand-off is refused), handed to `WizardApp` as a prop and written ONCE onto the wizard STATE (`state.brand`, like `gateVersion`), so it autosaves, resumes and submits with everything else: the draft route writes `wizard_drafts.brand`, the submit route writes `estimates.brand` and decides the tier (`paintHome: { tier, capCents }` on the payload, from the same `decision`, `policy` and `siteCheck` the guardrails used). `20270300000000_paint_home_brand.sql`: `brand` on `wizard_drafts`, `estimates`, `work_orders`, `invoices` (default `paintgroup`, check), partial indexes, and `brand_carry_from_estimate()` triggers so a work order and an invoice inherit their estimate's brand on insert — no screen writes those two. Screens: `QuickLook` renders `jobTypesFor` / `propertyKindsFor` and the gate's opt-in names the brand; `Wordmark` draws the Paint Home mark; `WizardHeader` labels the call button with the brand; `Reveal` on the `call` tier shows ONE hero door, `door-call` "Confirm my price. Book a call" (→ the existing request-a-call sheet) with Tighten and Send a message beside it, no site-visit or Speak-with-us door, and "Then one call." in the ladder; on the `visit` tier the doors are replaced by the hand-off (`painthome-handoff`: "This one's bigger than we can price from your phone." + "You'll hear from the Paint Group team" — the first and only Paint Group mention in the wizard) with `door-book` → `/estimate/visit`, answers intact on the estimate. The sent page introduces the estimator with `paintHomeEstimatorIntro` on Paint Home. Spec `e2e/marketing/painthome-wizard.spec.ts` (phone, anonymous: Inside → the wizard on the Paint Home host, shut doors, the price, the call door, brand on the session and estimate; the ceiling lowered → the hand-off → the visit page; the Paint Group wizard unchanged). Tom pastes `20270300`.

**Paint Home — Session 4, comms and portal (24 Oct 2026 — `docs/briefs/paint-home.md` §5 lead and account data, §8.4).** ONE brand parameter for the messaging adapter, never a second template set: `lib/messaging/brand.ts` — `messageBrandOf(row.brand)`, `companyForBrand(company, brand)` (Paint Home replaces the name, the phone and every logo field with the mark the app serves itself at `/painthome/email-logo.png` — `app/(marketing)/painthome/email-logo.png/route.tsx`, a PNG with its own slate background so dark-mode mail clients cannot invert it; the estimator, the email and the address stay the company's), `fromForBrand` (the verified mailbox with the brand's display name — a Paint Home sender domain is ⚑ for Tom to verify in Resend; `sendEmail` gained `from`), `publicOriginFor` (links start at painthome.com.au, where the whole app answers — ⚑ P5) and `entityForBrand` (the invoicing entity trades as Paint Home with *Enlvn Pty Ltd trading as Paint Home*; ABN, address and bank kept). The send sites read the row's `brand` column (20270300) and pass through it: the estimate email/SMS (`app/quote/actions.ts deliver`), the invoice email/SMS and the payment receipt (`lib/invoicing/sendInvoice.ts`; `buildInvoiceEmailHtml` takes `logoUrl`), the receipt PDF (`lib/invoicing/pdf.ts`), the booking confirmation (`lib/workorder/appointmentEmail.ts`), the walk-through invite (`lib/workorder/walkthroughInvite.ts`), the welcome (`lib/estimate/acceptedNotify.ts sendCustomerWelcome`). Customer pages: `/i/[token]` lays `entityForBrand` over the RPC's entity (the page is the PDF), `/e/[token]` lays the brand's name, phone and mark over the sent snapshot's company block at render (`lib/estimate/brandByToken.ts`, one service read; the snapshot itself is never rewritten) and its tab title follows. Portal (⚑ P8, shared accounts): `PortalEstimate.brand`, `portalBrandOf(estimates)` in `lib/portal/data.ts` — every estimate Paint Home → the Paint Home mark and number in the header (`data-brand` on the shell); mixed → Paint Group's header and a `job-brand` tag on each Paint Home job. Staff and contractor messages are untouched (the brief: never). Unit `lib/messaging/brand.test.ts`; spec `e2e/marketing/painthome-comms.spec.ts` (a Paint Home estimate's /e page on either host, the portal header for a Paint Home-only account, the tag once a Paint Group job joins). No migration.

**Paint Home — Session 5, the staff side (24 Oct 2026 — `docs/briefs/paint-home.md` §6, §8.5).** One pill, one filter, no separate views. `lib/brand/filter.ts` (`parseBrandFilter(?brand=)`, `matchesBrand(row.brand, filter)` — a missing brand is Paint Group — and `brandPillLabel`, which tags Paint Home rows only) and `app/components/BrandPill.tsx` (`BrandPill`, `BrandFilterChips` All · Paint Group · Paint Home, each host passing its own chip class) are the whole vocabulary. Wired in: **Estimates** (`LIST_SELECT` + `ListRow.brand`; the rows are narrowed before anything is derived; chips at the right of the status tabs and carried on every tab href; the Wizard tab's `WIZARD_SESSION_COLUMNS` + `WizardJourney.brand`, `.eq("brand")` on its query, Paint Group / Paint Home chips beside Home / Business, the pill in `WizardSessionsTable`), **CRM Today** (`lib/crm/itemBrands.ts brandsForItems`: work items stay derived and unstored, so the brand is read ALONGSIDE by subject — four `.in()` reads keyed by item key; `?brand=` narrows the scoped items; the pill after the title), **PC Command → Flow** (`consoleData` selects `work_orders.brand`; `?brand=` narrows each lane at render while the evaluator still runs over every job; the pill in the card's flag row), **Invoicing** (`jobMoneyData` selects `estimates.brand` → `JobMoneyJob.brand` → `JobMoneyRow.brand`; `?brand=` in `Params`/`current`; chips beside Show paid; the pill beside the address), **Dashboard** (`FunnelSlice.drafts.brand` from `wizard_drafts.brand`; `funnelRows` / `buildFunnel(input, range, brand?)` and `hasPaintHomeSessions`; `/home` draws *Where estimates go* twice, Paint Group then Paint Home, once Paint Home has sessions in the range; `marketing.ts byBrand` "By shopfront": started, saved, sent, accepted, calls requested (`range_option = speak`), visits booked (`visit`), per brand — page visits / `address_typed` / `see_price` join it when the website `events` table (already audience-stamped) is wired in at launch). Tests: `lib/brand/filter.test.ts`, `lib/reporting/metrics/brand.test.ts`; spec `e2e/marketing/painthome-staff.spec.ts` (a Paint Home and a Paint Group estimate: the pill, the three filters, the brand carried across the status tabs; the dashboard row). Settings → Brands / Website tab / Showcase rank landed in Sessions 1–2. No migration.
**Work order UX — Step 1, the By surface view (24 Oct 2026 — `docs/briefs/claude-code-brief-work-order-ux.md` §4.1, mockup `docs/mockups/work-order-ux-mockup.html`).** The painter's tick list (`app/components/wo/TickList.tsx`, the ONE component the portal, the worker screen, the console job page and its *as the painter* mirror all render) now opens **By surface**: one row per customer surface group present on the job with *n of N*, a two-colour bar and **Mark all prepped / Mark all painted**; **By room** is the list as it was, one tap away, remembered per browser (`localStorage`, never a setting). Which group a `wo_surfaces` row belongs to is decided in ONE place, Postgres: `wo_surface_groups_assign(wo)` (20270300) reads the frozen job sheet — the line's rate code, else its label as a code, else as a surface name, the three shared window codes told apart by the area's side — through `standards_surface_codes → standards_surfaces.key → surface_group_keys → surface_groups`, and stores `wo_surfaces.group_code`; `wo_seed_surfaces` calls it after every seed and the migration backfilled every open job. Nothing in TypeScript computes a group: `lib/workorder/surfaceGroups.ts` reads the column, holds the labels and wording, and `surfaceGroups.test.ts` pins both tables to the migration text. A bulk tap is `wo_tick_surface_group(wo, group, to)`: the single tick's actor rules and job-level photo gate (one gated room fails the whole call, nothing written), R3 (`done` refused while any room is `todo`), R5 (rooms at or past the target skipped), then per moved row the SAME `wo_surfaces` update and the SAME `surface_tick` event (meta gains `bulk_event_id`) plus one `surface_group_ticked` parent with the child ids; `all_surfaces_done` once, as before. `wo_untick_bulk(parent)` — 60 s, same user — puts those rows back where the tap found them, writing the by-hand reverse `surface_tick` per row (`undo_of`) and one `surface_group_untick`; the reminder moment the tap answered stays answered, and events are never deleted. The screen's Undo shows for six seconds. The painter reminder texts (`contractorJobUpdateSms`, `…Sms2`, `…Sms3`, `…MorningSms` defaults) end with *Tap By surface to update the whole job in one go.* E2e `e2e/wo-ticks-by-surface.spec.ts` as the painter (phone, dark and light) and as PC in the mirror, including the golden comparison of a bulk tap against three single ticks.

**Work order UX — Step 2, the Customer updates queue (24 Oct 2026 — brief §4.2–4.3, Step 0 report M2/M3/M8/M9).** The queue IS `wo_updates` (20270301): the row gains `kind` (`end_of_day | surface_milestone | checkin_40 | defect_day`), `milestones`, `source_event_ids`, `sent_by` and `sender_name`; the (job, day) unique becomes partial on `end_of_day`, so a milestone and the summary share a day; drafts are readable by staff only (`wo_updates_read` adds `status = 'sent'` for everyone else, proven in the customer role). ONE draft pass, `lib/workorder/draftFromTicks.ts draftUpdateForWorkOrder`, runs after every tick, bulk tick and undo and from the wo-sweep backstop: it writes the day's END-OF-DAY draft — rolled up by surface group (`lib/workorder/milestones.ts composeEndOfDay`) where the rows carry `group_code`, else the old per-area composer — and raises a SURFACE MILESTONE through `wo_draft_milestone` when a group has just reached 100% prepped or painted (`groupStandings → milestonesNow → newMilestones` against every milestone row and every `update_dismissed` event), bundled into an open draft younger than `bundle_minutes`, refused by `wo_customer_updates_allowed` on a job not in progress / completion prep, paused (`blocked_reason`), in rectification or signed off. Wording is messaging settings under registry key `customer_updates_queue` (Settings → Automations), and that automation's approve/auto MODE is the one switch at the top of `/pc/updates` (`AutoSendSwitch` → `setCustomerUpdatesAutoSend`), default office-approves-first (R7, M2) — not a second setting. On, `lib/automations/sweeps/customerUpdates.ts` (half-hour campaign sweep, `?only=updates`) approves and sends as the system (`wo_approve_update` / `wo_send_update` accept `wo_is_system()`) inside sending hours: milestones after the window, the summary from 16:00 and skipped on a day a milestone went (⚑2). The sender (`customerUpdatesSender`, else the Company profile's coordinator) is stamped on the row at send and read on the customer timeline as the item title "Felipe, Paint Group" with the greeting stripped (`lib/portal/timeline.ts stripGreeting`); the timeline's one reply control is relabelled "Reply to Felipe" (R13). `UpdateCard` shows the kind, the recipient and the sender and says Send to timeline / Edit / Drop. E2e `e2e/wo-customer-updates.spec.ts`.

**Paint Home — Session 6, launch (24 Oct 2026 — `docs/briefs/paint-home.md` §7, §8.6).** `app/robots.txt/route.ts` is a robots file per site, by host (like the sitemap): Paint Home follows `PAINTHOME_INDEXABLE`, Paint Group `SITE_INDEXABLE`, each naming only its own sitemap, the platform host never indexed. `app/sitemap.xml/route.ts` on the Paint Home host lists `/` and `/work` only — a job page's canonical is the Paint Group URL (⚑ P9), so Paint Home never offers one. Clarity: `lib/marketing/clarity.ts clarityIdFor(audience)` — `NEXT_PUBLIC_CLARITY_ID_PAINTHOME` for Paint Home, read from `<html data-audience>`; unset means Paint Home records nothing, and the tag still loads only after "Allow analytics". The dashboard's By shopfront row (`mk.by_brand`) now reads the website's own events: `FunnelSlice.web` (crm_events `web_event`, newest 10,000 in the window, the payload's name / audience / visitor id) gives visits (distinct visitor ids), address typed and see price per brand beside the session numbers. `docs/testing/paint-home-launch.md` is Tom's order of operations, the 90-second phone walk and the flip. Spec `e2e/marketing/painthome-launch.spec.ts` (robots and sitemap per host). No migration.
**Work order UX — Step 3, the 40% check-in and the defect-day note (24 Oct 2026 — brief §4.3 Triggers B and C, Step 0 report M1 default).** Two more kinds on the Customer updates queue, both TIMELINE ONLY (R10; and the defect-day note sits beside the existing `customer_defect_tape` text, which is untouched — the M1 default until Tom rules on 7:30 vs 9:00 and the size floor). The days are the one planner's: `lib/workorder/jobRhythm.ts customerCheckinDay(days, pct, minDays)` (the first morning at or past `pct` of booked days — 3 → day 3, 5 → day 3, 7 → day 4, 10 → day 5; null under `minDays`) and `customerDefectDay(days)` (the defect-tape day on 3+ day jobs, the last day on shorter ones — every job, R11). `runCustomerNoteTriggers` (half-hour campaign sweep, `?only=updates`, before the auto-send) reads every job under way with dates, computes the days off `work_orders.start_date/end_date` and the painter's work week, and from `customerCheckinTime` (09:00) / `customerDefectDayTime` (07:30) drafts through `wo_draft_note` (20270302): one row per job per kind (partial unique index), refused by `wo_customer_updates_allowed`, `already` on a repeat. `checkin_percent` (40) and `checkin_min_days` (3) are the automation's timing values on Settings → Automations. The auto-send sweep sends both the moment they exist; a person's Send to timeline records them without email or text (`isTimelineOnlyKind`). E2e `e2e/wo-customer-notes.spec.ts`; `lib/automations/sweeps/customerUpdates.test.ts` pins `notesDue` and `dueNow`.

**Paint Home wizard live + exterior 5% under (25 Oct 2026 — Tom).** The public wizard switch is per shopfront: `lib/wizard/publicFlag.ts OnlineEstimates.enabledPaintHome` (default TRUE; a `wizard_public` row written before the field existed reads as live) beside `enabled` (Paint Group), and `wizardOpenFor(online, brand)` is the one question `app/estimate/page.tsx` asks before drawing the holding page; Settings → Online estimates (`OnlineEstimatesSettings.tsx`) has the second switch. Paint Home's doors (no commercial kind, no "both") were shut in Session 3 and are unchanged. The exterior range: `WizardPolicySettings.exteriorUnderPct` (default 5, `wizard_policy`) stretches the LOW end of an exterior range only — `rangeFromTotal(total, pct, underPct)` and `envelopeFor({ underPct })` both subtract it from the low end and leave the top alone; `underPctFor(blocks, policy)` in `lib/wizard/policy.ts` is the one test (an `Exterior` area among the blocks) every caller uses: the submit route (a "both" job's exterior half only), the wizard-edit route, `customer-scope.ts`, the trade portal's `customerRange` and the assistant's `scope-tools.ts`. The staff pack (`pack-load.ts`) keeps the plain band. Nothing that reads the top of the range (phone-close tier, Speak with us, caps) moves. Unit `lib/wizard/policy.test.ts`, `envelope.test.ts`, `publicFlag.test.ts`, the S3 parity test; spec `e2e/marketing/painthome-wizard-live.spec.ts`. No migration.
**Work order UX — the defect day is one message (24 Oct 2026, ruling M1).** The `customer_defect_tape` text (8 Oct) is folded into the Customer updates queue: the `defect_day` row drafted by `runCustomerNoteTriggers` is the defect-tape message — sent by text and email (`deliverCustomerUpdate`) as well as shown on the timeline, on every job, from `customerDefectDayTime`. `TIMELINE_ONLY_KINDS` is the 40% check-in alone. `runDefectTapeSweep` answers `{ superseded: true }` and sends nothing (`DEFECT_TAPE_SUPERSEDED`); its day maths (`customerDefectTapeRungs`) is what `customerDefectDay` reuses, and the registry entry stays with a note so the office sees why its switch does nothing. The second 3:30 pm text on 3–6 day jobs is gone — one message a day.

**Paint Home polish (25 Oct 2026 — Tom's four items).** (1) **Address hand-off carries the pick.** The homepage `AddressField` keeps the resolved pick (`picked`), resolves the top suggestion on submit when nothing was picked, and `estimateHref({ picked })` writes `street / suburb / state / postcode` beside `address`; `parseEstimateIntent` reads them back as `intent.address` (suburb + numeric postcode required, clamped like `clampAddress`), and `WizardApp` seeds `state.address` and the customer suburb/postcode from it. Words with no pick behind them: `useAddressLookup.resolveText` (one autocomplete + details, the one fetch) runs once on the customer start screen via `app/wizard/AddressField autoResolve`. Unit `lib/marketing/{estimateLink,prefill}.test.ts`; spec `e2e/marketing/address-handoff.spec.ts` (receiving side, both hosts). (2) **The hero lights up**: the `.mk [data-brand="painthome"] .hero` block in `marketing.css` — cyan and blush radial glows, the prototype's blurred cyan sweeps, a cyan-edged glowing block, white headline, cyan kicker. CSS only. (3) **Every Estimates row names its shopfront**: `brandPillLabel(brand, always)` / `BrandPill always` — Paint Home in slate-and-cyan, Paint Group in grey, `data-brand` on the pill; Estimates and the Wizard tab pass `always`, every other list keeps the Paint-Home-only pill. (4) **The customer's documents carry the mark**: `/painthome/logo-light.png` (transparent, ink lettering, same path data) is `companyForBrand`'s `logoUrlLight`; the `/e` overlay now replaces `logoUrlLight` too (the card prefers it, so the Paint Group light logo had been winning); `InvoiceSheet` takes `brand` and draws `PaintHomeLogo on="light"` where the PAINT GROUP wordmark sits, from `/i/[token]/page.tsx`'s `invoiceBrand` (the PDF is a print of the sheet). Unit `lib/invoicing/invoiceSheetBrand.test.ts`; the comms spec asserts the mark's src. No migration.
**Settings → Paint Home website (25 Oct 2026 — Tom).** One folder in the Company bucket, `app/(app)/settings/PaintHomeWebsiteSettings.tsx`, after *Website*: the Paint Home hero photo (`website_content.heroPhotoPaintHome`, a new field of `lib/marketing/siteContent.ts`; `HomePage` draws it on the Paint Home audience, falling back to the homes photo; saved by `savePaintHomeHeroAction`, a read-modify-write of that ONE field so the Website folder's whole-row save and this one cannot clobber each other), the Paint Home copy (`SiteCopyEditor` with only the `painthome` set — removed from the *Website copy* folder, which keeps Homes and Businesses), and the project cards (every published home job with its top price, whether it fits `lib/showcase/rank.ts`'s Paint Home rule — priced at or under `wizard_policy.remoteConfirmCapCents` — and an inline rank select written by `lib/showcase/actions.ts setPaintHomeRankAction`, which clears the rank's previous holder as the job editor does, plus links to a new showcase job and the full list). Spec: `e2e/marketing/painthome.spec.ts` test 5 now edits through the folder and proves the Paint Home tab is gone from Website copy. No migration.

**Wizard batch (25 Oct 2026 — Tom's 18 items).** Customer-side only, no new tables. **Quick look:** the place step offers a floorplan upload only (the listing-URL field and "Read the floorplan from this listing" are gone from `WizardApp`'s `planUpload`; the staff page set keeps `listingUrl`); the groups ticked under "Which ones?" paint deep blue in the room picture — `boldPictureSurfaces(quick)` in `lib/wizard/quick-look.ts` → `RoomPicture bold` (`data-bold`, `data-bold-count`, `.s.on.bold`). **The guide range is capped:** `BandSettings.guideMaxSpreadPct` (default 40, `wizard_bands`) and `capSpread()` in `lib/wizard/envelope.ts` pull the envelope's top end down to the low end + 40% ("6000–10000 → 6000–8400"); the low end and the open questions are untouched, and the Detailed range after the tighten is not capped. **The tighten screen asks nothing about dark to light** — the darklight card, the ceilings row and the per-room ceiling tick are gone from `ScopeEditor` (the quick look's answer already lands in `condition.darkToLightSurfaces`; `set_paint_system` stays on the route for staff). **Cupboards:** `applyCupboardDefaults` starts every question as No (robe doors included); `applyCupboardInterior`, `roomLoopViews`, the sweep, the agent's question graph and `scope-tools` no longer gate the walls-inside question on the doors (a No on the doors keeps the interior answer and line; only the inside FACE of the robe doors still follows the doors). **Spots:** `RoomSpots` is one line ("Attach photos of areas that need attention."), no "easier in person" offer, "What is it?" before "How much of it is there?", the tag is a choice and `Add it` sends; a new `other` tag (`OTHER_TAG_KEY`, `SPOT_TAGS`) opens a note box and `spotLine` labels the repair with the customer's words. **Rooms:** the room's name is the rename button (`.sc-name`, same test id); the size question carries the length/width/ceiling boxes prefilled (`RoomLoopView.lengthM/widthM`, `size-length/width/height-*`, `size-ok-*`, `size-save-*`) — no "Adjust it". **Extras:** `jobExtras` prices a timed row at charge-out × hours (`perItemPriceCents`; the sheet used to show the hourly rate), hides Picture Rails (`NOT_ON_THE_SHEET`) and the imported custom-surface row (`add-catalogue.ts isImported`, both sides); the whole-job "Interior - Extras" block is never a room card (`customerScopeRooms` + `isExtrasBlock` — drawn as one, its air vent's + posted a room action and 400'd back to 1, Tom's "crashes on 1"), and a ticked extra carries − / + on the sheet (`toggle_job_extra.count` → `setExtrasItemCount`, `extrasItemCounts` on the bundle and the response). **Sent:** `customerStatusLine` for a requested visit reads "Thanks — your estimator will contact you … if required, organise a site inspection", no name. `20270305000000_wizard_extras_prices_25oct.sql` (data-only): Air Vent $50 (charge-out 20000 × 0.25 h), Mantle $340 (13600 × 2.5 h). Specs: `e2e/customer-journey/tom-batch-25oct.spec.ts` plus the rewritten `dark-to-light`, `room-spots`, `human-moments`, `interior-loop`, `self-sign`, `document-model`, `tighten-c10`, `tom-batch-15sep-evening`. Not reproduced: "it wouldn't give me the option to tighten the price" on a bold job — the Tighten door is drawn on every interior reveal on the test stack.

**Estimator wizard — the old page set is staff-only; the phone pass (25 Oct 2026 — Tom).** A customer on `/estimate` is always on the quick look: `WizardApp`'s `entry` starts as `"questions"` for `mode === "customer"`, the resume effect puts a customer on the quick look whatever the draft says (a draft from the old pages starts it at screen 1 with its answers kept), `chooseEntry` is a no-op for a customer, and the `?entry=upload` door is gone — the three ways a customer used to land on the old five-page set (a pre-quick-look draft resumed by inference, a seeded `prefillState`, the upload door). The page set itself stays for the internal `/wizard` (staff). On a phone (`wizard.css`, the ≤900px block): the talk-it-through bar is a compact pill at the bottom right (`TalkCard.tsx` wraps its words in `.wz-talk-lbl`, visually hidden under 900px — the test ids and accessible names are unchanged), the two-up icon cards stack the icon above the words, the picture band is 170px with every 400×300 / 400×240 drawing scaled to fill it (elevation ×1.24 about the ground line, room ×1.18, plan ×1.1, house ×1.75 from #386), the heading and lead are a notch smaller and Continue has no arrow. Specs: `exterior-v2-home.spec.ts` gained the 390×844 pin test; `openQuickLook` / `openExteriorPages` lost their old-route options and `toSidesEditor` (`exterior-v2-drive.ts`) is the one way to the sides editor; `exterior-path.spec.ts` and `tom-batch-7sep` test 2 are retired with the route. PR body: `docs/pr-bodies/wizard-mobile-pass-old-wizard-shut.md`.

**Movements run plan starts at the first stop (25 Oct 2026 — Tom: "mark the first job as the starting point, not the warehouse").** `runPlan` in `lib/movements/evaluate.ts` no longer measures the first stop from the warehouse or adds a leg back: the first stop carries `kmFromPrevious: null` and `totalKm` is the sum of the legs between stops. `mapPins.route` is the stops first to last with no warehouse point at either end, so the Map view's toggled route line and the draft run line (`MapView.tsx`, which used to wrap the draft in `[warehouse, …stops, warehouse]`) both start on stop one; the warehouse square stays on the map. The painter's run list lede reads "km from the first stop to the last" (`app/pc/movements/run/RunList.tsx`); Day view and the order card already showed km per stop and needed no change beyond the figure. Tests: `evaluate.test.ts` runPlan + route cases. Help: `docs/help/movements/pc.md` Map §4–5.

**Movements map: one icon per job by a ladder of importance (25 Oct 2026 — Tom: "update all of the icons depending on the stage of the job, so it is clear what the most important things to do on the job are").** `lib/movements/jobIcon.ts` is the ladder: `jobAttention(items, needWords, closed)` → rung (problem red warning · call violet phone · visit cyan clipboard · move amber with the first need's icon · closed grey gear · none teal house), the ordered list of everything open and its count; `tierOfKind` maps the PC Command work-item kinds onto the rungs and anything else is listed but never sets the icon. The facts are the console's own queue: `loadMovementsWeek` calls `buildPcWorkItems` in its first round and hangs `world.jobItems` (kind + title per work order, items whose subject is the work order) on the world — a failed read is a `failures` line, never an empty map. `mapPins` climbs the ladder per job (`JobPin.attention`, `fill` gains red / violet / cyan; the line under the address is the top of the list); a world without `jobItems` falls back to the old three fills. `MapView.tsx` draws `ATTENTION_ICONS` (gearIcons.tsx) by rung, a corner count when more than one thing is open, the hover list (`map-todo`, a dot per rung), the rung mark on the order card's rows (`order-tier`) and a six-row legend. Tests: `jobIcon.test.ts`, `evaluate.test.ts` ladder case; `e2e/movements-map-icons.spec.ts` (move → problem, count, list, legend — skips without the Maps key, which the C1 env does not hold). Help: Map §2.

**The walkthrough starts whenever the boxes are ticked (26 Oct 2026 — Tom, after 28 Logan Street: "if all of the boxes are ticked off and questions answered they should be able to start the walk through, even if the date changes, or if colour match details aren't supplied — if colour matches are outstanding, this is something we should know from our side").** Two walls came down. Migration `20270306` re-emits `wo_gate_blocked` without the colour-match arm (prep items, surfaces, variations and the open-check-before-close rules stand) and `wo_deliver_evidence_pack` writes a `colour_match_outstanding` event naming the paints still without a code; the new staff-only definer `wo_colour_matches_outstanding()` lists jobs at or past the hand-over (and 30 days after sign-off) whose codes are still missing, read by `readColourMatchRows` → `buildColourMatchItems` in `lib/crm/work-queue.ts` (kind `colour_match_outstanding`, PC-homed, weight 27, follow-up, key `…:codes`, action `/pc/wo/<id>#colour-matches`) and drawn in PC Command as a 🎨 card — derived from the job, cleared by keying the codes on either side, never stored. On the painter's job page (`app/portal/jobs/[id]/page.tsx`) a PASSED quality check no longer swaps `WalkthroughStart` for the `staff-signoff-notice`: the card stays with `officeMaySign` (`walkthrough-start-office` line), the pinned bar stays, and the office's `wo_staff_complete` remains a second door (StageAdvance / WalkthroughCard copy says so) — whichever lands first closes the job. No date gates the start: `wo_start_walkthrough_mode` never read one. Tests: `work-queue-colour-match.test.ts`; `e2e/wo-walkthrough-anytime.spec.ts` (codes outstanding → start OK, event, list, PC card, cleared by keying; passed check → Start visible and opens), `wo-batch4` colour test and `wo-prep-questions` re-pinned. Help: work-orders contractor §13/§15, pc §17/§17a.

**Customer portal — light mode + UX pass (26 Oct 2026, brief `docs/briefs/claude-code-brief-customer-portal-ux-light-mode.md`, ledger `docs/briefs/portal-ux-light-ledger.md`).** The portal (`app/account/**`) is light only: `app/account/account.css` defines the one token set (`--bg/--surface/--surface-2/--border/--ink/--ink-2/--ink-3/--accent/--accent-ink/--ok/--warn/--info/--danger` + tints) at `.acct`, with no dark block, no toggle and no `data-theme`; the header wears `settings.company_profile.logoUrlLight` through `PortalContext.logoUrl`; the floating assistant widget is no longer mounted in the portal shell (Messages is the one chat). Mono is for money, invoice/receipt numbers and chips only — headings, helper text and meta lines are the body font in sentence case. Home's list is `lib/portal/homeList.ts` (`groupEstimates` → Needs you / With us / Done with a next-step line and a Melbourne-day relative date; `addressChips` dedupes identical addresses, caps at four + More (n)); `homeState` headlines follow the stage. My project takes `?project=<work order id>` through `getPortalProjects()` / `getPortalProject(accountIds, woId)`, `areaRollups(surfaces, variations)` turns approved extras into one "Extra work · N approved · $X" row, the team cards read in the past tense after sign-off, and `PhotoGrid` is a swipeable counted lightbox. Payments (`/money`, tab and title renamed) reads `buildMoneyView`'s `totalIncCents / paidCents / remainingCents` and a Nothing owing / Due / Overdue chip, one row per invoice with **Invoice PDF** (new owner-only `app/account/invoice/[invoiceId]/route.ts`, the receipt route's twin) and **Receipt PDF**, and Pay now into `/i/<token>`. Messages lists live threads only with a start-a-conversation picker; unread is counted from the `messages` mirror (`provider portal, direction out, read_at null`) and `markPortalThreadOpened` stamps it only when a thread opens. My colours groups by colour (`byColour`, `describeProduct`, `displayCode` — never an id as a code) with a `?view=area` toggle, letter swatches when no hex is on record, sticky per-property actions and collapsible properties. Specs: `e2e/portal-home-groups.spec.ts`, `portal-messages.spec.ts`, and the extended `portal-timeline`, `portal-money`, `portal-aftercare`; help: `docs/help/customer-portal/customer.md`.

**PC Command: Needs you now drops the movements reminders and Agreement not signed (27 Oct 2026 — Tom).** `HIDDEN_FROM_NEEDS_YOU` + `needsYouItems()` in `lib/workorder/console.ts` are the one place that says which work-item kinds the console does not draw: the nine movement kinds and `agreement_unsigned`. The queue still builds them (`buildPcWorkItems` is unchanged, so the Movements map's icon ladder and the Contractors tag read the same facts); `app/pc/page.tsx` filters at the screen. `agreement_expiring` stays. Test: `console.test.ts`. Help: work-orders/pc §1, agreement/pc + staff, movements/pc.

**Portal photos: every day of the job, minted as they scroll in (27 Oct 2026 — Chris, Rose Street: "I can't see the photos in my portal").** The timeline used to sign at most 12 thumbnails per page and fetch at most 40 photo rows, so on a job with more than three days of photos every older day drew a "Photos from the site" card with nothing in it. `JobTimeline` now signs nothing: `portalPhotoRefs()` in `lib/portal/photos.ts` maps every row to `/account/photo/[id]?size=thumb`, and the route (`app/account/photo/[photoId]/route.ts`, `signPhotoRendition`) re-proves ownership and kind per request and redirects to a 640px or 1600px rendition — one storage call per photo SEEN, never the original. `projectForWo` reads up to 400 rows (a bound, not a budget); `getPortalProjects` tie-breaks equal stages by `issued_at` so two jobs never swap. Specs: `e2e/portal-photos-every-day.spec.ts` (five days × four photos, the qa-kind photo refused at both sizes), `portal-timeline` (the src is the route; the hop is the rendition); unit: `lib/progress-preview/jobTimelineSample.test.ts`. Help: work-orders/customer §Steps 4 + §If something goes wrong.

**Payments opens on All jobs; invoice dates can sit before today (27 Oct 2026).** `app/invoicing/page.tsx` defaults `view` to `table` (the URL stays bare for it; `?view=chase` and `?view=board` are the other two; the legacy `f=overdue|paid` mapping to the table is unchanged). Migration `20270307000000_invoice_date_backdate.sql`: `invoice_issue(p_invoice_id, p_issued_on date default null)` replaces the one-argument shape (dropped first — two overloads would make a one-argument call "not unique"); `issued_on` is the given Melbourne day or today, `error:issued_in_future` past today, and a draft with no due date takes the terms from the invoice date rather than the day of the press. `invoice_set_draft_due` refuses only a missing day (`error:no_due`); `due_in_past` is gone, so a due date already past is allowed and the invoice is overdue from midday the day after (`isOverdue` in `lib/invoicing/derive.ts`, unchanged). The Send sheet (`ActionsClient.tsx SendSheet`) carries an **Invoice date** field (`max` today) beside the due date (no `min`), through `sendWithDueAction` (`issuedOn` optional, zod yyyy-mm-dd) to the RPC; the draft card's due-date input in `PanelClient.tsx` lost its floor too. Proof: `e2e/payments-actions.spec.ts` "send can carry an invoice date and a due date before today" (page send → `issued_on`/`due_on`/event read back; the server refuses a future invoice date), `e2e/payments-page.spec.ts` default-view check. Help: invoicing staff §Customers views, §Send.

**Paint Home ceiling $25,000 + tighten from the hand-off (27 Oct 2026 — Tom).** Paint Home's ceiling is its own policy number, `WizardPolicySettings.paintHomeCapCents` (default 2,500,000; migration `20270307` writes the key on the live `wizard_policy` row), read by the submit route's `paintHomeTier`, the Paint Home homepage cards (`rankShowcaseJobs` cap) and the Settings folder — the office remote-confirmation cap (⚑7, $12,000, interior only) is untouched and no longer Paint Home's. `paintHomeTier`'s MUST_SEE no longer carries `over_self_serve_cap`: that cap is about fixing a price online with nobody looking (interior $6,000), which Paint Home never does, and it had been sending every inside job over $6,000 to the hand-off. The hand-off (`Reveal.tsx painthome-handoff`) now offers **Tighten my price** (or **Change a side** once the walk is checked) beside Book a site visit. Unit `lib/wizard/brand.test.ts`; spec `e2e/marketing/painthome-wizard.spec.ts` test 2.

**Wizard batch (27 Oct 2026 — Tom's four).** (1) The Paint Home over-the-ceiling hand-off offers no door into the editor: `Reveal.tsx handoffLocked` (brand painthome + visit tier) drops the Tighten door added that morning, the "Change this" assumption links and the dock's Tighten button; Book a site visit and Send us a message remain. (2) The walk's size answer: all three `wz-tile` chips carry a `wz-tilesub` line (`ExteriorWalk.tsx`). (3) The rooms editor's window size box (`ScopeEditor.tsx` `room_win_size`) carries the same `sd-whint` size words as the sides editor. (4) `rooms-loop.ts roomLoopViews`: a bedroom's `cupboardInterior` (code `Robe Interior`) reads `on: false` until answered, so the walls inside the built-in robe are pre-answered No (`lib/wizard/cupboard-interiors.test.ts`). No migration.

**Wizard mobile v5 — session 1 (27 Oct 2026; brief `docs/briefs/claude-code-brief-wizard-mobile-v5.md`, plan `build-plan-wizard-mobile-v5.md`, prototype `docs/mockups/painthome-wizard-v5.html`).** The skeleton under the mobile rebuild. **Brand guard:** `lib/wizard/brandGuard.test.ts` is a per-file ratchet over the literal "Paint Group" (outside comments) across `app/wizard`, `app/estimate` and `lib/wizard` — nine deliberate mentions are listed with their reasons; a new one fails the suite. The chat panels it caught now take `brandName` (`ChatWidget.tsx`, `AssistView.tsx`, `AssistantWidget.tsx`; `wizardBrandName()` in `lib/wizard/brandServer.ts`). **The dock:** `.wz-rv-dock` is rendered inside the range card in `Reveal.tsx`, a static button on a laptop and the fixed bottom bar under 900px (it was hidden on desktop); never on the hand-off. **Events (brief §8):** `lib/crm/events.ts` gains `wizard_step_viewed`, `surface_toggled`, `gate_viewed`, `gate_cta_clicked`, `contact_opened`, `scope_viewed`, and `visit_booked` carries `step` / `from` / `sessionId`. The customer's browser writes them through `POST /api/wizard/event` (`lib/wizard/wizardEvents.ts`: the zod shapes and `sendWizardEvent`; the route pins the session — the caller's open `wizard_drafts` row — and dedupes per session, so the dashboard counts sessions, never taps). Emitters: `WizardApp.tsx` (step viewed, Contact opened from the talk bar, the one-shot sessionStorage mark `markScopeFromGate`), `Reveal.tsx` (gate viewed; every door → `gate_cta_clicked`; Keep → `save`), `ScopeEditor.tsx` (`scope_viewed` from the mark). **Dashboard:** `buildWizardRates` in `lib/reporting/metrics/funnel.ts` (the funnel slice's `wizardEvents`, read in `load.ts`) feeds `FunnelCard`'s `funnel-rates` line — gate → exact price and Contact → booked — per shopfront when the funnel is split. No migration.

**Tighten editor: details first, sizes save on blur (28 Oct 2026 — Tom).** `ScopeEditor.tsx`: while any detail step is open (`detailsOpen`, the existing flag) the `sc-wrap` carries `sc-settle-first` and the details card's title gets the *Start here* kicker and a lead line; `wizard.css` frames the card in cyan and dims every later sibling of the wrap (a steer, not a lock — the customer-journey specs still tap rooms first, and so may a customer). The room size row saves on blur (`onBlur` on the row with a `relatedTarget` check so tabbing between the three boxes does not save half a size) and the *Update size* chip is gone (a "saves when you click out" line replaces it while dirty); `SidesEditor.tsx` does the same for a side's length × height (`commitDims`, also on Enter), with a **Keep these** chip only for a mirrored side with nothing typed. Five specs now blur instead of pressing a button. No migration.

**Wizard mobile v5 — session 2: the phone's shell (28 Oct 2026; brief `docs/briefs/claude-code-brief-wizard-mobile-v5.md` §2, plan `build-plan-wizard-mobile-v5.md`, prototype `docs/mockups/painthome-wizard-v5.html`).** Under 768px (`WizardApp useMobile`: the `(max-width: 767px)` media query through `useSyncExternalStore`, desktop until hydration) a customer's quick look is `app/wizard/MobileQuickLook.tsx` — back chevron · logo · **Contact** pill, a 3px bar, the live strip's place (session 3 draws the thumbnail and ribbon), one question per screen, single choices advancing themselves ~250ms after the tap (R7/D10), a bottom bar only on surfaces, rooms, details and on a step the phone does not split (safe-area padded). The screens are DATA: `lib/wizard/mobileScreens.ts mobileScreensFor(steps, quick)` lays the eleven screens (what · property · beds · storeys · job · surfaces · rooms · colours · condition · living · details) over `stepsFor()`, which stays the order of record — WizardApp's `page`, `quickNext` (validation, autosave tag, submit) and `quickBack` are untouched; the shell only keeps which screen of the step is showing (state + `localStorage pg-wizard-mobile-screen-v1`, so a reload and "Welcome back" land on the same screen). Skip rules: storeys for a unit; an outside job goes place → the exterior brief's screens as they are (§2.4), rendered through `QuickLook shell="mobile"` (no nav, no talk card, no "Your job so far"; the drawn house stays, static). The answers are the quick look's (`QuickLook`): the job pre-ticks its surfaces (`applyJobChoice`: Doors, windows and trims = skirtings, doors, windows; Some rooms = the first two rooms), the surface chips write `excluded`, the three colour answers read and write the colour tiles (`colourChoiceOf` / `applyColourChoice`; bold is never asked on a phone), the rooms screen lists the starter names with Study / Ensuite / Garage as added rooms. `wizard_step_viewed {step: <screen>, breakpoint: mobile}` and `contact_opened {step: <screen>}` are written per screen. The details button needs name + 10-digit mobile + email — the server's gate (`/api/wizard/submit gate_required`) still asks for the email, so the brief's name-and-mobile-only button waits on that rule (⚑ in the ledger). The sticky picture panel and the floating pill are gone on a phone; desktop renders none of this (proved by `e2e/_look-wizard-desktop.spec.ts` screenshots at 1470px, byte-identical before and after). The e2e drive (`driveNoPlanWizard` / `quickNext`) walks the phone's screens when the shell is up; `e2e/customer-journey/wizard-mobile-v5.spec.ts` is the contract.

**Wizard mobile v5 — session 3: the live strip, the thumbnail and the roller (28 Oct 2026; brief §3).** The strip under the phone's progress bar is `app/wizard/MobileStrip.tsx`: a 76 × 52 thumbnail, the ribbon and a chevron; a tap opens a bottom sheet (`.wz-sheetback` / `.wz-sheet`, the S8 sheet pattern) with the same picture at 5:3, the caption and the same surface chips as the step. The picture is ONE state, `lib/wizard/mobilePicture.ts pictureStateFor(quick, outside, surfacesReached)` — Inside → the room, Outside → the house; unit / townhouse / two storeys / the three wall tints (`WALL_TINT`) / the two condition marks from the answers; unpainted before the surfaces screen, the ticks kept after it — drawn twice by `app/wizard/pictures/MobilePicture.tsx` (the prototype's 200 × 120 drawings, as the prototype wins over brief §3.1's "the desktop SVGs"; session 6 may lift the layers onto the desktop picture). Every surface is a base layer plus a painted layer clipped by a rect; a tick sweeps the rect 0 → 200 over ~520 ms (ease-out cubic) from `requestAnimationFrame` with the roller glyph riding the edge, each rendered copy owning its own frames; React never writes the rect's width (effects do), and `prefers-reduced-motion` snaps. The ribbon is `ribbonFor` (§2.2: the answers of the screens passed, joined with " · "; "N surfaces ticked · tap to see" from the surfaces screen on; "N parts ticked" on an outside job). Outside draws from the exterior brief's `v2.parts` grouped onto six surfaces (`OUTSIDE_SURFACE_PARTS`); the sheet's chips toggle each group's first part through `togglePart`. `surface_toggled {surface, on}` is written from the step's chips and the sheet's. Contract: `e2e/customer-journey/wizard-mobile-v5-strip.spec.ts`.

**Wizard mobile v5 — session 4: the gate on a phone (28 Oct 2026; brief §4).** Under 768px a customer's range screen is `app/wizard/MobileGate.tsx` (WizardApp renders it in place of `WizardHeader` + `Reveal` on the reveal screen; the walk and the sent screen keep theirs): one column, no picture (R5) — the label, the range in Martian Mono 40px, the basis line (`restatement` / `exteriorRestatement`), the ONE small-print sentence (R3; no tolerance figure anywhere, R2), "Want the exact number?" with **Get my exact price** (D11; `onExact` is the desktop's Tighten path: range option, the details sheet when the contact is not held, `markScopeFromGate`, the scope) and "book a time with <estimator> first" (the talk sheet until session 5), the three tiles (R4: done · now · todo), the estimator line (`payload.estimator`, the suburb when covered), the trust line from the homepage's rating and warranty with "Reviews powered by Paint Group" in 11px on Paint Home (R10 — the one mention, in the brand-guard ratchet), and "What's in the range" collapsed: `payload.systems` lines with coats. §4.1 the sticky bar holds the one door. §4.2 the bigger-job variant is the Paint Home over-the-ceiling hand-off (`paintHome.tier === "visit"`): "We'll come and look" + Book a visit replace the question, the bar follows, never both. Events as Reveal's (`gate_viewed`, `gate_cta_clicked`). §4.3: `/estimate/scope` now reads the estimate's `brand` (host as fallback) into its chrome — `ScopeEditor`, `SidesEditor` and the holding page take `brand` for the Wordmark (Paint Home had been showing the Paint Group mark there) — and on a phone `WizardHeader`'s new `phoneTiles` draws the three tiles with Your exact price active in the frozen header in place of the step line. Contract: `e2e/customer-journey/wizard-mobile-v5-gate.spec.ts`; the Paint Home phone tests in `e2e/marketing/painthome-wizard.spec.ts` assert the gate.

**Wizard mobile v5 — session 5: Contact (28 Oct 2026; brief §5).** `app/wizard/MobileContact.tsx` is the sheet behind the phone's **Contact** pill (R6: every screen, the gate too — `MobileGate` gained a header with the pill): the estimator line, one teal door (Book a visit — on both shopfronts, as §5 reads; this one door supersedes the Paint Home phone-close door set), Call (tel:), Send a message, Save and come back later. It decides and books nothing itself: each door hands over to a mechanism the platform already has — before the range the door is the visit module's own pre-range path, a REQUEST for a time through `TalkSheet` (the standing R3 ruling: never a slot before the range); on the gate (and the gate's "book a time first") it is `/estimate/visit` — the zone's pre-set days, the hold, the texted code — on both shopfronts (a pre-range CALL request is refused by the visit route without a range, R25, so the pre-range door is the visit request everywhere); Send a message is the talk sheet's message mode; Save is `SaveAndBookSheet` (the link back by email). `TalkSheet` gained `onContact`, called whenever details are accepted, so the details step and the gate arrive pre-filled from a request (§2.5 / §5.4). `contact_opened {step}` names the screen (`gate` on the gate). **Not built, by rule:** the brief's slot booking from step 3 on name + mobile alone, confirmed by a text rather than the six-digit code, cuts across the one identity model (every lead is keyed on an email, `ensureAccountAndProperty`), the visit module's estimate-bound holds and code (section 8), and R3 — three rulings for Tom, listed in the ledger (M5 · S5), not worked around.
**Videos structured data (28 Oct 2026 — Search Console: missing uploadDate on painthome.com.au).** `lib/marketing/videoLd.ts videoObjectLd` is the one VideoObject builder, with `uploadDate` a required input: the homepage featured video, pasted link or showcase job (`Reviews.tsx`), and the job page (`work/[slug]`) all go through it. `videoUploadDateFor(job)` = published → completed → created day; a pasted link carries `website_content.featuredVideo.addedOn`, written by `saveWebsiteContentAction` (`melbourneDay`, Intl pinned to Australia/Melbourne), falling back to today until the row is saved again. Unit `lib/marketing/videoLd.test.ts`. No migration.

**Wizard mobile v5 — session 6: the roller on the desktop picture (28 Oct 2026; brief §6, D14 = build).** `app/wizard/pictures/rollerSweep.ts` is the ONE sweep, lifted out of `MobilePicture`: `useRollerSweep(keys, on, full, height)` owns the clip rects and glyphs by ref, writes each rect's width from `requestAnimationFrame` (0 → full over ~520ms, ease-out cubic; back on untick; a snap under `prefers-reduced-motion`; never a CSS transition on a clipPath child), with every rendered copy owning its own frames. `RoomPicture` (the desktop's room beside the Job and Condition steps) now draws every surface as two layers — the room as it is today underneath (`.rl-base`, the edge line), the painted surface on top (`.rl-paint`, fill only) under the clip — so a chip ticked on the Job step sweeps its paint in beside the questions; the old one-shot wall roller and its keyframes are gone. `data-s` / `data-on` / `data-bold` stay on the painted shapes, so the older specs read the state as before; no layout change (the 4:3 box is fixed). Contract: `e2e/customer-journey/wizard-desktop-roller.spec.ts`. The desktop screenshot diff for this session differs only inside the room picture (the base's edge line under the painted layer), as §6 allows.

**Wizard mobile v5 — session 7: the phone hero, the full phone E2E, the independent check (29 Oct 2026; brief §7, plan Session 7).** `app/(marketing)/_components/AddressField.tsx` wraps the form, the ghost line and the suggestions in `.fieldwrap` — `display: contents` above 767px, so a laptop's layout is untouched — and `marketing.css` stacks the hero's field on a phone (pin + address on one row, See my price full width under it) with the suggestions `position: absolute` under the wrapper, over the Inside / Outside chips (§7: overlay, never push). `e2e/customer-journey/wizard-mobile-v5-full.spec.ts` is the phone end to end on both shopfronts: the hero's geometry and the suggestions' placement, Paint Group Inside from the hero to the range and into the editor, Paint Group Outside through the exterior brief's screens to the range, Paint Home Outside from the hero to the range in Paint Home chrome. The independent check against brief §9 was done by a fresh agent, read-only, and its findings are in the ledger row M5 · S7.
