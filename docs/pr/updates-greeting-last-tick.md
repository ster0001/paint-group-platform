# fix(updates): greet by name, not the hour; painter's last tick on each Updates card

Tom, 14 Oct 2026 — PC Command → Updates, the customer messaging.

**1. "Good morning / Good evening" is gone.** The draft is composed the moment the painter ticks but read whenever the office sends it, so the time-of-day greeting was wrong as often as right. Worse, the email already printed "Hello Melissa," and the text "Hi Melissa, an update on your painting at …:" in front of it, so the customer read two greetings. The draft now opens **Hi Melissa —** and the email/text drop their own hello when the text already greets (a hand-written update that starts straight in still gets one).

**2. When the painter last updated the job.** Each Updates card now says **Painter's last update to this job: Tue 14 Oct, 3:42 pm** (Melbourne time), the newest tick the draft was written from. One `wo_events` read for the whole page; its error is shown, never swallowed. A hand-inserted draft with no ticks says "No tick on record".

No migration.

**Checks:** typecheck, lint (`--max-warnings 4`), 497 unit tests in `lib/workorder` green; `e2e/wo-updates.spec.ts` + `e2e/pc-console.spec.ts` on C1: 23 passed, 2 failed — both pre-existing in pc-console's variation-pricing tests (the "Price it in the builder" link now carries `&variation=` since the 7 Oct priced-in-scope work; the spec expects the old href; the second failure cascades). Help: `docs/help/work-orders/pc.md` step 12. ARCHITECTURE paragraph added.

**Manual test for Tom:** tick a surface on a job under way → Updates → the card opens "Hi <name> —" and shows the tick time under the title → Approve & send → the email has one greeting, the text has one greeting.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
