# Work order UX — Step 2: Customer updates queue + surface milestones

Brief `docs/briefs/claude-code-brief-work-order-ux.md` §4.2–4.3 (Triggers A and D); Step 0 report `docs/briefs/work-order-ux-s0-report.md` (M2, M3, M8, M9, M16 defaults).

## What changed

- **Migration `20270301000000_customer_updates_queue.sql`** (Tom pastes; converges; read-back + ledger row). The queue IS `wo_updates`: `kind`, `milestones`, `source_event_ids`, `sent_by`, `sender_name`; the (job, day) unique becomes partial on `end_of_day`; drafts readable by staff only; `wo_customer_updates_allowed`; `wo_draft_milestone` (bundling); `wo_approve_update` / `wo_send_update` accept the system (the send also takes `p_sender_name`; the two-arg overload is dropped); `wo_dismiss_update` records the milestones it drops. Read-back `_expect_`: columns 5 · partial_unique 1 · old_unique 0 · new_fns 2 · send_overloads 1 · system_grants 3 · drafts_staff_only true.
- **One draft pass** — `lib/workorder/draftFromTicks.ts draftUpdateForWorkOrder` (after every tick, bulk tick and undo, and now the wo-sweep backstop too, whose own copy is gone): the end-of-day draft rolled up by surface (`lib/workorder/milestones.ts composeEndOfDay`, falling back to the per-area composer on lists with no groups) and the surface milestone (`groupStandings → milestonesNow → newMilestones`, bundled within `bundle_minutes`, never twice, never after a drop, refused on a paused / rectification / signed-off job).
- **Wording** in messaging settings under registry key `customer_updates_queue` (Settings → Automations): the brief's four milestone sentences, the house/place word (⚑3), the end-of-day body, the sender first name. Placeholders `{{…}}` as the inventory does.
- **The switch** (R7, M2): `/pc/updates` top card = that automation's send-automatically / office-approves-first MODE, default approve. On, `lib/automations/sweeps/customerUpdates.ts` (half-hour campaign sweep, `?only=updates`) sends as the system inside sending hours: milestones after the window, the summary from 16:00 and skipped on a day a milestone went (⚑2 default).
- **The queue** — tab renamed *Customer updates*; cards show the kind, the job and time, *To Amanda Hughes · from Felipe*, with **Send to timeline / Edit / Drop** (same test ids as before).
- **The customer timeline** — item title is the sender line *Felipe, Paint Group* (greeting stripped), old rows keep *From your painting team*; the one reply control reads *Reply to Felipe* (R13, no new reply path).
- Help `docs/help/work-orders/{pc,customer}.md`; inventory rows 10 / 10a; `docs/ARCHITECTURE.md`.

## Decisions taken (defaults from the Step 0 report — say if wrong)
- **M2** one switch = the registry mode; no `auto_send` setting.
- **M3** extend `wo_updates`, no `customer_updates` table.
- **M9** paused = `blocked_reason` set; rectification = an open rectification row; signed off = `wo_signoff.signed_at`.
- **M16** instant drafting stays; the skip rule (⚑2) applies at auto-send time.
- Sender = `customerUpdatesSender`, else the Company profile's coordinator (Felipe) — nothing hardcoded.

## Tests
- Unit: `lib/workorder/milestones.test.ts` (17) — standings, which lines are new, two drafts for prepped-then-painted, the exact brief wording incl. two-in-one-bundle and commercial, the end-of-day roll-up; whole suite 4098 green; lint at the ceiling.
- E2e `e2e/wo-customer-updates.spec.ts` on C1 — as the painter: one bulk tap → one draft in the brief's words; a second surface in the window joins it; painted after the window → a second draft; a paused job drafts nothing; a dropped draft is not regenerated. As PC: switch off, kind + recipient + sender on the card, edit-then-send, drop; the sweep with the switch off sends nothing. As the customer: the entry with the sender line and no greeting, ONE Reply button, and a draft unreadable through the customer's own session.
- Local result: see the PR's CI e2e run if the C1 lock was held when this was pushed (the note in the PR comment says which).

## For Tom
- Paste `20270301000000_customer_updates_queue.sql` after `20270300`; compare the read-back; check the ledger.
- Still open for Step 3: M1 (`customer_defect_tape` as Trigger C — 07:30 vs 09:00, R11 vs the 3-day floor), and ⚑1 (the queue stays at `/pc/updates`, now titled Customer updates — the default).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
