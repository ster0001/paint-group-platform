---
feature: crm
role: staff
title: Your first hour in the CRM
summary: The four tabs, what Today is asking you to do, how to find any customer in two keystrokes, how to log a call or book a visit, and how to switch between dark and light.
verified_at_commit: 93b8089cec
---

## What this is for
The CRM is where the office lives between estimates: who needs a reply, who to chase, who is coming for a visit, and what went out to whom. Four tabs, and nothing else. **Today** is the only one you should need most mornings.

## Before you start
You need a staff login with the CRM area ticked (Settings → Staff logins). If you take site visits, ask the office to tick you under Settings → Estimator visits so the Diary gives you a lane.

## Steps
1. Open **Today**. The heading says how many things need you. Overdue comes first, then due today, then things waiting on customers. **Mine** shows your customers and anyone unowned; **Everyone** shows the whole team's queue.
2. **A quote sent and gone quiet is a Follow-up card.** Unopened, it appears after the "chase an unopened estimate" days in Settings → CRM (3 by default); opened, after the "opened, silent" days (5). Logging a call or a message resets the clock, and the card comes back if the customer stays quiet; at the "going cold" mark it says so. One card per customer, for their newest quote. Each card names what it is (Message, Callback, Follow-up, Rebook, Approve, Invoice…) and has one action button. Do the thing, and the card leaves on its own — there is nothing to tick. If a card should not be there, **Dismiss** asks why.
3. Find a customer: press **/** (or ⌘K) and type a name, phone or address. Enter opens the record.
4. On the record, the **Log** button records a call, a text, an email or a note in one tap, with an optional follow-up date. The follow-up comes back to Today when it is due.
   **Every date box in the CRM opens a mini calendar** — the follow-up, the snooze, a delay, a visit, a move in the Diary. Tap the box, step the month with ‹ ›, tap the day (**Today** is at the bottom). Days before the earliest allowed are greyed. The follow-up box shows the date already saved on the record, so when you come back to the customer you see the date you set; **Clear** beside it removes the follow-up.
5. **Visits → + Book a visit**: pick the estimator, date and time. The day plan beside the date shows what they already have — booked visits and, once they have reconnected Google on the Diary, their own Google entries too — and the free blocks you can tap. The customer gets a calendar invite; the estimator's Google Calendar updates; the Diary shows it. A time already taken by a visit is refused; a time taken in Google is shown, and the choice is yours.
6. **Diary**: day or week. On a visit: Done, No show, Rebook, Move, Cancel. A no-show comes back to Today as "rebook it". Dashed **Google** blocks in your lane are your own Google Calendar entries — the app reads them once you have connected (or reconnected, if you connected before 8 Sep) on the card at the bottom of the Diary — and customers are never offered those times online.
7. **Customers**: opens on the board; the list is a toggle away (a search opens the list). Filters (status, tag, owner, temperature, lifecycle) can be saved as a view for the whole office. Under a customer's name, "Where they're at" says the stage and why; the strip below jumps to their estimates, jobs, invoices, visits and messages.
8. **Campaigns**: audiences with real rules, quote follow-ups that start when an estimate is sent, and marketing to a list. Nothing sends until someone approves it, unless a campaign has auto-send on.
9. Prefer light on a bright day? The **☀ / ☾** button top right switches the whole CRM — and Projects and Payments with it. It remembers.
10. The logo top left is the way back to the main platform (Estimates). A customer who started an online estimate and stopped shows an **Online estimate** strip on their record: the page they stopped on, how long they spent, and when they were last active.

## When a customer replies to an email
An email sent from the record (Messages → Email) carries a reply address that routes straight back into the CRM: the reply appears on the record as "They wrote" and on Today as a Message card. A copy of every reply is also sent on to the office mailbox (Settings → Company email, or the `INBOUND_FORWARD_TO` address), with the customer as the reply-to, so answering from the mailbox reaches them directly. This needs the reply domain and inbound webhook set up in Resend (`REPLY_DOMAIN`, `MESSAGES_INBOUND_SECRET`); without them replies go to the company mailbox only, as before.

## What counts as a reply
A customer's message — an email reply, a text, a portal message, the chat on their estimate — sits on Today as a Message card until a **person** answers it: a reply typed on the record or in the builder's Chat tab, an email or text you send them, or a call you log. An automated message (a quote follow-up, a deposit reminder, any of Settings → Automations) does **not** clear the card — the customer is still waiting for you. Failed or suppressed sends never count either. The record's Messages tab shows a reply as read once the customer has opened the thread; for emails, an open is the best signal there is and is marked as such.

## What the colours and labels mean
- **Amber** — waiting on something; the label says what.
- **Cyan** — confirmed, active, yours.
- **Clay** — overdue or needs attention now; also the Today badge.

## If something goes wrong
- *A customer is missing from Today.* Check their status on the record: delayed, do-not-contact and archived customers are deliberately quiet.
- *Two records for one person.* Open either; the banner offers a one-click merge.
- *The badge looks stale.* It refreshes within a minute; open Today for the live list.

## Related
- Settings → Estimator visits (who takes visits, hours, the windows customers can book)
- Settings → Automations (every message the CRM sends, and the switch for each)
