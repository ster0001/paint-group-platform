---
feature: dashboard
role: staff
title: The home dashboard — what you land on, what each tile means, and the numbers the office types in
summary: /home shows each staff login the sections for their roles — a needs-doing strip, then tiles you can press for the rows behind them and export as CSV; roles are ticked on Settings → Staff logins, and the Dashboard folder in Settings holds the target, marketing spend and thresholds (owner/admin only).
sources: app/(app)/home/page.tsx, app/(app)/home/HomeTiles.tsx, lib/reporting/core.ts, lib/reporting/registry.ts, app/api/reporting/export/route.ts, app/(app)/settings/StaffAccountsManager.tsx, app/(app)/settings/staffActions.ts, app/(app)/settings/DashboardSettings.tsx, lib/reporting/roles.ts
---

## What this is for
**Home** (the ⌂ entry at the top of the rail) shows each person the sections for their job. At the top, the period chips — This month, Last 30 days, Quarter, Year to date, Custom — and, under your name, the days in view and what they are compared with (a partial month against the same days of last month). Then **Needs doing**: the cards from Today, the PC console and Invoicing that are yours, critical first. Then the sections your roles cover.

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
