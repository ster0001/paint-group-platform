---
feature: dashboard
role: staff
title: Who sees what on the home dashboard, and the numbers the office types in
summary: Dashboard roles are ticked per staff login on Settings → Staff logins (several add up); the Dashboard folder in Settings holds the monthly sales target, marketing spend by channel and the dashboard's thresholds, and only an owner or admin can open it.
sources: app/(app)/settings/StaffAccountsManager.tsx, app/(app)/settings/staffActions.ts, app/(app)/settings/DashboardSettings.tsx, lib/reporting/roles.ts
---

## What this is for
The home dashboard (in build) shows each person the sections for their job. This page is the office side: giving a login its dashboard roles, and typing in the figures the dashboard cannot read from anywhere else — the monthly sales target and what was spent on marketing.

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
- "Only an owner or admin can change this" — the login lacks the role; the master user ticks it on Staff logins.
- The Dashboard folder is missing from Settings — same cause: the folder only renders for owner and admin.
- "Only the master user can change … their dashboard roles" — roles are changed on Staff logins by the master user only, never by the person themselves.

## Related
- crm/staff — Today and the customer record
- estimator/staff — the estimate queue and the builder
