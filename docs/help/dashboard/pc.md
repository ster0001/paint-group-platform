---
feature: dashboard
role: pc
title: The home dashboard for a project coordinator — jobs, painters, and what needs you today
summary: /home for a PC login: the needs-doing strip with the console's job cards, PC Command (right-now job counts that each open their list), Contractors (on-time, silent, QA first time, hours vs estimate with the entered/schedule coverage) and the job-side Activity feed — never margin, P&L, targets or marketing.
sources: app/(app)/home/page.tsx, app/(app)/home/HomeTiles.tsx, lib/reporting/metrics/pc.ts, lib/reporting/metrics/contractors.ts, lib/reporting/workedTime.ts, lib/reporting/roles.ts
---

## What this is for
When you sign in you land on **Home**. With the Project coordinator role ticked (Settings → Staff logins, by the master user) you see the job side of the business: what needs doing today, the counts of jobs at each point, how the painters are going, and the job events as they happen. Job values are shown; margin, P&L, targets and marketing spend are never on a PC's screen, and the export route refuses them too.

## Before you start
Your login needs the Project coordinator role. Owner and admin logins see these sections as well as everything else.

## Steps
1. **Needs doing** at the top: the PC console's own cards (offers past SLA, silent sites, sign-offs waiting) and customer messages, critical first, each with its action. It is the same list the console draws — nothing here is a second queue.
2. **PC Command** — every tile is a right-now count and opens its list when pressed:
   Jobs to schedule (accepted, not yet booked; the money waiting and the oldest wait on the line), In progress (with how many are wrapping up), Quality check (the checks due), Variations open (to price / with customer), Customers awaiting reply (a person's message with no staff reply after it — automated chases never count), Awaiting sign-off, Offers past SLA, Starting this week (colours TBC counted), Booked work ahead ($ and weeks out). For the period: Materials estimated vs actual on signed-off jobs (the engine's budget against matched supplier invoices, ex GST — the same two figures as the job page's Materials card).
3. **Contractors** — Finished on time ("8 of 11 · 73%": last surface ticked on or before the booking's end, extensions included), Silent 3+ days (the console's quiet-site flags at the Settings threshold), QA passed first time (attempt 1), Variations raised, Expense claims awaiting approval, and Days on site / Hours vs estimate blended from the painter's own entry where they are opted in, otherwise the booked days × the standard day. Every row names its source and the tile says "actual on 4 of 11 jobs, schedule on 7". Nothing averages the two silently.
4. **Press a tile** for the rows it was counted from; **i** on the tile (or in the drill) says exactly what it counts; **Export CSV** downloads those rows; **Open list** goes to the console.
5. **Activity** — the job events for the period (stages, ticks, photos, visits, messages), newest first, with chips to narrow to one family and a search box. Export CSV is the rows you are looking at.
6. **Period chips** (Week, Month, Quarter, Year, Custom — Custom opens a calendar for the From and To days) move the period tiles and Activity; right-now tiles say **right now** and ignore them. The period you choose is remembered next time you open Home.

## What the colours and labels mean
- **Critical · job** — a console card that needs you now (an offer past SLA, a silent site).
- **Amber · job** — a console card due today.
- **right now** on a tile — a state count, not a period figure.
- **▲ / ▼ vs Aug** (or **vs 7–13 Sep**, **vs Q2 26**, **vs 2025**) on a period tile — against the same stretch of the previous week, month, quarter or year; a whole period against the whole previous one.
- **actual on N of M jobs, schedule on K** — how many hours figures came from a painter's own entry versus the booking.

## If something goes wrong
- **A tile shows a number you do not expect** — press it: the rows are the count. The list and the console agree by construction (one evaluator); if they do not, that is a bug to report with the job reference.
- **A yellow box says a read failed** — the page shows which read; nothing is drawn as zero in its place. Reload; if it persists, tell the office.
- **You see no sections** — your login has no dashboard role ticked yet.

## Related
- [The home dashboard (office)](../dashboard/staff.md)
- [The PC console](../work-orders/pc.md)
