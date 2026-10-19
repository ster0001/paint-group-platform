# Build plan — PC Command → Movements

**For:** Tom (runs the sessions, pastes the SQL, makes the calls). **Built by:** Claude Code, one session per step, in its own git worktree.
**Source of truth for *what* to build:** `docs/briefs/claude-code-brief-pc-movements.md` (v2.2) + `design/reference/pc-movements-mockup.html` (v4). This document is the *order*, the *prompts*, and *what you do between sessions*.
**Shape:** 9 sessions (0–8). Two can run side by side. Felipe gets a usable board at the end of Session 4; painters start getting texts after Session 5; everything is wired after Session 7; Session 8 is proof and training.

---

## 0. Before you start (half an hour, once)

Do these in order. Nothing below works without the first two.

1. **Commit the bundle** to the repo, on `main`, in one commit:
   - `docs/briefs/claude-code-brief-pc-movements.md`
   - `docs/briefs/movements-build-plan.md` (this file)
   - `design/reference/pc-movements-mockup.html`
   - `docs/briefs/data/suppliers-seed.csv`
   - `docs/briefs/data/equipment-seed-template.csv`
   Commit message: `docs: Movements brief v2.2, build plan, mockup v4, seed data`.
2. **Answer the flags you can answer now** by editing §9 of the brief in place (replace the default with your ruling, leave the ⚑ number). The ones that matter before code: ⚑1 warehouse address, ⚑5 who gets a staff lane (and which are hourly), ⚑12 the real equipment list (edit the CSV — tags can be blank, they're assigned on save), ⚑13 confirm Baycity Rentals and Alya Access are the right yards. Everything else has a default and can wait.
3. **Google Maps browser key** (⚑4, needed by Session 6, not before). In the Google Cloud project that holds the Places key: APIs & Services → Credentials → Create credentials → API key → restrict to **HTTP referrers** (`paint-group-platform.vercel.app/*`, `localhost:3000/*`, `localhost:3101/*`) and to the **Maps JavaScript API**. Put it in Vercel and `.env.local` as `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`. Session 0 will tell you if this is already done.
4. **Decide the rollout date for Felipe.** The plan below assumes he plans one week on paper *and* on the board in parallel (Session 8), then switches. Pick that week now so Session 8 can be timed to land the Thursday before it.

---

## 1. The order, and why

```
S0 read-only ─┬─ S1 schema + seed ──── S3 sync + evaluator ──┐
              │                                              ├─ S4 Week board ── S5 Day + texts + painter ── S6 Map + Gear + Settings ── S7 crossings ── S8 proof + training
              └─ S2 board engine (independent, can run beside S1/S3) ┘
```

- **S1 and S2 can run at the same time** in two worktrees: S1 touches `supabase/` and `lib/`, S2 touches `app/pc/schedule/` and `app/components/board/`. They don't overlap. (Repo rule: two worktrees, separate ports, and only one of them runs e2e at a time.)
- **S3 waits for S1** (it needs the tables). **S4 waits for S2 and S3.**
- **S5–S8 are in series** — each builds on the screen before it.
- The brief's acceptance criteria (§8) are the exit test for the whole thing; each session below has its own gate.

**Rough effort**, going on how fast the rest of the platform went: S0 an hour; S1, S3, S5, S6, S7 each about a day; S2 a day with a careful review; S4 a day and a half (it is the biggest screen); S8 a day plus your fifteen minutes. **Two working weeks** if the SQL pastes and the decisions don't queue up — which is the thing to watch, so each session's "your part" is listed below.

---

## 2. Rituals that apply to every session

- **Kickoff**: paste the session prompt. The first thing Claude Code does is confirm the file list back. If it can't find a referenced file, it stops and says so — do not let it build around a missing file.
- **Branch + worktree**: `feat/movements-sN-<name>`, its own worktree, its own port.
- **Tests first**: the failing e2e in the real role, then the code. Customer-journey suite must stay green.
- **Migrations**: every SQL file converges on re-run, starts with `set lock_timeout = '15s';`, ends with a read-back `select` and its `_prod_migrations` row. The SQL goes in the PR body. **You paste it, then the next session reads `_prod_migrations` before building on it.** "sql done" is not proof; the ledger row is.
- **CI after every push.** A red run on an unmerged branch is a defect.
- **Ledger**: `docs/briefs/movements-progress.md` updated at the end of every session (template in §5 below).
- **Help**: `docs/help/movements/<role>.md` ships in the same PR as the screen it describes.
- **Demo wall**: every new job-linked table gets `is_demo` + the copy trigger; every list read goes through `realOnly()`.

---

## 3. The sessions

### Session 0 — Read-only reconnaissance (no code)

**Why:** so Sessions 1–4 start from facts, not guesses — especially what is inside `ScheduleBoard.tsx`, what the calendar read returns, and which migrations are really live.

**Your part before:** step 0 above (the bundle is committed).

**Kickoff prompt — paste as-is:**

```
Session 0 of docs/briefs/movements-build-plan.md — read-only reconnaissance for PC Command → Movements.

Read docs/briefs/claude-code-brief-pc-movements.md (v2.2) and open design/reference/pc-movements-mockup.html. Confirm the file list from brief §0 back to me before anything else; stop and report on any file that is missing.

Then produce docs/briefs/movements-session-0-report.md covering, with file paths and line numbers:
1. app/pc/schedule/ScheduleBoard.tsx — its responsibilities as a list (pointer drag, ghost, drop targets, auto-scroll, tray + search, zoom, saved views, blocked days, offer confirm), which of those are board-generic and which are Schedule-specific. This is the extraction plan for Session 2.
2. lib/scheduling/board.ts loadBoard — how employees vs contractors are distinguished, how end dates and painter names come out, and what a Movements loader can reuse unchanged.
3. lib/gcal/read.ts readGoogleBusyForStaff — exact return shape, whether titles are available or only busy blocks, and which staff profiles have a connected calendar (ids only).
4. The current wo_seed_checklists rows and the current wo_tick_checklist_item / wo_answer_checklist_item signatures on main.
5. Read-only ledger check (IMPORT_DATABASE_URL, select name, applied_at from public._prod_migrations): do 20270243, 20270248, 20270266 have rows? List any migration file under supabase/migrations newer than 20270200 with no row.
6. products.brand — how populated, how many products lack a brand (paint chips group by it).
7. visit_suburbs — centroid coverage for every suburb in docs/briefs/data/suppliers-seed.csv; list the misses.
8. Whether a browser-restricted Google Maps key exists (env names, Vercel), and if not, the exact steps for Tom.
9. Anything in the brief that contradicts the code as it stands today.

No code changes. No migrations. Update docs/briefs/movements-progress.md (create it from the template in build-plan §5) with the session summary.
```

**Gate:** the report exists, you've read it, and item 9 is empty or you've ruled on each point. **Your part after:** paste any missing migrations it found (item 5) before Session 1 starts.

---

### Session 1 — Schema, RPCs, seed

**Why:** the two records (movements, equipment) and the three supporting tables, with every rule enforced in the database, before any screen exists.

**Kickoff prompt:**

```
Session 1 of docs/briefs/movements-build-plan.md — schema + RPCs + seed for Movements. Brief: docs/briefs/claude-code-brief-pc-movements.md §3.1, §4 (table), §5. Read docs/briefs/movements-session-0-report.md first and confirm the file list back.

Build, on branch feat/movements-s1-schema, in its own worktree:
- One migration 2027NNNN0000_movements.sql (converging; set lock_timeout; read-back select; _prod_migrations row) creating: enums movement_kind, movement_status, movement_assignee, place_kind, branch_kind, equipment_category (Tom's nine types + other), equipment_status; tables movements, movement_items, wo_material_lines, equipment_items (+ equipment_tag_seq), supplier_branches, supplier_branch_accounts, wo_logistics_decisions; the settings row 'movements' with the defaults in §3.1 (warehouse = company_profile address until Tom changes it; boardPeople empty — Settings fills it); is_demo columns + copy triggers; RLS on every table (painters: movements on their jobs/assignments with the column limits in §5, supplier_branches active rows with the listed columns only, nothing on accounts/items/decisions; customers nothing); indexes from §3.1.
- Every RPC in §5 except the three redefinitions (those are Session 7): movements_sync_for_wo, movement_create, movement_place, movement_unplace, movement_mark_ordered, movement_set_status, movement_redate, movement_set_time, movement_set_sequence, movement_update, movement_send_run_plan (stub that logs — the automations are Session 5), movement_painter_done, material_line_add/update/remove/merge, material_request_accept, wo_logistics_decide, equipment_item_create/update/set_status, supplier_branch_upsert, supplier_branch_set_account. SECURITY DEFINER, explicit grants, zod'd server actions in app/pc/movements/actions.ts.
- scripts/seed-suppliers.ts (CSV → vendors by brand + supplier_branches by (brand, branch), lat/lng from visit_suburbs, UNVERIFIED rows inactive, never touches accounts) and scripts/seed-equipment.ts (refuses without EQUIPMENT_SEED_CONFIRMED=1).
- Tests through role sessions, never the service key: every transition and every refusal (colours_first on paint→ordered, stranded item on place, supplier lane refusing own gear and a non-delivering branch, painter calling a staff RPC → not_staff, customer reading movements → empty with no error). lib/movements/boundary.test.ts and the demo boundary test extended.

Deliver: PR with the SQL in the body for Tom, docs/ARCHITECTURE.md paragraph, ledger updated. Do not build any screen.
```

**Gate:** CI green; the PR body has the SQL; the test list in the PR shows every refusal. **Your part after:** paste the migration, then run `npx tsx scripts/seed-suppliers.ts`, and `EQUIPMENT_SEED_CONFIRMED=1 npx tsx scripts/seed-equipment.ts` once the CSV is yours. Then enter the trade account numbers in Settings → Suppliers once Session 6 ships (not before — there's no screen yet, and they never go in a file).

---

### Session 2 — The board engine (runs beside Session 1)

**Why:** the Schedule board already has drag that works on a phone. We want one engine, not two. This is the one session that touches a shipped screen, so its gate is "nothing changed".

**Kickoff prompt:**

```
Session 2 of docs/briefs/movements-build-plan.md — extract the board engine. Brief §4. Read docs/briefs/movements-session-0-report.md item 1 (the extraction plan) and confirm the file list back.

On branch feat/movements-s2-board-engine, in its own worktree:
- Create app/components/board/ with Board, Lane, DayCell, Tray, useBoardDrag (pointer capture, ghost, drop targets by elementFromPoint, edge auto-scroll), useBoardZoom, SavedViews — lifted from app/pc/schedule/ScheduleBoard.tsx. Props for what differs: cell sub-slots (none / AM-PM / hourly rows), block renderer, tray item renderer, drop validation, lane header renderer.
- Re-point ScheduleBoard.tsx at the engine with NO behaviour change: every existing unit test and e2e/scheduling/* stays green without edits; the CSS diff is additive only.
- Write e2e/board-engine.spec.ts proving a drag on the Schedule board still opens the confirm step, still refuses the wrong drop, still works on a touch viewport.
- Add the "one board engine" ruling to CLAUDE.md under Architecture boundaries.
- In the PR, list every prop the engine grew and why.

No Movements screen in this session. Ledger updated.
```

**Gate:** Schedule e2e green with zero test edits; you open `/pc/schedule` on your phone and drag an offer exactly as before. **Your part after:** that phone check. If anything feels different, say so before S4 starts — this is the cheapest moment to fix it.

---

### Session 3 — Sync, evaluator, loaders (waits for S1)

**Why:** everything the screens show is computed here, once, with tests. Chips come from the jobs; nothing on screen is typed twice.

**Kickoff prompt:**

```
Session 3 of docs/briefs/movements-build-plan.md — sync + evaluator + loaders. Brief §3.2, §3.3, §6. Read docs/briefs/movements-progress.md and verify (read-only ledger) that Session 1's migration has its _prod_migrations row; stop if it doesn't. Confirm the file list back.

On branch feat/movements-s3-evaluator:
- lib/movements/sync.ts: movements_sync_for_wo as the TS mirror of the RPC's rules (paint chip per product brand from the Materials rows with source_key paint:<brand>; one chip per unmerged material line; one undecided rubbish chip per job; auto return chips keyed return:<id>, hire_off:<id>; stranded-gear return chips; never touches a placed movement except source_changed_at). Pinned against the RPC by a test that runs both on the same fixtures.
- lib/movements/evaluate.ts, pure: lanes(window) (supplier; every painter booked/assigned/with a movement in the window — contractors and employees alike; boardPeople in Settings order), context(lane, day) (jobs from loadBoard, Google busy via readGoogleBusyForStaff with GoogleRead kinds surfaced as a line, QA checks, site check-ins, walkthroughs, leave), kindLabel, laneColour, methodOf, needsOrder, window(chip), nearby, hotCells, whileYouAreThere (nearest first), orderedStops/runPlan (seq, then time; fixed context stays at its time), reorder (same set of times handed out in the new order), locations, jobNeeds, jobMoved, gates, counts. Golden tests for the cases listed in brief §3.3.
- lib/movements/load.ts loadMovementsWeek(from, to): one round trip per source, every read keeps its error, realOnly() on every list, failure lines returned not thrown.
- The nine registry entries of brief §6 in lib/crm/work-queue.ts as pure builders + readers, with tests; nothing wired to a screen yet.

Ledger updated. No screens.
```

**Gate:** golden tests cover every listed case; the sync mirror test passes; CI green. **Your part after:** none.

---

### Session 4 — The Week board (waits for S2 + S3) — first usable screen

**Why:** this is the thing Felipe uses. It must match the mockup, not approximate it.

**Kickoff prompt:**

```
Session 4 of docs/briefs/movements-build-plan.md — the Week board and Sources. Brief §3.4 (Week, Sources, + Add a chip, chip sheet), rulings 7–9, 15–17, 20. Open design/reference/pc-movements-mockup.html and match it. Confirm the file list back.

On branch feat/movements-s4-week, using app/components/board/ (no second drag implementation):
- Route /pc/movements (view=week|sources, week=, job=), PcNav tab "Movements" between Schedule and Dashboard, headline from counts(), the three-sentence "How this tab works" strip (open on first visit per browser, try/catch localStorage).
- Tray: filters with counts, search, grouped by job (closed jobs with stranded gear as their own group, Warehouse last), amber = unplanned, clay = blocked with the reason, + Add a chip (Paint / Materials / Gear with the register and locations / Rubbish).
- Board: lane column sticky left; AM/PM halves for slots='half' lanes; ten one-hour rows 07:30–16:30 for slots='hour' lanes (hour label left of each row; a drop sets time); context blocks in their half/hour; movement cards with kind label, lane colour, state line, Ordered ✓ / Done / ↩; Nearby pill + sheet; one While-you're-there ghost per calendar/QA block (nearest first); hot cells while dragging; drop validation toasts (own gear on Supplier, non-delivering branch, out-of-window warning).
- Chip sheet: paint lines (writes wo_set_material), material line text, gear items with locations, rubbish "how" = Painter disposed / Painter drops at warehouse / Left on site (ruling 20), shop nearest-first, time chips (hourly for hour lanes), order reference, client notice toggle (off by default), note, Ordered ✓, Copy order text, Back to tray, Remove (manual chips).
- Sources view: the three cards over the one list, add/remove lines from any card, the "three doors, one record" strip.
- Light theme default. Phone: board scrolls sideways, tray is the bottom drawer.
- e2e as PC (customer-journey stays green): drag the Taubmans chip onto Felipe Mon 10:30 → movement row with time 10:30; drag a paint chip onto the Supplier lane, tick Ordered → ordered_at set, painter text drafted (not sent); drop onto a non-delivering branch refused with the toast; add a line on the estimate card → chip in the tray; pick "Painter drops at warehouse" → movement on the painter's last day.
- docs/help/movements/pc.md v1 (template in docs/help/_template.md; the strip's three sentences are the first paragraph).

Ledger updated. Day, Map and Gear are later sessions — leave their tabs out, not stubbed.
```

**Gate:** you open it on a laptop and plan next week's real jobs on it (data is real after S1's seed and the sync runs on issued WOs). It should take you under fifteen minutes and you should not need to type anything that the system already knew. Then open it on your phone and drag one chip. **Your part after:** write down everything that made you stop and think — that list is Session 8's hardening input.

---

### Session 5 — Day run plans, the texts, the painter side

**Why:** the order step is what makes the board worth it to painters — "ready at Dulux Preston from 6, order PG-0092".

**Kickoff prompt:**

```
Session 5 of docs/briefs/movements-build-plan.md — Day, texts, painter side. Brief §3.4 (Day), §3.5 (order step, run plan send), rulings 10–11, 14, 22. Confirm the file list back.

On branch feat/movements-s5-day:
- view=day: day chips with counts, person chips in lane colours, the numbered timeline from the warehouse (context stops ◌ and dashed; movements numbered with km from the previous stop), ▲▼ reorder → movement_set_sequence (times re-slotted per ruling 22), ticks → movement_set_status done, "Map & reorder" link, Send to <name>'s phone; Orders to place card (every needsOrder movement in the week, soonest first, Ordered ✓ inline, colours-TBC rows disabled with the reason).
- Automations (lib/automations/registry.ts, draft-first, Settings toggles): movement_pickup_ready, movement_delivery_booked, movement_delivery_client_notice (per-movement opt-in, default off), movement_run_plan, movement_arrived_check. movement_mark_ordered emits the first three; movement_send_run_plan the fourth; the sweep the fifth.
- Painter portal: "Your pickups and drop-offs today" card on the portal home (every movement on their lane that day, ticks → movement_painter_done); job sheet lines in Materials & colours: Paint (delivered when / pick up where, from what time, order ref, Navigate + Call + Picked up ✓), Loan gear (items, on site from / collected), Rubbish instruction. Staff run view at /pc/movements/run?day=&who=me.
- e2e as contractor: sees the pickup line with branch name, address, from-time and order ref; ticks Picked up → done; the rendered HTML contains no account number, no cost, no branch email, no other job's address. e2e as customer: none of it exists.
- docs/help/movements/contractor.md; portal-gaps help updated.

Ledger updated.
```

**Gate:** with automations in draft mode, tick Ordered on a real pickup and read the drafted text — it should be sendable without editing. **Your part after:** flip `movement_pickup_ready` and `movement_delivery_booked` to automatic when you're happy with a week of drafts (the usual messaging rollout). Leave the client notice draft-only until a customer has asked for it.

---

### Session 6 — Map, Gear, Settings (needs the Google key)

**Kickoff prompt:**

```
Session 6 of docs/briefs/movements-build-plan.md — Map, Gear, Settings. Brief §3.4 (Map, Gear, Settings), rulings 13, 18, 21, 22, flags ⚑4 ⚑7. Stop and report if NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY is missing. Confirm the file list back.

On branch feat/movements-s6-map:
- view=map on Google Maps JS: one icon per job — teal house when jobNeeds() is empty, amber with the first need's icon (paint / materials / the gear type / rubbish) when not, grey house for a closed job with gear still on it; address + one "what's needed" line; warehouse as a dark square; shops as faint dots, names only with the Shops toggle, solid when a stop today; order numbers in the person's colour on each stop of the selected person's day (◌ violet for fixed appointments); Route line toggle off by default (straight lines); day chips, person chips. Jobs use work_orders.lat/lng when present (⚑3, filled lazily through the existing Places details route), suburb centroid otherwise.
- The order card beside the map: the person's stops for the day as rows, drag the handle to reorder (fixed rows have no handle), Run plan, Send to phone; reorder → movement_set_sequence; the numbers on the map and in Day follow.
- view=gear: filters, the nine-icon legend, cards with the type icon (lib/movements/gearIcons.tsx), tag, location detail + next movement, pill; trail with Find it in the tray / Edit item. The same icons on gear chips and in the chip sheet.
- Settings → Suppliers (branches by brand, kind filter, add/edit, active, favourite, account ref saved to supplier_branch_accounts and masked after save), → Equipment (register, tag on save, status, photo), → Movements (warehouse, nearKm, horizon, deliveryConfirmBy, boardPeople with slots + colour, hourSlots, recordHireCosts, showHowItWorks).
- e2e: reorder two stops → numbers on the map and Day change together; clear a job's last tray chip → icon turns teal; a stranded item shows the clay pill and its return chip is findable from the card.
- Help files updated (pc.md gains Map/Gear/Settings sections).

Ledger updated.
```

**Gate:** Thursday's map on your phone reads at a glance — you can say which jobs still need something without tapping. **Your part after:** enter the trade account numbers in Settings → Suppliers; set `boardPeople` (Felipe and Tom hourly; Saul, Adi, Abdul AM/PM); check the warehouse pin is where the warehouse is.

---

### Session 7 — The crossings (ties it into everything else)

**Kickoff prompt:**

```
Session 7 of docs/briefs/movements-build-plan.md — the crossings. Brief §3.5, rulings 12, 17, 20, flags ⚑9 ⚑10. Confirm the file list back; read the ledger and verify Sessions 1–6 migrations have _prod_migrations rows.

On branch feat/movements-s7-crossings, one converging migration:
- Estimate builder: internal "Materials & sundries" list beside Crew notes (builder_state.internalMaterials[]); copied to wo_material_lines(source='estimate') at WO issue; the customer snapshot test asserts it is absent from every customer-facing render.
- Redefine wo_tick_checklist_item: "Materials ordered" requires gates(wo).paint (every paint chip ordered/done, or not_needed / painter_supplies) else error:paint_not_ordered; "Equipment movements booked" requires gates(wo).gear else error:equipment_not_booked; colours_first stays in front. Console pre-start blocker names the chip.
- Redefine wo_answer_checklist_item: "Equipment for collection? Yes" sets painter_confirmed_at on the open equipment_return (creating a tray one if none); "Rubbish? Yes" the same for rubbish (method 'site'). wo_handle_collection becomes a wrapper over movement_place. Retire the two collect: cards in lib/workorder/console.ts §5b and the collections read in consoleData.ts — the §6 work items replace them.
- Material requests: Accept as a line (material_request_accept) on the dashboard card and MaterialRequests.tsx; reply drafted.
- Job page pre-start: PrestartListBox removed; paint rows + this job's paint/materials chips (board card component, same sheet) + material lines list under "Materials ordered"; gear chips under "Equipment movements booked"; existing wo_prestart_lists text imported once as lines (source='pc') — show the import count in the PR.
- material_costs.movement_id; Materials card budget line shows "ordered $X · invoiced $Y". hire_off done with expected_cost_cents → job_costs (equipment_hire, recorded) when recordHireCosts.
- Project Progress pre-start cards: "Paint ordered" / "Gear booked" pills from gates(wo).
- API-level adversarial tests for both gate refusals; e2e for the estimate field never reaching a customer.

Ledger updated. docs/help/work-orders/pc.md updated.
```

**Gate:** on a real job, "Materials ordered" refuses until the paint chip is ordered; the old free-text equipment box is gone and nothing was lost (the import count matches). **Your part after:** paste the migration, then check one old job's pre-start — its old notes should appear as lines.

---

### Session 8 — Full loop, hardening, training

**Kickoff prompt:**

```
Session 8 of docs/briefs/movements-build-plan.md — full loop, hardening, training. Brief §7 Session 8 and §8 (every acceptance criterion). Confirm the file list back; read docs/briefs/movements-s4-notes.md (Tom's list of things that made him stop) and treat each as a defect to fix or a decision to flag.

On branch feat/movements-s8-proof:
- e2e/movements/full-loop.spec.ts on the test project: seed the mockup's week (four jobs, one running, two closed with stranded gear, Felipe + Tom hourly, three employees) → plan every chip → order every order → run Mon–Sat with ticks from the PC and the painter → every item back at the warehouse → a supplier invoice with the PG- ref lands on its movement. Assert every §8 criterion that can be asserted.
- Lighthouse ≥ 90 on the phone layouts of Week, Day and Map.
- Fix the Session 4 notes.
- docs/help/movements/pc.md and contractor.md final; a 30-second Claude-in-Chrome GIF for each (help foundation Phase A); docs/ARCHITECTURE.md paragraph; docs/manual-tests/movements-week-one.md — Tom plans next week for real in fifteen minutes on a laptop, then opens Felipe's Monday on his phone and reorders two stops on the map.
- A Settings toggle movements_tab (default on) so the tab can be hidden in one click if week one goes wrong.

Ledger closed out with "what's next" (⚑7 Directions, QR scanning, the job-pack message).
```

**Gate:** the full-loop e2e is green and you've done the manual test yourself. **Your part after:** §4 below.

---

## 4. Rollout — Felipe's first two weeks

**Week A (the Thursday after Session 8):** Felipe plans the following week **twice** — his list as usual, and the board. Nothing is sent to painters from the board yet (automations in draft). Friday: the two of you compare. Every difference is either a missing chip source (fix) or a habit the board should learn (note).

**Week B:** the board is the plan. Texts go automatic for pickup-ready and delivery-booked. Felipe runs Monday from his phone's Day view. You watch the dashboard's new cards (`order_unplaced`, `delivery_unconfirmed`, `equipment_stranded`) — if they're noisy, tune `nearKm` and `planningHorizonDays` in Settings rather than the code.

**Training is the strip.** Three sentences, open on first visit. The help files and the two GIFs cover the rest. If Felipe needs more than that, the screen is wrong, not the training.

**Rollback:** Settings → `movements_tab` off hides the tab; the old pre-start text is preserved as lines; nothing in the Schedule board changed. The texts stop when the automations are turned back to draft.

---

## 5. Ledger template — `docs/briefs/movements-progress.md`

```
# Movements — progress ledger

| Session | Branch | PR | Migration | _prod_migrations row | Status | Date |
|---|---|---|---|---|---|---|
| 0 recon | — | — | — | — | | |
| 1 schema + seed | feat/movements-s1-schema | | 2027NNNN0000_movements.sql | | | |
| 2 board engine | feat/movements-s2-board-engine | | — | — | | |
| 3 evaluator | feat/movements-s3-evaluator | | — | — | | |
| 4 week | feat/movements-s4-week | | — | — | | |
| 5 day + texts | feat/movements-s5-day | | | | | |
| 6 map + gear + settings | feat/movements-s6-map | | | | | |
| 7 crossings | feat/movements-s7-crossings | | | | | |
| 8 proof | feat/movements-s8-proof | | — | — | | |

## Decisions taken in sessions (⚑ numbers from the brief)
- 

## Defects found and fixed
- 

## Tom's Session 4 notes → docs/briefs/movements-s4-notes.md
```

---

## 6. What could go wrong, and the cheap answer

| Risk | Cheap answer |
|---|---|
| Session 2 changes the Schedule board's feel | Gate is zero test edits + your phone check before S4 starts. If it fails, S4 builds on the engine anyway and the Schedule board is re-pointed later — the two can coexist for a week. |
| Google key not ready for S6 | S6 is the only session that needs it; run S7 first if the key is late. |
| Paint chips wrong because `products.brand` is patchy | S0 item 6 tells you; a product with no brand groups under "Paint (brand?)" and the chip says so — fix the products in Settings, not the code. |
| Felipe's calendar not connected | The lane still works; it shows "Calendar not connected" on the lane instead of an empty day. Connect it in the portal's Calendar tab. |
| Too many "nearby" suggestions | `nearKm` in Settings. Start at 7, drop to 5 if it's noisy. |
| A migration paste stops halfway | Every file converges on re-run — paste it again, then read the ledger row. |
| SMS costs from the new texts | Pickup-ready and delivery-booked are one text each per movement; the run plan is one per person per day. Client notice is off. The messaging module's existing per-month cap applies. |
