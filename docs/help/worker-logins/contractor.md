---
feature: worker-logins
role: contractor
title: Your crew — give each worker their own login, share jobs with them
summary: Add a worker by name and mobile and they get their own login by text. Share a job with them and they see the scope, the finish standard and the tick list on their own phone, and tick and photograph under their own name. They never see your price, offers, invoices, variations or messages. Remove a worker and their login stops opening your jobs at once.
sources: app/portal/WorkersCard.tsx, app/portal/workerActions.ts, app/portal/jobs/page.tsx, app/portal/jobs/[id]/page.tsx, app/portal/jobs/[id]/WorkerJob.tsx, lib/contractor/workers.ts, lib/contractor/workerJobs.ts, supabase/migrations/20270264000000_worker_logins.sql
---

## What this is for
Every painter on a Paint Group job does the induction, so every worker gets a login. A worker's login is small on purpose: the jobs you share with them, the standards, photos and ticks. Everything about money, offers and the customer stays with you. Their ticks count for your job and show their name.

## Before you start
You need the worker's name and mobile. They do not need an email address — their login is a link texted to their phone.

## Steps
1. Open **Jobs**. At the bottom, under **Your crew**, tap **Add a worker**. Type their name and mobile and tap **Add and text the login**. They get a text with a link; tapping it opens their portal, no password.
2. Open a job and find **Your crew** on it. Tap **Share** beside a worker and they see that job on their phone; tap **Shared ✓** to take it back. They get a text with the job link when you share it.
3. On their phone a shared job shows the scope, "What we expect", the before-photo step, the tick list and a place for progress photos. They tick as they go; you see it on your job exactly as if you had ticked it.
4. Lost the text? Under **Your crew** on Jobs, tap **Send the link again**.
5. Someone leaves? Tap **Remove**. Every job is unshared and their login stops working on your jobs straight away.

## What the colours and labels mean
- **Shared ✓** (cyan) — this worker sees this job.
- **Share** — they do not.
- **not inducted yet** — the worker induction has not been done; sharing still works until the office switches the gate on.

## If something goes wrong
- **"That worker has not finished the worker induction yet"** — the office has switched on the induction gate; the worker does the worker induction first.
- **They did not get the text** — check the mobile under Your crew, then Send the link again. The link works once; a second tap asks for a new one.
- **A worker says they can see nothing** — the job is not shared, or they were removed. Share it again.

## Related
- [12 Demo Street — your practice job](../demo-property/contractor.md)
- [Finish standards](../standards/contractor.md)
