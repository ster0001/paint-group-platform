---
feature: logins
role: staff
title: Change a password or send a reset link, for staff and for painters
summary: Where the master user sets a staff login's password by hand or emails a reset link, where any staff member does the same for a painter from the painter's page, what the reset link does when it is clicked, and why a removed staff login can be created again with the same address.
sources: app/(app)/settings/StaffAccountsManager.tsx, app/(app)/settings/staffActions.ts, app/(app)/contractors/[id]/ContractorLogin.tsx, app/(app)/contractors/actions.ts, lib/auth/adminPassword.ts, app/reset-password/page.tsx, app/account/auth/route.ts
---

## What this is for
Somebody is locked out. A staff member has forgotten their password, or a painter cannot get into the portal. There are two ways to fix it from the office, and both are on the screen where that person already lives: **Settings → Company → Staff logins** for office people, and the painter's own page under **Contractors** for painters.

- **Set password** — you type a new one and read it out to them over the phone. Quickest when they are on the line.
- **Email a reset link** — they get an email with a private link. Clicking it signs them in and asks them to choose their own password. Nothing passes through you.

## Before you start
- For a staff login you must be the **master user**. Other staff see the list but not the password controls.
- For a painter, any staff login will do, but the painter must already have **joined** (accepted their invite). Someone still under **Waiting to join** has no login to change; resend the invite instead.
- A reset link needs an email address on the login, and needs email to be set up on this server. If it is not, the message says so; set a password by hand instead.

## Steps

### A staff login
1. Open **Settings → Company → Staff logins** and find their row.
2. To set one by hand: type at least 8 characters in the **Password** box on their row and press **Set password**. The message confirms it changed. They sign in at `/login` with it and can change it themselves later from a reset link.
3. To send a link: press **Email a reset link** on their row. The message says the link was emailed and that it works for 60 minutes.

### A painter
4. Open **Contractors** and click the painter's name. Below their jobs is a card called **Their login**, showing the email they sign in with.
5. **Set password** works the same way as for staff: 8 or more characters, then read it out over the phone rather than texting it.
6. **Email a reset link** sends them the same 60-minute link.

### What they see when they click the link
7. The link signs them in and opens **Choose a new password**. They type it twice and press **Save password**. Staff land on Home, painters on their portal. Next time they sign in at `/login` they use the new password.

### Creating a staff login again after removing it
8. **Remove login** normally deletes the login outright. When that person created estimates or other records, the platform cannot delete them without losing those records, so instead it locks the login out and takes away their staff access. Their email address stays on the system.
9. That used to block creating the same person again. Now it does not: type the same email in **Add a staff login** with a new password and it is **restored**, with the areas and roles you tick, and the message says so. It is the same login underneath, so everything filed under their name before is still theirs.

## What the colours and labels mean
- **Set password** stays greyed out until there are 8 characters in the box.
- **Email a reset link** is greyed out when the login has no email address.
- Green message — done. Red message — nothing changed; it says why.

## If something goes wrong
- **"Three links have gone to that address in the last hour."** A limit on emailed links. Wait, or set a password by hand.
- **"Email isn't configured on this server."** No email key on this environment. Set a password by hand.
- **"That reset link has expired or was already used."** Links last 60 minutes and work once. Send another.
- **"They haven't joined yet — there is no login to change."** The painter never accepted their invite. Resend it from **Contractors → Waiting to join**.
- **"Only the master user can change a staff login's password."** Ask the master user.
- **"…already has a login. Remove it first, or use a different address."** That address belongs to a live login (a customer's, or a staff member who was never removed), not a removed one. Find it under Staff logins, or ask whoever maintains the platform.
- Every reset link email is on the record like any other send (Settings → Message queue shows delivery).

## Related
- Inviting a painter and opening their record: contractors/staff.md
- Which alerts each staff login gets: automations/staff.md
- Painter side: logins/contractor.md
