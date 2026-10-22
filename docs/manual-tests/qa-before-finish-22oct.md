# Manual test — quality check before the painter has finished (22 Oct 2026)

Tom: "please update so a quality check can be ticked off before all the boxes have been ticked, so we can quality check before a job is finished."

No migration. Deploy the branch and use a real In-progress job, or the demo job reset.

1. Open a job that is at **04 In progress** with at least one surface still unticked. Under **Job facts**, tick **Quality check required** if the facts read "Not required".
2. Scroll to the quality-check cards. Expect a **Quality check · before the finish · 4 to check** card with the four standards and the line *The painter hasn't ticked every box yet. Log it now all the same…*. Before this change there was no card here until the painter had finished.
3. Press **Log FAIL**, enter **Where** and what needs putting right, **Log FAIL — raise rectification**. Expect **Logged: FAIL · re-check scheduled**, the job still at In progress (the rail does not move), and on the painter's phone the red **QUALITY CHECK — AREAS TO PUT RIGHT** card and the amber **RECTIFY** row at once. A fresh **re-check · before the finish** card is drawn under the fail.
4. Tick the four standards on the re-check card and press **Log check — PASS**. Expect *Passed — logged before the painter finished. Nothing else to check: when they tick the last box and finish, the job skips the Quality check lane and the office signs it off.* The job is still at In progress; Job facts shows the check as **pass**.
5. As the painter, tick the remaining boxes (and the rectification), take the after photo, answer the finishing-up list and tap **All done — next step**. Expect the job to land at **06 Walkthrough** with no stop at Quality check, and the Next step card to offer **Sign off as complete — quality check passed**.
6. Regression: a job that reaches Quality check with the check still unlogged (the painter finished first) behaves as before — the card is there without "before the finish", and the pass routes the job on.
