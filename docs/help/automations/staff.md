---
feature: automations
role: staff
title: Control every automatic message from one screen
summary: Settings → Automations — switch any message on or off, choose Text, Email or Both, decide whether the office approves it first, set sending hours and the daily limit, and edit the wording with a live preview and a test send.
verified_at_commit: 5138945ff6
---

## What this is for
Every email, text and calendar invite the platform sends to customers, painters and staff is listed here, in three groups. Use it when a message should stop, go by text instead of email, wait for a person to approve it, or say something different.

## Before you start
You need a staff login. Texts need a mobile number and email needs an address on the customer's or painter's record — if the channel you choose isn't possible for someone, the message falls back to the other channel and the record says so.

## Steps
1. Open **Settings → Automations**. Use the chips at the top to see just Customers, Contractors or Staff.
2. **Sending hours** are at the top. Automatic customer and painter messages due outside them wait until the next opening. Untick a day to send nothing that day. Job offers, receipts, sign-in links and calendar invites ignore these hours.
3. **Daily limit per customer** stops a customer getting more than this many automatic job messages in a day. The extras go the next morning. Payment and sign-off messages never count.
4. On any row, the switch turns the message **On** or **Off**. Off means nothing is sent; the event is still recorded.
5. **Send by** appears when a message can go by text and email. Pick **Text**, **Email** or **Both**.
6. **Mode** appears on job messages that can wait: **Send automatically** or **Office approves first**. Approve-first messages land in **CRM → Today → Messages to approve**.
7. Press **Edit wording**. Type in the boxes or press an **Insert** token to drop in the customer's name, the address, the link and so on. The **Preview** on the right fills in an example job as you type.
8. Under a text message the counter shows how many text-message parts it will cost. Keep it to one where you can.
9. **Send test email to me** / **Send test text to me** sends the wording as it reads right now to your own login email or the mobile on your staff profile.
10. **Reset to default wording** puts the shipped wording back.
11. Press **Save automations**. Nothing changes until you save.

## Money and sign-off reminders (Session 3)
- **Welcome** goes the moment a customer accepts: thanks, what happens next, their account, and the deposit link if that invoice is already issued.
- **Unpaid invoice reminders** run four times after the due date (1, 4, 7 and 14 days by default; change the numbers on the row). Reminders 1 and 2 are email; 3 and 4 add a text. They ship as **Office approves first**, so each one lands in Messages to approve until you switch the mode. A payment stops the ladder at once. To pause a disputed invoice, press **Pause reminders** on the invoice row in Invoicing and give the reason; **Resume reminders** clears it. No reminder ever mentions late fees.
- **Deposit reminder** texts a few days after the deposit is issued and again a few days before the start date, until it is paid.
- **Sign-off reminders** go when the completion pack is sent, then 24 and 48 hours later, until the customer signs. The reminder line is the approved wording and never says the job will be treated as signed.
- **Variation reminder** texts 24 and 48 hours after a priced change is sent, until they answer.
- **Job signed off — send your invoice** texts the painter at sign-off and again three days later if their invoice is still a draft.
- **Sign-off overdue** alerts the staff who ticked it, 72 hours after the pack went out unsigned.

## What the colours and labels mean
- **Automatic** (green) — fires on its own; has the switch.
- **You press send** (blue) — a person sends it; listed so the picture is complete.
- **Not sending yet** (amber) — recorded, but no message goes out.
- **Office approves first** (amber badge) — this message waits in the queue.
- Amber text under a message box — the text is over one part, or a placeholder isn't recognised.

## If something goes wrong
- **A message didn't go out.** Check the row is On, the person has the chosen contact detail, sending hours, and the daily limit. Every attempt is recorded on the customer's CRM record with the reason.
- **The test says texts or email are not configured.** The server has no text or email provider set up — ask the developer.
- **The preview shows a strange placeholder.** Only the tokens listed under **Insert** work for that message; anything else is sent as typed.

## Related
- [Messages to approve](../message-queue/staff.md)
- [Your first hour in the CRM](../crm/staff.md)
