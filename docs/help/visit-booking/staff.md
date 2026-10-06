---
feature: visit-booking
role: staff
title: What happens when a customer books a site visit online
summary: A customer who has seen their guide price books a site visit themselves — they pick a time in their zone, confirm with a text code, and the visit lands on the Diary with its zone frozen. This explains what you see and what to do if something looks wrong.
verified_at_commit: 91b0ed397196decd077bbe942fee33ea520f0a25
---

## What this is for
Customers in a bookable zone book their own site visit from the guide-price screen. You do not confirm anything: the booking is made when the customer enters the 6-digit code we text them. You see the result on the Diary and on the customer's record.

## Before you start
- Each zone has an estimator under **Settings → Visit zones**, and that estimator has a week under **Settings → Visit schedule**. A zone with no estimator, or an estimator with no week, offers customers no times.
- The booking rules (notice, how far ahead, hold time) are under **Settings → Booking rules**.

## What the customer goes through
1. On the guide price they tap **Book your estimator** (or **Book a site visit** on the Book page).
2. If we do not already hold their name, email and mobile, they are asked for them first. These create or link their account.
3. They see **Choose a time for your site visit**: only the free slots of the estimator covering their zone, in the next three weeks, none closer than two hours from now.
4. They pick a time. We hold it for ten minutes and text a 6-digit code to their mobile.
5. They enter the code. Five wrong codes end the hold; they can ask for a new code three times.
6. **Your site visit is booked.** They get a text and an email with a calendar invitation. The visit shows as one hour; the half hour after it is travel and is blocked from other bookings.

Customers in a pre-arranged area or out of area never see the calendar. For now they are sent to the Book page to request a call back; the proper request screens come with the next session.

## What you see
- **Diary**: the visit on the estimator's lane, one hour long, source "wizard". Its zone and far-edge flag are frozen at booking, so moving a suburb later never changes a booked day.
- **Customer record**: a "Held a visit time online" event when they pick a time and a "Visit booked" event when they confirm.
- **Messages**: the code text, the "visit is booked" text and the calendar-invite email on the customer's thread.
- **Settings → Automations**: "Text code to book a visit" (always on) and "Visit booked — text" (switchable), with editable wording.

## If something goes wrong
- **A customer says they never got the code.** They can tap **Send a new code** up to three times. After five codes to one mobile in ten minutes they must wait. Check the Messages tab for the delivery status.
- **A customer says the time they wanted disappeared.** Someone else held or booked it first, or the ten-minute hold ran out. The calendar refreshes and they pick again.
- **A customer wants to move a visit.** They cancel and rebook; moving is a staff action on the Diary.
- **Two visits appear at the same time for one estimator.** This cannot happen from the online path; if you see it, the second was booked from the Diary and the database let it through because the first ended before it started. Check both.

## Related
- `visit-zones/staff` — which suburb is in which zone and who covers it.
- `visit-schedule/staff` — each estimator's week and the booking rules.
