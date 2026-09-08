# Tom's 8 September (evening) batch — walk it through

Twelve items from two messages on 8 Sep 2026. Everything below is the online
estimate (`/estimate` → `/estimate/scope`), the staff builder (`/quote`), the
marketing site, and one new Settings field.

Nothing here needs a migration.

---

## 1 · Gutters and fascias can go on a side twice

The exterior builder → open a side → **+ Add a surface to this side**.

- Add **Gutters**. Open the panel again: it now offers **Gutters (second run,
  upper)**. Add it. The two rows read *Gutters (lower)* and *Gutters (upper)*.
- The same for **Fascias**. A third refuses: *"That's already on this side twice."*
- Anything else (Downpipes, a roof) still refuses the second one.

Why: a two-storey elevation has a lower run and an upper run, and each measures
on its own. Eaves have worked this way since 5 Sep — gutters and fascias now
join them (`TWICE_OK_CODES` in `lib/wizard/sides.ts`, one list for the panel and
the server).

## 2 · Renaming a side

On any side card, next to the title, **Rename** → type *Courtyard* → Save.

- The card, the confirm button and the add panel all read *Courtyard*.
- The area's real name becomes `Exterior - Left (Courtyard)`, so the quote, the
  work order and the job sheet all read the customer's word without losing
  which elevation it is.
- Clearing the box puts *Left side* back.
- Try renaming the front to *"Right of the shed"* — the front stays the front
  (`sideBaseName` strips the bracket before a side is matched).

## 3 + 12 · A side nobody asked for is not in the estimate

Ask the assistant (or the "describe it" path) for **"outside only — the front,
the left side and the back"**.

- The estimate has **three** side cards. There is no right side, and no
  right-side exclusion on the quote.
- The header reads *0 OF 7 CONFIRMED*, not 8 — the loop counts the sides that
  exist plus the four whole-job checks.
- The house diagram greys the right edge.
- The assumption list says *"Painting the front, left, back only…"*.

A side the customer **opens and skips** in the loop still shows as NOT PAINTING
on the quote — that is a decision they made, and the quote should carry it. The
change is only about sides nobody ever mentioned.

Also: the assistant now asks *"Which sides are we painting?"* before it builds.

## 4 · Handrails, by the metre

Add a surface → **Exterior Trim** → *Handrails & balustrades*.

- The tile carries a **Metres** box. Empty, it says *follows this side* and
  prices off the elevation's length (12 m on a typical front).
- Type `6` and tab out: the range moves, and the box says *you told us*.
- Clear it and the run goes back to following the side.
- Every lineal row gets the same box — gutters, fascias, eaves, downpipe runs.
  Walls keep their **% of wall** control and refuse metres.

## 5 · "Book in your estimator"

The strip under the finalise button now leads with **Book in your estimator**
and each action carries a filled icon tile (calendar / handset / call-back
arrow) that fills cyan on hover and when open.

## 6 · The call-back form knows their number

Tap **Request a call back**: the mobile field arrives filled in with the number
they typed on the contact page, with *"That's the number you gave us — change it
if another one suits."* Editing it works normally; the request sends whatever is
in the box.

## 7 · When our lines are open

Under the Call us button: **"Our lines are open 8:30am – 4:30pm, Monday to
Friday."**

The wording comes from **Settings → Company details → Phone hours** (new field).
Leave it blank and the line above is what shows.

## 8 · You don't have to finish first

The finalise button is no longer dead until every card is blue.

- Exterior: **Finalise my price** is live from the start, with a line under it —
  *"You don't have to finish first — 2 of 7 confirmed…"*
- Interior/both: the same, and the guardrail still holds where it matters —
  until everything is confirmed the tap hands the job to a person (call back /
  visit) rather than **accepting** a fixed price against an unconfirmed scope.

## 9 · Fits the screen

At 320px, 375px, 768px and 1440px:

- the page must not scroll **sideways** — the tile grids, the plan panel, the
  house diagram and the sticky rows are all clamped to the viewport; and
- scrolled to the **bottom**, the last side card must sit *above* the sticky
  footer, not under it.

The second was the actual fault: the footer is `position: fixed`, so it takes no
space in the flow, and the exterior editor reserved none — the bottom of the
list was permanently hidden behind it at every scroll position. The footer's
height is now measured (`useStickyRoom` → `--wz-stick-h`) and the page's bottom
padding follows it, so opening the call-back form or the visit slots reserves
more room rather than covering more of the page.

## 10 · The chat bubble on the website

Open the marketing site (`/`). The same **Chat with us** bubble sits bottom-left,
above the mobile call bar. Send a line; it lands in the staff dock exactly as it
does from the estimate.

The anonymous session is made on the **first tap**, not on page load — a visitor
who never opens the chat never becomes an anonymous user.

Because the thread id lives under one localStorage key, somebody who asks a
question on the homepage and then starts an estimate carries the same
conversation with them.

## 11 · The comments and photo box on each side

At the bottom of each side, under the add panel:

> **Anything worth mentioning about this side?** OPTIONAL
> Extra preparation is what moves a price most — flaking or bubbling paint, bare
> or rotten timber, render cracks, an old colour that will need an extra coat, a
> tricky bit to reach…

- Type something, **Save this note** — a toast confirms and the text stays put on
  a reload.
- **Add a photo (optional)** takes one or more images, uploads them and claims
  them for the estimate; the count shows under the box and the photos appear in
  the Plan & photos panel and in the estimator's photo sign-off.
- Neither prices anything. Both arrive on the estimator's review list as
  *"customer note on the left (+2 photos)"*.

## 13 · A customer's own item, in the staff builder

In the estimate, add **Something else on this side → "security bars"**.

Open the estimate in the staff builder (`/quote?id=…`). Above the areas, an
**amber** panel:

> **Asked for by the customer** · 1 unpriced
> "security bars" — on Exterior - Left
> [ Add a line on Exterior - Left ] [ Priced / not needed ✓ ]

- *Add a line* opens the surface picker on that area so the estimator picks the
  rate row.
- *Priced / not needed* clears it and its review-gate entry.
- Until then the send gate still refuses to let the estimate out unnoticed, and
  the customer cannot accept online.

---

## What to run

```
npx vitest run
./scripts/c1/run-e2e.sh e2e/customer-journey/tom-batch-8sep.spec.ts e2e/customer-asks-panel.spec.ts
```

Ran green on the C1 stack for this batch: `tom-batch-8sep` ×4, `customer-asks-panel`,
`sides-editor` ×2, `interior-loop`, `both-stacked`, `doors-tiles-steppers` ×3,
`ladder`, `exterior-path`, `exterior-no-photos`, `reach-and-chat` ×3. Unit: 1794.

Screenshots from the fit-to-screen test land in `test-results/8sep-estimate-{320,375,768,1440}.png`.
