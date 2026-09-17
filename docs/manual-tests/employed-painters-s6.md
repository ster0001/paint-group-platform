# Manual test — employed painters, Session 6 (timesheets + job cost)

Needs `20270163` applied, `employees_enabled` = `{"enabled": true}`, one employee assigned to a job today, and a contract value on that job's estimate.

1. **Cost rate.** On the Contractors page, the employee's row shows **Cost rate · not set**. Type `52.50`, press **Save** → "Cost rate saved from <today>". A contractor's row has no such field.
2. **Start day.** Sign in as the employee. The home page has **Your day → Start day**. Tap it → "Started 07:xx · <today> ". Tap Start again from the job page → "Your day is already running". On a day with nothing booked the button answers "Nothing is booked for you today".
3. **Finish day.** Pick the break (30 min), tap **Finish day** → "Day finished — x.x hours sent to the office"; the entry appears below as **With the office**. Nowhere on the page is a `$` figure or the word rate.
4. **PC Command → Timesheets.** The day is listed with start, finish, break and hours to two places. If the painter's rate was saved AFTER the work day, the card says "No cost rate covers this day" and Approve answers the same. **Send back** with a reason → the painter sees **Not approved · <reason>**.
5. **Record a day.** In *Record a day for a painter* choose the employee, the job, today, 07:00 → 15:06, 30 min break → **Record** → a 7.60 h card "entered by the office".
6. **Approve** it → "Approved ✓". Open the job's money view → **Costs**: one line "Labour — <name> · <date> · 7.60 h · $399.00" (at $52.50/h). Approve again does nothing more.
7. **PC job page**: the money strip gains **Labour (employees) $399** and **Est. GP** drops by 399 ÷ contract. A contractor job is unchanged.
8. **Allocated vs actual** on the Timesheets tab lists the job: allocated = the estimate's hours, actual 7.6 h (amber when over).
9. **Payroll CSV → Last 7 days** downloads `painter,job,date,start,finish,break_minutes,hours,source,approved_at` with the approved day only — the one still waiting is absent, and there is no rate or pay column. Signed out (or as the employee) the URL is a 404.
10. As the employee again: the approved day reads **Approved · 7.6 h**; still no `$` anywhere on Home or the job page.
