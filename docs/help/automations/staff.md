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
2. **Sending hours** are at the top: 8 am to 8 pm every day, Sunday included, unless you change them (since 11 Nov 2026). They apply to **texts**: an automatic text to a customer or painter that is due outside them waits until the next opening, and a message going by text and email waits whole so both arrive together. An **email on its own goes at any hour**. Untick a day to send no texts that day. Job offers, receipts, sign-in links and calendar invites ignore these hours. Hours you saved before 11 Nov stay as you set them, so check them once.
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
- **Variation approved — confirmation** (since 8 Oct 2026) emails the customer the moment they sign a change. It is not on this list yet and cannot be switched off here; the customer's own "job" email switch in their account does stop it. A **Reject** reply to a painter (PC Command) is your own message, so it is not an automation either.
- **Variation waiting on you** and **A signed change is on your job** (painter) go by text and email — a painter with no mobile on file is emailed; with neither, the job's record says "skipped" and the reason, and **Remind the painter** on the variation card sends it again once their details are in.
- **Job signed off — send your invoice** texts the painter at sign-off and again three days later if their invoice is still a draft.
- **Update your work order — reminders** texts every painter on a job under way to tick what is done and add the day's photos, with a link to the job. The moments depend on the booking's length in the painter's working days: a 1–2 day job gets day 1 at 7:30 am and day 2 at 3:30 pm; a 3–6 day job gets day 1 at 7:30 am, half way at 3:30 pm and the last day at 3:30 pm; a job of 7 days or more gets day 1, 30%, 60% and the last day. Each moment goes once per job and stops when the job reaches its quality check, walkthrough or close. It goes out at 7:30 am regardless of the sending hours. The same half-way point puts a **Check-in** card on PC Command for the office (see the work-orders guide).
- **Update your work order — morning heads-up** (8 Oct) texts every painter on the job at 7:30 am on each day that has a 3:30 pm reminder (day 2 of a two-day job, half way, 30%, 60%, the last day), so they know before they start that today is an update day. Day 1 has its own 7:30 am reminder, so it gets no second one. It has its own switch and wording, can go by text, email or both, and is not sent when the day's update is already in, when the day is marked **No work**, or once the job reaches its quality check. A morning the sweep missed is not sent in the afternoon. The send window (7:30 am to noon) is the `headsUp` / `headsUpUntil` pair on the `job_update_rules` setting. Each painter's outcome (sent, not set up, no mobile…) is written on the job.
- **Mark touch-ups with tape before the walkthrough** (8 Oct) texts the customer on jobs of 3 working days or more to put a small piece of the painter's tape on any spot they want touched up before the final walkthrough. A 3–6 day job gets two texts two working days before the last day — 9:00 am and 3:30 pm (the second in its own shorter wording); a job of 7 days or more gets one text at 9:00 am three working days before the last day. Days are the painter's booked working days on the schedule, and the last day is read from the schedule when the text is due, so moving the finish date moves the text. Each text goes once per job, only while the job is under way, and never late (9:00 am–noon, 3:30–7:00 pm; the `defect_tape_rules` setting). A customer who turned off job texts in their account is not texted, and a customer with no mobile is emailed instead. The outcome is written on the job.
- **Final walkthrough in two business days — running ahead or behind?** (19 Oct) texts the contractor on a booked job two business days (Monday to Friday, public holidays on the visit-booking list skipped) before the walkthrough day — the booked final walkthrough, or the job's last booked day when no final is booked yet — naming the date and asking them to change it in the app if the job is running ahead or behind. The day is read from the job when the text is due, so a moved finish date moves the text, and the new date gets its own text in its turn (once per job per date). Only while the job is booked and not signed off; the crew are not texted. Sent from 7:30 am until noon (the `from` / `until` pair on the `finish_reminder_rules` setting), regardless of the sending hours; a morning the sweep missed is not sent in the afternoon. Can go by text, email or both; the outcome is written on the job.
- **Job offer still waiting — reminder** texts the painter 12 and 20 hours after a job offer if they haven't answered, naming the suburb, start date and the time the offer expires, with a link to their Requests tab. It stops the moment the offer is accepted, declined, withdrawn or expires. It has its own night rule instead of the sending hours: nothing goes between 10 pm and 4:59 am Melbourne — a reminder due then goes on the first sweep after 5 am, or not at all if the offer was answered overnight. Change the two hour numbers on the row.
- **Sign-off overdue** alerts the staff who ticked it, 72 hours after the pack went out unsigned.
- **Customer wrote on the estimate chat** (20 Sep) emails and texts the staff who ticked **Customer chat message** under Staff logins the moment a customer sends a chat message from their estimate — or the office address when nobody has. Out of hours the subject says *(after hours)*. See `docs/help/estimate-chat/staff.md`.
- **Estimate declined by the customer** (1 Oct) emails or texts the staff who ticked **Estimate declined** under Staff logins the moment a customer presses **Decline estimate** on their estimate page. The message names the customer, the job and the total, carries the reason they picked or typed, and links to the estimate. Once per estimate; nothing goes for an estimate staff mark declined themselves.
- **Estimate expired without an answer** (1 Oct) emails or texts the staff who ticked **Estimate expired** under Staff logins when the daily CRM sweep finds a sent estimate past its valid-until date and marks it expired. It names the customer, job, total and the date it ran out, and links to the estimate; the estimate also appears on the CRM follow-up list. Once per estimate.

## Office reminders (12 Oct 2026)
- **Today's follow ups (estimates)** emails **tom@paintgroup.com.au** Monday to Friday from 8 am with every estimate sent 3 days ago that is still waiting — not accepted, declined or expired. Each row has the customer's name, the address, their phone (tap to ring) and **Open estimate**, which opens it in the builder (the staff screen, so opening it does not count as a customer view). Monday's email also has the estimates sent the Wednesday and Thursday before, whose 3 days ran out over the weekend, so none is missed. Nothing is sent on a day with nothing to follow up. Switch it off on its row like any other automation.
- **Pre-start checklist not filled out** (PC Command) texts at 2 pm on a business day (Monday to Friday, public holidays on the visit-booking list excluded). A **Reminder** names how many jobs start within 2 business days whose pre-start list isn't done; a **FINAL reminder** names how many start on the next business day — on a Friday that is Saturday, Sunday and Monday starts. "Not done" is the start gate's own test: no pre-start list yet, or a required pre-start tick still open. Both link to PC Command → Project progress. It goes to whoever has **Pre-start** ticked under Settings → Staff logins (text, email or both) — **nobody is ticked to begin with**, so tick it for the people who should get it. Each reminder goes once a day, and not at all when every job is ready.

## New automations start switched off (11 Nov 2026)
Every automation added from 11 Nov 2026 arrives **Off**. Nothing new sends until you switch it on here. Automations that were already on the list keep the state they had.

## When a customer says no to marketing (11 Nov 2026)
Some automations are **marketing**: a message the customer did not ask for, sent to bring them back. Today that is **Abandoned wizard — pick up where you left off** and the three lead messages below. A marketing message is not sent, and is recorded in Messages as **suppressed** with the reason, when the customer:
- replied **STOP** to any of our texts,
- unsubscribed from marketing, or
- is marked as not wanting marketing texts or email on their customer record (that channel only).

Everything else on this list — their estimate, visit times, job updates, invoices, receipts — is a service message and still goes; the customer's own switches in their account still apply to those. If we cannot check a customer's answer (a lookup fails), a marketing message is held back rather than sent.

## The lead messages, L1–L3 (17 Nov 2026)
Three messages for a customer who saw their price range in the online wizard and then did nothing. All three are **off** until you turn them on, one by one, under Settings → Automations → Customers.

- **Lead L1 — your range is saved (text)**: 2 hours after the range, one text with the link to their range page.
- **Lead L2 — three ways forward (chat)**: a day after, a message on their range page's chat in the estimator's name — their range, and that they can tighten it, book a visit or just reply — with an email telling them it is there.
- **Lead L3 — a personal check-in (chat)**: three days after, a short line offering a call, the same way.

Each goes once per estimate, and only while the customer is still at **Range seen, no action**: the moment they tighten their range, ask for help, request or book a visit, or you send them an estimate, nothing more goes. L2 and L3 also stop once a conversation has started on the chat (they wrote, or one of you replied). Each has a number you can change (hours or days after the range).

**Switching one on does not message old leads.** A message goes from its moment until a little after it (2 hours for L1, a day for L2 and L3), never later, so only customers reaching that point from now on get it. The text keeps to the sending hours (8 am to 8 pm); the chat and its email go at any hour. Like every marketing message, none of them goes to a customer who texted STOP, unsubscribed, or said no to texts or emails.

The chat message appears in the estimate's chat and on the customer's range page under the estimator's first name (Settings → Company → estimator). A Paint Home lead's email comes from Paint Home.

## The tightening messages, L5–L7 (17 Nov 2026)
Three more, for customers who go on to tighten their range. All three are **off** until you turn them on. They work like L1–L3 above: once per estimate, never late, not to anyone who said no, and the texts keep to 8 am to 8 pm.

- **Lead L5 — pick up where you left off (text)**: they started tightening their range and stopped. One text an hour after they started, while they are still at **Tightening**.
- **Lead L6 — measuring help (chat)**: a day after they started, still not finished. A measuring tip on the chat, or book a visit instead, with the email. Stops once a conversation has started.
- **Lead L7 — your closer range is ready (text)**: they finished tightening and booked nothing. One text 4 hours later with their closer range, while they are still at **Tightened, no action**.

All three link to the customer's range page. Its **Tighten my range** and **Book a visit** buttons open their draft, on another phone after a code texted to the mobile on file. Two changes from the plan's wording: L5 doesn't say how many rooms they did (nothing records that part-way), and L6's visit link is the range page, whose Book a visit button is the door.

## The staff alerts and the call card, L8–L10 and L13 (17 Nov 2026)
When a customer asks for a person, staff hear about it straight away. The three alerts are **off** until you turn them on here. Who gets each one is set per person under **Settings → Staff logins → Who gets each staff alert** (the **Help**, **Visit req** and **Call req** columns).

- **Lead L9 — a customer needs help**: they tapped "I'm stuck" or asked a question in the wizard.
- **Lead L10 — visit request**: they asked for a visit time, or a visit before the range.
- **Lead L13 — call request**: they asked us to call (Speak with us, a call back from the holding page or the range editor, or the assistant).

**In office hours** (Monday to Friday, 8 am to 5 pm, with the public holidays from Settings → Booking rules off), everyone ticked **Email** is emailed. The request also pops up in the chat corner of every staff screen with a chime. Open it, and you are on that customer's estimate chat, so you can reply in the thread. The pop-up goes once someone replies, logs a call, offers a time or books a visit.

**Out of office hours**, everyone ticked **Text after hours** gets a text with the same line, and Email still gets the email as the summary. Each request alerts once, however many times the customer taps.

**Lead L10 — we're sorting a time (chat)** is for the customer. When nobody has offered a time a working day after a visit request, a line goes on their range page's chat: "I'm sorting a time and will come back to you by …", with the request's reply-by time and the email. Offering a time stops it. It is off until you turn it on.

**L8 is a card, not a message.** When a lead tightens their range and books nothing, their **Follow up** card on Today becomes **Call {name} ({mobile}) — tightened {address} to {range}, no booking yet**, due a day later. The card's second line says **Phone-closable: yes** or **no**. Yes means the job can be confirmed on the call with no visit: interior and under the remote-confirmation cap, or for Paint Home, under the Paint Home ceiling. A call logged on the customer clears it, and so does them booking or asking for something. It is on for everyone (it is a card on Today, it sends nothing).

## The visit reminder two hours before, L11 (17 Nov 2026)
**Lead L11 — visit reminder two hours before (text)** is off until you turn it on. Two hours before an estimator visit, the customer is texted who is coming and the visit's window. It goes from two hours before until one hour before, never closer, and is skipped when that falls in the quiet hours. Each visit gets it once; a visit moved to another time gets it again. The evening-before text is still **Visit reminder text**, unchanged.

## The no-show text, L12 (17 Nov 2026)
**Lead L12 — we missed each other (text)** is off until you turn it on. When a visit is marked **No show**, the customer gets one text with the link to their range page, where **Book a visit** rebooks. Quiet hours hold it until sending hours open. The Today card to rebook stays as it was.

## Estimate alerts: E1 overdue, E8 the chat by office hours (17 Nov 2026)
- **E1 — estimate overdue after a visit (staff alert)** is off until you turn it on. When a visit was marked done two days ago and no estimate has gone to that customer since, everyone ticked **Overdue** under Staff logins is told once: "{address} visited {days} days ago, estimate not sent." It uses the same rule as the Today card. It goes in office hours only; one that falls due overnight comes in the morning.
- **E8 — Customer wrote on the estimate chat** now follows the office hours like the help, visit and call alerts. In office hours, whoever is ticked **Email** is emailed and the chat corner pops up; the **Text** box no longer texts in office hours. Out of hours, whoever is ticked **Text after hours** is texted too. The public holidays from Booking rules count as out of hours.

## The sent-quote follow-ups, E2–E7 (17 Nov 2026)
Five messages for a quote you have sent. All are **off** until you turn them on. They work like the lead messages: once per quote, never more than a day late, not to anyone who said no to marketing, texts kept to sending hours, and the chat ones stop once a conversation has started.

- **Estimate E2 — your quote is ready (text)**: not opened 2 days after sending.
- **Estimate E3 — here it is again (chat)**: still not opened at 5 days.
- **Estimate E4 — any questions? (chat)**: opened 2 days ago, nothing said.
- **Estimate E5 — worth knowing before you decide (chat)**: opened 5 days ago, still quiet. It covers the warranty and the daily updates. The plan's "we can start from {date}" is left out, because nothing in the system knows the next free start yet.
- **Estimate E7 — your price is held (chat)**: opened 14 days ago, still quiet. It says the price is held until the quote's valid-until day, with no discount or incentive.

A question, acceptance, decline or revision stops them. The calls in the plan (E3's call, and E6 at 7 days) are the **Follow up** card on Today, timed by Settings → CRM's chase days, so there's one card per quote, not two.

## The end of a quote, E9–E12 (17 Nov 2026)
Four more, all **off** until you turn them on. Each goes once per quote, and none goes to anyone who said no to marketing.

- **Estimate E9 — your price is valid until (text + chat)**: a week before the quote's valid-until day, from 9 am, while it is still open. One text and one chat line.
- **Estimate E10 — your quote has lapsed (chat)**: once the quote passes its valid-until day with no decision. It says reply and we'll refresh the price. Your own **Estimate expired** alert is unchanged.
- **Estimate E11 — which was it? (chat)**: when someone declines without a reason, four one-tap reasons go on their chat: Price, Timing, Went with someone else, Not going ahead. Each opens a short page with one button. Nothing is recorded until they press it, so an email scanner that opens links can't pick one. The reason is saved in the same words as the decline panel ("Timing" is saved as "Postponing"), and it never replaces a reason already given.
- **Estimate E12 — ready now? (chat)**: 60 days after a decline for timing (Postponing): if that has changed, here's the quote.

## Before the job starts, W1–W4 (17 Nov 2026)
- **W1, the welcome**, is **Welcome — thanks, what happens next**, which already sends on acceptance (email and text, with the deposit link and their account). Nothing changed.
- **W2 — deposit due before the start (text + chat)**: off until you turn it on. Three days before the start, from 9 am, if the deposit is still owing, the customer gets one text and one line on their estimate chat (with the email), each with the pay link and the painter's name. **This replaces the Deposit reminder ladder.** While W2 is on, the old reminder stands down, so nobody gets both.
- **W3 — colours still to confirm (text)**: off until you turn it on. Five days before the start, if the job's pre-start **Colour schedule finalised** box isn't ticked, one text asks them to book a colour consult.
- **W4 — your job starts soon (text)**: off until you turn it on. Two days before the start, one text with the painter's first name, the day, and the arrival window. No job records an arrival time, so the window ("between 7:30 and 8:30 am") is in the wording. Change it there.

All three are about a job the customer booked, so a marketing STOP doesn't stop them. They keep to sending hours, and a start date that moves gets them again for the new date.

## Which logo the emails use
Every email the platform sends (estimates, offers, reminders, reset links, campaigns, the lot) takes the **Logo for emails** from Settings → Company. Upload a version with its own solid background, not a transparent one: mail apps in dark mode invert or recolour transparent logos, which is why the logo used to come out light in some inboxes and dark in others. If no email logo is uploaded, the light-background logo is used, and failing that the main one.

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
