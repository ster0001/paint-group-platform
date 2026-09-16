---
feature: message-queue
role: staff
title: Approve, change or skip an automatic message before it goes
summary: CRM → Messages to approve — the automatic job messages the office chose to approve first, and anything held for sending hours or the daily limit. Approve, edit then send, or skip.
verified_at_commit: 5138945ff6
---

## What this is for
When an automation on Settings → Automations is set to **Office approves first**, its messages stop here instead of going out. So do messages held for sending hours or the daily limit, which show when they will go. Nothing on this page has been sent.

## Before you start
A staff login. To put a message type in this queue, set its **Mode** to **Office approves first** on Settings → Automations.

## Steps
1. On **CRM → Today**, the card **job messages waiting for approval** says how many are waiting. Press **Review**.
2. Each card shows who it goes to, the channel, the subject and why it stopped. Press **Read it** to see the full text.
3. **Approve & send** sends it now. Before it goes, the platform checks the automation is still on and the message is still needed — a booking that was cancelled is skipped with the reason.
4. **Edit then send** opens the subject, message and text for changes; **Send with these changes** sends your version.
5. **Skip** sends nothing and records that the office skipped it.
6. Tick several and press **Approve & send N** to clear them together.
7. **Already dealt with** at the bottom shows what was sent or skipped and why.

## What the colours and labels mean
- **to approve** — waiting for you.
- **held · goes …** (amber) — held for sending hours or the daily limit; it will go by itself at that time, or press **Send now**.
- **sent / skipped / failed** in the list below — what happened, with the reason.

## If something goes wrong
- **"Not sent — it is no longer needed."** The job changed since the message was written (unbooked, finished, switched off). Nothing to do.
- **"The send failed."** The details are on the row; the customer's record shows the failed message too.
- **The count on Today doesn't match.** Today refreshes when you act; reload if it looks stale.

## Related
- [Control every automatic message from one screen](../automations/staff.md)
- [Your first hour in the CRM](../crm/staff.md)
