---
feature: movements
role: contractor
title: Your pickups and drop-offs — where the paint is, when it comes, what to bring back
summary: The office plans how paint, materials, gear and rubbish get to and from your job. You see it in two places — a "Your pickups and drop-offs today" card on your home screen and a "Getting it to site" section on the job sheet — with the shop's address and phone, the order reference to quote at the counter, and a tick for each pickup, drop-off or return that is yours.
sources: app/portal/MovementsCard.tsx, app/portal/page.tsx, app/portal/jobs/[id]/page.tsx, app/w/WorkOrderDoc.tsx, lib/movements/painterView.ts, lib/movements/painterLoad.ts, supabase/migrations/20270281000000_movements_painter_run.sql
verified_at_commit: bde6480324
---

## What this is for
Every job needs paint, usually some materials, sometimes gear from the warehouse or a hire yard, and a plan for the rubbish. The office plans all of that on their Movements board. What reaches you is the part that is yours: **pick this up at this shop from this time, quote this order number**, or **it is being delivered Monday morning**, or **bring the sprayer back Friday**. You tick each one as you do it, so the office knows without ringing you.

## Before you start
- A pickup only appears as "ready" once the office has placed the order. Until then the line says the office will text you when it is ready — do not drive to the shop yet.
- The order is under **Paint Group**'s trade account. You quote the **order reference** (PG-0093 and the like) at the counter; you never need an account number.
- The text that tells you a pickup is ready comes from the office's number. Reply there if something is wrong.

## Steps

### On your home screen
1. When there is something to pick up, drop off or bring back today, a **Your pickups and drop-offs today** card sits near the top, numbered in the order the office planned.
2. Each line says what it is (for example "Dulux · 4 lines · 6 cans") and the sentence that matters: *Pick up at Paint Spot Carnegie, 1066 Dandenong Rd, Carnegie, from 6:30 am Tue 20 Oct — order PG-0093 under Paint Group.* Paint lines list the products, colours and litres underneath — the trade-counter list.
3. **Navigate** opens the shop in Google Maps. **Call** rings the shop.
4. Tap **Picked up ✓** (or **Dropped off ✓**, **Returned ✓**) once it is in the van. The line greys out with a tick. The office sees it the same moment.
5. If the office texts you a run for a day other than today, the link opens the same card for that day.

### On the job sheet
1. Open the job. Under **Materials & colours** there is a **Getting it to site** section with up to four groups: **Paint**, **Materials**, **Loan gear**, **Rubbish**.
2. Paint and materials say either *Delivered to site Mon 19 Oct, morning* (nothing for you to do) or *Pick up at …* (yours, with the same Navigate, Call and tick as the card).
3. Loan gear says when it comes to site and, if you are to bring it back, *Bring it back to the warehouse Fri 23 Oct* with a **Returned ✓** tick.
4. Rubbish says how it goes: a skip's in and out days, *Drop the rubbish at the warehouse on your last day*, *Take the rubbish to the tip — claim the fee under Expenses*, or *Leave the rubbish on site — it is collected*.
5. Short of something that is not on the list? **Request more** on the same job page still works — the office turns it into a line and you are told when it is ready.

## What the colours and labels mean
- **A number on the left** — the order the office planned your stops in.
- **✓ in green** — done; you (or the office) ticked it.
- **"the office will text you when it is ready"** — the order has not been placed yet.
- **Amber line at the top of the card** — the list could not be read; it is not that there is nothing to do.

## If something goes wrong
- **The shop has no order under Paint Group** — ring the office; the line on your card carries the order reference to read out.
- **You cannot tick a line** — only lines on your own run have a tick; a delivery to site has none. If a pickup of yours has no tick, the office has not placed the order yet.
- **Nothing on the card but you were texted** — check the day in the text; the card shows today unless the link named another day.
- **"Pickups and deliveries are not switched on yet"** — the office has not run the update that adds this; tell them.

## Related
- [portal-gaps/contractor](../portal-gaps/contractor.md) — Request more materials from the job page.
- [work-orders/contractor](../work-orders/contractor.md) — the rest of the job sheet.
