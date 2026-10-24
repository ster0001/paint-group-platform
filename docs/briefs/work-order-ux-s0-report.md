# Work order UX — Step 0 report (map and report)

**Date:** 24 Oct 2026 · **Brief:** `docs/briefs/claude-code-brief-work-order-ux.md` · **Mockup:** `docs/mockups/work-order-ux-mockup.html`
**Code changed:** none. This branch adds the brief, the mockup, this report and one read-only diag script.
**Status:** STOPPED, waiting for Tom to read this before Step 1.

---

## 0. Other builds in flight (conflict check)

| Where | Branch | Touches | Overlap with this build |
|---|---|---|---|
| `~/pgp-painthome` (Paint Home homepage, session running) | `feat/paint-home-s2-content` | `app/(marketing)`, `app/(app)/settings/showcase`, `lib/marketing`, `lib/showcase`, `e2e/marketing`, migration **20270299** | None in code. Shared files only `docs/ARCHITECTURE.md` (one paragraph each, merges clean) and `docs/help/_index.json` (regenerated). **This build's first migration must be 20270300 or later.** |
| `~/pgp-fix` | `fix/prestart-chip-ordered-on-job-page` | merged (#364) | none |
| `~/pgp-wo-paint`, `~/pgp-extv2on`, `~/pgp-agreement`, `~/pgp-e2e-fix` | all merged | — | none |

The main checkout (`~/Documents/paint-group-platform`) is on iCloud, 53 commits behind `origin/main`, and `grep`/`git fetch` hang on evicted files. This build runs in a fresh clone, `~/pgp-wo-ux`, branched from `origin/main` at `497ae263`.

## 1. Reference list — confirmed with real paths

| Brief says | Real path | Note |
|---|---|---|
| WO loop brief | `docs/briefs/claude-code-brief-wo-loop-pc-command.md` | ok |
| Standards / status brief | `docs/briefs/claude-code-brief-standards-status-callbacks.md` | ok |
| Messaging inventory | `docs/briefs/messaging-automations-inventory.md` | ok |
| Customer portal brief | `docs/briefs/claude-code-brief-customer-portal.md` | ok |
| Home dashboard v2 brief | `docs/briefs/claude-code-brief-home-dashboard-v2.md` | ok |
| `app/portal/jobs/[id]/` | same | painter work order page; `TickList` is imported from `app/components/wo/TickList.tsx` |
| `app/pc/wo/[id]/` + mirror | `app/pc/wo/[id]/page.tsx`, `app/pc/wo/[id]/as-contractor/page.tsx` | both render the same `TickList` with `surface="console"` |
| `lib/workorder/` "eleven test files" | 45 `*.test.ts` files | the count in the brief is stale; nothing missing |
| Customer timeline | `lib/portal/timeline.ts` (pure builder), `lib/portal/data.ts` (reads), `app/account/(portal)/JobTimeline.tsx` (render) | found |
| `ARCHITECTURE.md` | `docs/ARCHITECTURE.md` | root file does not exist |
| `CLAUDE.md` | same | ok |
| Brief + mockup | were only in `~/Downloads` | **committed on this branch** per the brief's header |

No reference is missing. Build may proceed once the mismatches in §7 are ruled on.

## 2. (1) The tick RPC and `wo_events` today

- **`wo_tick_surface(p_surface_id uuid, p_to wo_surface_state)`**, latest in `20270265000000_worker_logins.sql`. Per call: lock the row; refuse `removed_from_scope`; actor kind = `staff` | `worker` (`wo_worker_on_job`) | `contractor` (`wo_painter_on_job`, lead or assigned crew); refuse unless `work_orders.stage = 'in_progress'`; no-op if already at `p_to`; **before-photo gate is per JOB** (`wo_has_job_photo(wo,'before')`, skipped on `photos_optional` rows) → `error:before_photo_required:job`; update `state` + `state_changed_at`; insert one `wo_events` row `surface_tick` with `meta {surface_id, heading, label, from, to}`; when `p_to='done'` and every in-scope row is done, insert `all_surfaces_done` once per job.
- **No order is enforced server-side**: the RPC accepts any `p_to`. The UI cycles todo → prepped → done → todo (`nextState`). R3 (painted only after prepped in every room) is therefore a NEW rule the bulk RPC and the By-surface buttons introduce; the single tick keeps its cycle.
- **No undo exists.** A mis-tap is fixed by cycling round. `wo_events` rows are never deleted.
- **Triggers on `wo_events` insert** that a bulk tick will fire N times: `wo_reminder_moment_answer` (answers today's reminder moment — first tick wins, rest no-op), `wo_clear_zero_tick_flag`, `demo_flag_copy`. Harmless at N rows.
- **`wo_events`**: `(id, work_order_id, type text, from_stage, to_stage, actor, actor_kind, meta jsonb, created_at)`, indexed `(work_order_id, created_at desc)` and `(work_order_id, type, created_at desc)`. No parent/child link column — R4's "parent bulk event carrying child ids" fits in `meta.child_event_ids`.
- **`wo_surfaces`**: `(heading, heading_meta, label, surface_key, sort, state, state_changed_at, rectification, source_ref, removed_from_scope, photos_optional)`. `heading` = the area/room title, `label` = the surface name, `surface_key` = `${areaId}:${surfaceId}` into the frozen `wo_snapshot`. **No rate code on the row** — the code lives on `wo_snapshot.areas[].surfaces[].code` (absent on documents frozen before 8 Oct 2026). Rectification rows have no `surface_key`.
- **App side**: `app/components/wo/tickAction.ts` `tickSurfaceAction` → RPC, then best-effort `applyColourRecordsForTick` (on done) and `after(() => draftUpdateFromTodaysTicks(service, surfaceId))`, then `revalidatePath` on `/portal/jobs` and `/pc`. A bulk action must call the draft hook ONCE per call, not per row.
- **Scoring** (`lib/painterStatus/run.ts`, `evaluate.ts`): reads `wo_events` of type `surface_tick|photo|all_surfaces_done` with actor `contractor|system` and credits **days with an update**, not counts. A bulk tick writing N `surface_tick` rows on one day scores identically to N single ticks. R14 holds without work. Note the evaluator filters `actor_kind in (contractor, system)` — a worker's ticks (`worker`) are credited through the reminder-moment trigger path, not here; unchanged by this build.

## 3. (2) Does the daily-update draft have its own table? — YES

`public.wo_updates` (`20260927000000_wo_loop_tables.sql`): `(work_order_id, for_date, draft_text, final_text, source_tick_ids uuid[], photo_count, photo_ids (20270268), status wo_update_status, approved_by/at, sent_at)`, **`unique (work_order_id, for_date)`**. Status enum `drafted | approved | sent` + `dismissed` (`20270203`, `wo_dismiss_update`). RPCs: `wo_draft_update` (never overwrites approved/sent), `wo_approve_update(id, final_text)`, `wo_send_update(id, photo_ids)` → writes `wo_events update_sent`, `wo_dismiss_update`. Delivery: `lib/workorder/sendUpdate.ts deliverCustomerUpdate` (email + SMS, customer's channel prefs via `lib/messaging/send.ts`).

Drafting: `lib/workorder/draftFromTicks.ts` (on every tick, today's ticks → `composeUpdate`) and the 16:00-ish backstop in `app/api/cron/wo-sweep/route.ts`; composer `lib/workorder/updates.ts composeUpdate` (sectioned "Finished today / Prepped and ready" by AREA heading, 21 Oct wording). Staff are alerted once per job per day (`staffCustomerUpdateDrafted`, key `office_update_drafted`).

Queue UI: **`/pc/updates` already exists** ("Updates" in `app/pc/PcNav.tsx`), cards with Approve / Approve & send / Dismiss, today's sent cards stay greyed, closed-job drafts bulk-dismissed. This IS the "Customer updates queue" — rename and extend, do not build a second one (⚑1 default lands here).

**Per the brief's own instruction, Step 2 EXTENDS `wo_updates`**: add `kind wo_update_kind` (`end_of_day | surface_milestone | checkin_40 | defect_day`, default `end_of_day`), `source_event_ids uuid[]` (or reuse `source_tick_ids`), `sent_by`; replace the `(work_order_id, for_date)` unique with a partial unique `where kind = 'end_of_day'` so a milestone and a summary can share a day. No `customer_updates` table.

## 4. (3) How the customer timeline reads events, and how Reply works

- Reads: `lib/portal/data.ts` loads, through the **service client**, `wo_surfaces`, `wo_updates` (SENT only), `wo_photos`, `wo_variations`, and `wo_events(type, to_stage, created_at)` for stage milestones. `lib/portal/timeline.ts buildTimeline` is pure; every sent update becomes an item titled **"From your painting team"** with the update text and photos. A trade viewer gets extra `tradeEvents`. Snapshot-tested (`timeline.test.ts`, `timeline.shared.test.ts`).
- Rendered by `app/account/(portal)/JobTimeline.tsx` (signed-in `/account` portal). The token page `/w/[token]` is the WORK ORDER document for the painter, not the customer timeline.
- **Reply**: there is already ONE control per timeline — the "Message me" button under the coordinator card (`data-testid="message-coordinator"`) → `/account/messages/[estimateId]`, the customer's estimate chat. A customer message there fires `office_estimate_chat` (per-person routing, office email fallback) and lands in the CRM record thread. R13 is already true structurally; Step 2 relabels it ("Reply to Felipe") and keeps one control.
- **Sender line**: the item title is fixed ("From your painting team"). R8's "Felipe, Paint Group" needs a `customer_updates.sender` setting (a staff login id) and the timeline item to carry `sender_name`; nothing stores that today.

## 5. (4) Surface codes on real work orders → §4.3 groups

The DB tally (counts per code on live jobs) was **refused by this session's permission classifier as a production read**. The script is committed as `scripts/diag/wo-surface-groups.mjs` (read-only, same `.env.local` pattern as `standards-unmapped-lines.mjs`) for Tom to run from the main checkout. The MAPPING below does not need the counts — it is read off the rate card via `lib/standards/codes.ts`, which the standards build already had Tom approve.

**Group ← standards surface ← rate-card code** (one mapping; proposal: `surface_groups` is seeded from `codes.ts` + this table, or the group is a column on `standards_surfaces`):

| Group | Wording | Standards surfaces | Rate-card codes |
|---|---|---|---|
| `ceilings` | ceilings | ceilings, cornices | Ceilings; Standard Cornices; Patterned Cornices |
| `walls` | walls | walls | Walls |
| `trims` | doors, frames and skirting boards | skirting, architraves, doors | Skirting Boards; Skirting Boards MDF; Architrave (1 Side); Flat Door and Frame (1 Side); Flat Door (1 Side); 4-6 Panel Door and Frame (1 Side); 4-6 Panel Door (1 Side) |
| `windows` | windows | windowframes (interior) | Fixed / Picture / Window Reveal; Awning / Casement Window; Double Hung Sash; Colonial / Bay Window |
| `ext_body` | weatherboards and render | weatherboards, brick, render | Weatherboards; Brick; Brick (Unpainted); Render; Stucco; Cement Sheet; Concrete / Tilt Slab |
| `ext_trim` | trims, fascias and eaves | fascias, eaves, strapping, fretwork | Fascias; Eaves; Soffits / Exterior Ceilings; Strapping (fretwork has no code) |
| `ext_openings` | doors and windows | extdoors, extwindows | Standard Door (1 Side); Front Door; Fixed / Picture Window; Awning / Casement Window; Double Hung Sash; Colonial / Bay Window |
| `ext_fence` | fences and gates | picket | Picket Fence (Hand Paint); Picket Fence (Spray) — **no gate code maps** (Side Gate is unmapped) |

Three window codes exist on BOTH sides of the card; the area's `side` decides interior `windows` vs exterior `ext_openings` (the resolver in `lib/standards/model.ts` already does this; reuse it, do not re-derive).

**Codes that map to NO group** (tick normally, never trigger a customer message) — `UNMAPPED_RATE_CODES`, 35 codes: Gutters, Downpipes, Roof, Deck Painting, Pergola, Garage Door (1 Car), Garage Door (2 Car), Pressure Washing, Colorbond Cladding, Cutek, Columns, Posts, Wood Shutters, Window Shutters, Hand Rails, Balustrades, Picture Rails, Paling Fence, Security Door, Side Gate, Meter Box, Shed, Air Vent, Kitchen Cupboard Front, Robe Door, Vanity Door, Kitchen Cupboard Interior, Robe Interior, Vanity Interior, Linen / Broom Cupboard Interior, Colour Match Allowance, Ceilings Only Allowance, Minor Fascia Rot Allowance, Access Allowance, Custom surface (imported).

Also outside every group: **rectification rows** (no `surface_key`), lines on **documents frozen before 8 Oct 2026** (no `code`; the standards resolver falls back to the label — reuse that), and **struck** rows (`removed_from_scope`).

## 6. (5) Where the defect reminder is scheduled

- **There is no painter "defect/tape reminder".** The painter's texts are the update ladder (`contractor_job_update_reminder` 07:30 / 15:30, `contractor_job_update_morning` 07:30) and the **finish reminder** (`contractor_finish_reminder`, two business days before the walkthrough, `lib/automations/sweeps/finishReminder.ts`).
- **A CUSTOMER defect-tape text already exists**: automation `customer_defect_tape` (Tom, 8 Oct 2026), `lib/automations/sweeps/defectTape.ts` off the half-hour campaign sweep, timed by `customerDefectTapeRungs` in `lib/workorder/jobRhythm.ts`: jobs of **3+ working days only**; 3–6 days → two texts two working days before the last day (09:00, 15:30); 7+ → one text three working days before the last day (09:00). SMS, email fallback, claimed once per rung (`automation_claims`), outcome `wo_events defect_tape_sent`. Wording `defectTapeSms` / `defectTapeSms2` in `lib/messaging/config.ts`: "…please put a small piece of the painter's tape on any spot you'd like touched up…".
- The brief's Trigger C ("7:30 on the day the painter's defect/tape reminder goes out, every job regardless of size, reuse that scheduler") therefore has no scheduler to reuse and partly duplicates a live automation. See M1.

## 7. Every mismatch with the brief

| # | Brief | Code today | Proposed resolution (needs Tom) |
|---|---|---|---|
| **M1** | Trigger C fires 7:30 on the painter's defect/tape reminder day, every job (R11) | No painter defect reminder exists; a customer defect-tape TEXT already goes at 09:00 two or three working days before the last day, 3+ day jobs only, different wording | Treat `customer_defect_tape` AS Trigger C: route it through the queue (`kind defect_day`), reword to the brief's sentence, and rule on (a) 07:30 vs 09:00, (b) R11 "every job" vs today's 3-day floor, (c) keep the second 15:30 text on 3–6 day jobs or drop it |
| **M2** | Settings switch `customer_updates.auto_send` (default off) gates everything | Every automation already has a MODE control: `auto` / `approve` (office approves first) in `messaging.controls[key]`, plus on/off | Make the four kinds registry automations with `defaultMode: "approve"`; the queue's top card IS that mode for them (one source). Do not add a second switch. Keep `bundle_minutes`, `checkin_percent`, `checkin_min_days`, `sender` as `timing`/settings values |
| **M3** | New `customer_updates` table | `wo_updates` exists with its queue, RPCs, delivery, RLS, demo trigger, e2e | Extend `wo_updates` (§3). The `unique (work_order_id, for_date)` must become partial (end_of_day only) |
| **M4** | One Reply button per timeline (R13) | Already one: "Message me" → estimate chat → CRM thread + office alert | Relabel only; no new reply path |
| **M5** | Sender line "Felipe, Paint Group" (R8) | Timeline items say "From your painting team"; no sender setting | Add `customer_updates.sender` (staff login) and `sender_name` on the sent row; the timeline shows it |
| **M6** | `surface_groups` seeded one row per surface code | Codes live on the snapshot surface, not on `wo_surfaces`; standards already map code→surface with side disambiguation | Group = f(standards surface). Seed `surface_groups` from `codes.ts` + §5 table, or add `group_code` to `standards_surfaces`. Resolve a tick's group through `surface_key` → snapshot surface → `resolveSurface` |
| **M7** | R3: Painted disabled until Prepped everywhere | RPC accepts any target; UI cycles todo→prepped→done→todo | Enforce R3 in the bulk RPC and the By-surface buttons only; the single tick keeps its cycle (R2 "By room remains the current UI") |
| **M8** | R6 Undo reverts "exactly the rows" | A tick also answers today's reminder moment, clears the zero-tick flag, drafts an update, and may write `all_surfaces_done` | Undo reverts `wo_surfaces` states and writes `surface_group_untick`; it does NOT un-answer the moment (R14 says scoring unchanged — a bulk tick then undone still counts as the day's update) and does not delete events. The draft is re-composed from remaining ticks. Confirm this reading |
| **M9** | Never send when "paused, in rectification, or after sign-off" | No paused stage. Stages: offered, pre_start, in_progress, qa, completion_prep, walkthrough, closed; `blocked_reason` text; rectification = extra `wo_surfaces.rectification` rows while in_progress | Define: drafts only while stage ∈ {in_progress, completion_prep}, no open rectification row, `wo_signoff` unsigned, `blocked_reason` null. Rule on whether `blocked_reason` counts as paused |
| **M10** | Mockup's By room shows a PREP / PAINT two-column tick grid | By room is a row list, one tap cycles the state | R2 says By room is the current UI — keep it; the mockup's grid is illustrative |
| **M11** | Trigger B at "40% of booked days", jobs ≥ 3 days | Office check-ins already exist as PC work items at 50% (3–6 d) / 35%+70% (7+ d) — `customerCheckins`, kind `job_checkin`, no customer message | Trigger B is new and customer-facing; add a `checkinDay(days, 0.4)` rung in `jobRhythm.ts` (`dayAt` exists). Flag the overlap: the PC gets a check-in item AND the customer gets a note on a nearby day |
| **M12** | §4.4 "inventory edit only" for the reminder line | Reminder wording is the DEFAULT strings in `lib/messaging/config.ts` (`contractorJobUpdateSms`, `…Sms2`, `…Sms3`, `…MorningSms`) + the inventory doc | Change the defaults and the inventory; an office that saved custom wording keeps theirs |
| **M13** | "eleven test files" / `ARCHITECTURE.md` | 45 / `docs/ARCHITECTURE.md` | Text only |
| **M14** | Bulk parent event carries child ids | `wo_events` has no parent column | `meta.child_event_ids` on the `surface_group_ticked` row |
| **M15** | Step 0 lists codes on REAL work orders | Production read refused in this session | `scripts/diag/wo-surface-groups.mjs` for Tom; the static mapping is complete |
| **M16** | Trigger D "16:00 on work days where ticks happened but no milestone was sent" | Today's draft is refreshed on every tick and by the sweep; sent whenever the office presses send | Keep instant drafting (the office likes seeing it fill); the SKIP rule (⚑2) applies at send/auto-send time, not draft time |

Not mismatches, confirmed: the office mirror and PC page share `TickList`, so By surface reaches all three screens through the existing `surface` prop; worker attribution (`actor_kind = worker`) is already in the RPC; `all_surfaces_done` is written once and the bulk RPC must mirror it; `wo_updates` read grant is to `authenticated` with policies set by the loop in `20261008`/`20261213` — the customer-role proof for the extended table is a Step 2 e2e.

## 8. Shape of Step 1 (for Tom's eye before I start)

- Migration `20270300000000_wo_tick_surface_group.sql`: `wo_tick_surface_group(p_work_order_id, p_group_code, p_to)` and `wo_untick_bulk(p_parent_event_id)`; both definer, same actor resolution and photo gate as `wo_tick_surface`, R3 and R5 enforced, `grant execute … to authenticated`; `surface_groups` table + seed (RLS: staff + painter read). The group of a row resolved server-side from `surface_key` → snapshot `code` → `standards_surface_codes` → group, label fallback for pre-8-Oct documents.
- `lib/workorder/surfaceGroups.ts` (pure: rows → group rows with per-room list, counts, button states) + tests; `TickList` gains a `view` toggle (By surface default, remembered in `localStorage` per login), `app/components/wo/bulkTickAction.ts`, a 6-second Undo toast.
- Reminder default strings gain "Tap By surface to update the whole job in one go." Induction slide content as a note in the PR body (⚑5).
- e2e: `e2e/wo-ticks-by-surface.spec.ts` as the painter (phone, light + dark) and as PC in the mirror; existing `wo-ticks.spec.ts`, `wo-updates.spec.ts`, status and schedule specs stay green.

## 9. Open questions (beyond the brief's ⚑ table)

1. M1 — is `customer_defect_tape` Trigger C? Time (07:30 vs 09:00), size floor (R11 vs 3 days), second text.
2. M2 — one mode switch (registry `approve`) instead of a second `auto_send` setting?
3. M8 — Undo leaves the reminder moment answered and the events in the log?
4. M9 — what "paused" means (blocked_reason? nothing?).
5. Who is the default sender in production — Felipe's staff login id, or the name typed in Settings?

— End of Step 0. No code changed.
