---
feature: dashboard
role: staff
title: The home dashboard — what you land on, what each tile means, and the numbers the office types in
summary: /home is where every staff login lands — a needs-doing strip, then the sections for your roles as tiles you can press for the rows behind them, an i for what each counts, and Export CSV; roles are ticked on Settings → Staff logins, and the Dashboard folder in Settings holds the target, marketing spend and thresholds (owner/admin only).
sources: app/(app)/home/page.tsx, app/(app)/home/HomeTiles.tsx, lib/reporting/core.ts, lib/reporting/registry.ts, app/api/reporting/export/route.ts, app/(app)/settings/StaffAccountsManager.tsx, app/(app)/settings/staffActions.ts, app/(app)/settings/DashboardSettings.tsx, lib/reporting/roles.ts
---

## What this is for
**Home** (the ⌂ entry at the top of the rail) shows each person the sections for their job. At the top, the period chips — **Week, Month, Quarter, Financial year, Custom** — and, under your name, the days in view and what they are compared with: a week against the same days of last week, a partial month against the same days of last month, a quarter or the financial year (1 July → today) against the same stretch of the one before (a whole one against the whole one before). **Custom** shows a **From** and a **To** day; press either and a calendar pops up to pick the day (arrows move a month, Today jumps back), then **Apply**. The period you pick follows you: come back to Home tomorrow, or from a drill or another section, and it is still the one you chose. Every tile export carries the same period. Then **Needs doing**: the cards from Today, the PC console and Invoicing that are yours, critical first. Then the sections your roles cover.

**Sales** (sales, owner, admin) — Estimates sent, Sales $, Sales (number), **Conversion** (accepted ÷ sent as a cohort of the estimates sent in the period, with "still open" counted), and two lists: **Average order value by presentation category** (the label on the presentation ticked on the estimate; no presentation = Uncategorised, with the median beside each average) and **By salesperson** (whoever pressed Send; the wizard's own sends are "Wizard (self-serve)"). A sales login lands on **Mine**; **Team** shows everyone. Owner and admin also see the **target card**: this month's sales against the Settings target, a pace marker for how much of the month has gone, a "FY so far" line, and the financial year's months July → June — actual against target, target only for the months still ahead, recorded months in the lighter shade (Show as table for the numbers).

**Months recorded from PaintScout.** The months sold before the platform (Settings → Dashboard → Recorded sales, owner/admin) stand in for the imported estimates wherever a sale is counted: Sales $, Sales (number), Contracts signed, Spend vs sales and the target card's bars. Such a month shows as one line in the rows ("PaintScout · July 2026 (recorded)"), pro-rated by days when a custom range covers part of it, and the tile's line says how many months came from PaintScout. Conversion, Average order value and By salesperson are per estimate and leave recorded months out. A month with no recorded row is the platform's own signed jobs — every month from the cutover on.

**Where estimates go** (sales, owner, admin) — wizard sessions started in the period, counted at each step: started → email captured → estimate saved → sent → viewed → accepted, with the drop-off between steps written out and the median days from sent to accepted. Export CSV gives one row per session with how far it got. Self-serve (no visit) acceptances switch on when the wizard stores the outcome tier.

**Activity** (every role, scoped) — the CRM timeline for the period, newest first, with the same wording as the customer record. A PC sees jobs, visits and messages; sales sees estimates, wizard, visits and messages; finance sees money and messages; owner and admin everything. The chips narrow to one family, the box searches customer and detail, and Export CSV is exactly the rows you are looking at. An estimate a customer opens appears here within a few seconds.

**Invoicing** (finance, owner, admin) — the same numbers as the /invoicing dashboard, from the same rows: **Received** for the period (payments that landed, split card / bank / cash on the line), **Outstanding** and **Overdue** right now (Overdue aged 1–7 / 8–30 / 31+ days by the Settings edges, oldest first in the list), **Contractor invoices to pay** (approved, with what is still to approve on the line), **Materials to match** (the number of supplier invoices that have arrived but sit on no job yet — the same count as the Payables tile; press it for the list, and match each one from the Materials without a job card on Payables), **Unsent invoices** (drafts by stage: deposits, progress, finals), **Deposits unpaid with the job within 7 days**, and **Average days to pay a final** for finals paid in full in the period. Press any tile for the invoices behind it; Export CSV is those rows.

**P&L** (owner, admin only) — ex GST throughout, and every line ends "Settings basis until MYOB": until MYOB supplies actuals, overhead and marketing come from Settings → Dashboard ("Weekly fixed costs", "Weekly marketing"). **Contracts signed** (the period's acceptances ÷ 1.1), **Revenue received** (payments landed ÷ 1.1), **Gross margin, actual** on jobs signed off in the period (the engine's contract less contractor invoices, supplier invoices, job costs and approved expenses, with the estimated margin and the difference on every row), **Net margin** (gross, less fixed overhead × weeks, less marketing — a month with recorded spend uses it, the rest the weekly figure), and margin by job size band and by category with the materials share.

**Marketing** (owner, admin only) — **By lead source** (sent, accepted, conversion, average, revenue for estimates sent in the period; "Not recorded" for blanks), **Cost per accepted job** (spend for the period ÷ acceptances) and the same **by channel** for channels with recorded spend, **Spend vs sales** for the period and the **twelve-month trend**, **Repeat + referral share** (a repeat customer is an account with an earlier accepted estimate — worked out, never typed), and **Wizard starts by source**.

**Trend cards.** For owner and admin, a period tile that is at least the anomaly threshold (Settings → Dashboard, 25% by default) above or below its comparison becomes an "Amber · trend" card in Needs doing — "Conversion down 18% vs August" — with **See the tile** jumping to it.

**PC Command** and **Contractors** (project coordinator, owner, admin) — the job-side sections; the project coordinator's guide describes every tile.

**Leaving a job out.** A test job, or a duplicate, must not move a number. On the estimate (Job settings → **Leave out of the dashboard**) tick the box: from that moment nothing on Home counts that estimate, its job, its invoices or its payments — Sales, the target, P&L, PC Command, Contractors, Invoicing and the funnel all drop it together — while the estimate, the job and the invoices stay exactly where they are. Untick to count it again. The Airtable history copies of the PaintScout booked jobs (one sale, two rows) were marked this way on 20 Sep 2026, which is why Sales $ came down that day.

**Definitions.** Every tile carries a small **i**: press it and the tile's definition appears under the row of tiles, with whether it is a right-now count or moves with the period and its GST basis. The same **i** sits on every rows card and in every drill-through.

A **tile** is a number with a name. Tiles marked **right now** are a state count and ignore the period; the others move with it and carry an arrow against the previous period. Press a tile: the rows it was counted from open beneath it, **i** shows exactly what it counts, **Export CSV** downloads those rows (the same route for every list), **Open list** goes to the screen. A section whose module has not shipped yet says *Switches on when … ships* — it never shows a zero in place of a number nobody has captured. This page is the office side: giving a login its dashboard roles, and typing in the figures the dashboard cannot read from anywhere else — the months sold in PaintScout before the platform, the monthly sales target by financial year, and what was spent on marketing.

## Before you start
You need to be the **master user** to change roles (Settings → Staff logins), and an **owner or admin** to see the Dashboard folder. Everyone else can look at Staff logins but not change it, and never sees the Dashboard folder at all.

## Steps
1. **Give a login its roles.** Settings → Staff logins → the person's row → **Dashboard roles**: tick Owner, Admin, Project coordinator, Sales or Finance. Tick more than one and they see both sets of sections. Press **Save**. A master user holds every role automatically — their ticks are greyed out.
2. **Record the months sold before the platform.** Settings → Dashboard → **Recorded sales — before the platform**: pick the month, type that month's Total Sold from PaintScout in dollars including GST, the number of jobs signed if the report says (leave it blank if not), an optional note, **Save month**. The dashboard shows a recorded month *instead of* the imported estimates for that month — Sales $, the target card, contracts signed and the spend-vs-sales trend all read it. A month with no row is the platform's own signed jobs, which is every month from the cutover on. Saving the same month again replaces it; **Remove** puts that month back to the platform's own figures. Nothing is deleted from the imported estimates.
3. **Set the monthly target.** Settings → Dashboard → **Monthly sales target**: pick the **Financial year** (July to June — FY 2026/27 runs 1 July 2026 to 30 June 2027; the list offers last year, this year and next), then the **Month** from that year's twelve (July first), type the target in dollars including GST, **Save target**. January in FY 2026/27 saves as January 2027. The table below groups the targets by financial year. Saving the same month again replaces it. A month with no target shows "no target set" on the dashboard, never 0%. **Remove** takes it away.
4. **Record marketing spend.** Settings → Dashboard → **Marketing spend**: month, channel (the same list as lead sources), dollars, an optional note, **Save spend**. One row per channel per month; saving again replaces.
5. **Thresholds.** Settings → Dashboard → **Thresholds**: silent-contractor days (3), anomaly threshold (25%), and the two overdue-ageing edges (7 and 30 days). Type a number and **Save** beside it.

## What the colours and labels mean
- **Owner / Admin** — every section, including margins, P&L, targets and marketing spend.
- **Project coordinator** — the needs-doing strip, PC Command, Contractors, Activity.
- **Sales** — the needs-doing strip, Sales, Where estimates go, Activity.
- **Finance** — the needs-doing strip, Invoicing, Activity.
- Job values are visible to PC and Sales; margin never is.

## If something goes wrong
- "No dashboard roles yet" on Home — the master user has not ticked a role against your login yet.
- "Some of this page could not be read" — a read failed; the numbers below leave it out rather than showing zero. Tell the office; the error is logged.
- "Only an owner or admin can change this" — the login lacks the role; the master user ticks it on Staff logins.
- The Dashboard folder is missing from Settings — same cause: the folder only renders for owner and admin.
- "Only the master user can change … their dashboard roles" — roles are changed on Staff logins by the master user only, never by the person themselves.

## Related
- crm/staff — Today and the customer record
- estimator/staff — the estimate queue and the builder
