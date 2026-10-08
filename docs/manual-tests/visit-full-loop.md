# Visit booking — the 90-second walkthrough on your phone (S7)

**For:** Tom · **Where:** production, on your phone, signed out · **Takes:** about 90 seconds, plus one email

Everything below is the customer's path as built. If any step reads differently on the screen, the screen is right and the help file needs the fix — tell me which step.

## Before you start
- Settings → Booking rules → gate order is **details first**.
- Settings → Visit zones: Zone 1 has an estimator; Settings → Visit schedule: that estimator has a week.
- CRM → Diary → Google Calendar is **connected** with the write permission (reconnected after the S5 change).
- Have a mobile number you can read texts on, and an email you can open on the phone.

## The walk
1. Open paintgroup.com.au on your phone and start **Get a guide price**. Type a Zone 1 address (Glen Waverley works). Answer the quick questions; do not upload a plan.
2. **Last question** — name, email, mobile. Tap **Show my guide price**. ☐ The price appears. ☐ The options read Tighten my price (large), Book a site visit, Send us a message, with Speak with us only if the price is in the phone range. ☐ No "Keep this estimate".
3. Tap **Book a site visit**. ☐ The calendar opens straight away: "These are the times we are in Glen Waverley and nearby." No details screen.
4. Tap a time, then **Book …**. ☐ Within a few seconds a text arrives with a 6-digit code. ☐ The screen shows "Confirm it's you", your mobile masked, and the ten-minute clock.
5. Type the code. ☐ "Your site visit is booked." ☐ A second text says the visit is booked, with the one-hour time. ☐ An email with a calendar invitation arrives.
6. Open Google Calendar on your phone (the info@ account). ☐ Within a minute the visit is there as a one-hour event at the property with the customer as a guest, followed by a 30-minute **Travel** block.
7. On the invitation email, **Decline**. ☐ Within five minutes the visit disappears from Google with its travel block. ☐ A text arrives saying the visit is cancelled. ☐ CRM → Today → Follow-ups shows "… declined the visit".
8. As a second customer (another browser or a private window), get a guide price for another Zone 1 address and tap Book a site visit. ☐ The time you declined is offered again.

## If a step fails
- **No code text**: Messages on the customer's record shows the send and its status. Twilio not configured on production is the usual cause.
- **No Google event**: Diary → Google Calendar card — reconnect if it asks. Booked visits stay safe in the platform either way.
- **Decline did nothing after five minutes**: that is the STOP condition from S5 — tell me which mail client you declined from.

## Afterwards
Cancel the test customer's account from Contacts, or leave it: it is one estimate under your own email.
