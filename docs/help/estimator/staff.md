---
feature: estimator
role: staff
title: Online estimates from the office side — the queue, the pack, and the three things you can do with a request
summary: Every online quote lands in Waiting on you with a promise clock; the Pack tab shows what the customer built and what they assumed; you fix the price, ask a question or book a visit from the strip, and the measured tree goes to the property when you fix.
sources: app/(app)/estimates/WaitingTable.tsx, app/(app)/estimates/actions.ts, app/quote/PackPane.tsx, app/quote/StripActions.tsx, app/api/confirmations/[id]/route.ts, lib/crm/work-queue.ts
---

## What this is for
The customer does the typing; you do the confirming. This page is the office side of the online estimate: where requests appear, what you are looking at, and what each button does.

## Before you start
A staff login with the Estimates area. If you take visits, the office should tick you under Settings → Estimator visits and set your patch postcodes so requests from your area name you.

## Steps
1. **Estimates → Waiting on you.** Every online request is a row with a bucket: **Overdue** (past the turnaround we told the customer), **Today**, or **Waiting**. The sentence on the row is the queue's own — it says what we promised and whether that has passed. The turnaround comes from Settings → `confirmation_turnaround`; change it there and every row follows.
2. **Tidying the list.** Tick the box on any rows you have dealt with and press **Remove from this list**. That takes them off *this screen only* — the item stays on CRM Today and in the badge count, because nothing about the customer changed. An **Undo** sits in the line that confirms the removal. To silence an item everywhere, dismiss it from CRM Today, where a reason is asked for.
3. Open the row → the estimate opens on its **Pack** tab: the customer's answers, the range they saw, the rooms and what was assumed (amber) versus confirmed by them (cyan), their photos, and any notes from the assistant.
4. The strip has three buttons:
   - **Fix the price and send** — fixes the engine's own figure (never the top of the band), sends the confirmation, and writes the measured tree to the property so the next quote on that address starts from it. Outside the remote-confirmation cap the button says so; sending is then an override.
   - **Ask a question** — records the question; nothing is sent automatically, you send it.
   - **Book a visit** — marks the request visit-booked and raises the CRM event; book the time in the Diary.
5. A fixed price cannot be fixed again — that is a variation. A visit already booked blocks a second booking until it is done or cancelled.
6. **Commercial requests** never reach fix-online. A brief request (strata, hospital, any outside work) arrives with the brief on the pack and a visit already booked from the customer's slot pick; the site checklist items it raised (induction, meeting date, hazmat) are on the Pack too.
7. **Trade requests** likewise always come to you. Fixing one puts the tree on the property's file; the agent's next quote on that property is seeded from it.

## In the builder
- **Admin notes** is the first card, above Job settings — anything the office knows that helps price the job (what the customer said on the phone, access, budget). Staff only: never on the customer's copy or the work order. Saved with the estimate.
- **Preparation** reads "Allowance for time/ materials for job site set up, fillers and consumables". The amount is the Settings allowance (type your own to change it for this job). **Contractor time** on the same card is hours for site set-up: they are charged to the customer at the charge-out rate on the Preparation line, and they go to the painter's work order as a **Preparation** area at the top, so the offer's hours and the pay carry them.
- **A single wall.** On a walls row inside a room-measured area, switch **Room L×W×H** to **Single wall W×H** to price one wall on its own — a feature wall, or a wall needing extra coats. Type its width (the height comes from the room), pick its coats, and it prices as W × H. Add another Walls row for the rest of the room. Switching back to Room clears the wall's own size.
- **Clicking away saves.** With unsaved changes, any link — the sidebar, a breadcrumb — saves the estimate first and then opens the page. If the save fails, you stay on the builder and its message says why. Closing the tab with unsaved work asks the browser's "leave site?" question.

## What the colours and labels mean
- **Overdue** (clay), **Today**, **Waiting** — the queue's buckets, from the promise clock.
- **Amber** on the pack — assumed by the engine, the reader or the assistant. **Cyan** — the customer confirmed it.
- **"Outside what we fix remotely"** — over the cap in Settings → `wizard_policy`; a person decides.

## If something goes wrong
- A request is in the queue with no customer contact — the customer never gave an email; the pack still has the address and the range; call or visit.
- A row you removed is back — it came back under a new fact (a call request that became a visit request is a new row), or someone pressed Undo. Remove it again.
- "Removing rows from this list needs migration 20270147 run first" — the hidden-rows table is not on this project yet.
- "Somebody else just acted on this one" — two people on the same card; reload and look again.
- The measured tree did not land on the property — the estimate has no property linked; link it on the record, then fix again from a new request.

## Related
- crm/staff — Today, the Diary and the customer record
- estimator/customer, estimator/commercial, estimator/trade — what the customer sees
