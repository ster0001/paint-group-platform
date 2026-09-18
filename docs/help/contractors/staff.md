---
feature: contractors
role: staff
title: Invite a painter, open their record, and remove one who should never have been there
summary: How the office invites a contractor or employed painter, what each painter's own page shows (mobile, crew, paperwork, every job and their quality-check record), and when a painter can be removed rather than suspended.
verified_at_commit: cfab75826b
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

### Removing a painter
7. At the foot of their page, **Remove this painter**. It asks you to type DELETE, and it only ever works for a row that never did anything: a duplicate, a typo, an invite that went nowhere.
8. A painter with any job, offer, invoice, expense claim or clocked day behind them **cannot be removed**, and the message names what is stopping it. That is deliberate. Deleting them would strip their jobs of a painter and take their insurance certificates with them. Use **Suspend access** instead, which keeps every record and stops them being offered work.

## What the colours and labels mean
- **emailed 18/9** (green) — the invitation went out on that day; **(×2)** means it was resent.
- **not emailed yet** (amber) — the link exists but nothing has been sent from here.
- **expires 25/9** — invitations last a week. Create a new one after that.

## If something goes wrong
- **"They are on job WO-… Removing them would leave that job with no painter."** Working as intended. Suspend them rather than removing them.
- **"Nothing was removed — the database refused it."** Rare. Suspend them and tell whoever maintains the platform.
- **"Email isn't configured on this server."** The email service key is missing on this environment. Copy the link and send it yourself; nothing was marked as emailed.
- **"This invite has expired / was revoked."** Create a fresh one. The old link tells the painter the same in plain words.
- **They say the link "has already been used".** Their login exists — they sign in with the invited email.
- Every invitation email is on the record like any other send (Settings → Message queue shows delivery).

## Related
- Contractor side: work-orders/contractor.md
