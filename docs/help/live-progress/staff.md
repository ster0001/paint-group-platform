---
feature: live-progress
role: staff
title: The live-updates demo card on a customer's estimate — when it shows, what it says, and the one setting behind it
summary: An estimate with a presentation attached carries one glowing card in the presentation's capability panel ("A few extra details"); pressed, it opens a phone playing an example of the day-by-day updates the customer will get, built from their own address, rooms and photos; trade accounts see commercial wording; the Demo painter comes from Settings → Website.
---

## What this is for
In the presentation's capability panel (**A few extra details** on the live presentations) a sent estimate carries one extra card that glows: **Receive live on-the-job updates as your job progresses — Click here to see a demo of your live updates.** Pressed, a phone opens under the cards. A text arrives, gets tapped, and their job opens: their street, their rooms, their own "as we saw it" photos, and five days of example updates ending with a "finished, walkthrough at 2pm" text. It is a preview of the portal's day-by-day feed, built from the estimate itself, so it looks like their job. Nothing on it is a promise about dates or programme, and the page says so twice: the label **Example of your live updates** above the phone and the **For illustration only** line under it.

## Before you start
- The estimate must be **sent** and must have a **presentation attached** (the tick under Job settings in the builder). No presentation, no card, no phone. There is no separate switch: every attached presentation carries it. The card joins the presentation's FIRST capability panel; a presentation without one gets the card in a panel of its own after its blocks. The card is the only way in (Tom, 20 Sep): the hero button and the step-4 link are gone.
- Estimates the customer built themselves in the online wizard never show it, presentation or not.
- The phone needs a street address or a suburb on the estimate. With neither, the section quietly does not render.

## What the customer sees, and where it comes from
| On the phone | Comes from |
|---|---|
| "Good morning Ben. … arrived at 43 Keith Street" | First name and street from the estimate. No first name → "Good morning." No street → "your property", suburb alone in the header. |
| The rooms named in each update | The estimate's areas, in order. An exterior job gets exterior wording (wash-down, priming, top coats) with elevation names. |
| "Two coats of Haymes Expressions Ceiling", "Dulux Wash & Wear going on" | The estimate's paints (ceiling and wall products). |
| The photos, tagged **Before · your photo** | ONLY the estimate's own "Your property, as we saw it" photos, in order, at most two per update, none used twice. No photos = text only. Never a photo from another job. |
| **Jacob · Your lead painter** with a photo | The **Demo painter** (below). Unset → "Your lead painter" with a plain avatar and "the team have arrived". |
| "Day 1 … Day 7" and the times | Fixed example values. Illustrative only. |

**Trade accounts** (the estimate is linked to an account whose type is **trade**) get the commercial set instead: "signed in on site at 6:30am", **Site supervisor**, the organisation name in the header, PO and Owner references **only if they are on the property**, a Pre-start → Closed stage rail, document chips (Certificate of currency, SWMS, Daily reports), site induction, after-hours works, daily reports, practical completion and handover. Photos are tagged **Before · site photo**. Everything else gets the residential set.

## The one setting: Demo painter
Settings → **Website** → under the painter cards, **Demo painter**. Pick one of the painters listed there. They need a photo, or the option is greyed out. The same person shows as "Your lead painter" on residential estimates and "Site supervisor" on trade ones, and the line under the phone says the painter shown is an example. Leave it on *None* and every phone uses the generic fallback.

## Steps
1. Build the estimate with a presentation ticked under Job settings.
2. Check it before sending: the builder's **ESTIMATE** tab shows the same card in the same panel, built from the working scope (a moment after each edit). Press it to open the phone. It reads the estimate's linked account, so a trade account shows the commercial set here too.
3. Send. The customer link (`/e/<token>`) shows the card; pressed, the phone opens, plays and loops, and **↻ Play again** restarts it. Pressed again, it closes.
4. Check the first text: their name and street. Check the rooms in the updates. Check the photos are theirs.
5. If the wrong messaging set shows, check the linked account's type on the CRM record (trade vs residential). There is no per-estimate override.

## What the colours and labels mean
- **Cyan ring** on an update — work under way; **emerald dot** — the final walkthrough / handover milestone.
- **In progress** pill turns **Ready for walkthrough** when the last text arrives.
- On the CRM timeline the customer's interaction lands as **Watched the live-updates example on the estimate** — pressed the card, started, watched it through, or pressed Play again.

## If something goes wrong
- **No card on an estimate that has a presentation.** Was the estimate sent (not just saved) after the presentation was ticked? The customer sees the snapshot taken at send. Is it a wizard-built estimate? Those never show it. Does it have an address?
- **The wrong painter, or no painter.** Settings → Website → Demo painter. A painter removed from the list, or one whose photo was removed, falls back to the generic card.
- **A customer says the days or times are wrong.** They are examples and labelled so; there is nothing to correct on the estimate.
- **It does not appear on the PDF or in print.** Correct: the section is screen-only.

## Related
- `docs/help/estimator/staff.md` — building and sending an estimate, attaching a presentation.
- `docs/help/live-progress/customer.md` — what the customer is told.
