---
feature: quote-stage
role: staff
title: The customer's quote-range stage, seen from the office
summary: What a customer builds on "Get my quote range" — one question per card, the quote writing itself — lands in the same estimate tree the scope page wrote; you preview it from the estimate's link, and nothing on it prices in the browser.
---

## What this is for
The quote-range stage is on by default (`NEXT_PUBLIC_QUOTE_STAGE_V10=0` switches it off for a release); the phone gate's **Get my quote range** opens `/estimate/quote?id=…` instead of the room-by-room scope page. Every tap posts one of the scope page's existing actions, so the estimate, its lines, its repairs and its photos arrive in **Waiting on you** exactly as before. This page is for previewing what the customer saw.

## Before you start
You are signed in as staff. The estimate is still a draft (an accepted estimate shows "its scope is locked in").

## Steps
1. Open the estimate's customer link with `/estimate/quote?id=<estimate id>` — staff can open any draft; a customer only their own.
2. You see the stage as they do: on a phone width the tiles (Quote, the room drawn, the plan if uploaded), the price band and the card; on a laptop the three columns — drawing left, the card centre, plan + price + quote right.
3. Tap through with the keyboard on a laptop: **1–4** pick, **Enter** is the button, **←** goes back. Anything you answer here writes to the draft, the same as the customer.
4. The repairs a customer pointed out are **Repair — …** lines on the room (the spot tags); a side's note on an outside job rides as an amber line on that side. Photos are in the pack as condition photos.

## What the colours and labels mean
- **Draft quote · PG-xxxxxx** — lines still open; **Quote** once every line is measured or typical.
- **(typical)** — the customer kept the typical size for that room; **—** in the amount column means the line is still open.
- **closing in · N% settled** — the share of the quote's lines settled, not the engine's accuracy figure.

## If something goes wrong
- The link opens the old scope page — the stage was switched off on this environment (`NEXT_PUBLIC_QUOTE_STAGE_V10=0`), or the estimate predates the sides rebuild (a holding line says so).
- A card will not save — the customer sees "That didn't save"; the action is one of the scope page's own, so check the estimate's draft state and the route's response in the error monitor.

## Related
- [The customer's view](customer.md)
- [Online estimates from the office side](../estimator/staff.md)

## Changes on 19 Nov 2026
- **The customer's quote lines come from one split** (`lib/pricing/quoteBreakdown.ts`): each room's engine price, plus Set-up and preparation (sundries + prep hours), Cleaning, specialist work, size allowance and discount, share the range in whole dollars so the lines add to the Subtotal. The loading (job modifier) is inside the room prices and has no line of its own.
- **"Valid N days"** on the quote reads Settings → Estimates → Accuracy tiers & online cap → *how long a fixed price is held* (`wizard_hold_days`, default 60). There is no separate validity number.
- **Rooms cleared** applies no Staging modifier any more (the seeded `STG-EMPTY` row is unused); Mostly cleared and Furniture stays are unchanged.

## Contact sheet (20 November 2026)

- **Send us a message** is on the Contact sheet on every card of the quote stage, the finished quote included. The message lands in the customer's conversation in the CRM chat, the same place as a message sent from the range screen.
- **The number under the estimator's name** is the estimator's own: the staff profile whose patch covers the postcode, else Settings → Company → Estimator phone, else the company number. Change the number there, not in code.
- On a laptop the Contact sheet is a side sheet on the right. It used to draw as one large rounded bubble.
