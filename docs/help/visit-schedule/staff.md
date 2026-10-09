---
feature: visit-schedule
role: staff
title: Set each estimator's week of site-visit slots, and the booking rules behind the calendar
summary: Settings → Visit schedule is each estimator's week — the slots, which zones can book each one, and the Friday 12:30 rule. Settings → Booking rules holds the numbers the calendar follows, the public holidays and the far-edge pairs.
verified_at_commit: 7884fcc94a226d6d2c98062cbed1a0e62721d750
---

## What this is for
Customers in a zone only see times when the estimator who covers that zone is already in their part of Melbourne. This screen is where that week lives. Every slot runs 90 minutes: one hour with the customer, then 30 minutes of travel. Change a slot here and the next customer sees the new times.

## Before you start
- You are signed in as office staff. Open **Settings → Company → Visit schedule**. **Booking rules** is the folder below it.
- Zones are assigned to estimators under **Visit zones**. An estimator with no week shows an amber box and their zones offer no times until a week exists.

## Steps
1. **Pick the estimator.** The chips at the top name each staff login and the zones they cover.
2. **Load the standard week** if the estimator has none: the amber box has a **Load the standard week (21 slots)** button. It only works on an empty week, so it can never overwrite one.
3. **Pick a day.** Mon to Sun tabs, each with its slot count.
4. **Tap a slot** to open it. Tap the zone numbers to turn each zone on or off. A slot with no zones shows a red **No zones, nobody can book this** warning.
5. **Set the conditional rule.** Under the zones, choose "Also Zone X if the slot before is Zone Y". Friday 12:30 is seeded with "Zone 1 if the visit before is Zone 1".
6. **Add a slot.** The **Add a slot** button offers the next free time after the last slot of the day; type another start time if you want. A slot that starts inside another slot's 90 minutes is refused and the message names the slot it ran into.
7. **Remove a slot** from inside its panel.
8. **Watch the totals.** "Slots a week each zone can book" updates as you go. A slot shared by two zones counts for both; conditional rules are not counted. The seeded week gives 16, 13, 6, 5 and 9.
9. **Booking rules.** In the folder below: same-day booking, whether a connected Google Calendar is required, shortest notice (2 hours), how far ahead (21 days), hold time (10 minutes), slot and visit length (90 and 60 minutes), the Speak with us limits, the reminder time (6:00 pm the day before), the gate order, the far-edge pairs, and the public holidays list. **Save booking rules** applies them from the calendar's next load.
10. **The gate order.** "Details first" (the default) asks every customer for their name, email and mobile as the last question before the guide price. "Range first" shows the price first and asks for the details when they choose an option on the price screen. Switch it by hand to test the other order; a customer who has already started keeps the order they started with. The dashboard's "Where estimates go" card compares the two.

## What the colours and labels mean
- **Zone chips 1 to 5** — the zones that can book that slot.
- **Red "No zones"** — the slot exists but nobody can book it.
- **Grey "+ Zone X if the visit before is Zone Y"** — the conditional rule on that slot.
- **Amber box** — this estimator has no week yet.

## If something goes wrong
- **"That starts inside the 08:00 slot…"** — pick a start time at or after the previous slot ends.
- **"This estimator already has a week"** — the standard week only loads into an empty week. Remove the slots first if you want to start again.
- **"The visit the customer sees cannot be longer than the slot"** — visit length must be at or under slot length.
- **A red line says the schedule could not be loaded** — the database is behind the app. Run the newest migration, then reload.

## Related
- `visit-zones/staff` — which suburb is in which zone and who covers each zone.
