---
feature: visit-booking
role: staff
title: What happens when a customer books a site visit online
summary: A customer who has seen their guide price books a site visit themselves — they pick a time in their zone, confirm with a text code, and the visit lands on the Diary with its zone frozen. This explains what you see and what to do if something looks wrong.
verified_at_commit: 180803f340
---

## What this is for
Customers in a bookable zone book their own site visit from the guide-price screen. You do not confirm anything: the booking is made when the customer enters the 6-digit code we text them. You see the result on the Diary and on the customer's record.

## Before you start
- Each zone has an estimator under **Settings → Visit zones**, and that estimator has a week under **Settings → Visit schedule**. A zone with no estimator, or an estimator with no week, offers customers no times.
- The booking rules (notice, how far ahead, hold time) are under **Settings → Booking rules**.

## What the customer goes through
1. The last wizard question before the price asks for their full name, email and mobile (**Settings → Booking rules → gate order**, "details first"). The guide price follows, and their account exists from that moment.
2. On the guide price the options are, in order: **Tighten my price**, **Speak with us** (only when the job is inside the phone limits), **Book a site visit**, **Send us a message**.
3. They tap **Book a site visit**. If the gate order is "range first" and we hold no details yet, they are asked for them here instead.
4. They see **Choose a time for your site visit**: only the free slots of the estimator covering their zone, in the next three weeks, none closer than two hours from now, none on a public holiday.
5. They pick a time. We hold it for ten minutes and text a 6-digit code to their mobile.
6. They enter the code. Five wrong codes end the hold; they can ask for a new code three times.
7. **Your site visit is booked.** They get a text, a confirmation email, and the Google Calendar invitation from the estimator's account (info@paintgroup.com.au), titled "Paint Group site visit" with the property address. Gmail may label that first invitation "from an unknown sender"; the text and the email both say it is coming and from which address. The visit shows as one hour; the half hour after it is travel and is blocked from other bookings.

Customers in a pre-arranged area, in a suburb we do not know, or who find nothing that suits, see **Request a time** instead of the calendar; out-of-area customers see a message box. Both reach you as a card on Today — see `visit-requests/staff`.

## What you see
- **Diary**: the visit on the estimator's lane, one hour long, source "wizard". Its zone and far-edge flag are frozen at booking, so moving a suburb later never changes a booked day.
- **Customer record**: a "Held a visit time online" event when they pick a time and a "Visit booked" event when they confirm.
- **Messages**: the code text, the "visit is booked" text and the calendar-invite email on the customer's thread.
- **Settings → Automations**: "Text code to book a visit" (always on) and "Visit booked — text" (switchable), with editable wording.

## Google Calendar
- Booked visits go into the estimator&rsquo;s main Google calendar as a one-hour event with the property as the location and the customer as a guest, followed by a 30-minute Travel block. Google sends the customer the invitation.
- Customers can only book into a zone whose estimator&rsquo;s Google Calendar is connected with permission to write visits (**Settings → Booking rules → Customers can only book when the estimator&rsquo;s Google Calendar is connected**). Without it, customers are offered a request instead, and Today shows a card saying so. Connect or reconnect from **CRM → Diary → Google Calendar**.
- **Customer declines the invitation**: the visit is cancelled in the platform, both events disappear from Google, the slot reopens, the customer gets a text, and a "declined the visit" card appears on Today.
- **You delete the event in Google**: same as a decline, the customer is texted that the visit is cancelled.
- **You move the event in Google**: nothing changes in the platform. Today shows "moved … in Google"; confirm the new time with the customer, then move the visit on the Diary so the invitation and the slot follow.
- **A private event in your Google calendar** hides the overlapping slot from customers within five minutes.
- **If Google cannot be reached** while a customer is choosing or confirming a time, they are sent to request a time; nothing is booked blind.

## If something goes wrong
- **A customer says they never got the code.** They can tap **Send a new code** up to three times. After five codes to one mobile in ten minutes they must wait. Check the Messages tab for the delivery status.
- **A customer says the time they wanted disappeared.** Someone else held or booked it first, or the ten-minute hold ran out. The calendar refreshes and they pick again.
- **A customer wants to move a visit.** They cancel and rebook; moving is a staff action on the Diary.
- **"Google Calendar sync is failing" on Today.** Booked visits are safe in the platform; they are not reaching Google. Open the Diary card: it says why (usually the connection needs a reconnect).
- **Two visits appear at the same time for one estimator.** This cannot happen from the online path; if you see it, the second was booked from the Diary and the database let it through because the first ended before it started. Check both.

## Related
- `visit-zones/staff` — which suburb is in which zone and who covers it.
- `visit-schedule/staff` — each estimator's week and the booking rules.
