---
feature: dashboard
role: staff
title: The home dashboard — what you land on, what each tile means, and the numbers the office types in
summary: /home shows each staff login the sections for their roles — a needs-doing strip, then tiles you can press for the rows behind them and export as CSV; roles are ticked on Settings → Staff logins, and the Dashboard folder in Settings holds the target, marketing spend and thresholds (owner/admin only).
sources: app/(app)/home/page.tsx, app/(app)/home/HomeTiles.tsx, lib/reporting/core.ts, lib/reporting/registry.ts, app/api/reporting/export/route.ts, app/(app)/settings/StaffAccountsManager.tsx, app/(app)/settings/staffActions.ts, app/(app)/settings/DashboardSettings.tsx, lib/reporting/roles.ts
---

## What this is for
**Home** (the ⌂ entry at the top of the rail) shows each person the sections for their job. At the top, the period chips — This month, Last 30 days, Quarter, Year to date, Custom — and, under your name, the days in view and what they are compared with (a partial month against the same days of last month). Then **Needs doing**: the cards from Today, the PC console and Invoicing that are yours, critical first. Then the sections your roles cover.

**Sales** (sales, owner, admin) — Estimates sent, Sales $, Sales (number), **Conversion** (accepted ÷ sent as a cohort of the estimates sent in the period, with "still open" counted), and two lists: **Average order value by presentation category** (the label on the presentation ticked on the estimate; no presentation = Uncategorised, with the median beside each average) and **By salesperson** (whoever pressed Send; the wizard's own sends are "Wizard (self-serve)"). A sales login lands on **Mine**; **Team** shows everyone. Owner and admin also see the **target card**: this month's sales against the Settings target, a pace marker for how much of the month has gone, and twelve months of actual against target (Show as table for the numbers).

**Where estimates go** (sales, owner, admin) — wizard sessions started in the period, counted at each step: started → email captured → estimate saved → sent → viewed → accepted, with the drop-off between steps written out and the median days from sent to accepted. Export CSV gives one row per session with how far it got. Self-serve (no visit) acceptances switch on when the wizard stores the outcome tier.

**Activity** (every role, scoped) — the CRM timeline for the period, newest first, with the same wording as the customer record. A PC sees jobs, visits and messages; sales sees estimates, wizard, visits and messages; finance sees money and messages; owner and admin everything. The chips narrow to one family, the box searches customer and detail, and Export CSV is exactly the rows you are looking at. An estimate a customer opens appears here within a few seconds.

**Invoicing** (finance, owner, admin) — the same numbers as the /invoicing dashboard, from the same rows: **Received** for the period (payments that landed, split card / bank / cash on the line), **Outstanding** and **Overdue** right now (Overdue aged 1–7 / 8–30 / 31+ days by the Settings edges, oldest first in the list), **Contractor invoices to pay** (approved, with what is still to approve on the line), **Unsent invoices** (drafts by stage: deposits, progress, finals), **Deposits unpaid with the job within 7 days**, and **Average days to pay a final** for finals paid in full in the period. Press any tile for the invoices behind it; Export CSV is those rows.

**PC Command** (project coordinator, owner, admin) — right-now counts, every one opening its list: Jobs to schedule (accepted, not yet booked, with the money waiting and the oldest wait), In progress (with how many are wrapping up), Quality check (with the checks due, from the console's own cards), Variations open (to price / with customer), Customers awaiting reply (a person's reply, never an automated chase), Awaiting sign-off, Offers past SLA (the console's own cards), Starting this week (colours TBC counted), Booked work ahead ($ and weeks out), and for the period Materials estimated vs actual on signed-off jobs (the engine's budget against matched supplier invoices, ex GST — the same two figures as the job page's Materials card).

**Contractors** (same roles) — Finished on time ("8 of 11 · 73%": last surface ticked on or before the booking's end, extensions included), Silent 3+ days (the console's quiet-site flags at the Settings threshold), QA passed first time (attempt 1), Offers accepted within 24h, Variations raised, Expense claims awaiting approval, and Days on site / Hours vs estimate — blended from the painter's own entry where they are opted in, otherwise the booked days × the standard day; every row names its source and the tile says "actual on 4 of 11 jobs, schedule on 7". Nothing averages the two silently.

A **tile** is a number with a name. Tiles marked **right now** are a state count and ignore the period; the others move with it and carry an arrow against the previous period. Press a tile: the rows it was counted from open beneath it, **i** shows exactly what it counts, **Export CSV** downloads those rows (the same route for every list), **Open list** goes to the screen. A section whose module has not shipped yet says *Switches on when … ships* — it never shows a zero in place of a number nobody has captured. This page is the office side: giving a login its dashboard roles, and typing in the figures the dashboard cannot read from anywhere else — the monthly sales target and what was spent on marketing.

## Before you start
You need to be the **master user** to change roles (Settings → Staff logins), and an **owner or admin** to see the Dashboard folder. Everyone else can look at Staff logins but not change it, and never sees the Dashboard folder at all.

## Steps
1. **Give a login its roles.** Settings → Staff logins → the person's row → **Dashboard roles**: tick Owner, Admin, Project coordinator, Sales or Finance. Tick more than one and they see both sets of sections. Press **Save**. A master user holds every role automatically — their ticks are greyed out.
2. **Set the monthly target.** Settings → Dashboard → **Monthly sales target**: pick the month, type the target in dollars including GST, **Save target**. Saving the same month again replaces it. A month with no target shows "no target set" on the dashboard, never 0%. **Remove** takes it away.
3. **Record marketing spend.** Settings → Dashboard → **Marketing spend**: month, channel (the same list as lead sources), dollars, an optional note, **Save spend**. One row per channel per month; saving again replaces.
4. **Thresholds.** Settings → Dashboard → **Thresholds**: silent-contractor days (3), anomaly threshold (25%), and the two overdue-ageing edges (7 and 30 days). Type a number and **Save** beside it.

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
