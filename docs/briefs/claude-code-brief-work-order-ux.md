# Claude Code brief — Work order UX: surface ticking and customer updates

**Status:** APPROVED by Tom, 24 Oct 2026 (mockup v2 signed off). Commit this file to `docs/briefs/` and the mockup to `docs/mockups/work-order-ux-mockup.html` the same day.
**Size:** three Claude Code sessions. No new business objects, no changes to the schedule, QA, variation or sign-off flows, no pricing changes.
**Mockup:** `docs/mockups/work-order-ux-mockup.html` — three screens (painter, PC Command, customer). The mockup is the design authority for layout and wording.

---

## 1. Why we're doing this, and how it fits

Painters already tick each surface in each room (`wo_surfaces`, todo → prepped → done) to keep the app up to date for their status light. Two problems:

1. On a three-bedroom job with four surfaces each, that is 24 ticks. Painters skip it.
2. The customer sees very little of that effort. Daily updates are drafted from ticks and PC-approved (WO loop ruling), but nothing is said when a whole substrate finishes, nobody checks in mid-job, and the customer isn't told when the tape-defect pass starts.

This build makes one painter tap do three jobs: it updates every room for that surface, it counts toward the painter's app-compliance score, and it becomes a plain, human-sounding update that Felipe sends to the customer timeline. Same event log, same messaging adapter, same timeline — no new attention surface anywhere (one-source-of-truth rule).

Where it sits: WO completion loop (built) → **this** → customer portal timeline (consumes it) → home dashboard PC Command activity (counts it).

---

## 2. Rulings — locked, do not revisit

| # | Ruling |
|---|---|
| R1 | **No whole-job "mark everything" buttons.** Bulk actions are per surface only (all ceilings, all walls…). Reason: a single button means a single customer update. |
| R2 | The painter work order lands on **By surface** by default; **By room** remains one tap away and shows the same ticks. |
| R3 | Per-surface **Painted** is disabled until that surface is **Prepped** in every room. The todo → prepped → done order is preserved per room. |
| R4 | A bulk tap writes the **same per-room tick rows** it would have written one at a time (one RPC call, N rows, one `wo_events` row per room, plus one `bulk` parent event). Nothing downstream changes. |
| R5 | Rooms already at or past the target state are skipped, not re-written. |
| R6 | A 6-second **Undo** on every bulk tap, reverting exactly the rows that tap wrote. |
| R7 | **Every customer message lands in the Customer updates queue** for Felipe to send, edit or drop. Nothing goes to a customer automatically until the Settings switch `customer_updates.auto_send` is on (default off). |
| R8 | Customer messages are **from Felipe**, by name, in the sender line only. Not "Felipe from Paint Group" at the top of the message. |
| R9 | **Wording is human, not corporate.** Short sentences, contractions, no bullet lists, no "we are pleased to", grammar can be loose. English (not Australian) tone. All wording lives in the messaging inventory and is editable. |
| R10 | The 40% check-in goes to the **timeline only**, no text or email, once per job, only on jobs with 3 or more booked days. |
| R11 | The defect-day message goes on **every job regardless of size** (no small-job cut-off). |
| R12 | Surface groupings for customer wording: *ceilings* / *walls* / *doors, frames and skirting boards* / *windows* / exterior groups (*weatherboards and render*, *trims, fascias and eaves*, *doors and windows*, *fences and gates*). Mapping table in §4.3; Claude Code lists any work-order line code that maps to no group. |
| R13 | Customer timeline gets **one Reply button for the whole timeline**, not a reply per entry. Replies land in the CRM inbox against the job, as today. |
| R14 | Painter reminder texts (7:30 / 3:30 ladder) and the app-compliance score are **unchanged**. A bulk tick counts as an update exactly like a single tick. Only the reminder wording gains one line pointing at By surface. |
| R15 | The existing PC-approved **daily update** stays, renamed in the queue as *End of day summary*, and now rolls up partial progress by surface group (§4.4). |

---

## 3. Reference files — read before writing code

Kickoff ritual: read these, confirm the list back to Tom with real paths, report every mismatch with this brief, then stop until Tom has read the report (Step 0).

- `docs/briefs/claude-code-brief-wo-loop-pc-command.md` — `wo_surfaces`, tick RPC, `wo_events`, daily update drafting, before-photo gate
- `docs/briefs/claude-code-brief-standards-status-callbacks.md` — `standards_surface_codes` (17 surfaces ↔ rate-card codes), app-compliance scoring, reminder ladder
- `docs/briefs/messaging-automations-inventory.md` — every message, its wording, channel choice
- `docs/briefs/claude-code-brief-customer-portal.md` — Project Timeline, communications hub
- `docs/briefs/claude-code-brief-home-dashboard-v2.md` — Phase 0 "WO all-surfaces-done event"; PC Command activity tiles
- `app/portal/jobs/[id]/` — painter work order page and tick tiles
- `app/pc/wo/[id]/` and the office "as contractor" mirror
- `lib/workorder/` — tick logic and tests (eleven test files; add to them, don't fork)
- Customer timeline rendering (find it; the portal brief says it reads `wo_events`)
- `CLAUDE.md`, `ARCHITECTURE.md`
- `docs/mockups/work-order-ux-mockup.html`

Stop-and-report rule applies: a missing reference halts the session.

---

## 4. What we're building

### 4.1 Painter work order — By surface view (Step 1)

- New default view: one row per surface group present on the job. Row shows name, "n of N prepped/painted", a two-colour progress bar (amber prepped, green painted), and two buttons: **Mark all prepped** / **Mark all painted**. Done states render as green "✓ Prepped" / "✓ Painted".
- Tapping the row (not the buttons) expands the per-room list: "Bed 1 painted · Bed 2 prepped · Bed 3 prepped".
- Toggle **By surface | By room** at the top; By room is the current UI. Remember the last choice per painter (local, not a Settings value).
- New RPC `wo_tick_surface_group(wo_id, group_code, target_state)`:
  - validates the before-photo gate exactly as the single tick does (if any room is gated, the whole call fails with the same kind message and nothing is written);
  - writes one tick row per room not yet at `target_state`, each with its own `wo_events` row, and one parent `wo_events` row `surface_group_ticked` carrying `group_code`, `target_state`, the child event ids and `count`;
  - returns the child ids for Undo;
  - `wo_untick_bulk(parent_event_id)` reverts those rows and writes `surface_group_untick`. Only valid for 60 seconds and only by the same user.
- Same view in the office mirror (`as-contractor`) and in PC Command's work order, where PC can also use it.
- Light and dark via portal tokens. Phone viewport first.
- Worker logins (induction brief ⚑13) may use bulk ticks; the tick is recorded against the worker as today.

### 4.2 Customer updates queue in PC Command (Step 2)

- Generalise the existing PC-approved daily update drafting into a **Customer updates** queue: a `customer_updates` table (`id, wo_id, account_id, kind, body, status draft|sent|dropped, created_at, sent_at, sent_by, source_event_ids[]`). If the daily-update draft already has a table, extend it rather than adding a second one — report in Step 0.
- Kinds: `surface_milestone`, `checkin_40`, `defect_day`, `end_of_day`.
- Queue UI per the mockup: Settings switch card at the top (`customer_updates.auto_send`, default off), count, then one card per draft with trigger label, job, recipient, "from Felipe", the body, and **Send to timeline / Edit / Drop**. Edit is inline; Send writes the timeline event and the message through the existing messaging adapter with the customer's existing channel preference (timeline always; text/email per the inventory's per-automation choice — timeline-only for `checkin_40` per R10).
- Sender: the staff member set in Settings as `customer_updates.sender` (default Felipe). Sender line in the timeline: "Felipe, Paint Group".
- When `auto_send` is on, drafts are sent on creation after the bundling window, and still appear in the queue as *sent*.
- ⚑1 decides where the queue lives in PC Command navigation.

### 4.3 Message triggers and wording

All wording in the messaging inventory, editable. Placeholders in `{}`. Group names come from the mapping below.

**Surface group mapping** (`surface_groups`, seeded, one row per rate-card/standards surface code → group):

| Group code | Customer wording | Interior surfaces | Exterior surfaces |
|---|---|---|---|
| `ceilings` | ceilings | ceiling, cornice | — |
| `walls` | walls | walls | — |
| `trims` | doors, frames and skirting boards | skirting, architraves, doors | — |
| `windows` | windows | window frames | — |
| `ext_body` | weatherboards and render | — | weatherboards, brick, render |
| `ext_trim` | trims, fascias and eaves | — | fascias, eaves, strapping, fretwork |
| `ext_openings` | doors and windows | — | exterior doors, windows |
| `ext_fence` | fences and gates | — | picket fence, gates |

Claude Code lists every unmapped line code in the Step 0 report; unmapped lines still tick but never trigger a customer message.

**Trigger A — surface milestone** (`surface_milestone`). Fires when, after any tick (single or bulk), a group reaches 100% prepped or 100% painted across the job. Bundling: ticks landing within `customer_updates.bundle_minutes` (default 5) of each other collapse into one draft covering every group that crossed a line in that window.

- Prepped: `Hi {first_name}, all the {group} are prepped now so painting on those starts next.`
- Painted: `Hi {first_name}, {group} are painted right through the house. {next_group_sentence}` where `next_group_sentence` is `{Next group} are up next.` if a later group is still in progress, else empty. ("house" becomes "place" for commercial jobs — inventory variant.)
- Two groups in one bundle: `Hi {first_name}, {group A} and {group B} are both prepped now so painting on those starts next.`

**Trigger B — 40% check-in** (`checkin_40`). Fires once, at 9:00 Melbourne on the first morning on or after 40% of booked days have elapsed, jobs with ≥3 booked days only. Timeline only.

- `Hi {first_name}, just touching base to see how you're finding things so far. Happy with the progress? Anything at all, reply here and we'll sort it.`

**Trigger C — defect day** (`defect_day`). Fires at 7:30 Melbourne on the day the painter's defect/tape reminder goes out (reuse that scheduler's job; don't compute the day twice). Every job.

- `Hi {first_name}, we've started going over the job today marking up anything that needs a touch up before your walkthrough. If you spot anything you want extra attention on just let us know, or stick a bit of tape on it and we'll take care of it.`

**Trigger D — end of day summary** (`end_of_day`). The existing daily update, now rolled up by group. Fires at 16:00 on work days where ticks happened but no `surface_milestone` was sent that day (if a milestone went out, skip — don't send two). Generated sentence per group with a change today, then a "tomorrow" sentence from the groups still open.

- Example: `Hi {first_name}, quick one on today. Ceilings are all done, main bedroom walls painted and the other two bedrooms prepped ready to go. Tomorrow it's the rest of the walls then onto the doors and frames.`

Never send to a customer whose job is paused, in rectification, or after sign-off. A dropped draft is never regenerated for the same source events.

### 4.4 Painter reminders (part of Step 1)

- Add one line to the existing reminder texts: `Tap By surface to update the whole job in one go.` Inventory edit only.
- Induction deck module on keeping the app updated gets a slide for By surface (content only; flag to Tom, don't build the deck).

---

## 5. Build order — one step per session

### Step 0 — Map and report
    Read docs/briefs/claude-code-brief-work-order-ux.md and the mockup. Confirm the
    reference list with real paths. Report: (1) how the tick RPC and wo_events look
    today; (2) whether the daily-update draft has its own table; (3) how the customer
    timeline reads events and how Reply works; (4) the surface codes on real work
    orders and which map to no group in §4.3; (5) where the defect reminder is
    scheduled; (6) every mismatch with this brief. Change no code. STOP.

### Step 1 — By surface view, bulk RPC, undo
    Build §4.1 and §4.4. Migrations between gate runs. Golden tests: bulk tick
    writes exactly the rows a loop of single ticks would; skipped rooms untouched;
    photo gate blocks the whole call; undo restores byte-for-byte; painted
    disabled until all rooms prepped; worker tick attribution unchanged.
    E2e AS THE PAINTER on a phone viewport, both themes, and AS PC in the mirror.

**Accept:** app-compliance score for a job ticked in bulk equals the score for the same job ticked room by room · no change to any downstream reader (schedule, QA, dashboard tests all green untouched) · undo tested · reminder text updated in the inventory.

### Step 2 — Customer updates queue + surface milestones
    Build §4.2, surface_groups seed, Trigger A with bundling, and the Settings
    switch (default off). Absorb the existing daily-update draft into the queue
    (Trigger D rolled up by group). Golden tests: a bulk tick that completes a
    group creates exactly one draft; six ticks in 5 minutes create one draft;
    a group completed at 100% prepped then 100% painted creates two drafts;
    dropped drafts are never regenerated; nothing is sent while auto_send is off;
    paused/rectification/signed-off jobs create nothing.
    E2e AS PC: send, edit-then-send, drop; AS CUSTOMER: the entry appears with
    "Felipe, Paint Group" and one Reply button for the timeline.

**Accept:** every message in the inventory with editable wording · queue shows all four kinds · customer role cannot read `customer_updates` · timeline Reply is one control per timeline.

### Step 3 — 40% check-in and defect day
    Build Triggers B and C off the existing scheduler. Settings values:
    checkin_percent (40), checkin_min_days (3), bundle_minutes (5), sender.
    Tests: 40% maths on 3, 5, 7 and 10-day jobs; no check-in on 2-day jobs;
    defect-day draft created the same run as the painter's reminder; one per job.
    Update CLAUDE.md, ARCHITECTURE.md, the messaging inventory and the session
    ledger. List open ⚑s in the PR body.

**Accept:** both triggers idempotent · timeline-only enforced for the check-in · Tom's two-minute phone check: as a painter, mark all walls painted and undo it; as PC, see the draft and send it; as the customer, read it and tap Reply.

---

## 6. Decisions for Tom ⚑

| ⚑ | Decision | Default until ruled | Blocks |
|---|---|---|---|
| 1 | Where **Customer updates** lives in PC Command | Inside the existing messaging area, with a badge count on the PC home tile | Step 2 UI only |
| 2 | Keep the **end of day summary** when a milestone already went out that day | Skip it (one message a day max) | — |
| 3 | Commercial wording for "right through the house" | "right through the place" | — |
| 4 | Should a **Dropped** draft tell the painter anything | No | — |
| 5 | Induction deck slide for By surface | Content only, Tom adds to the deck | — |

Only ⚑1 touches the build, and it doesn't block it.

---

## 7. Out of scope

- Any whole-job bulk action (R1).
- Changes to the painter reminder ladder, scoring bands, or the traffic light.
- Text/email channel for the 40% check-in.
- A customer-side reply thread per entry.
- Translations of any wording.
- Photo attachments on auto-drafted messages (painters' progress photos already show on the timeline through the existing path).

— End of brief. If anything here contradicts the WO loop brief on stages or ticks, that file wins. If anything contradicts the code, report it before building.
