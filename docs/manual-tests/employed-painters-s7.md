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

## 7b — days log themselves (Tom, 17 Sep)

Needs `20270166` applied.

9. **Standard day.** PC Command → Timesheets shows **Standard day 07:30 – 15:30, 30 min**. Change it and Save → "Standard day saved".
10. **The fill.** With an employee on ONE job today and no entry, after 3:30 pm press **Fill that day now** (today) → "1 standard day filled"; a card "standard day · 07:30–15:30 · 30 min break · 7.50 h" appears. Press again → "0 filled". The evening sweep (6 pm) does the same for the last 7 days by itself.
11. **Two jobs.** Put an employee on two jobs the same weekday, no entry → the fill logs nothing for them and **Needs a manual day** lists them with both jobs.
12. **Signed off early.** A job signed off at, say, 1 pm → the standard day for that painter that day ends 13:00.
13. **Sick / leave.** A painter sick or on approved leave that day gets no standard day.
14. **Approve all.** With filled days waiting and rates set → **Approve all standard days (n)** → all approved, each posting its labour line; any without a rate is counted as "left".
15. **Painter's extra hours.** Portal → Your hours → **Log extra hours** → job, day, 15:30–17:00, note → "Extra hours sent". Overlapping the standard day is refused with "overlap". Nothing in dollars on the page.
16. **Start day still works** for a two-job day: **Start day → Start day now**, then Finish day.
17. **Board.** Block out days on an employee's lane offers Sick / Leave / RDO / Blocked; Sick raises Reassign for any booked day; Leave/RDO show as approved time off at once.
