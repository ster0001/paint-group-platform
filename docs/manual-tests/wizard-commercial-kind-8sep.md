# Commercial in the wizard — Tom, 8 Sep 2026

Branch `feat/commercial-kind`. No migration.

**What changed**
- Page 1, once "Commercial" is picked: **"What sort of commercial job is it?"** — *A few rooms or offices* /
  *A larger space — whole floor, shop or warehouse* / *Strata / body corporate*. Continue is refused until answered.
- *A few rooms or offices* → a note ("price the same way a home does… one of us confirms it on site"), the walk
  continues like any interior, a **figure shows** at the end on the visit tier (a person signs it off before
  anything is booked — no online accept). Staff see the reason `commercial_small` on the lead.
- *A larger space* or *Strata* → the note says **"we'll need to see it"** right there on page 1; the walk still
  collects the basics and contact; the end screen is "This one deserves a person" with the reason
  ("priced on site…"). Reasons `commercial_large` / `commercial_strata`.
- A commercial job is **never asked** about asbestos sheeting or "will anyone be living there" (interior details
  page). Both stay at their defaults (asbestos "no", occupancy unset = assumed empty); the visit covers them.
- The business site's hand-off (`?mode=business`) pre-selects Commercial, so the new question is the first thing
  a business visitor answers. The chat / describe paths carry the answer if the wizard set it; the assistant
  itself does not ask it yet — a commercial job built purely by chat still hands off to a person (unchanged).

**Walk (live, anonymous, /estimate):** Interior → "There isn't a floorplan to hand" → suburb/postcode →
Commercial → tap each of the three and read the notes → pick *A few rooms* → next pages have no asbestos and no
living-there question → contact → "See my estimate" shows a range. Repeat with *Strata*: end screen names a person
and says why.

**Proven on C1:** `e2e/customer-journey/commercial-kind.spec.ts` 2/2; the 7 Sep commercial-exterior walk updated
and green; `lib/wizard/policy.test.ts` (+1); unit 1783 green.

**Ruling to confirm (⚑):** small commercial = price shown, visit tier (no online accept). If you want small
commercial jobs accepted online like a home, that is one line in `lib/wizard/policy.ts`.
