# Manual test — Tom's batch, 20 Sep 2026 (dashboard period, left-out jobs, imported jobs to the tray, offer reminders)

Run on production AFTER the two migrations are pasted and read back (`20270184`, `20270185`) and the data steps in the PR body are done.

## 1. The period filter (Home)
1. Open **Home**. The chips read **Week · Month · Quarter · Year · Custom**.
2. Press **Week**: the line under your name reads the Monday-to-today days, "compared with" the same days last week. Press **Quarter**, then **Year**: the comparison is the same stretch of the previous quarter / year.
3. Press **Custom**: From and To appear. Press **From** — a calendar pops up. Pick the 3rd of last month; press **To**, pick the 10th; press **Apply**. The URL carries `preset=custom&from=…&to=…`, the Sales tiles show the arrows "vs 3–10 <month before>".
4. Press the ⌂ Home entry in the rail (no period in the link). The Custom range is still selected — the choice is remembered.
5. On a period tile press **Export CSV**: the file is the rows for the same days.

## 2. A job left out of the dashboard
1. Note **Sales $** and **Sales (number)** for Month.
2. Open the estimate for a test job (1/41 Devoy Street). Under **Job settings** tick **Leave out of the dashboard**. It says "Left out of the dashboard from now on."
3. Back on Home: Sales $ and Sales (number) are lower by that job; the target card's month too; Invoicing's Received no longer includes its payments; PC Command no longer lists its job.
4. Untick it: everything counts it again. Tick it back on (it is a test job).

## 3. Imported jobs in the tray
1. After `release-to-tray.ts run`: **Projects → Schedule**, the Unscheduled tray lists the imported jobs; **Projects → Flow** shows them in lane **01 Offer**, none in **02 Pre-start** unless booked by hand.
2. Home → **PC Command → Jobs to schedule** counts them; each has an "Accepted, still not booked in" card in Needs doing once its grace day passes.
3. Drag one onto a painter's row and send the offer as usual — it moves to Pre-start when the painter accepts.

## 4. Offer reminders to painters
1. **Settings → Messages**, Painters: **Painter offer reminder** is ON, Text, 12 h and 20 h. Read the wording; the test send goes to your phone.
2. Send an offer to a painter and do not answer it. About 12 hours later (never between 22:00 and 04:59 Melbourne — one sent at 23:00 waits for the 05:00 sweep) the painter gets "Job offer at <suburb> (<start>) is still waiting and expires at <time>. Accept or decline: <link>"; again at 20 hours.
3. Accept the offer before the 20-hour mark: no second text.
4. **CRM → Messages → Queue** shows nothing for it unless you switch the row to approve-first.
