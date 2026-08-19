# Customer scope editor — the workflow after the five questions

**Status: for Tom's approval.** ⚑ marks decisions needed.

The situation: the wizard is built, the capture screen is a great in-house tool, and the builder is the source of truth — but the builder is a staff instrument, and customers should never touch it. What the customer needs is a third surface: not a builder, not a viewer, but a **scope editor** — full control over *what* gets painted, zero control over *what it costs to paint it*.

---

## 1. The one principle everything follows

**Customers edit the WHAT. The engine owns the HOW-LONG and the HOW-MUCH.**

A customer adding "garage door" is telling us about their property — that's information we want, and they know it better than any AI or floorplan. A customer editing hours would be negotiating our labour allowance — that's pricing, and it's not theirs. So every control in the editor changes *scope inputs* (which substrates, how many, what condition, which rooms), and every consequence (hours, prep allowances, coat maths, rates, the price range) is recomputed server-side by the same engine the builder uses. There is no path — in the UI or the API — where a customer-writable field is a time or a rate. This is enforced at the server boundary, not by hiding buttons: the customer role's actions accept only substrate toggles, quantities, condition selections and flags.

One consequence worth stating plainly: because the customer editor and the staff builder write to the same area/surface tree through the same engine, **there is never a translation step**. What the customer shaped is exactly what your estimator opens, what the work order derives from, and what gets priced.

## 2. What's open, what's locked

**Open to the customer (full control, as you asked):**
- Every paintable substrate, on/off, in every room or element — the complete lists, not a curated subset. Interior: walls, ceilings, cornices, doors, door frames/architraves, skirting, windows, built-in robes, staircase parts, feature walls, exposed beams. Exterior: weatherboards, render, brick (painted), eaves, fascias, gutters, downpipes, windows, doors, garage doors, decks, fences, pergolas, balustrades, letterbox.
- Quantities of counted items (doors ×3 → ×4) via steppers.
- Rooms/areas: add (the chips already built), remove, rename.
- The wizard's own vocabulary, editable per surface group: freshen up / change of colour / dark-to-light — this changes coats internally, but through their language of *outcome*, never a coats field.
- Paint brand preference and colours (from the wizard's page 5 choices).
- Photos, anywhere, any time — always raises accuracy.
- **"Not sure"** on anything — a first-class answer, never a dead end (see §5).
- **"Something else?"** free text per room/element — never priced silently; it becomes an amber note for the estimator.

**Locked (visible as inclusions, never as numbers):**
- Hours, rates, prep times, coat multipliers, calibration factors — none of these render anywhere customer-facing, not even greyed out. Prep shows as words: "includes filling minor cracks and sanding," not "2.5 hrs prep."
- Pass-through items (scaffold, traffic management, permits, lifts): shown as "arranged by us" inclusions once staff add them; customers can't add or remove them.
- Sundries, materials maths, GST mechanics.
- The accuracy score and range bands (they influence them by confirming things, but the formula is ours).

## 3. The interior editor (mostly built — this closes the spec)

The wizard's editor already has the shape: plan pinned, room cards, add-room chips, confirmations. The substrate control deepens it: each room card expands to **the same tile grid as your capture screen, rendered in customer mode** — identical components, identical `room_type_scope_rules` ordering, so a bedroom shows walls/ceiling/door/skirting first and the long tail (robes, cornices, feature wall) behind "more surfaces." Tap on, tap off, steppers on countables. Two touches that keep edits honest:

- **Pairing advice, not blocking:** untick skirting while walls stay on and a gentle line appears — "Skirting is usually painted with the walls — leave it out?" One tap to confirm, one to restore. Advisory only; it's their house.
- **Ephemeral deltas:** each change shows a passing note — "Doors removed — about −$310 from your range" — then the range updates. Feedback without publishing a rate card. ⚑ Confirm you're comfortable showing per-change deltas at all; the alternative is silent range updates only, which protects pricing harder but feels unresponsive.

## 4. The exterior editor (the genuinely new design)

Rooms are the wrong model outside. The exterior editor is **element-first**, pinned to their own facade photo (from the listing or their uploads) the way the plan pins the interior:

- **The body** — weatherboards / render / brick, with extent: whole house · front only · front + sides. (Mixed-substrate houses list each.)
- **Trims & openings** — windows (stepper, type from the wizard), entry doors, garage doors.
- **The roofline** — fascias, gutters, eaves, downpipes: the group people forget and the quotes that blow up later. Pre-ticked per your standard exterior scope; unticking is theirs.
- **Extras** — deck, fence, pergola, balustrade, letterbox: off by default, one tap to add, each with a size question in plain words (fence: "roughly how many metres?" with a "not sure" option).

Storey count and wall heights stay **read-only** here — they came from the envelope pipeline and they're geometry, not scope. If the customer disagrees ("we're actually double storey at the back"), that's a one-tap flag, not an edit: it goes to the estimator and marks the job non-straightforward. Letting customers edit storeys silently would be letting them edit the biggest number in the quote.

## 5. "Not sure" is an answer

Every question, both editors, accepts "not sure." Each one: drops accuracy slightly (widening the range honestly), adds an amber item to the estimator's list, and moves on. The customer is never stuck, and every not-sure is a reason the human step exists — which reframes the site visit from "we don't trust you" to "you had questions; we're bringing answers."

## 6. The sign-off ladder — your policy, formalised

Everything still passes the desk review queue (that's internal and invisible). The customer-facing ladder:

| Tier | Who lands here | What happens |
|---|---|---|
| **Self-serve** | Interior ≤ $6,000 with accuracy ≥ 90% · OR straightforward exterior (definition below) | "Accept estimate" available online. Desk review converts range → fixed price same day; booking proceeds. |
| **Human sign-off** | Interior > $6,000 · any non-straightforward exterior · any tier landing below its accuracy bar | "Accept" is replaced by **"Confirm my price — book the visit"**: an inline calendar on the estimator's real availability. Price stays a range until the visit; the visit converts it to a fixed, signed-off estimate. |
| **Specialist handoff** | Commercial, heritage, body corporate, pre-1970s + peeling (lead), asbestos, under the $2,000 floor | Existing hard stops, unchanged — straight to your team. |

**"Straightforward exterior" defined (ALL must hold):** single storey · facade photos verified by the envelope pipeline · damage tier 1–2 · standard substrates (weatherboard/render/brick — no roofing, no timber restoration beyond deck oil) · post-1970s or no peeling flag · accuracy ≥ 85% · ⚑ and I'd suggest a value cap too (say ≤ $12,000) so a big-but-simple exterior still gets eyes — confirm or strike.

Two notes on your thresholds. First, this supersedes the earlier $15k rule — the $6k interior line is stricter and simpler, and I've folded the old "small jobs need 90%" rule into the self-serve tier, which protects your weakest-margin band ($2–4.5k at ~26% GP). Second, ⚑ decide whether a **15-minute video walkthrough** counts as "human interaction" for borderline cases (interior $6–10k, high accuracy, good photos), with on-site reserved for everything above — it would let one estimator sign off far more jobs per day. If you want boots on every one of these, say so and video disappears.

**Crucial framing:** the customer never sees a "blocked" state. The human tier is presented as the premium step — *"Your estimate is ready. The final step is a short visit so we can stand behind every number in it."* — with the calendar right there. The gate IS the service.

## 7. What your estimator walks in with

The visit inherits everything: a **prep pack** auto-built from the customer's session — their scope, every not-sure, every flag, every photo, the removed-substrate list (what they *chose* not to paint is sales context), and the accuracy items still open. On site, the estimator runs your **capture screen in verify mode**: each room/element pre-filled from the customer's scope, confirm-as-you-walk flipping provenance to human_confirmed, differences highlighted rather than re-entered. End of walk: convert range → fixed, snapshot, send, sign — often on the spot. The customer did 80% of the estimator's old job before the car left the office; the visit is verification and close, not data entry — which is exactly how one estimator covers the volume your wizard will generate.

## 8. Build notes (for the eventual brief — not yet)

Same components, `mode="customer"`; customer-role server actions limited to: toggle substrate, set quantity, set condition tier, add/remove/rename area, set flag, attach photo, submit free-text note — everything else recomputed via `lib/pricing`, RLS denying the rest; telemetry on removed substrates and not-sure rates per question (your preset-tuning signal); ladder thresholds ($6k, 90%, 85%, the exterior cap) all Settings values.

## ⚑ Recap
1. Ephemeral per-change deltas — show or silent? (my recommendation: show)
2. Exterior self-serve value cap — $12k, another number, or none?
3. Video walkthrough as valid human sign-off for the borderline band — yes or on-site only?
