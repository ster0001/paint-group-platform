---
feature: worker-logins
role: pc
title: Worker logins — who is on a contractor's crew and what they can see
summary: A contractor adds workers under Your crew; each gets a login by text and sees only the jobs shared with them — scope, standards, photos and ticks, never money. The contractor's record shows their crew, the induction state and how many jobs each worker sees. Ticks by a worker count for the contractor's job and carry the worker's name.
sources: app/(app)/contractors/[id]/page.tsx, lib/contractor/workers.ts, supabase/migrations/20270265000000_worker_logins.sql
---

## What this is for
Every painter on a Paint Group job does the induction, so every worker needs a login — a small one. This page is where you see who a contractor has added, whether they have done the worker induction, and how many jobs they currently see. Nothing is set up from here: the contractor manages their own crew.

## Before you start
Nothing. The section appears on every contractor's record (not on an employed painter's).

## Steps
1. Open **Contractors** and the contractor's record. **Their crew — worker logins** lists each worker with their mobile, **Inducted** or **Not inducted**, and *N jobs shared*.
2. A worker marked **removed** no longer opens any of that contractor's jobs.
3. On a job page a worker's ticks and photos show under the worker's own name in the job's events; the job itself stays the contractor's.
4. The induction gate (⚑15) is off until the worker induction exists; when it is on, a contractor cannot share a job with a worker who has not finished it.

## What the colours and labels mean
- **Not inducted** (amber) — no worker induction recorded yet.
- **Inducted** — the worker induction is complete.
- **removed** — the contractor took them off the crew.

## If something goes wrong
- **A worker says they can see money or an offer** — that is a defect; a worker login can read none of those tables. Tell the office with the job and the worker's name.
- **A contractor cannot share a job** — the induction gate is on and the worker has not been inducted, or the worker was removed.

## Related
- [12 Demo Street for the PC](../demo-property/pc.md)
- [Contractors](../pc-contractors/pc.md)
