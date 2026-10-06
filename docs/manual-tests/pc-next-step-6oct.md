# Manual test — moving a job on from In progress (6 Oct 2026)

Run `20270215000000_wo_after_photos_waiver.sql` in the SQL editor (paste starts with `set lock_timeout`), then read
the one-row select at its end: every column must equal its `_expect_` neighbour
(`finish_honours_waiver = true`, `waive_granted = true`, `helper_not_granted = false`, `finish_granted = true`).
Check `_prod_migrations` has the row before the deploy that needs it is live. Security Advisor: 0 errors.

Before anything else, find out what is holding the two live jobs (read-only):

```bash
node scripts/diag/wo-next-step.mjs "Collins" "Jacka"
```

It prints the stage, the surfaces and their states, photos by kind, the finishing-up items, open variations, open
quality checks, and what the finish gate would say — the last line is the reason.

1. **Open 568 Collins Street** in the PC console. The **Next step** card now begins **Before the next step:** with a
   ✓/○ line for surfaces, after photos, the finishing-up list and (if any) variations waiting.
2. If the open line is **After photos … not in yet**: either **Upload after photos** (pick the painter's texted shots)
   — the page refreshes and the line turns ✓ — or press **No after photos coming — move on without them**, type a
   reason, **Move on without after photos**. The card says it is noted on the job.
3. Press **All done — next step**. The card reads **Stage moved · Now at 05 Quality check** (or 06 Walkthrough / 07
   Closed), and the rest of the page — rail, ticks, cards — moves with it without a reload.
4. The job's activity shows an **after photos waived** entry with your name and the reason (if you used the waiver).
5. Repeat for **40 Jacka Boulevard**.
6. **The refusal is in words now.** On any In-progress job with a box still open, press the button: the message under
   it names the gate ("2 of 9 surfaces still to tick off", "1 finishing-up item to tick or answer", "1 variation still
   waiting on a decision"). "not at prep" never appears.
7. **Painter's rule unchanged.** As a painter, on a job with no after photos, **All done — next step** still answers
   "Step 3 first — upload the after photos". The waiver button exists only on the PC console.
