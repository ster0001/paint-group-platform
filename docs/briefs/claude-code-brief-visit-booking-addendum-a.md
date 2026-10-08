# Claude Code brief: Visit booking, addendum A

Zones, slot schedule, wizard gate, text code, Google Calendar.

- **Date:** 5 October 2026
- **Status:** Approved by Tom. Ready to build. **Revision 3**, same day.
- **Parent brief:** `docs/briefs/claude-code-brief-visit-booking.md` (29 August 2026)
- **Where this conflicts with the parent brief, this addendum wins.** Section 3 lists what is replaced.

**Changed in revision 3:** the customer sees a one-hour visit and the last 30 minutes is travel (R32), Victorian public holidays do not count towards "one working day" (R33), and the phone range, message emails and reminder time are now rulings (R34 to R36). Two small decisions remain in section 11.

**Changed in revision 2:** the range screen options (R24 to R26), the wording under Tighten my price (R17), decisions A to F are now rulings (R27 to R31), reminders are on, and three new decisions (J, K, L) replace them.

---

## 0. What we are building, in plain English

A customer who has seen their guide price can book a site visit themselves. They only see times when the estimator is already in their part of Melbourne. They confirm with a code sent by text. The visit lands in the estimator's Google Calendar, and anything already in that calendar hides the slot.

Customers outside the booking zones either request a time (pre-arranged areas) or are told politely that we don't visit (out of area). Customers who ask for a visit before they have seen a price send a request instead of booking.

Tom controls all of it in Settings: which suburb is in which zone, which zones can book which slot, and the booking rules. Each estimator has their own week.

---

## 1. Reference files

**Kickoff ritual applies:** commit these files, then confirm the file list back before writing any code. **If any file marked "must exist" is missing, STOP and report.** Do not rebuild a missing reference from memory.

| File | Commit to | Purpose |
|---|---|---|
| `claude-code-brief-visit-booking-addendum-a.md` | `docs/briefs/` | This brief |
| `paint-group-visit-booking-mockup.html` (mockup 4) | `design/reference/` | **Source of truth for the customer flow, screen order and all customer wording.** Also shows the Settings schedule editor |
| `paint-group-visit-zones-map.html` (approved draft 2) | `design/reference/` | The approved zone map, with the suburbs Tom named |
| `visit-zones-draft2.geojson` | `docs/briefs/data/` | Zone outlines, used once to seed the suburb list |
| `visit-zones-suburb-rulings.csv` | `docs/briefs/data/` | 210 suburbs with their approved status. These always win |

Already in the repo. Must exist, read before coding:

| File | Why |
|---|---|
| `CLAUDE.md` | Engineering standards, STOP rule, migrations between gate runs, e2e-first |
| `docs/briefs/claude-code-brief-visit-booking.md` | Parent brief |
| `docs/briefs/wizard-progress-crm-buckets-brief.md` | `wizard_sessions`, heartbeat, CRM buckets. The gate tracking extends this |
| `docs/briefs/messaging-automations-inventory.md` | Every new message is added here, with editable wording |
| `docs/briefs/claude-code-brief-home-dashboard-v2.md` | "Where estimates go" section, where the gate report lives |
| `docs/briefs/claude-code-brief-crm-retargeting.md` | The one `crm_events` log and the one work queue |
| `docs/briefs/claude-code-brief-customer-portal.md` | Identity model (accounts, account_users, properties) |

Paths are where I expect them. If a file lives elsewhere, use it and say so. If it does not exist, STOP.

---

## 2. Rulings

Settled by Tom on 5 October 2026. Binding. Do not reopen them in a session.

**Who can book**

- **R1.** A customer is pre-qualified once they have seen their guide price range. Only pre-qualified customers can book a slot themselves.
- **R2.** Everyone who has seen their range can book a visit, whatever the job value. There is no phone-first threshold. The screen must still encourage finishing online (R17).
- **R3.** Before the price range, every wizard step offers three options: **Request a site visit**, **Call us**, **Send a message**. A visit asked for here is a request for staff to follow up. It never books a slot.
- **R4.** Request a site visit and Send a message (before the range) ask for full name, property address, email and mobile.

**The gate**

- **R5.** The last wizard question before the price range asks for full name, email and mobile. The customer must answer it to see the range. This is "the gate".
- **R6.** Tom wants to test the other order too (range first, details after). Build a Settings switch between the two, **changed by hand**. No automatic 50/50 split. Record which version each wizard session saw, and where people drop out, so the two can be compared.
- **R7.** In the "range first" version, choosing any option on the range screen (R24) asks for all contact details before going further.

**Zones**

- **R8.** The approved map is draft 2, including spots A to D. Five bookable zones, pre-arranged areas, and out of area.
- **R9.** Out-of-area addresses are never offered a calendar or a time request. They can send a message. Their details are still saved as a lead.
- **R10.** Pre-arranged addresses are never shown the calendar. They request a time and staff confirm it.
- **R11.** When a new estimator joins, zones are redrawn and each estimator gets their own week. A zone belongs to one estimator at a time.

**Slots**

- **R12.** Every slot is 1 hour 30 minutes: a one-hour visit, then 30 minutes of travel to the next one (R32).
- **R13.** The weekly schedule is in section 5. It must be easy for Tom to edit.
- **R14.** Friday 12:30 takes Zone 2. It also takes Zone 1 if the Friday 11:00 visit is a Zone 1 visit.
- **R15.** Customers can book the same day if the slot is free and starts at least **2 hours** from now.
- **R16.** Customers can book up to **3 weeks** ahead.
- **R17.** "Tighten my price" is the main button on the range screen. The line under it reads **"Get a more accurate quote now"**. The calendar screen carries a link back to it. Booking a visit stays available to everyone.
- **R18.** A visit at the far edge of Zone 4 cannot sit back to back with a visit at the far edge of Zone 3, in either order. The far-edge suburbs are the ones marked `proposed` in the rulings CSV. Tom has approved that list and can change it in Settings.
- **R19.** If the times shown don't suit, the customer can request a time.

**Confirming and cancelling**

- **R20.** The customer confirms a booking with a code sent by text. By this point we already hold their full name, address and email.
- **R21.** Booked visits go into the Google Calendar of **info@paintgroup.com.au**. A private event added to that calendar makes the time unavailable to customers.
- **R22.** The customer cancels by declining the calendar invitation. That must cancel the visit in the platform too.
- **R23.** Requests without a booked time are answered within **one working day**. The customer is told this.

**The range screen**

- **R24.** The range screen offers, in this order: **Tighten my price**, **Speak with us**, **Book a site visit**, **Send us a message**. "Request a quote" is removed everywhere.
- **R25.** **Speak with us** carries the line "Request a call to finalise your booking". It is shown only when the job is within the range that can be finalised over the phone (R34). It creates a call request for staff, answered within one working day.
- **R26.** **Send us a message**: if we do not yet hold the customer's details, ask for them first. Then open a message box. The message is posted into that customer's chat in the platform **and** sent by email (R35).

**Settled from the first round of decisions**

- **R27.** If Tom deletes a visit in Google Calendar, the visit is cancelled in the platform and the customer is told by text. If Tom moves it in Google Calendar, nothing changes in the platform and a work-queue item asks staff to confirm the new time with the customer.
- **R28.** Reminders are on. The customer gets a text the evening before the visit, as well as the calendar invitation (R36 for the time).
- **R29.** The "finish online" wording is exactly as R17. No figure or promise is added to it.
- **R30.** The "authorised to commission" tick from the parent brief is left out.
- **R31.** Each estimator has their own week. Zones are redrawn when one joins (R11). No rule is needed for sharing a zone.

**Settled from the second round of decisions**

- **R32.** The customer is shown a **one-hour** visit everywhere: on screen, in the text, in the email and in the calendar invitation. The 30 minutes after it is travel time. It is blocked in the estimator's calendar only and the customer never sees it.
- **R33.** "One working day" means Monday to Friday, **not counting Victorian public holidays**.
- **R34.** Speak with us (R25) is offered when the **top** of the guide range is at or under the phone limit: interior **$6,000**, straightforward exterior **$12,000**, AUD including GST. Seed these from the existing Settings limits but keep them as their own Settings values.
- **R35.** A customer message (R26) is emailed to the office address held in Settings, with a copy to the customer. If there is no office address setting, STOP.
- **R36.** The reminder text (R28) goes at **6:00 pm the day before** the visit. No reminder is sent if the visit was booked after that time.

**Standing rules that apply here**

- Money shown to customers is AUD including GST.
- Customer wording is English in tone, not Australian.
- A price is never fixed by the wizard alone. The range screen says so.
- One event log, one work queue, one messaging adapter, one identity model. This module must not build its own list, badge or inbox.
- Customer sizes, prices, zones and eligibility are decided on the server. Nothing the browser sends is trusted.

---

## 3. What this replaces in the parent brief

Read the parent brief, then apply these changes. If the parent brief says something this list does not cover and it conflicts with section 2, STOP and report.

| Parent brief | Now |
|---|---|
| Visit-policy function returning self-serve, phone-first or manual | Three outcomes by address: bookable zone, pre-arranged, out of area. No phone-first (R2) |
| Zone half-days plus an anchor radius | Named slots, each listing the zones that can book it (section 5), plus the far-edge rule (R18) |
| Two-hour arrival windows, narrowed by a night-before route solve | Fixed start times. No route solving |
| Hard gate "price acknowledged" | Replaced by R1: the range has been shown to this customer |
| Hard gate "mobile verified by OTP" | Kept (R20) |
| Hard gate "in service area" | Kept, now three-way (R8 to R10) |
| Hard gate "authorised to commission" | Left out (R30) |
| Any open calendar a customer can book freely | Removed (Tom's ruling of 20 September, confirmed here) |

---

## 4. How it works

### 4.1 Address to outcome

The property address decides everything. Resolve it on the server from the structured address the wizard already stores.

- Look up by **suburb and postcode together**. Postcode alone is wrong: Glen Waverley (Zone 1) and Wheelers Hill (Zone 3) share 3150, and Parkdale (Zone 1) and Mordialloc (Zone 4) share 3195.
- Result is one of: `zone_1` to `zone_5`, `pre_arranged`, `out_of_area`.
- A Victorian suburb that is not in the list at all must not be silently rejected. Send that customer down the request-a-time path and raise an "unmapped suburb" item in the work queue.

### 4.2 Which slots a customer sees

A slot is offered to a customer only when **all** of these are true:

1. The customer's address resolves to a bookable zone.
2. The slot's zone list includes that zone, or its conditional rule is met (R14).
3. The slot is not booked and not held by someone else.
4. It starts at least 2 hours from now and no more than 21 days from now.
5. Nothing in the estimator's Google Calendar overlaps the slot's full 90 minutes (the visit and the travel after it).
6. The far-edge rule is not broken (R18): if the customer's suburb is marked far edge, and the slot directly before or after it (same day, same estimator) is booked by a far-edge suburb in the paired zone, the slot is hidden.
7. The day is not in the public holidays list (decision 1 in section 11).

"Booked" in rules 2 and 6 means a confirmed booking. A hold does not count for another customer's conditional or far-edge check, but it does block the held slot itself.

All times are wall-clock times in `Australia/Melbourne`. Store instants. Daylight saving must not shift a slot.

### 4.3 Booking

1. Customer picks a slot. The server places a **hold** for 10 minutes and sends a 6-digit code by text.
2. Customer enters the code. The server re-checks every rule in 4.2 inside one transaction, then confirms.
3. On confirmation: a `crm_events` entry, a text and an email to the customer, a one-hour Google Calendar event with the customer invited, a 30-minute travel block after it in the estimator's calendar, and the slot disappears for everyone else.

If the hold expires, the slot is released and the customer is told plainly, with a button back to the calendar.

### 4.4 Requests

Three things create a request rather than a booking:

- A visit asked for before the price range (R3).
- A pre-arranged address (R10). The customer picks the weekdays and time of day that suit.
- A zone customer who taps "None of these suit" or whose zone has nothing free in the next 3 weeks (R19).

A fourth kind is the **call request** from Speak with us (R25). The server decides whether the job is within the phone range. The browser only shows or hides the button.

Requests and messages go into the **existing** work queue, due within one working day (R33). A request made on a Friday is due by the end of Monday. A request made the day before a public holiday is due by the end of the next working day after it.

Public holidays come from a list in Settings that Tom can edit. Seed it from the Victorian Government's published list for metropolitan Melbourne, for this year and next, and report the dates and the source so Tom can check them. Do not type the dates from memory. Raise a work-queue item each November to add the following year. Staff answer a request by offering a time. Offering a time books the slot for the customer, sends them the details and the invitation, and needs no text code. Staff may pick any free slot, including one whose zone list would not normally allow that address.

### 4.5 Messages from customers

- Details first if we do not hold them, then the message box (R26).
- The message is written once, into the customer's existing conversation in the platform, so staff reply from the chat they already use. **If there is no customer conversation store to post into, STOP and report.** Do not build a second inbox.
- It is also sent by email as R35 sets out.
- A message from an out-of-area customer works the same way and still saves the lead.

### 4.6 Google Calendar

One connection per estimator. For Tom it is info@paintgroup.com.au.

- **Write.** Each confirmed booking creates two things in the estimator's calendar (R32). First, a **one-hour** visit event with the property address as the location and the customer as a guest, so Google emails them the invitation. Second, a separate 30-minute "Travel" block straight after it, with no guests.
- The platform's own bookings always block the full 90 minutes, whatever happens to the travel block in Google.
- **Read.** Any event in that calendar that the platform did not create hides overlapping slots. The platform's own visit events and travel blocks are ignored here, so a booking never blocks itself. An all-day event hides the day. This is also how Tom blocks leave and public holidays.
- **Cancel.** When the guest declines, cancel the booking, remove the visit event and its travel block, reopen the slot, tell staff through the work queue, and send the customer a short confirmation that the visit is cancelled.
- **Changes Tom makes in Google** follow R27.
- **Reminders.** The reminder to the customer is the platform's text (R28). As far as I know, Google only lets us set a pop-up reminder on the estimator's own copy of the event, not on the guest's, so the customer's calendar reminds them according to their own settings. Confirm this in the current documentation and report. Set a reminder on the estimator's copy.
- Check the current Google Calendar API documentation before coding. Use the smallest permissions that allow creating events and reading busy times. Keep tokens on the server only.
- If Google cannot be reached when a customer confirms, do not book blind. Send the customer to the request-a-time path instead.
- If creating the event fails after a booking is confirmed, the booking stands. Retry, and raise a work-queue item if it keeps failing.
- Changes must arrive both by Google's push notifications and by a scheduled sweep, so a missed notification is caught. Follow the existing `wo-sweep` cron pattern with `CRON_SECRET`.

### 4.7 The gate and its tracking

- Default: details first (R5). Settings switch to range first, changed by hand (R6, R7).
- A wizard session keeps the version it started with, even if the switch changes mid-session.
- Record, per session: which version, each step reached, gate shown, gate completed, range shown, option chosen on the range screen (tighten, speak, visit or message), visit booked or requested.
- Report it in the dashboard's "Where estimates go" section, by version: reached the gate, completed it, percentage lost at the gate, saw the range, what they did next. Date filter and CSV export as the dashboard brief requires.
- Completing the gate creates or links the customer through the existing identity model. Do not create a second way of storing customers.
- The marketing tick on the gate is optional and unticked by default, as the existing registration rule requires.

---

## 5. The week

Seed this as Tom's schedule. Times are slot starts. Every slot runs 90 minutes: one hour with the customer, then 30 minutes of travel.

| Day | Start | Zones that can book |
|---|---|---|
| Monday | 08:00 | 5, 2, 1 |
| Monday | 09:30 | 5, 2, 1 |
| Monday | 11:00 | 1 |
| Monday | 12:30 | 1 |
| Monday | 14:00 | 1 |
| Monday | 15:30 | 1 |
| Tuesday | 08:00 | 1, 2, 3, 4, 5 |
| Tuesday | 15:00 | 3, 4, 1 |
| Wednesday | 08:00 | 1, 2, 5 |
| Wednesday | 09:30 | 2 |
| Wednesday | 11:00 | 2 |
| Wednesday | 12:30 | 2 |
| Wednesday | 14:00 | 5, 1 |
| Thursday | 08:00 | 1, 2, 3, 4, 5 |
| Thursday | 16:30 | 1, 2, 3, 4, 5 |
| Friday | 08:00 | 4, 3, 1 |
| Friday | 09:30 | 3, 1 |
| Friday | 11:00 | 1, 2 |
| Friday | 12:30 | 2. Also 1 if the 11:00 visit is Zone 1 |
| Friday | 14:00 | 2, 5 |
| Friday | 15:30 | 2, 5, 1 |

21 slots a week. Slots each zone can book: Zone 1 = 16, Zone 2 = 13, Zone 3 = 6, Zone 4 = 5, Zone 5 = 9. Use these totals as a seed check.

No slots on Saturday or Sunday.

---

## 6. Settings screens

Follow the "Your week" tab of the mockup for layout and behaviour.

**Visit zones**
- A list of suburbs with postcode, status (Zone 1 to 5, pre-arranged, out of area), a far-edge tick, and whether Tom has reviewed it.
- Filter by status. Move a suburb to another status. Approve in bulk.
- Each bookable zone shows which estimator covers it.

**Visit schedule** (per estimator)
- Day tabs. Each slot shows its time and zone chips.
- Tap a slot to toggle zones, set or clear a conditional rule ("also Zone X if the slot before is Zone Y"), or remove it. Add a slot.
- A live count of slots a week per zone.
- A slot with no zones is allowed but must show a clear warning that nobody can book it.

**Booking rules**
- Same-day booking on or off. Shortest notice (default 2 hours). Booking window (default 3 weeks). Hold time (default 10 minutes).
- Slot length (90 minutes) and the visit length shown to the customer (60 minutes).
- Phone limits for Speak with us (R34). Reminder time (R36).
- Public holidays list (R33).
- Far-edge pairs (seeded with Zone 4 and Zone 3).
- Gate order: details first or range first.

**Estimators**
- Add an estimator: name, the zones they cover, their week, and their Google Calendar connection.
- Customers see the free slots of the estimator who covers their zone.

---

## 7. Sessions

Walking skeleton first. Each session ends with its acceptance criteria met, the ledger updated, and a short report. Migrations run between gate runs, never during one. Tom pastes SQL.

### S0. Read and report. No code.

- Commit the reference files. Confirm the list back.
- Report, with file paths: how the wizard stores the address and whether suburb and postcode are separate fields; how the current gate works; how `wizard_sessions` records steps; how the work queue takes a new item type; how messages are sent and made editable; where the office phone number is stored; whether the staff scheduling calendar can show a visit; where customer chat conversations are stored and how a customer message is posted into one; where the existing price limits live in Settings (interior and straightforward exterior).
- List anything in the parent brief that conflicts with section 2 and is not covered by section 3.

**Done when:** Tom has the report and has answered anything that stopped you.

### S1. Zones

- Suburb list, statuses, far-edge tick, review flag. Settings → Visit zones.
- Seed it:
  1. Take a list of Victorian suburbs with postcode and centre point. Report the source and its licence.
  2. Test each centre point against `visit-zones-draft2.geojson`, features in ascending `priority`, first hit wins. No hit is out of area.
  3. Apply `visit-zones-suburb-rulings.csv`. The CSV always wins.
  4. **Report every suburb where the outline and the CSV disagree. Do not quietly pick one.**
  5. Write `docs/briefs/data/visit-zones-review.csv` for Tom: suburb, postcode, proposed status, basis.
- Far-edge ticks are seeded from the CSV's `far_edge` column (R18).
- The resolver from 4.1.

**Done when:**
- All 210 suburbs in the rulings CSV resolve to their `expected_status`. This is an automated test.
- Glen Waverley 3150 is Zone 1 and Wheelers Hill 3150 is Zone 3. Parkdale 3195 is Zone 1 and Mordialloc 3195 is Zone 4.
- Greensborough, Bundoora, Werribee and Tarneit are out of area. Thomastown, Eltham, Cranbourne, Pakenham, Officer and Clyde are pre-arranged. Lynbrook, Langwarrin and Baxter are Zone 4.
- A made-up Victorian suburb resolves to "unmapped" and raises a work-queue item.
- Tom can move a suburb in Settings and the resolver follows at once.

### S2. Schedule and the availability function

- Estimators, weekly slots, conditional rules, booking rules. Settings → Visit schedule and Booking rules.
- One availability function in `lib/` with no database or network calls inside it, so it can be tested with fixed inputs. It takes the week, the bookings, the holds, the busy times, the rules, the customer's zone and far-edge flag, and "now".

**Done when** these golden tests pass:
- The seeded week gives the per-zone totals in section 5.
- Zone 1 on a Monday with nothing booked: 08:00, 09:30, 11:00, 12:30, 14:00, 15:30. Zone 4 on a Friday: 08:00 only. Zone 3 on a Tuesday: 08:00 and 15:00.
- Friday 12:30 is offered to Zone 1 only when Friday 11:00 has a confirmed Zone 1 booking. A hold on 11:00 does not unlock it.
- Now is Monday 10:15. Monday 11:00 is hidden. Monday 12:30 is offered. A slot starting exactly 2 hours from now is offered.
- A slot 21 days ahead is offered. A slot 22 days ahead is not.
- Friday 08:00 is booked by a far-edge Zone 4 suburb. Friday 09:30 is hidden for a far-edge Zone 3 suburb and offered to an ordinary Zone 3 suburb and to Zone 1. The same holds with the order reversed.
- A busy time of 13:00 to 13:30 on Wednesday hides the 12:30 slot only. An all-day busy time hides the whole day.
- The Monday after daylight saving starts, and the Monday after it ends, still offer 08:00 local time.
- Editing a slot's zones in Settings changes the function's answer.
- A day in the public holidays list offers no slots. The same weekday a week later offers its normal slots.

### S3. Walking skeleton: book a visit

- From the range screen: Book a site visit → calendar → hold → text code → booked. Screens and wording exactly as the mockup.
- One server action does the booking. It resolves the zone from the stored address, re-runs availability, and confirms in a single transaction. Two customers can never hold or book the same slot.
- Text code: 6 digits, sent through the existing messaging adapter, stored hashed, expires with the hold, 5 wrong attempts ends the hold, 3 resends per hold, limits per mobile number and per IP address.
- On confirmation: `crm_events` entry, text and email to the customer.
- The estimate is linked to the visit. One active visit per estimate.

**Done when:**
- An e2e test, run as an anonymous customer on the test project, books a Zone 1 visit from the range screen to the confirmation screen.
- The booked slot no longer shows for a second customer.
- Section 8 tests 1 to 9 pass.
- Side-by-side with the mockup, the four screens match in order, wording and controls.

### S4. Requests, pre-arranged and out of area

- The three options on every step before the range (R3, R4).
- Pre-arranged request-a-time screen. "None of these suit". The out-of-area screen and its message step.
- Work-queue items with a one-working-day due time. Staff action: offer a time (4.4).
- Call us dials the office number from Settings. If there is no such setting, STOP.
- Speak with us on the range screen (R25) and the call request it creates.
- Send us a message, before and after the range (R26, 4.5).

**Done when:**
- A Sorrento address never sees the calendar and creates a time request.
- A Werribee address sees the out-of-area screen and can send a message. A lead is saved.
- A visit requested at step 3 of the wizard creates a request with all four contact fields and books nothing.
- A request not answered by the end of the next working day shows as overdue in the existing attention queue. No new list was built.
- A request made on a Friday is due by the end of Monday. A request made the day before a public holiday in the Settings list is due by the end of the next working day after the holiday.
- The public holiday list was seeded from the official Victorian list, and the dates and source are in the session report.
- Staff offer a time, the customer receives it, and the slot is taken.
- Speak with us shows for a job inside the phone range and is absent for one outside it. Tapping it creates one call request, due within one working day.
- A message sent before the range asks for details first, then shows the message box. A message sent after the gate goes straight to the message box.
- One sent message appears once in the customer's conversation in the platform and arrives by email. Sending it does not create a second inbox or list.

### S5. Google Calendar

- Connect an estimator's Google account. Write, read and cancel as 4.6.

**Done when:**
- A booking appears in the connected calendar within a minute as a one-hour event, with the address and the customer as a guest, followed by a 30-minute travel block with no guests.
- The customer's invitation, text, email and confirmation screen all show the same one-hour time, for example 2:00 pm to 3:00 pm. None of them shows the travel time.
- Neither the visit event nor the travel block hides any other slot. Cancelling removes both.
- A private event added in Google hides the overlapping slot from customers within 5 minutes.
- Declining the invitation cancels the booking in the platform, reopens the slot and raises a staff item.
- **Declining from a non-Google mailbox is tested too (Outlook and Apple Mail). If those declines do not reach the calendar, STOP and report.** The fallback is a cancel link in the text, which needs Tom's ruling.
- With Google unreachable, a customer confirming is sent to request-a-time and nothing is double-booked.
- Disconnecting the calendar stops customer booking for that estimator and tells staff why.
- Deleting the event in Google cancels the visit and texts the customer. Moving it leaves the visit unchanged and raises a work-queue item (R27).
- The reminder text is sent the evening before, once, and not at all for a cancelled visit.

### S6. The gate

- Contact step as the last question before the range. Settings switch. Tracking and the dashboard report (4.7).
- Range screen with Tighten my price as the main button, and the link back to it on the calendar screen (R17).

**Done when:**
- Details first: the range cannot be fetched from the server without a completed gate. This is tested at the API, not just in the page.
- Range first: the range shows with no details, and each option on the range screen asks for details before continuing.
- The range screen shows the R24 options in order, with no "Request a quote" anywhere in the wizard.
- A session keeps its version after the switch is changed.
- The report shows, per version, sessions that reached the gate, completed it and saw the range, and the numbers match the test data exactly.
- The two-estimates limit per email and IP still holds.

### S7. Full loop and hand-over

- One e2e run: wizard → gate → range → book → code → Google event → decline → slot reopens.
- Help pages in `docs/help/` for staff: managing zones, managing the week, answering requests, connecting Google Calendar.
- Add every new message to the messaging inventory.

**Done when:** all of section 8 passes, the health check is clean, and Tom has done his 90-second walkthrough on his phone.

---

## 8. Tests that try to break it

Run these against the API directly, not through the page.

1. Book a slot whose zone list does not include the address's zone, by sending a different zone. Refused. The zone comes from the stored address only.
2. Book without a valid code. Refused.
3. Book with an expired code or after the hold ran out. Refused, hold released.
4. Two customers confirm the same slot at the same moment. Exactly one succeeds.
5. Book a slot starting in 90 minutes. Refused.
6. Book a slot 30 days ahead. Refused.
7. Book from a pre-arranged address. Refused.
8. Book from an out-of-area address. Refused.
9. Book on an estimate that has never been shown its range. Refused.
10. Six wrong codes. Hold ended, no booking.
11. Request 20 codes to one mobile in a minute. Limited.
12. Fetch the range in "details first" with no completed gate. Refused.
13. A far-edge Zone 4 customer holds Friday 08:00 and a far-edge Zone 3 customer holds Friday 09:30. Whoever confirms second is refused, because confirming would break R18.
14. A customer calls another customer's booking or request by id. Refused.
15. A browser tries to write a booking row directly. Refused. Only the server action can.
16. Request a call for a job outside the phone range. Refused.
17. Send the same message twice by retrying the request. It appears once in the conversation and one email is sent.
18. In Settings, add a slot that starts inside another slot's 90 minutes for the same estimator. Refused.
19. Delete a visit's travel block in Google, then try to book a time inside it. Still refused, because the platform's own booking blocks the full 90 minutes.

---

## 9. Customer wording

The mockup is the wording. Do not rewrite it. The key lines:

| Screen | Wording |
|---|---|
| Before the range, on each step | Would you rather talk it through? **Request a site visit / Call us / Send a message** |
| Gate | **Where shall we send your estimate?** Enter your details to see your guide price. We will save your estimate so you can come back to it. Button: **Show my guide price** |
| Range | **Your guide price.** $X to $Y. AUD, including GST. This is based on what you have told us so far. One of our team confirms every price with you before it is fixed. |
| Range, main button | **Tighten my price.** Get a more accurate quote now |
| Range, second button, only inside the phone range | **Speak with us.** Request a call to finalise your booking |
| Range, other buttons | **Book a site visit.** Choose a time for us to see the property. **Send us a message.** Ask a question about your estimate |
| Call requested | **Thank you, we will call you.** We will call you on [mobile] within one working day to finalise your booking. |
| Message box | **Send us a message.** Tell us a little about your project and we will reply by email or phone. Button: **Send my message** |
| Message sent | **Thank you, your message is with us.** We will reply within one working day. |
| Calendar | **Choose a time for your site visit.** These are the times we are in [suburb] and nearby. Links: None of these suit? Request a different time. Rather not wait for a visit? Tighten your price online |
| Slot summary on the code and booked screens | [Day date], [start] to [start plus one hour]. For example: Monday 5 October, 2:00 pm to 3:00 pm |
| Code | **Confirm it's you.** We have sent a 6-digit code by text to [masked mobile]. Enter it to book your visit. Button: **Book my visit** |
| Booked | **Your site visit is booked.** We have sent the details by text, and a calendar invitation by email. We will send a reminder by text the evening before. If you need to cancel, decline the invitation or call us. |
| Pre-arranged | **We visit [suburb] by arrangement.** Tell us which days suit you and we will confirm a time with you. |
| Request sent | **Thank you, we have your request.** We will be in touch within one working day to arrange your site visit. |
| Out of area | **We don't currently visit [suburb].** We are sorry, this address is outside the area we cover for site visits. You are welcome to send us a message and we will let you know if we can help. |

Dates read as "Monday 5 October". Times read as "2:00 pm".

---

## 10. Messages to add to the inventory

Every one gets editable wording. Each can be set to text or email unless marked.

| Message | To | Default |
|---|---|---|
| Text code | Customer | Text only |
| Visit booked | Customer | Text and email |
| Request received | Customer | Email |
| Time offered by staff | Customer | Text and email |
| Visit cancelled | Customer | Text |
| Visit cancelled by customer | Staff | Work queue |
| New request or message | Staff | Work queue |
| Unmapped suburb | Staff | Work queue |
| Reminder, evening before | Customer | Text. On (R28) |
| Call request received | Customer | Email |
| Call request | Staff | Work queue |
| Customer message | Staff, with a copy to the customer | Platform chat and email (R35) |

---

## 11. Decisions for Tom

Two small ones are left. Neither stops the build. Each has a starting value. They match the "Still open" list in the mockup. Every earlier decision is now a ruling in section 2.

| | Decision | Starting value |
|---|---|---|
| ⚑ 1 | Should customers be able to book a visit on a public holiday? | No. Slots on a day in the public holidays list are not offered |
| ⚑ 2 | Which calendar inside info@paintgroup.com.au | The main one |

**Things only Tom can do**

- Say whether info@paintgroup.com.au is a Google Workspace account or a standard Google account. It changes how the connection is set up.
- Create the Google connection credentials and add them to Vercel. Claude Code lists exactly what is needed in the S5 report.
- Paste each migration into Supabase between gate runs.
- Review `visit-zones-review.csv` and approve the suburb list in Settings.
- Check the seeded public holiday dates.
- Add the test customer's mobile number for the text-code e2e.

---

## 12. Not in this brief

- Route optimisation or drive-time checks.
- Trade and commercial accounts booking visits.
- Customers moving a visit themselves. They cancel and rebook.
- Payment or deposits for visits.
- The AI assistant arranging visits. It can hand over to these screens later.
- A second estimator's actual zones. The build supports it. The zones are drawn when they join.

---

## 13. Definition of done

- Every "Done when" in section 7 is met and every test in section 8 passes.
- The customer screens match the mockup in order, wording and controls.
- No money, zone, eligibility or availability decision is made in the browser.
- Nothing new was built for lists, badges or inboxes. Requests use the existing work queue. Events use `crm_events`. Messages use the existing adapter.
- Every new message is in the inventory with editable wording.
- Help pages are written from the finished screens.
- The session ledger is up to date.

---

## 14. Kickoff prompt

Paste this into Claude Code:

```
Read CLAUDE.md first.

I am adding five files for the visit booking module:
- docs/briefs/claude-code-brief-visit-booking-addendum-a.md
- design/reference/paint-group-visit-booking-mockup.html
- design/reference/paint-group-visit-zones-map.html
- docs/briefs/data/visit-zones-draft2.geojson
- docs/briefs/data/visit-zones-suburb-rulings.csv

Commit them, then confirm the file list back to me before writing any code.

Then run session S0 of the addendum only. It is read-and-report, with no code.
Read the parent brief docs/briefs/claude-code-brief-visit-booking.md and every
file listed in section 1 of the addendum. If any file marked "must exist" is
missing, stop and tell me which one.

The rulings in section 2 are settled. Do not reopen them. Where the parent
brief and the addendum disagree, the addendum wins. Section 3 lists what is
replaced. If you find a conflict that section 3 does not cover, stop and report.

Finish S0 with the report it asks for, and wait for my go-ahead before S1.
```
