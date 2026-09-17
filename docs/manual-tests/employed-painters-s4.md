# Manual test — employed painters, Session 4 (variations)

Needs `20270158` applied. An employee assigned to a job (S2/S3 scripts).

1. As the employee, on the job: **+ Found something** → category, note, photo, hours → **Send to the office**. The card reads **With the office**. (A non-lead crew member can raise too.)
2. As staff, price it from the job page as usual. The employee's card reads **With the customer**; still no figure anywhere on their page.
3. As the customer, sign it on the `/v/…` link. The employee's card now reads **Variation approved — Go ahead — N hrs added to the job** with the scope lines under it. No Accept button, no "$… added to your payment".
4. As staff, the job's event log shows `variation_employee_applied`, the variation is `contractor_accepted`, and the stage gate is not blocked by it.
5. Decline one on the `/v/…` link with a note → the employee's card reads **Not going ahead — The office says: "…"**.
6. As a contractor on their own job: the card still reads **Your approval → Accept $… — N hrs** after release. Nothing changed for them.

**4b — crew mechanics.** Add a second employee to the job from the board. Sign in as that (non-lead) painter: they can take a before photo, tick a surface, answer a checklist item, add a note and raise a variation. The event log shows their name on each.
