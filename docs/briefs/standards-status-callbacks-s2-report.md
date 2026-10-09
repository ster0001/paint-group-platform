# Finish standards, painter status, call backs — Step 2 report (sign-off, the offers gate and reminders)

**Date:** 8 October 2026 · **Branch:** `feat/standards-status-callbacks` · **Brief:** `docs/briefs/claude-code-brief-standards-status-callbacks.md` §10 Step 2 · **Before:** `standards-status-callbacks-s1-report.md`

## What was built

| Brief asked | Built |
|---|---|
| Six-section sign-off per the mockup: one tick per section, stored per section with timestamp and version, resumable, no typed name | `/portal/standards/confirm`: intro → six sections (`SIGN_SECTIONS`, mockup order and titles) → confirmation. Each tick is a `standards_acks` row via `standards_ack_section` (RPC); the page opens at the first unticked section; the tab bar is hidden on the route (full screen) |
| Six ticks = confirmed: event, PDF from the same data, saved to documents, emailed | `standards_confirmed` event (once per version) written by the RPC; `completeStandardsConfirmation` renders the PDF from `Standards`, saves it as a `contractor_documents` row of kind `standards` (new enum value; not removable by the painter) and emails it attached (message 3) |
| New painters: required onboarding step. Existing painters: invite (message 1), reminders (⚑17), full-screen prompt | `redeem_contractor_invite` invites a new painter with no grace, so Home redirects to the sign-off until done. The office's **Send standards invite** / **Invite N** start the grace (⚑1 = `standards_rules.graceDays`, 7) and send message 1. Reminders days 2, 4, 6 at 9 am in the campaign sweep; Home carries an amber card while grace runs and redirects once blocked |
| Offers gate in the existing offer RPC, grace as a Settings value; grey out unsigned painters in the scheduler picker | `send_offer` returns `error:standards_not_signed` after the compliance check; trigger `t_booking_offers_standards_gate` refuses any other insert. The board's lanes carry `standardsStatus`; the drop sheet shows **Standards not signed** and disables Send offer (Hold still works) |
| Employed painters ⚑2 | `employee_unsigned`: reminders and the PC card, never a block |
| Confirmed date and version on the profile and the staff list | Profile card, Home chip, Help › standards pill; `Standards:` line on every Contractors card and a **Finish standards** row on the painter page |
| "Standards not signed after the grace period" trigger in the existing attention queue | Work-queue kind `standards_unsigned` (PC-homed, registry entry, weight, group), card from day 7 with **Send reminder text** |
| Material new version requires a new confirmation with the change note first | `standards_publish_version(n)`: re-invites everyone not confirmed on a material version (same grace) and the sweep sends message 4; the sign-off intro shows **What changed since Version N**. Non-material versions require nothing (S7) |
| E2e as a new painter, an existing painter and PC | `e2e/standards-signoff.spec.ts` |

## Acceptance (brief Step 2)
- An offer to an unsigned painter fails at the RPC (`error:standards_not_signed`) and at the table (the trigger) — both in the spec.
- Six ack rows per confirmed painter, one version — in the spec.
- The PDF text is rendered from the same `Standards` the screens read (one derivation; the Step 1 test pins that derivation to the file).
- Reminders stop the moment the painter confirms (`stillNeeded`) — in the spec.
- Jobs in progress are untouched: the gate is on `booking_offers` inserts only.

## Decisions taken
1. **Grace for a new painter is zero.** The brief's ⚑1 grace is for painters who were here before the standards; a new painter's sign-off is onboarding, so they are blocked from the first second and Home shows nothing else.
2. **The gate lives in two places on purpose:** `send_offer` for the friendly word, and a `BEFORE INSERT` trigger on `booking_offers` so reassign, re-offer and any future path cannot step around it.
3. **The reminder ladder's entity is `painter@inviteInstant`,** so a re-invite (new version, or the office inviting again) starts a fresh ladder instead of finding old claims.
4. **The numbers live in one jsonb row** `settings.standards_rules` (graceDays, reminderDays, reminderHour, pcCardDay). Editable in the database for now; no Settings card was built this step.
5. **"Every login signs" (⚑16) is one acknowledgement per contractor** — Step 0 found one login per contractor.
6. **The confirmed version is per contractor**, so the staff list, the painter's profile and the PDF all name it.

## Open for Tom
- The wording of the invite, reminder, copy and update messages (Settings → Automations, four new entries).
- The grace period (7 days) and the reminder days — `standards_rules` in the database.
- Launch: **Invite N to confirm the standards** is one press on the Contractors page; rollout §12 says tell the painters first.
- Paste `20270225000000_standards_signoff.sql`; nothing is sent until a button is pressed.

## Not in this step
Call backs (Step 3), reminder moments (Step 4), the evaluator (Step 5), the traffic light (Step 6), payment and bonus (Step 7), PC Contractors (Step 8).
