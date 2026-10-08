---
feature: pc-contractors
role: pc
title: Contractors in PC Command — every painter's light, call backs, rewards and who has signed
summary: The Contractors tab in PC Command counts painters by colour, open call backs, rewards due and standards not signed, and lists one row per painter with their light, checks, app updates, call backs, streak and trend. Tap a row for their last 10 jobs, the bonus history, a Spot check or to log a call back.
sources: app/pc/contractors/page.tsx, app/pc/contractors/ContractorRows.tsx, lib/painterStatus/contractorsView.ts, lib/painterStatus/contractorsLoad.ts
---

## What this is for
One screen for the people side of the jobs: who is on Green, who has slipped, who has a call back open, who has a bonus waiting on Tom, and who has not signed the finish standards. Every number on it, and on the home dashboard's Contractor tiles, comes from the same model, so they always agree. Customers never see any of it; a painter sees their own light only.

## Before you start
A painter has a colour once the evaluator has run for them (the daily sweep seeds everyone as New; a painter with jobs is scored from then on). An employed painter appears with a light only once they have led a job.

## Steps
1. PC Command → **Contractors**. The strip counts painters by colour — **Green, Yellow, Orange, Red, New** — then **Open call backs**, **Rewards due** and **Not signed**.
2. Each row: the light in words (**GREEN**, or **RED · NO OFFERS** while the owner has not cleared them), the name, the trend arrow against last month (↑ better, ↓ worse, → same), then **Checks** (passed first time, as "3/3"), **App** (reminders answered, as "11/12"), **Call backs** and **Streak** (clean jobs in a row). Tags underneath: **Open call back**, **Bonus due**, **Check every job**, **Standards not signed**, **Job 2 of 4**, **Lead painter, employed**. Red first, then Orange, Yellow and New, Green last.
3. Tap a row. The sheet shows their **last 10 jobs** as dots — tick clean, exclamation not clean — oldest on the left; tap a dot for the job, its hours and what went wrong. The reason line reads as the painter sees it. **Bonus history (staff only)** lists approved and paid bonuses with amounts.
4. **Spot check**: pick one of their jobs under way; a spot check is added to it and appears on the job page and the painter's job. Greyed when they have no job under way.
5. **Log call back**: pick one of their finished jobs; you land on that job's **Call backs** card to log it (the customer-called route). Greyed when they have no finished job.
6. **Open painter** goes to their full record (status and bonus decisions, standards, paperwork).

## What the colours and labels mean
- **Green** — last 4 jobs clean; priority offers, 3-business-day payment, bonus eligible.
- **Yellow** — 8 in 10 or better and at most 1 call back; normal offers and payment.
- **Orange** — 5 to 8 in 10 or 2 to 3 call backs; a check on every job; ring them.
- **Red** — under 5 in 10 or 4 or more call backs; no new offers until the owner records the clearance.
- **New** — first 4 jobs.
- **NOT EVALUATED** — no colour yet (the evaluator has not run for them, or an employed painter who has not led a job).

## If something goes wrong
- **"Couldn't read …" at the top** — one of the reads failed; the counts may be incomplete and it has been reported. Reload.
- **A painter is missing** — suspended painters are left off. Check Contractors in the main app.
- **The dashboard tile disagrees with the strip** — it cannot, they are one query; if you see it, the page was loaded at a different moment. Reload both.

## Related
- [Painter status for the painter](../painter-status/contractor.md)
- [Contractors — status, Red clearance and bonus](../contractors/staff.md)
- [Call backs](../call-backs/pc.md)
