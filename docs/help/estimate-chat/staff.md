---
feature: estimate-chat
role: staff
title: A customer's chat message reaches you in the corner of every staff page — and by email and text
summary: A message sent from the chat on a customer's estimate becomes a Waiting row in the chat dock on every staff page, emails and texts the staff routed for "Customer chat message", or the office address when nobody is; reply from the dock, the builder's Messages or by answering the alert email, and the customer is texted and emailed the reply.
---

## What this is for
Customers write on the chat on their estimate (Ask a question, Chat with us in the bottom bar, Message us, or the link in a reply text). Every message lands in the one estimate thread, and this page is how it reaches a person and how the person answers.

## Before you start
- **Who gets the alert:** Settings → Staff logins → each person's notifications → tick **Customer chat message** for email, text or both. With nobody ticked, the office address (Settings → Automations → the alert's "Send to") is emailed so a message is never silent.
- **The alert itself:** Settings → Automations → **Customer wrote on the estimate chat** — on/off, Text/Email/Both, and the wording (placeholders `{{customer}}`, `{{job}}`, `{{message}}`, `{{hours_tag}}`, `{{hours_line}}`, `{{link}}`). Out of hours the subject carries *(after hours)*.
- **Office hours** shown to the customer are Monday to Friday, 8:30am to 4:30pm Melbourne. They are fixed in the code, not a setting.

## Steps
1. A customer sends a message. The dock in the bottom-left corner of every staff page pops open, chimes, and lists the estimate as **Estimate chat · Waiting** with the customer's name, the job address and their last line.
2. Press the row. You see the whole thread, **Call**, **Record** (their CRM record) and **Open estimate**.
3. Type in **Reply to the customer…** and press **Send**. The reply is posted on the thread and the customer is texted and emailed a link that reopens their chat (the *Reply on the estimate chat* automation, same as replying from the builder).
4. Or reply from the estimate itself: the builder's messages panel works exactly as before.
5. Or reply to the alert email from your mailbox. When the reply domain is set up (Settings → Company, the `reply+…` address on outgoing mail), an emailed reply from a staff address is posted on the chat as your reply and the customer is notified the same way. Only the text above the quoted email is posted.

## What the colours and labels mean
- **Waiting** (amber) — the customer's last line has no reply yet.
- **Live** — a person has replied since their last line.
- **Estimate chat ·** before the last line — this row is an estimate thread (the others are website assistant chats).

## If something goes wrong
- **No email or text arrived.** Check the person's ticks under Staff logins, and that the automation is on. With nobody ticked, only the office address is emailed. Every send is on the customer's CRM record and in Messages.
- **The row does not show.** The dock lists threads with a customer line in the last three days; older threads are on the estimate and in the CRM record.
- **An emailed reply did not reach the chat.** The reply domain must be configured (an outgoing alert without a `reply+…` Reply-To cannot be matched), and the reply must come from a staff login's email address. Post it from the dock instead.

## Related
- `docs/help/automations/staff.md` — switching and wording every automatic message.
- `docs/help/estimate-chat/customer.md` — what the customer sees.
