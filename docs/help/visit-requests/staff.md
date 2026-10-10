---
feature: visit-requests
role: staff
title: Answer a request for a visit, a time or a call
summary: Customers who cannot book a slot themselves — pre-arranged areas, a suburb we don't know, nothing that suits, or a visit asked for before the price — send a request. It lands on CRM Today, due within one working day. You answer it by offering a time, which books the visit and tells the customer, or by marking it answered.
verified_at_commit: 15a82a8e
---

## What this is for
Not every customer gets the calendar. A customer in a pre-arranged area, one whose suburb is not in the list, one who finds nothing that suits, or one who asks for a visit before seeing their price sends a **request**. "Speak with us" on the guide price sends a **call request**. Each request is one card on CRM Today and one page where you answer it.

## Before you start
- The public holidays list is filled in under **Settings → Booking rules**. "One working day" skips weekends and those dates, so a request made on a Friday is due by the end of Monday, and one made the day before Melbourne Cup Day is due by the end of the Wednesday.
- Each estimator has a week under **Settings → Visit schedule**; offering a time picks from those slots.

## Steps
1. Open **CRM → Today**, filter **Follow-ups**. A request reads "Offer a visit time — Pat Shore", "Arrange a site visit — …" or "Call … to finalise by phone", with the suburb, zone, mobile and the days that suit them. Its due time is the end of the next working day; past that it sits under **Overdue**.
2. Tap the card. The request page shows what the customer gave: the property and its zone, how to reach them, the days and time of day that suit, their note, when it was made and when a reply is due.
3. **Offer a time.** Every free slot of every estimator over the next three weeks is listed, by day and estimator. Any slot is allowed here, whatever zones it normally takes; the far-edge rule still applies. Tap one. The visit is booked on the Diary for that estimator, the customer gets a text and an email with the calendar invitation (no text code), and the page changes to the green answered box: "Answered … — Time offered.", then "Booked Monday 13 October, 9:00 am to 10:00 am with Felipe. The visit is on the Diary.", then what actually reached the customer — "The customer was sent the details by text and email", or that the message is still waiting in the message queue, or that nothing went and you should ring them. The same box shows whenever you open the request later.
4. **Answered another way?** If you phoned or emailed instead, type a word about it and tap **Mark as answered**. For a call request this is the normal answer.
5. The card leaves Today as soon as the request is answered.

## What the colours and labels mean
- **Offer a visit time** — a customer asked for a time (pre-arranged area, nothing suited, or an unknown suburb).
- **Arrange a site visit** — asked for before the price range, with full name, address, email and mobile.
- **Call … to finalise by phone** — Speak with us on the guide price; the job is inside the phone limits.
- **Overdue** (red on the request page) — the end of the next working day has passed.
- **Add the … Victorian public holidays** — a card that appears from 1 November until next year's dates are in Booking rules.

## If something goes wrong
- **"That time is no longer free."** Someone booked it between the page loading and your tap. Pick another; the list refreshes.
- **No slots are listed.** Nothing is free in the booking window, or no estimator has a week. Arrange it by phone and mark the request answered.
- **The answered box says the message is waiting, or that no message reached the customer.** The visit IS booked; only the telling is missing. A waiting message is in **CRM → Messages → queue** (held for quiet hours, or the time-offered message is set to need approval) — approve it there. If nothing went (the automation is switched off, or the customer gave no mobile or email), ring them with the time.
- **The customer says they got no email.** Check Messages on their record; the request-received email goes to the address they typed.
- **A message rather than a request.** "Send us a message" does not make a card here: it goes into the customer's chat (the estimate chat after the price, the website chat before it) and is emailed to the office address with a copy to the customer. Reply from the chat as usual.

## Related
- `visit-booking/staff` — what a customer who CAN book goes through.
- `visit-zones/staff` — which suburbs are pre-arranged or out of area.
- `visit-schedule/staff` — the slots you can offer, and the Booking rules including the public holidays.
