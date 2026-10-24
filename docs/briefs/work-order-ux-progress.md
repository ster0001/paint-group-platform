# Work order UX — session ledger

Brief `claude-code-brief-work-order-ux.md` · mockup `../mockups/work-order-ux-mockup.html` · Step 0 report `work-order-ux-s0-report.md`.

| Step | What | PR | Migration | Status (24 Oct 2026) |
|---|---|---|---|---|
| 0 | Map and report (16 mismatches) | #367 | — | merged |
| 1 | By surface view, `wo_tick_surface_group`, `wo_untick_bulk`, groups resolved once in SQL, reminder line | #370 | 20270300 | merged; prod paste by Tom |
| 2 | Customer updates queue on `wo_updates` (kinds), surface milestones bundled, end-of-day by surface, the one switch, sender line + Reply to | #372 | 20270301 | merged; prod paste by Tom |
| 3 | 40% check-in + defect-day note (timeline only), `wo_draft_note`, settings values, CLAUDE.md rule | this PR | 20270302 | pushed |

## Rulings taken as defaults (Tom to confirm or overturn)
- **M1** The existing `customer_defect_tape` TEXT (9:00, 3+ day jobs, second text on 3–6 day jobs) is untouched. Trigger C is a TIMELINE-ONLY note at 7:30 on the same day, on every job (shorter jobs: the last day). Open: should the text move to the queue, and 7:30 vs 9:00.
- **M2** The "send automatically" switch is the registry mode of `customer_updates_queue`, not a second setting.
- **M8** Undo puts rows back and writes the by-hand reverse ticks; the reminder moment stays answered.
- **M9** Paused = `work_orders.blocked_reason` set; rectification = an open rectification row; signed off = `wo_signoff.signed_at`.
- **⚑1** The queue stays at `/pc/updates`, titled Customer updates. **⚑2** A day with a sent milestone skips the summary. **⚑3** "place" on commercial jobs. **⚑4** No. **⚑5** Slide content in the Step 1 PR body.

## Open
- M1 as above; the `customer_defect_tape` text and the defect-day note both reach the customer on the same morning (different channels).
- Local e2e proof: every spec of Steps 1–3 ran in PR CI only — main's own e2e held the test project lock all day.
- Translations, photo attachments on auto-drafts, per-entry replies: out of scope (brief §7).
