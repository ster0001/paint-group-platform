# Manual test — visit booking and Google Calendar (S5)

For Tom, on production, after 20270216 is pasted and the deploy is live. Uses the real info@paintgroup.com.au calendar and your own phone. About 15 minutes.

## Before you start
1. Google Cloud console → OAuth consent screen → Audience **Internal** (see `docs/gcal-setup.md`, "Visit booking S5").
2. **CRM → Diary → Google Calendar card → Reconnect Google Calendar.** Accept the extra permission ("view and edit events on all your calendars"). The card should then read "Booked visits go into your main Google calendar…".
3. Settings → Visit zones: you cover all five zones. Settings → Visit schedule: your week is loaded. Settings → Booking rules: "Customers can only book when the estimator's Google Calendar is connected" is **on**.

## 1. A customer books
1. On your phone, build an estimate for a Zone 1 address (for example 12 Sample Street, Glen Waverley 3150). On the guide price tap **Book a site visit**.
2. Give your own name, a mailbox you can read, and your mobile. Pick a time. Enter the code from the text.
3. **Expect within a minute**, in Google Calendar on info@: a one-hour event "Site visit: <your name> (Glen Waverley)" at the property, with you as a guest, and a 30-minute "Travel from Glen Waverley" block straight after it, with no guests.
4. **Expect** an invitation email from Google to the mailbox you gave, plus the platform's own "visit is booked" text and the confirmation email with the calendar attachment. All three show the same one-hour time; none mentions travel.
5. On the Diary, the visit shows once, one hour long. The slot has gone from the customer calendar (open the booking page again in a private window: that time is not offered).

## 2. A private event hides a slot
1. In Google Calendar, add a private event tomorrow that overlaps one of your slots (for example 1:00 pm to 1:30 pm on a Wednesday).
2. **Expect** within five minutes: that slot (12:30 pm) is not offered to a new customer; the slots either side still are.

## 3. The customer declines
1. From the mailbox that received the invitation, decline it **in Gmail** first.
2. **Expect** within five minutes (sooner if the push channel is live): the visit is cancelled on the Diary; both events are gone from Google; the customer mailbox gets the platform's cancellation email; your phone gets the "visit is cancelled" text; Today shows "<name> declined the visit".
3. **Repeat with Outlook and Apple Mail** (book again, then decline from each). The brief says: if those declines do not reach Google, STOP and report — the fallback is a cancel link in the text, which needs your ruling.

## 4. You delete the event in Google
1. Book again. In Google Calendar, delete the visit event.
2. **Expect** within five minutes: the visit is cancelled on the Diary and the customer gets the cancellation text.

## 5. You move the event in Google
1. Book again. In Google Calendar, drag the visit to a different time.
2. **Expect**: nothing changes on the Diary or for the customer. Today shows "Tom moved <name>'s visit in Google — <old> → <new>". Move the visit on the Diary to the new time; the card clears on the next sweep.

## 6. Disconnect
1. Diary → Google Calendar → Disconnect.
2. **Expect**: a new customer in Zone 1 is offered a request, not the calendar; Today shows "Tom's Google Calendar is not connected"; reconnecting restores the calendar.

## 7. Delete a travel block, then try to book inside it (section 8, test 19)
1. Book a visit. In Google, delete only the "Travel" block.
2. **Expect**: a new customer still cannot book a time inside the deleted half hour — the platform's own booking blocks the full 90 minutes.

## What to report back
- Did the event and the travel block appear within a minute?
- Did the Outlook and Apple Mail declines reach Google (step 3)?
- Any card on Today that did not clear when it should have.
