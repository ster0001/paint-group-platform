# Claude Code build brief — PC Command → Movements

**Status:** v2.2 — 19 Oct 2026 evening (v4 mockup: rubbish options, one-icon map, drag-to-order day list). **Supersedes** `claude-code-brief-pc-logistics.md` (v1, 16 Oct — the per-job five-line form, rejected by Tom as "not how I imagined it"). Tom's rulings of 16 and 19 Oct applied (§2). Fourteen ⚑ items in §9; none blocks Session 1.
**Owner:** Tom Roman, Paint Group. **Day-to-day user:** Felipe (project coordinator); Tom, Saul, Adi and Abdul as people on the board; painters on their phones.
**Extends:** the Schedule board (its drag engine becomes shared), the WO completion loop (pre-start gate, completion-prep answers), PC Command (material requests, console cards), cost intake, the automations registry, the one work queue.
**Size:** large. Eight build sessions plus a read-only Session 0. The board engine extraction (Session 2) is the risky step — it is gated by the Schedule board's existing e2e staying green.
**Design reference:** `design/reference/pc-movements-mockup.html` (v3) — **the spec**. Light theme by default, dark via the toggle. Week board with tray (Felipe and Tom in one-hour slots, everyone else AM/PM), Sources (the one materials list in three places, + Add a chip), Day run plans, Map (labelled pins, colour per person), Gear (register with icons). Drag works with a mouse or a finger. Open it on a laptop first, then a phone.

---

## 0. Read first

Kickoff ritual applies: commit this brief, the mockup and the two CSVs, then **confirm the file list back before writing any code**. Stop-and-report on every missing reference.

| File | Why it matters here |
|---|---|
| `CLAUDE.md` (repo root) | Server boundary · one work queue · demo wall · migrations register themselves · `error` never dropped on a list read · help = definition of done · one evaluator, one writer |
| `design/reference/pc-movements-mockup.html` | Every screen, state, label, chip, lane, sheet and badge. Match it, don't approximate it |
| `docs/briefs/data/suppliers-seed.csv`, `docs/briefs/data/equipment-seed-template.csv` | Branch seed (69 rows) and the register's shape (Tom's real inventory to come, ⚑12) |
| `app/pc/schedule/ScheduleBoard.tsx` (2,230 lines), `app/pc/schedule/schedule.css`, `app/pc/schedule/actions.ts`, `lib/scheduling/board.ts` (`loadBoard`, `Lane`, `Block`, `TrayJob`) | **The board we already have**: lanes × days, pointer-based drag that works on touch, a tray with search, zoom, saved views, blocked days. Session 2 lifts the engine out of it into `app/components/board/` and runs both boards on it |
| `lib/gcal/read.ts` (`readGoogleBusyForStaff`, `readStaffGoogleBusy`, `GoogleBusy`), `lib/gcal/staff.ts`, `docs/gcal-setup.md` | Staff Google Calendar is already readable. Tom's and Felipe's calendars are the violet context blocks on the board |
| `supabase/migrations/20270248…_site_checkins.sql` (`wo_site_visits`), `20260927…_wo_loop_tables.sql` (`wo_qa_checks`), `wo_walkthroughs`, the employee leave table from the timesheets module | The cyan context blocks (QA checks, site check-ins, walkthroughs) and "Leave" |
| `lib/workorder/snapshot.ts` (`WOMaterial`, `CAN_SIZES`, `cansFor`), `lib/workorder/materials.ts`, `lib/workorder/materialsBudget.ts`, `products.brand` | Paint chips are the Materials card's rows **grouped by product brand**. The chip reads these rows; editing lines in the chip calls `wo_set_material`, the existing writer |
| `app/pc/wo/[id]/page.tsx` (~L440 pre-start wiring), `PrestartListBox.tsx`, `PrestartPaintEstimate.tsx`, `MaterialsCard.tsx`, `MaterialRequests.tsx`, `app/pc/materialActions.ts`, `app/pc/prestartActions.ts`, `supabase/migrations/20270243…` (`wo_prestart_lists`), `20270266…` (`wo_material_requests`) | What exists under pre-start today. The materials free-text box becomes **material lines**; the painter's request becomes a line; the equipment box is replaced by gear chips |
| `app/quote/QuoteBuilder.tsx` (`crew_notes`, `access_notes` — the internal, non-customer fields), `lib/workorder/snapshot.ts` (`crewNotes`) | The pattern for the new internal **Materials & sundries** field on the estimate (ruling 5: internal only) |
| `supabase/migrations/20261110…` (`wo_seed_checklists`), `20270159…` (`wo_tick_checklist_item`, `wo_answer_checklist_item`), `20261103…` (`wo_handle_collection`), `lib/workorder/console.ts` §5b + `consoleData.ts` collections read | The two pre-start gate items this brief makes real; the completion-prep "Equipment for collection? / Rubbish?" answers; the two `collect:` console cards this brief retires |
| `lib/crm/work-queue.ts` (`WORK_ITEM_KINDS`, `KIND_WEIGHT`, `GROUP_OF_KIND`, `PC_HOMED`, `buildMaterialRequestItems`, `buildPcWorkItems`) | The only place a "needs attention" card may come from (§6) |
| `lib/automations/registry.ts`, `lib/messaging/config.ts` (`automationOn`, `renderTemplate`, `normalisePhoneAU`), the draft-first rollout rule from the messaging brief | Every text in §5 is a registry entry, draft-first |
| `lib/demo/scope.ts` (`realOnly`), `lib/demo/boundary.test.ts`, `20270262…_demo_property.sql` | Demo wall: `is_demo` + copy trigger on every new job-linked table; `realOnly()` on every list read |
| `lib/costs/match.ts`, `20261122…_cost_intake.sql` (`work_orders.job_no`, `PG-` refs), `20261112…_invoicing_core.sql` (`vendors`, `job_costs`, `equipment_hire`) | Orders carry the job's `PG-####`; invoices match themselves; hire expectations become `job_costs` (⚑9) |
| `20270212…_visit_zones.sql` (`visit_suburbs.lat/lng`), `app/api/places/details/route.ts`, `lib/places/` | Suburb centroids for nearest-branch and Nearby in v1; the Places route for geocoding jobs (⚑3) |
| `app/w/WorkOrderDoc.tsx` (Materials & colours), `app/portal/jobs/[id]/` (`MaterialsRequest.tsx`, `PrepChecklist.tsx`, `gapActions.ts`), `app/portal/` home | Painter side: job sheet lines, "Your pickups today" card, Picked up tick |
| `docs/induction/induction-v1.md` Module 4 | "We deliver to site where we can… the work order shows which" — this brief makes it true |
| `docs/help/_template.md`, `docs/help/work-orders/pc.md`, `docs/help/portal-gaps/`, `docs/help/scheduling/` | Help per role ships in the same PR |

---

## 1. What we are building — in one paragraph

A **Movements** tab in PC Command that works like the Schedule board: a **tray of chips** on the left (everything that has to move next week, built from the jobs — paint per brand, materials per line, gear, rubbish) and a **board of lanes × days** on the right where each lane is a bucket Felipe can drop a chip into: **Supplier delivers** (the orders he places himself), **a lane per painter** (contractor or employee — they pick it up or move it) and **a lane per staff member** (Felipe, Tom, Saul, Adi, Abdul — they move it). Each day splits into AM and PM. Dropping a chip creates the movement: the lane decides who and how, the column decides when. The board already shows **where everyone will be** — their job from the schedule, their Google Calendar, their QA checks and site check-ins, leave — so Felipe can send things with whoever is going that way, and the board tells him when there are chips **Nearby** or something to pick up **"while you're there"**. Ticking **Ordered** on a supplier or painter movement is what alerts the painter. The **Day** view turns a person's drops into a numbered run plan with distances and sends it to their phone; the **Map** shows active jobs by stage, the shops, the warehouse and each person's route; **Gear** is the register, with every item's location read from the last ticked movement that carried it.

### What does NOT change (recorded so no session revisits it)

- The Schedule board's behaviour. Its engine is shared after Session 2; its screens, offers, SLA, blocked days, saved views and e2e are untouched.
- The six-stage WO model and `wo_events`. "Materials ordered" and "Equipment movements booked" stay the two pre-start gate items — now backed by movements.
- The Materials card is the source of paint rows (product, colour, litres, cans). A paint chip reads it and edits it through `wo_set_material`. Nothing in this brief re-derives litres.
- A moved job never moves a movement by itself (ruling 4, 16 Oct). It flags.
- Painter material requests stay as the painter's way to ask; accepting one creates a material line and a tray chip.
- Cost intake stays the only way a supplier invoice enters the books.
- The one work queue. Every "needs you" card on this tab comes from `lib/movements/evaluate.ts` through the registry.
- The v1 data decisions that survived: tagged equipment, derived location, supplier branches hanging off `vendors`, account numbers out of the repo, the branch seed, nearest-first sorting.

---

## 2. Tom's rulings (binding)

**16 Oct 2026**
1. Equipment is tagged individually; two identical ladders are two rows.
2. Paint is ~50/50 pickup and delivery with the occasional delivery by Paint Group. Default for a paint chip dropped on the Supplier lane is delivery; on a painter's lane, pickup; on a staff lane, our van.
3. Rubbish is a movement, not a note. **Amended 19 Oct (evening), ruling 20:** the question on the chip is *how* — **Painter disposed** · **Painter drops at warehouse** · **Left on site**. Painter disposed = recorded on the painter's lane, nothing for anyone to move. Drops at warehouse = a drop-off on the painter's last day, on their lane. Left on site = a collection chip in the tray — drop it on whoever collects, or turn it into a skip (in day, out day) from the chip.
4. When a job's dates move, **flag, never shift**.
5. Seed every Dulux Trade Centre, Paint Spot and Inspirations Paint branch in the working area, every Taubmans trade centre, Bunnings, Viponds Tullamarine, Premier Roof Coatings Dandenong, and the hire yards (Baycity Rentals Cheltenham, Alya Access Thomastown, Carnegie Smart Hire Oakleigh South + Carnegie). Tom prunes in Settings.
6. Easy to use and to train on.

**19 Oct 2026**
7. **The planning surface is a board, not a form.** Tray of chips → drag onto people × days. Lanes are the buckets. (Supersedes v1's five-line job card; it survives only as pills on Project Progress.)
8. **Contractors can be given staff-style runs.** Any chip can be dropped on any painter's lane, not just pickups for their own job.
9. **Columns are days split AM / PM.** Day view is hourly.
10. **No pay for rubbish drop-off** — for employees or contractors. The pay side is left out entirely; a rubbish chip on a painter's lane is just "they take it".
11. **Client delivery notice is OFF by default**, toggled per delivery.
12. **The estimate's Materials & sundries field is internal only** — never on the customer document.
13. **Google Maps** for the map.
14. **Planning is desktop/tablet; running is phone.** The board scrolls sideways on a phone like the Schedule board; the Day run plan is phone-first.
15. **Light mode** is the default presentation of this tab's design (the console's existing light tokens); dark stays available via the console toggle.

**19 Oct 2026, afternoon**
16. **Felipe's and Tom's lanes are in one-hour slots, 07:30–17:30**, on the week board as well as in Day view. Other lanes stay AM/PM. Which people get hourly lanes is a per-person setting (`boardPeople[].slots`), not code.
17. **Movements can be created from three doors** — the estimate's internal Materials & sundries field, the job page's pre-start, and straight into the tray (+ Add a chip) — and **the content is one shared list**: a line typed in any of them shows in all of them. A chip added from scratch for materials writes the line back to the job (and therefore the estimate's WO copy).
18. **Gear gets an icon per type.** Tom's register types: step ladder · extension ladder 7 m · platform ladder · spray gun · Festool Planex wall sander · Festool vacuum · extension ladder 10 m · mobile scaffold · fall protection. The icon set in the mockup is the reference; a new category needs an icon before it can be created.
19. ~~The map labels every pin with what it is and colours it by who does it.~~ **Superseded by ruling 21** (the labelled-pins map was judged confusing).

**19 Oct 2026, evening**
20. **Rubbish "how" = Painter disposed · Painter drops at warehouse · Left on site** (see ruling 3 as amended). No pay side.
21. **The map is simple: one icon per job.** Teal house = nothing outstanding; **amber, showing the icon of what is needed** (paint · materials · gear · rubbish), when that job still has a chip in the tray or an order not yet placed — so action is visible at a glance; grey = closed job with gear still there. Short address under each, one line saying what is needed. No route lines by default (a toggle), shop dots only on request, no per-movement label chips.
22. **The day's order is dragged into shape beside the map.** A list of the selected person's stops for the selected day, drag-to-reorder (fixed appointments — calendar, QA checks — stay at their time; movements re-slot around them, keeping the same set of times so the week board and the run plan agree). **The order number sits on the location's icon on the map.** Same list feeds Day's run plan and "Send to phone".

---

## 3. Design

### 3.1 One record for the thing that moves — `movements`

Every chip **is** a movement row. A chip in the tray is a movement with `status = 'tray'` (no assignee, no date). Dropping it fills the assignee and the day. This keeps one record from "it needs to move" to "it moved", and the tray is just a filter.

| column | notes |
|---|---|
| `id uuid pk`, `work_order_id uuid null → work_orders` | null = warehouse (restock, repair) |
| `kind movement_kind` | `paint` · `materials` · `equipment_out` · `equipment_return` · `hire_on` · `hire_off` · `rubbish_in` · `rubbish_out` · `restock` · `repair_out` · `repair_back` · `other` |
| `source_key text null` | how the sync recognises its own chip: `paint:<brand>` · `matline:<line id>` · `rubbish` · `return:<out movement id>` · `hire_off:<hire_on id>`. Unique per `work_order_id`. Manual chips have none |
| `title text`, `detail text null` | the chip's two lines, rendered by the sync from its source (never typed for synced chips; editable for manual) |
| `assignee_kind movement_assignee null` | `supplier` · `person` |
| `assignee_id uuid null` | `person` → `profiles.id` (staff) **or** `contractors.id` (painter); `assignee_table` says which. Supplier lane → null |
| `due_date date null`, `half text null check (half in ('AM','PM'))`, `time time null`, `sequence int null` | the column, the half, the optional exact time, the run order within a person-day |
| `from_kind place_kind`, `from_branch_id null → supplier_branches`, `from_text` ; `to_kind`, `to_branch_id`, `to_text` | `place_kind`: `branch` · `warehouse` · `site` · `person` · `tip` · `other`. Text columns are rendered snapshots |
| `status movement_status` | `tray` · `planned` · `booked` · `done` · `problem` · `cancelled`. **Only RPCs write it** |
| `needs_order boolean` (derived in the evaluator, not stored) | true when assignee is supplier, or a person picking up from a branch, and `ordered_at` is null |
| `ordered_at/by timestamptz` | the order step — "I've placed it" — the trigger for the painter alert |
| `painter_alerted_at`, `client_notice boolean default false`, `client_notified_at` | ruling 11 |
| `order_ref text` | defaults to the job's `PG-####`; printed on supplier orders; what cost intake matches |
| `lines jsonb null` | paint: snapshot of the Materials rows **at ordering** (`[{rowKey, product, colourName, colourHex, colourStatus, litres, cans}]`); before ordering the chip renders live rows |
| `planned_for_start date null` | job start when the chip was placed; `≠ work_orders.start_date` ⇒ **job moved** flag (ruling 4) |
| `blocked_by_movement_id uuid null → movements` | gear that cannot go out until its return movement is done (the stranded sprayer) |
| `expected_cost_cents int null check (>= 0)` | hires (⚑9) |
| `note text ≤ 500`, `problem_note text ≤ 500` | |
| `painter_confirmed_at` | painter's tick (Picked up / Returned / "Equipment for collection: yes") |
| `source_changed_at` | the sync noticed the Materials rows or the line changed after ordering → work item |
| `booked_at/by`, `done_at/by`, `cancelled_at/by`, `created_at/by`, `updated_at`, `is_demo` | |

Indexes: `(work_order_id)`, `(due_date, status)`, `(assignee_kind, assignee_id, due_date)`, `(status) where status = 'tray'`, `(source_key, work_order_id) unique where source_key is not null`.

**`movement_items`** `(movement_id, equipment_item_id) pk`, `label` snapshot, `is_demo`.

**`wo_material_lines`** — the materials list as lines, replacing the free-text box: `id`, `work_order_id`, `text ≤ 200`, `source` (`estimate` · `pc` · `painter_request`), `request_id null → wo_material_requests`, `sort`, `merged_into uuid null` (Felipe merged two lines into one chip), `created_by`, `is_demo`. **`estimates.builder_state.internalMaterials: string[]`** is the estimate-side field (internal; the customer snapshot strips it — tested). At WO issue the lines copy to `wo_material_lines(source='estimate')`; later additions come from the PC job page and from accepted painter requests. The old `wo_prestart_lists.materials` text is imported once as lines (`source='pc'`) and the box is removed.

**`equipment_items`**, **`supplier_branches`**, **`supplier_branch_accounts`** — as v1 §3.1 (tag from sequence, no location column; `category` enum = Tom's nine types `step_ladder · ext_ladder_7 · ext_ladder_10 · platform_ladder · spray_gun · planex_sander · festool_vacuum · mobile_scaffold · fall_protection` + `other`, each with an icon in `lib/movements/gearIcons.tsx` — ruling 18; branches with `lat/lng`, `delivers_to_site`, `opens_weekday`, `favourite`; account refs staff-only in their own table, never in the repo). Add `supplier_branches.email` for ⚑8 and `supplier_branches.map_place_id` for Google Maps.

**`wo_logistics_decisions`** `(work_order_id, line) pk` — `line` ∈ `paint` · `materials` · `equipment` · `rubbish`, `decision` ∈ `not_needed` · `painter_supplies`; the one stored fact a job can hold without a movement.

**Settings row `movements`** (jsonb): `warehouse {label, address, suburb, postcode, lat, lng}` (⚑1), `nearKm 7` (⚑2), `planningHorizonDays 7`, `deliveryConfirmBy "10:00"`, `boardPeople: profile ids` (who gets a staff lane, ⚑5), `showHowItWorks true`, `recordHireCosts true` (⚑9), `defaultHalfTime {AM: "07:00", PM: "13:00"}`.

### 3.2 Chips come from the jobs — `lib/movements/sync.ts`

`movements_sync_for_wo(wo)` (definer RPC, idempotent, called on WO issue, on Materials-card change, on material-line change, on completion-prep answers, and by the nightly sweep) creates or refreshes **tray** chips and never touches a placed one except to set `source_changed_at`:

- **Paint — one chip per product brand per job.** Group the Materials rows by `products.brand`; `source_key = paint:<brand>`; title "Dulux · 4 lines · 6 cans"; detail "from the Materials card". The chip's default branch = the nearest **delivering** branch of that brand to the job (favourites first); a brand with no branch in Settings (e.g. Haymes) still gets a chip with no shop — Felipe picks. Colours unconfirmed (`wo_colours_confirmed(wo) = false`) → chip carries `coloursTbc` (rendered amber: "can plan, can't order").
- **Materials — one chip per material line** not merged into another; `source_key = matline:<id>`; default branch = nearest hardware branch. Felipe can **merge** lines into one chip (`wo_material_lines.merged_into`) or split by un-merging.
- **Rubbish — one undecided chip per job** (`source_key = rubbish`, title "Rubbish — how?") until Felipe decides in the chip sheet: *None* → `not_needed` decision, chip cancelled; *Painter takes it* → chip retitled, droppable on a painter lane; *Skip* → chip becomes `rubbish_in` with a hire branch and an auto `rubbish_out` (`hire_off:` pattern); *We collect* → droppable on a staff lane, `to_kind = tip`.
- **Gear — no auto chips for what a job needs** (the register doesn't know); Felipe adds a gear chip from the tray's **+ Add a chip → Gear**, ticking items from the register with their current location. An item that is stranded, in repair, or on another site until after the chosen day is disabled with the reason; a stranded item's chip is created `blocked_by` its return chip. **Return chips are automatic**: booking an `equipment_out` creates `return:<id>` in the tray dated to the job's end; the same for `hire_on → hire_off` and `rubbish_in → rubbish_out`.
- **Stranded gear** (location `site` on a closed WO) gets a return chip in the tray by the nightly sweep, grouped under that closed job.
- **Manual chips** — anything: `+ Add a chip` with kind, title, job (optional), from/to.

### 3.3 Everything else is derived — `lib/movements/evaluate.ts` (pure, tested, the only evaluator)

- **`lanes(window)`** → Supplier (always), then every painter with a booking or an assignment overlapping the window **or** any movement in it (contractors and employees alike — ruling 8), then every profile in `settings.movements.boardPeople`. Lane order: supplier, painters by first job start, staff in the Settings order.
- **`context(lane, day)`** → read-only blocks: job blocks from `loadBoard` (green), Google busy from `readGoogleBusyForStaff` for staff with a connected calendar (violet; titles when the read scope allows, else "Busy" — ⚑6), QA checks / site check-ins / walkthroughs dated that day for that person (cyan), leave (grey). Each block carries a suburb when it has an address.
- **`methodOf(movement)`** → from assignee kind + chip kind + from/to: supplier lane → `supplier_delivers` (`hire_delivers` for hires); person lane + from a branch → `pickup`; person lane + from warehouse → `drop_off`; person lane + return → `collect`; person lane + rubbish to tip → `takes_to_tip`. Rendered as "Josef picks up" / "Felipe drops off" / "Saul collects".
- **`kindLabel(movement)`** → the label on cards, run plans and map pins: Paint delivery · Paint pickup · Materials delivery · Materials pickup · Gear drop-off · Gear collection · Hire delivery · Rubbish collection · Rubbish to tip · Skip in / out. Context blocks label themselves: Quality check · Job check-in · Estimate visit · Walkthrough · On site · Leave.
- **`laneColour(lane)`** → one colour per lane from `settings.movements.boardPeople[].colour` (painters get a colour from a fixed palette by stable hash of their id), used identically on the board, in Day and on the map. Supplier lane is grey.
- **`needsOrder(movement)`** → assignee is supplier, or a person picking up from a branch, and `ordered_at` is null.
- **`window(chip)`** → the days a chip may sensibly land on: a return not before its job's end date, a delivery/pickup/drop-off not after its job's start date; closed-job returns and warehouse chips any day. Dropping outside the window is **allowed with a warning** (Felipe knows things the system doesn't), but Nearby, ghosts and hot cells never suggest it.
- **`nearby(lane, day)`** → tray chips (not blocked, not undecided, in window) within `nearKm` of any context block that person has that day (suburb centroids in v1; `work_orders.lat/lng` when ⚑3 lands). Staff lanes only.
- **`hotCells(chip)`** → every (lane, day) where someone has context within `nearKm` of the chip's location — lit while dragging.
- **`whileYouAreThere(block)`** → the single nearest tray chip to a calendar/QA block (one ghost per block, max).
- **`runPlan(person, day)`** → context + movements sorted by `sequence`, then `time`, then AM/PM default; distances between consecutive stops from the warehouse out and back.
- **`locations(items, movements)`** → per item: `warehouse` · `site` · `person` · `repair` · `stranded`, from the latest **done** movement carrying it. (v1 §3.2 rules, unchanged.)
- **`jobMoved(movement, wo)`**, **`gates(wo)`** (pre-start: paint all ordered/none/painter-supplies; gear all booked/none), **`counts(window)`** (tray, placed, orders to place).
- Golden tests: two identical ladders; out-back-out; a stranded item whose WO closed yesterday; a paint chip on a colours-TBC job; a chip dropped on a supplier lane whose branch doesn't deliver (refused); a painter lane receiving a staff-style drop-off (allowed, ruling 8); Nearby excluding undecided rubbish and out-of-window chips (a Saturday return never suggested for Monday); a merged line producing one chip; a moved job flagging but not shifting.

### 3.4 Screens (match the mockup)

**`/pc/movements?view=week|day|map|gear&week=YYYY-MM-DD&day=YYYY-MM-DD&who=<id>`** — `PcNav` tab **Movements** between Schedule and Dashboard. Week defaults to next week Mon–Sat when today is Thu–Sun.

- **Headline** — "Week of 19 Oct — N chips still in the tray, M movements placed." / "Week of 19 Oct is planned." **Orders to place · K** pill (opens Day → Orders).
- **How this tab works** — three sentences from the mockup; open on first visit per browser (localStorage, try/catch), collapsed after; the strip is the training script.
- **Week — tray** (left, sticky; on a phone a bottom drawer): filter chips All · Paint · Materials · Gear · Rubbish with counts; chips grouped by job (closed jobs with stranded gear appear as their own group; "Warehouse" last); amber left edge = unplanned, clay = blocked with the reason; **+ Add a chip**. Tray search as the Schedule board has.
- **Week — board**: lane column sticky left; six day columns. A lane with `slots = 'half'` splits each cell **AM over PM** (full-width halves, faint AM/PM label bottom-right); a lane with `slots = 'hour'` (Felipe, Tom — ruling 16) shows **ten one-hour rows 07:30–16:30** with the hour label at the left of each row, each row a drop target that sets the movement's `time`; the lane header says "1-hour slots · 07:30–17:30". Saturday hatched; context blocks inside the half they belong to (all-day job blocks in the AM half, labelled); placed movements as cards (icon · title · branch · time · job ref · state line · actions **Ordered ✓** / **Done** / ↩ back to tray); **Nearby N — see** pill under the context that earned it; one **While you're there** ghost under a calendar/QA block (tap drops it). Dragging: pointer-based (the shared engine), ghost follows the finger, hot cells light cyan, the hovered half lights green, drop = `movement_place`; drop onto the tray = back to tray. Supplier lane refuses our own gear ("drop it on a person") and refuses a paint chip whose branch doesn't deliver (toast names the fix).
- **Sources view** (ruling 17): three cards side by side for one job — **Estimate builder** (crew notes as today + the new internal **Materials & sundries** list + the Materials card's paint rows), **Job page · pre-start** (the two gate items with their derived state, the paint chips per brand, the same materials list, the gear chips), **Movements · tray** (this job's chips, live, + Add a chip). Adding or removing a line in any card changes all three and creates/removes the tray chip. A line already on someone's day cannot be removed until it is back in the tray. The strip under the cards names the four doors (estimate · job page · painter request · tray) and the one record.
- **+ Add a chip** (tray and Sources): kind (Paint · Materials · Gear · Rubbish) → job (or Warehouse) → what; Gear shows the register with each item's current location and disables anything not at the warehouse; Paint takes a brand and lines (writes a Materials-card row flagged "added from the tray" for the office to confirm); Rubbish refuses a second chip for a job. Lands in the tray.
- **Chip sheet** (tap any chip, tray or placed): lines (paint: editable, writes `wo_set_material`; materials: the line text), items (gear, with locations), **shop nearest-first** with km and opens/delivers, time chips, order reference box, note, actions: **Ordered ✓** (when `needsOrder`), **Copy order text**, **Make it a skip** / **Painter takes it** / **None** (rubbish), **Back to tray**, **Save**. × closes; so does the overlay.
- **Day — run plans**: day chips with move counts; person chips (everyone with a stop that day); a numbered timeline from the warehouse: context stops (◌, dashed) and movements (numbered, with ▲▼ to reorder → `movement_set_sequence`, a big tick → done, km from the previous stop); header "Felipe · Mon 19 · 5 stops · 61 km"; **Map** and **Send to Felipe's phone**. **Orders to place** card: every `needsOrder` movement in the week, soonest first, with its own **Ordered ✓**; colours-TBC rows disabled with the reason.
- **Map** (Google Maps JS, ⚑4; rulings 21–22): **one icon per job** — a 26 px rounded square: teal with a house when nothing is outstanding; **amber with the icon of the first outstanding need** (`jobNeeds(job)` = chips in the tray + placed-but-unordered, the paint / materials / gear-type / rubbish icon) with a one-line "what's needed" under the address; grey house for a closed job with gear still on it. Warehouse as a dark square. Shops as faint dots, names only with the **Shops** toggle; a shop that is a stop today is drawn solid. **Order numbers** (the selected person's colour) sit top-left of the icon of each stop in that person's day; a fixed appointment shows ◌ in violet. **Route line** toggle off by default. Day chips, person chips. Right-hand **order card**: the person's stops for the day as rows (number · what · from → to · time · km), **drag the handle to reorder** (pointer events; fixed rows have no handle), **Run plan** and **Send to phone**. Reordering calls `movement_set_sequence` and re-slots times as in ruling 22. Legend card: the six icon meanings + the four need icons.
- **Gear** (ruling 18): filters All · At warehouse · Out on site · With a painter · Flagged; a legend strip of the nine type icons; a grid of cards with the **type icon**, name, tag, location detail + next movement, location pill (clay border when stranded); tap → trail (register trail + planned movements) with **Find it in the tray** (stranded) / **Edit item**. The same icon appears on gear chips on the board, in the tray and in the chip sheet.
- **Phone**: the week board scrolls sideways with the lane column sticky (as the Schedule board); the tray is a bottom drawer (58 px handle, 62 vh open); Day, Map and Gear are single-column. A person's own run plan is reachable at `/pc/movements/run?day=&who=me` for staff and as a **"Your pickups and drop-offs today"** card in the painter portal.

**Settings → Suppliers / Equipment / Movements** — as v1 §3.3 plus `boardPeople` (who gets a staff lane) and the map key check.

**Job page (`/pc/wo/[id]`) — pre-start**: `PrestartListBox` removed. Under "Materials ordered": the paint rows (existing) + this job's paint and materials chips rendered with the board's card component (tap → the same sheet) + the material lines list (add / merge / remove). Under "Equipment movements booked": the gear chips. The gate ticks read `gates(wo)`.

**Estimate builder**: internal **Materials & sundries** field beside Crew notes (one line per item, "what the painter needs that isn't paint — caulk, filler, tape, sheets, a plank hire"); never in the customer snapshot (`lib/estimate` snapshot test asserts absence); copies to `wo_material_lines` at issue.

**Painter portal + job sheet**: Materials & colours gains **Paint** ("Delivered to site Mon 19, morning" / "Pick up at Paint Spot Carnegie, 1066 Dandenong Rd, from 6:30 Tue 20 — order **PG-0093** under Paint Group" with Navigate + Call + **Picked up ✓**), **Loan gear** (items, on site from / collected), **Rubbish** ("Skip on site Tue–Thu" / "Take it to the tip — claim the fee under Expenses"), and — for staff-style drops on their lane (ruling 8) — a **"Your pickups and drop-offs today"** card on the portal home listing every movement assigned to them that day with ticks. Contractor HTML never carries an account number, a cost, a branch email, or another job's full address (server render, column privileges, asserted in the contractor role).

### 3.5 Flows that cross modules

- **Order step → painter alert.** `movement_mark_ordered(id)` sets `ordered_at`, status `booked`, and emits `movement_pickup_ready` (person picking up from a branch: shop, address, from what time, order ref) or `movement_delivery_booked` (supplier delivers: what, when, order ref) to the job's painter; `client_notice = true` additionally emits `movement_delivery_client_notice` to the customer (ruling 11: off by default, per movement). Staff-lane drops have no order step: placing them is booking them.
- **Run plan send.** `movement_send_run_plan(person, day)` emits `movement_run_plan` (SMS with a link to the person's own Day view; painters get the portal card link) and logs it on each movement.
- **Material request → line → chip.** On the dashboard `material_request` card and in `MaterialRequests.tsx`: **Accept as a line** creates `wo_material_lines(source='painter_request')`, the sync creates the chip, and the reply to the painter is drafted ("Added to the order — we'll text you when it's ready"); **Ordered ✓** later sends the pickup/delivery text. Declining works as today.
- **Pre-start gate.** `wo_tick_checklist_item` redefined (converging migration): **Materials ordered** requires `gates(wo).paint` (every paint chip ordered or done, or `not_needed` / `painter_supplies`) else `error:paint_not_ordered`; **Equipment movements booked** requires `gates(wo).gear` else `error:equipment_not_booked`; `colours_first` stays in front. The console's pre-start blocker names the chip.
- **Completion-prep answers.** "Equipment for collection? Yes" → `painter_confirmed_at` on the job's open `equipment_return` (creating a tray one if the office never did); "Rubbish? Yes" → the same for `rubbish_out`. `wo_handle_collection` becomes a wrapper over `movement_place`; the two `collect:` console cards are **retired** (Session 7) in favour of §6 items.
- **Job moved.** No trigger touches movements; the evaluator flags; the work item's one action is **Re-date** → `movement_redate`.
- **Cost intake.** `material_costs.movement_id null` links a matched invoice to its order; the Materials card's budget line shows "ordered $X · invoiced $Y". A `hire_off` ticked done with `expected_cost_cents` writes a `job_costs` row (`equipment_hire`, `recorded`, vendor = branch's vendor) when `recordHireCosts` is on (⚑9).
- **Project Progress lanes**: pre-start cards show "Paint ordered" / "Gear booked" pills or amber "Paint ⚑" / "Gear ⚑" from `gates(wo)`.

---

## 4. The board engine — Session 2, and why it is its own session

`ScheduleBoard.tsx` already solves pointer drag on touch, lanes × days, a tray with search, zoom and saved views. Building a second 2,000-line board is the wrong answer; so is changing the Schedule board's behaviour. Session 2 lifts the engine into `app/components/board/` — `Board`, `Lane`, `DayCell`, `Tray`, `useBoardDrag` (pointer capture, ghost, drop targets from `elementFromPoint`, auto-scroll at the edges), `useBoardZoom`, `SavedViews` — with **props for what differs**: cell sub-slots (none for Schedule, AM/PM for Movements), block renderers, drop validation, tray item renderer. `ScheduleBoard.tsx` is then re-pointed at the engine with **no behaviour change**: its unit tests and `e2e/scheduling/*` stay green, the diff on its CSS is additive only, and the session's report lists every prop the engine grew. Ruling to record in `CLAUDE.md`: **one board engine** — a new lanes × days screen uses `app/components/board/` or stops and reports.

---

## 5. Server boundary

Every mutation is a `SECURITY DEFINER` RPC with an explicit `grant execute … to authenticated`, zod-validated server actions, status columns revoked from client writes. One migration file per session; every file converges on re-run, starts with `set lock_timeout = '15s';`, ends with its read-back `select` and its `_prod_migrations` row; the SQL goes in the PR body for Tom; the next session reads the ledger before building on it.

| RPC | who | does |
|---|---|---|
| `movements_sync_for_wo(wo)` | definer, called by triggers + sweep + staff | §3.2; never changes a placed movement except `source_changed_at` |
| `movement_create(payload)` | staff | manual chips; validates kind/places; items; `wo_events` when job-linked |
| `movement_place(id, assignee_kind, assignee_id, due_date, half)` | staff | the drop. Validates: supplier lane refuses own gear and non-delivering branches; `blocked_by` must be done; sets `planned_for_start`, default `time`; status `tray → planned`, or `booked` for staff lanes (no order step) |
| `movement_unplace(id)` | staff | back to tray; clears assignee/date/`ordered_at`; refuses when `done` |
| `movement_mark_ordered(id)` | staff | `ordered_at`, status `booked`, `colours_first` check for paint, emits the painter text (+ client notice when flagged) |
| `movement_set_status(id, status, note)` | staff | `booked → done`, `→ problem`, `→ cancelled`; `equipment_out → done` writes nothing else (location is derived); creates auto returns on `booked` for out/hire/skip |
| `movement_redate(id, date, half)`, `movement_set_time(id, time)`, `movement_set_sequence(person, day, ids[])` | staff | |
| `movement_update(id, payload)` | staff | branch, note, `client_notice`, lines text for materials; paint lines go through `wo_set_material` |
| `movement_send_run_plan(person_kind, person_id, day)` | staff | emits `movement_run_plan`, logs |
| `movement_painter_done(id)` | the assigned painter | pickups, drop-offs, returns, takes-to-tip on their lane; sets `painter_confirmed_at` + `done` |
| `material_line_add/update/remove/merge(wo, …)`, `material_request_accept(request_id)` | staff | §3.1 / §3.5 |
| `wo_logistics_decide(wo, line, decision)` | staff | `not_needed` / `painter_supplies` |
| `equipment_item_create/update/set_status`, `supplier_branch_upsert`, `supplier_branch_set_account` | staff | as v1 |
| `wo_tick_checklist_item`, `wo_answer_checklist_item`, `wo_handle_collection` (redefined) | existing | §3.5 |

RLS: staff all on every new table; painters select `movements` where `assignee_id = their contractor id` **or** `work_order_id` is a live job of theirs (`wo_is_my_job_as_contractor` helper), columns limited to what the job sheet shows (no `expected_cost_cents`, no `note` from the office unless flagged `painter_visible`); painters select active `supplier_branches` columns `id, brand, branch, address, suburb, phone, opens_weekday, map_place_id`; customers nothing. `lib/movements/boundary.test.ts` greps `app/` and `lib/` for direct writes and for any `status =` on `movements` outside the RPCs; `lib/demo/boundary.test.ts` extended.

---

## 6. Work queue — registry entries (`PC_HOMED`)

| kind | fires when | due | one action |
|---|---|---|---|
| `movements_unplanned` | a job starts within `planningHorizonDays` and has tray chips | start − 3 days | Plan it → `/pc/movements?view=week&job=` |
| `order_unplaced` | a `needsOrder` movement is due within 2 days | due − 1 day | Ordered ✓ (inline) |
| `delivery_unconfirmed` | a supplier delivery due today still `booked` at `deliveryConfirmBy` | today 10:00 | Ring the shop |
| `movement_overdue` | past `due_date`, not done/cancelled | due date | Open on Day |
| `movement_problem` | status `problem` | now | Open |
| `equipment_stranded` | an item's location is `stranded` | WO close date | Find it in the tray |
| `hire_off_due` | `hire_off` due today or tomorrow, not done | due | Open |
| `job_moved` | `jobMoved()` true | now | Re-date |
| `materials_changed_after_order` | `source_changed_at` set on an ordered chip | now | Review the order |
| `material_request` (existing) | unchanged | | action gains **Accept as a line** |

Weights alongside `material_request: 28`; `equipment_stranded`, `movement_problem`, `delivery_unconfirmed` ~40. Dismissals and notes as every other item.

---

## 7. Sessions

Each session: feature branch; failing e2e first in the real role (PC for the board, contractor for the portal, anonymous customer to prove absence); evaluator and RPC unit tests; lint at the CI ceiling; CI checked after push; `docs/briefs/movements-progress.md` ledger updated; help files in the PR that ships the screen.

**Session 0 — read-only.** Commit the brief, the mockup, the CSVs. Confirm the file list. Report: `ScheduleBoard.tsx`'s drag/zoom/tray/saved-view responsibilities as a list (the extraction plan for Session 2); how `loadBoard` exposes employees vs contractors and end dates; what `readGoogleBusyForStaff` returns today and which staff have connected calendars (ids only); the current `wo_seed_checklists` rows and `wo_tick_checklist_item` signature; which of `20270243`, `20270266`, `20270248` have `_prod_migrations` rows; how `products.brand` is populated (coverage); suburb-centroid coverage for the seed suburbs; whether a browser-restricted Google Maps key exists (⚑4). No code.

**Session 1 — schema + seed.** Enums, `movements`, `movement_items`, `wo_material_lines`, `equipment_items`, `supplier_branches` (+ accounts), `wo_logistics_decisions`, the `movements` settings row, `is_demo` triggers, RLS incl. painter column grants, all RPCs in §5 except the redefinitions, grants, read-backs. `scripts/seed-suppliers.ts`, `scripts/seed-equipment.ts` (refuses without `EQUIPMENT_SEED_CONFIRMED=1`). Unit tests through role sessions for every transition and refusal.

**Session 2 — the board engine.** Extract `app/components/board/` from `ScheduleBoard.tsx`; re-point the Schedule board; **no behaviour change** (its e2e green, snapshot diff reviewed). `CLAUDE.md` ruling added.

**Session 3 — sync + evaluator + loaders.** `lib/movements/sync.ts`, `evaluate.ts` (+ golden tests), `load.ts` (`loadMovementsWeek(from, to)`: one round trip for jobs via `loadBoard`-compatible reads, movements + items, lines, decisions, branches, centroids, context reads incl. Google busy with its `GoogleRead` kinds surfaced as a line, not swallowed; `realOnly()` on every list; every read keeps its `error`). Registry builders of §6 with tests. Nothing on screen.

**Session 4 — Week (walking skeleton).** Route + nav tab, headline, how-it-works, tray with filters/search/+Add (from scratch, all four kinds), lanes, AM/PM cells **and hourly cells for `slots = 'hour'` lanes**, the Sources view (three cards over the one list), context blocks, drag-drop onto cells and back to the tray, chip sheet, Ordered ✓ / Done / ↩, Nearby pill + sheet, While-you're-there ghost, hot cells. e2e as PC: drag the Taubmans chip onto Felipe Mon AM → movement row; drag a paint chip onto the Supplier lane and tick Ordered → `ordered_at` set and the painter text drafted; drop onto a non-delivering branch refused with the toast. Light theme by default (ruling 15). Help: `docs/help/movements/pc.md` v1.

**Session 5 — Day + texts + painter side.** Run plans (timeline, reorder, ticks, km), Orders to place card, Send to phone, the five registry automations (draft-first), painter portal card + job sheet lines + Picked up ✓, staff `?who=me` run view. e2e as contractor: sees the pickup line with branch address and order ref, ticks Picked up, never sees an account number or a cost; as customer: nothing.

**Session 6 — Map + Gear + Settings.** Google Maps (loader, one icon per job that turns amber with the need's icon, warehouse, faint shop dots with a toggle, order numbers on the selected person's stops, route line toggle off by default), the **order card** beside the map with drag-to-reorder (`movement_set_sequence`, times re-slotted per ruling 22), Gear view with the nine type icons, trails and the stranded flag, Settings → Suppliers / Equipment / Movements (incl. `boardPeople` with `slots` and colour, masked account field). e2e: reorder two stops → numbers on the map and the run plan both change; clear a job's last tray chip → its icon turns teal.

**Session 7 — the crossings.** Estimate internal materials field → lines at issue (customer snapshot asserted clean); pre-start gate redefinition; material request → line; completion-prep answers → movements; `collect:` cards retired; `material_costs.movement_id`; hire → `job_costs`; Project Progress pills; `wo_prestart_lists` import + box removal.

**Session 8 — full loop, hardening, training.** Seed the mockup's week (four jobs, two stranded items, one running job) → plan every chip → run Mon–Sat → every item back at the warehouse → invoices matched by order ref. Lighthouse on the phone layouts. Help: `docs/help/movements/{pc,contractor}.md` final + `scheduling` cross-link; 30-second Claude-in-Chrome GIFs (help foundation Phase A); `docs/ARCHITECTURE.md` paragraph; `docs/manual-tests/movements-week-one.md` — Tom plans next week for real, on a laptop, in fifteen minutes, then opens Felipe's Monday on his phone.

---

## 8. Acceptance criteria (definition of done)

1. **Matches the mockup** — tray, lanes, AM/PM cells, context blocks, chips, sheet, Nearby, ghosts, Day, Map, Gear, light theme; the e2e that encodes the mockup's interactions passes; Tom's laptop + phone walkthrough ends without "that's not what the mockup does".
2. **One board engine.** The Schedule board runs on `app/components/board/` with its e2e green and no behaviour change; the Movements board adds no second drag implementation.
3. **Drag works with a finger** on a phone and a tablet (pointer events, capture, ghost, auto-scroll), and with a mouse — into AM/PM halves and into one-hour rows alike; a drop into an hour row sets the time.
3a. **One list, three doors.** A materials line added on the estimate, on the job page or in the tray appears in all three within one render and has one chip; removing it anywhere removes it everywhere; a line already placed on someone's day refuses removal until it is back in the tray.
3b. **Cards say what they are and whose they are** — the `kindLabel` set and the lane colour are identical on the board and in Day; gear carries its type icon everywhere.
3c. **The map reads at a glance** — a job with any chip in the tray or any unplaced order shows amber with the need's icon; clearing the last need turns it teal within one render; the selected person's order numbers match the order card and the run plan exactly, including after a drag.
4. **Chips come from the jobs.** A WO with Dulux and Taubmans rows yields two paint chips; three material lines yield three chips (one after merging two); every booked out gets its return chip; a job closed with gear on site gets a return chip in the tray by the next morning.
5. **The order step alerts the painter.** Ordered ✓ on a pickup texts the painter the shop, address, from-time and order ref (draft-first until Tom flips it); on a delivery, what's coming when; the client gets nothing unless the per-movement toggle is on.
6. **Gates are real** — the two pre-start ticks refuse without the chips in the right state, proven at the API level.
7. **Location follows the ticks**; two identical ladders never swap identities; stranded gear flags itself.
8. **Moved jobs flag, never shift.**
9. **Painters see exactly enough**, asserted on rendered HTML in the contractor role; customers see nothing.
10. **Nothing silent** — every list read on the tab renders its failure line; a Google Calendar that can't be read says so on the lane rather than showing an empty day.
11. **Demo wall holds** across every new table and view.
12. **Help and training** — `docs/help/movements/{pc,contractor}.md`; the three-sentence strip is the first paragraph; `npm run help:index -- --check` green.
13. **CI green on every push**; customer-journey suite untouched and green.

---

## 9. ⚑ Decisions for Tom (defaults chosen so Session 1 can start)

| # | question | default until ruled |
|---|---|---|
| ⚑1 | **Warehouse address** — the Bunney Rd company address, or elsewhere? | Company address; Settings → Movements |
| ⚑2 | **"Nearby" radius** — how far counts as "while you're there"? | 7 km, Settings |
| ⚑3 | **Geocode jobs** at WO issue through the existing Places route (so Nearby and the map use real points, not suburb centres)? | Yes — `work_orders.lat/lng`, filled lazily; centroids until then |
| ⚑4 | **Google Maps browser key** — the platform's Places key is server-side; the map needs a browser key with Maps JavaScript API on and the domain restricted. Tom creates it in the same Google Cloud project (≈5 min, steps in Session 0's report) | Session 6 blocked until the key exists; Leaflet stand-in is **not** shipped |
| ⚑5 | **Who gets a staff lane** — Felipe, Tom, Saul, Adi, Abdul (Saul/Adi/Abdul are the employed painters, so they already appear as painters; a staff lane only adds "move things" to their day). Anyone else? | Those five via `boardPeople`; employees' lanes merge job + movements |
| ⚑6 | **Calendar detail on the board** — titles ("Estimate visit · Brighton") or just "Busy"? Titles need the read scope on Tom's and Felipe's connections | Titles when the scope is granted, else "Busy" |
| ⚑7 | **Route line on the map** (off by default) — straight lines between stops (free) or real driving routes (Directions API, billed per request)? | Straight lines in v1 |
| ⚑8 | **Sending orders** — v1 copies order text to paste into the email or trade app. Email the branch directly later? | Copy only; `email` column seeded empty |
| ⚑9 | **Hire costs** — record the expected cost at booking and write `job_costs` (`equipment_hire`) at off-hire? | Yes, `recordHireCosts = true` |
| ⚑10 | **"Painter supplies"** — allowed as an answer that unlocks "Materials ordered" when the painter buys the paint themselves? | Yes, recorded as a decision, shown amber on the board |
| ⚑11 | **Run plan channel** — SMS with a link, or push (when the PWA ships)? | SMS link |
| ⚑12 | **The real equipment list** — replace the template rows | Seed refuses without `EQUIPMENT_SEED_CONFIRMED=1` |
| ⚑13 | **Supplier pruning** — Baycity Rentals (Cheltenham) for "Bayside City Rentals", Alya Access for "Alya Hire"; Taubmans Mitcham + Cranbourne unverified; Bunnings Northland closed | Verified rows active; unverified inactive |
| ⚑14 | **Materials field on the estimate** — one free list per estimate, or per area? | One list per estimate |

Trade account numbers are in none of these files; Tom enters them in Settings after Session 6.

---

## 10. Out of scope (so nobody builds it by accident)

Route optimisation (the van order is a hint; Directions is ⚑7); ordering through supplier portals/APIs; consumable stock counts; QR scanning of gear (v2); pay for rubbish drop-off (ruled out); multi-warehouse; vehicle tracking; the painter job-pack message (messaging brief — it reads these movements when built).
