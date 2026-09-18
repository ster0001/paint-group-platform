# Manual test — the board, the paint list, employees and QA (18 Sep 2026)

Migrations **20270171** (`qa_mode`) and **20270172** (`delete_contractor`, offers) are live on
test and production. Nothing below needs a fresh paste.

## 1. An employee is not "not offerable"
1. **Contractors**. Find Saulius Ginetas, or any painter ticked **Employee**.
2. Their badge reads **Employee · assigned** in blue — not "Not offerable" in amber.
3. The line under their company name talks about their **tickets** (white card, working at
   heights), never "No current insurance".
4. A subcontractor's row is unchanged: **Ready for work** in green, or **Not offerable** in
   amber with their insurance state under it.

## 2. The board keeps employees
1. **Projects → Schedule**. The employee has a lane with an **EMPLOYEE** chip.
2. Press **Contractors · n/n** at the right of the toolbar.
3. Tick **Ready for work only**. *(Before today this popover could not be clicked at all —
   if the tick does nothing, tell me.)*
4. Contractors without current insurance drop off the board. **The employee stays.**

## 3. The unscheduled tray
1. Same screen. The tray heading says **longest wait first**.
2. Top card = the job accepted longest ago; bottom = the most recently accepted.
3. Type part of a job title, a WO reference, or a suburb in the box above the list — the list
   narrows as you type. Clear it and they all come back.
4. Type something that matches nothing: you get a message, not an empty box.

## 4. Quality checks: three settings
1. **Contractors**. The **QA:** button on a row says which setting it is on.
2. Click it: **QA: first jobs → QA: every job → QA: none → QA: first jobs**. Each click
   confirms in words what will happen.
3. Leave a painter on **QA: none** and book them a job WITHOUT ticking the quality check:
   no check is scheduled.
4. Book them another job and DO tick **Quality check required on this job**: the check is
   scheduled. Asking for one on a particular job still wins.

## 5. The paint list in the builder
1. Open any estimate with rooms → **Job settings → Materials**.
2. The paints in every dropdown read A–Z.
3. Type in the search box above the card — every dropdown narrows at once.
4. **The important one:** a row already set to a paint that does not match what you typed
   still shows that paint, and still says the same product after you clear the box. Filtering
   must never change what a job is quoted with.

## 6. Removing a demo painter
1. **Contractors** → click a demo painter's name → **Remove this painter** at the foot.
2. Type DELETE → **Remove permanently**.
3. A painter whose only history is an offer they turned down or let lapse now goes.
4. One with a job, an assignment, an offer they **accepted**, an invoice, an expense or a
   clocked day is still refused, and the message names it. Suspend those instead.
5. `WO-OVERLAP2` and `WO-VERIFY1` are leftover test work orders from August. If a painter is
   still blocked by one of those, say so and I will send the SQL to clear them.
