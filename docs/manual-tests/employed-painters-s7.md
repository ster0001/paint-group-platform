# Manual test — employed painters, Session 7 (attention items, notifications, time off, the switch)

Needs `20270164` applied, and `employees_enabled` on (the switch at the top of Contractors).

1. **The switch.** Contractors page → **Employed painters off/on** at the top. Off: the Employee tick box and the invite tick disappear; an existing employee's portal is unchanged. On again: they are back.
2. **Not accepted.** Assign an employee to a job starting today or tomorrow without them tapping Accept → Today (Follow-ups) shows "<name> hasn't accepted <job> — <days>" with **Call painter**. They tap Accept → gone on the next load.
3. **Time off.** As the employee, Calendar → **Time off** → RDO on a day 10 days out → **Ask the office** → "Requested". Today (Approvals) shows "<name> asked for an RDO — <day>" with **Decide**. PC Command → Timesheets → **Time off requests** → **Approve** → "Approved" on the painter's calendar; the Schedule board shows "RDO" on that day and refuses to drop a job on it. Decline instead → the painter reads your note under the entry.
4. **Booked clash.** Ask for leave over a day the painter is assigned → the card says "Booked on WO-…"; Approve refuses with the same words until the day is reassigned.
5. **Sick.** As the employee assigned today, **Sick today → Mark me sick today** → no approval needed; Today shows **Reassign** for that job (same card as "can't make it").
6. **Timesheets waiting.** A submitted day older than 24 h → Today (Approvals): "1 clocked day from <name> waiting on approval" with **Approve**; approve it on the Timesheets tab → gone.
7. **Texts** (need a mobile on the painter and Settings → Automations on): make another painter the lead → the new lead gets "you're now the lead painter"; a customer signs a variation on an employee job → every employee on it gets "the customer approved a change … 3 hrs added" (no price); approve/reject an expense → "your expense claim of $… was approved"; decide leave → "your RDO request for … was approved". Each text is sent once; the Automations screen lists all four with editable wording.
8. **Full loop as an employee** (the e2e `employee-loop.spec.ts` does this): assigned → Accept → pre-start → ticks by two painters → variation signed (applied, no accept step) → QA → walkthrough from the lead's job page → signed → closed, report names the lead only, no contractor invoice.
