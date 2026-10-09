---
feature: visit-zones
role: staff
title: Decide which suburbs can book a site visit, and in which zone
summary: Settings → Visit zones is the list of every Victorian suburb with its status — a bookable zone, pre-arranged, or out of area — the far-edge tick, who covers each zone, and a box to check what a customer at any address would be offered.
verified_at_commit: 857c0e4f15b5a63358f101dc7440da29a82fa976
---

## What this is for
When a customer asks for a site visit, their property address decides what they see: the free times in one of the five zones, a request-a-time form (pre-arranged areas), or a polite "we don't visit here" with a message box (out of area). This screen is where that decision lives. Change a suburb here and the next customer gets the new answer straight away.

## Before you start
- You are signed in as office staff. Open **Settings → Company → Visit zones**.
- The list was seeded from the approved zone map (draft 2, 5 October 2026) and your suburb rulings. Rows you ruled on show **Reviewed: Yes**; the rest were placed by the map outline and show **Not yet**.

## Steps
1. **See who covers each zone.** The five cards at the top show each zone, how many suburbs it holds, and the estimator whose week it books into. Pick a name in the drop-down to change it. A zone has one estimator at a time.
2. **Find a suburb.** Type a suburb or postcode in the search box, or tap a filter chip (Zone 1 to 5, Pre-arranged, Out of area, Not yet reviewed, Far edge).
3. **Move a suburb.** Change the status drop-down on its row. The message under the list confirms it, and the change is live for the next customer.
4. **Move several at once.** Tick the rows, then use **Move selected to…**.
5. **Mark the far edge.** Tick **Far edge** on a suburb at the outer edge of Zone 3 or Zone 4. A far-edge Zone 4 visit is never offered back to back with a far-edge Zone 3 visit.
6. **Approve in bulk.** Filter to **Not yet reviewed**, look down the list, then tap **Approve everything shown**. Approving changes nothing but the Reviewed mark.
7. **Add a suburb.** Fill in suburb, postcode and status under **Add a suburb**. Suburb and postcode together make the row: Glen Waverley 3150 (Zone 1) and Wheelers Hill 3150 (Zone 3) are two rows.
8. **Check an address.** Type a suburb and postcode under **Check an address** and tap **Check**. It tells you exactly what a customer there would be offered right now. This never records anything.
9. **Answer an unmapped suburb.** If a customer types a Victorian suburb the list does not know, they are sent to request a time and an amber box appears at the top of this screen (and a **Suburb** card on CRM Today). Choose **Add as…** to give it a status, or **Dismiss** if it was a typo. Both clear the Today card.

## What the colours and labels mean
- **Zone 1 to Zone 5** — the customer books one of that zone's slots.
- **Pre-arranged** — no calendar; the customer asks for days that suit and you confirm a time.
- **Out of area** — no calendar and no time request; the customer can send a message and is saved as a lead.
- **Far edge** — the outer-edge suburbs of Zone 3 and Zone 4 that are kept apart in the day.
- **Reviewed: Not yet** (amber) — placed by the map outline, not yet looked at by you.
- **Amber box at the top** — suburbs customers typed that are not in the list, waiting for a status.

## If something goes wrong
- **A red line says the zones could not be loaded.** The database is behind the app. Run the newest migration, then reload.
- **A suburb is not in the list.** Add it under **Add a suburb**. If a customer already hit it, it is in the amber box; adding it there also clears the Today card.
- **The same suburb name is in two places.** That is two postcodes with one name (Hillside 3037 near Sydenham, Hillside 3875 in Gippsland). Each row is its own decision.

## Related
- `estimator/staff` — the online estimate the customer books from.
- `crm/staff` — CRM Today, where the unmapped-suburb card appears.
