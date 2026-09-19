---
feature: contractors
role: staff
title: Invite a painter, open their record, and remove one who should never have been there
summary: How the office invites a contractor or employed painter, what each painter's own page shows (mobile, crew, paperwork, every job and their quality-check record), how the quality-check setting works, and when a painter can be removed rather than suspended.
verified_at_commit: 65054fe00d
---

## What this is for
The office uses this when a new painter is joining. Each invite is a private link to `/join/…` that lets the painter create their login and land in their portal, already tied to the tier and (if the employees switch is on) the employment type you chose.

## Before you start
- Their email address. The link is tied to it: they sign in with that email afterwards.
- For a subcontractor, their company name and tier if you know them. They can fill in the rest on their profile.

## Steps
1. Open **Contractors** and press **+ Invite a contractor**.
2. Enter their email, name, company and tier. With the employees switch on, tick **Employee** for a PAYG painter.
3. Leave **Email them the link now** ticked and press **Create & email invite**. The platform emails them a short note with the link, what it is for, when it expires and our phone number. Untick it to get the link without an email and send it yourself by text or WhatsApp.
4. They appear under **Waiting to join** with their expiry date and whether the link has been emailed. **Email again** resends it, **Copy link** copies it, **Revoke** cancels it.
5. When they open the link and create their login, they leave the waiting list and appear in the contractor list.

### Opening a painter's record
6. Click a painter's **name** in the list. Their page shows their mobile and email, how many painters are on their crew, tier, ABN, GST, address, weekend availability and bank details, all of their paperwork with expiry dates, every job they have done for us, and their quality-check record with a running tally of passes and fails. Job titles and check rows link through to the job itself.

### How often their work is quality checked
7. The **QA:** button on each row in the list cycles through three settings, and says which one it is on:
   - **QA: first jobs** — checked while they are new to us, then as scheduled. This is the default.
   - **QA: every job** — every job of theirs gets a check.
   - **QA: none** — no automatic checks at all.
8. **QA: none** does not override a single job. Ticking **Quality check required on this job** when you book it still schedules one, because that is you asking for a check on that job in particular.

### Removing a painter
9. At the foot of their page, **Remove this painter**. It asks you to type DELETE, and it only ever works for a row with no history: a duplicate, a typo, an invite that went nowhere, someone taken on who never started.
10. A painter with a job, an assignment, an offer they **accepted**, an invoice, an expense claim or a clocked day behind them **cannot be removed**, and the message names what is stopping it. That is deliberate. Deleting them would strip their jobs of a painter and take their insurance certificates with them. Use **Suspend access** instead, which keeps every record and stops them being offered work.
11. An offer they **turned down or let lapse** does not stop it. The job keeps its own record of what happened, so there is nothing to strand.

## Asking a painter for their hours
Each painter's row has an **Asks for hours / Hours from schedule** button. Switched on, that painter's **All surfaces done** press asks for days on site and hours in total (pre-filled from the booking; they can skip). Their entry shows on their self-invoice as a note and feeds the dashboard's hours-versus-estimate. Switched off (the default), the dashboard uses the booked days × the standard day length from Settings (**worked_day_hours**, 8) and says so. Switching a painter on or off changes only what their *next* finished job asks — nothing already entered moves.

## What the colours and labels mean
- **emailed 18/9** (green) — the invitation went out on that day; **(×2)** means it was resent.
- **not emailed yet** (amber) — the link exists but nothing has been sent from here.
- **expires 25/9** — invitations last a week. Create a new one after that.
- **Ready for work** (green) on a contractor — current, verified public liability on file, so they can be offered jobs. **Not offerable** (amber) — no current certificate.
- **Employee · assigned** (blue) — one of our own painters. They are never *offered* work, they are assigned it on the scheduling board, so there is nothing for them to be offerable for and they are never asked for public liability. Their paperwork is their own tickets: white card and working at heights.

## If something goes wrong
- **"They are on job WO-… Removing them would leave that job with no painter."** Working as intended. Suspend them rather than removing them.
- **"They accepted WO-…, so that job is theirs on the record."** Same thing: they took a job on. Suspend them instead.
- **"Nothing was removed — the database refused it."** Rare. Suspend them and tell whoever maintains the platform.
- **"Email isn't configured on this server."** The email service key is missing on this environment. Copy the link and send it yourself; nothing was marked as emailed.
- **"This invite has expired / was revoked."** Create a fresh one. The old link tells the painter the same in plain words.
- **They say the link "has already been used".** Their login exists — they sign in with the invited email.
- Every invitation email is on the record like any other send (Settings → Message queue shows delivery).

## Related
- Contractor side: work-orders/contractor.md
