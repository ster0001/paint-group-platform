# Estimator journey v2 — the plan

**Prepared:** 9 September 2026
**Status:** for Tom's review. Walk the prototype (`estimator-journey-v2.html`) first, then read this. Once the journey is agreed, the Claude Code brief follows — with reference files, acceptance criteria and the decisions below resolved.
**Money:** AUD, inc. GST throughout, illustrative figures.

---

## 1. What we're solving

Your brief, turned into the four targets the design is measured against:

| You said | The design target |
|---|---|
| Get to a guide range as quickly as possible | **Under a minute, under ten taps** from landing to a number. Today it's 25–30 answers. |
| Time-poor customers see a range and book a person; others add detail for a tighter price | **One flow, two speeds.** The range appears first; everything after it is optional and each step visibly narrows the range. Both doors — book a person, tighten online — sit on the same screen, with no hierarchy between them. |
| Preparation, coats per surface, access and defects aren't properly factored in | **The customer never picks coats or prep.** They describe colour intent, condition and surfaces; the engine derives the paint system per surface group and shows it back in plain English to correct. Access is asked, interior and exterior. Defects become photos pinned to a room, priced as repair lines. |
| Quote some jobs without looking at them; self-qualify the rest for the estimator | **Remote confirmation.** A confirmed scope tree plus photos goes to the estimator console, where a person fixes the price without a visit and only books one when needed. The customer does the estimator's discovery; the estimator does verification. |

The gamified plan is set aside as asked. Nothing here awards points, unlocks or badges. The only progression the customer sees is the range narrowing and three honest words: *guide → detailed → confirmed*.

---

## 2. Where today's wizard falls short

From walking the live build (`wizardcurrentflow.md`, screenshots `01`–`18`):

1. **Screen 1 asks the customer to choose a route** (describe it / questions / floorplan) before they've seen any value. That's a decision about *our* mechanics, not their house.
2. **Coats are chosen once, for the whole job**, by the customer, from a card that says "1 / 2 / 3 coats". Coats differ by surface — new-colour walls need two, a white-on-white ceiling often needs one, enamel trims usually need two plus prep — and the customer can't judge it. This is the single biggest accuracy gap.
3. **Condition is one global answer** and "needs repair" opens a free-text box the engine can't price. Nothing pins a defect to a room or a surface.
4. **Interior access is never asked.** Stairwells, voids, furniture, floors, parking, lift bookings — the four allowance modifiers in the allowances spec — have no home in the flow.
5. **Extras aren't asked** — no feature walls, no wallpaper, no ceiling roses. "Anything else" is flagged, never priced.
6. **Contact is a gate before the price.** Reasonable for retargeting; costly for conversion. (Decision ⚑1.)
7. **The builder opens as nine amber cards** that all look equally urgent, plus two checks. There's no sense of which three taps matter most. Ceiling height and door style sit in a "details to settle" block above the rooms, disconnected from either.
8. **The exterior builder is good** — the plan-from-above with tappable sides is the best idea in the current build and stays.

---

## 3. The journey in one page

```
LANDING          QUICK LOOK (4 screens, ~9 taps, <60s)        THE FORK
 address  ─►  place ─► job ─► condition ─►  GUIDE RANGE  ─┬─► Tighten online (optional, any order, stop any time)
 in / out     beds     scope   overall        ±15%         │      rooms · paint systems · site & access · extras
              storeys  colour  living in it   what we      │      each rung narrows the range → DETAILED ±8% → ±4%
                                              assumed      │
                                                           ├─► Book your estimator (visit · call back · call now)
                                                           │
                                                           └─► Keep it (email → magic link → portal)

FINISH LINE  ─►  Fix online (qualifying jobs)  |  Send for remote confirmation  |  Book a visit
                 ─────────────────────────── a person is reachable from every screen ───────────────────────────
```

**Quick look.** Address and inside/outside. Then kind of home, bedrooms, storeys. Then scope preset and colour intent. Then overall condition and whether they're living in it. Nine taps on defaults. Bedrooms + storeys seeds the room tree from `business-inputs.md` typical sizes; scope preset seeds the surfaces; colour intent and condition seed coats and prep.

**The guide range.** A range (never a single number), a one-line restatement of what they told us, and a tappable list of what we assumed — each line jumps to where it can be changed. Then three doors with no hierarchy. This is the screen the redesign exists for.

**Tighten.** Exactly four rungs, matched to your five accuracy questions (rooms covers two of them). Rooms are a list with an assumed size, surface summary and an amber/cyan status; a room opens to size → surfaces → condition and flagged spots → extras → confirm. Paint systems is a new screen that shows the derived coats and prep per surface group in the painter's words. Site and access asks the allowance modifiers. Extras is a sheet. A floorplan or listing upload sits at the top of the rooms rung, where it saves work. "Finish and send" is always in the footer.

**Finish line.** The detailed range, the summary of everything they told us, and the fixing options chosen by the policy ladder: fix online for qualifying jobs, remote confirmation for the rest, a site visit for anyone who wants one. The hand-off screen names the estimator, lists three concrete next steps, offers a booking slot and confirms the estimate is saved in the portal.

**Branches.** Commercial goes to the segment question and six gates (per the commercial pricing strategy) before any measuring. Exterior gets its own five-answer quick look, then the sides builder with a photo per side. Asbestos or lead is a hard stop with a person within a working day.

---

## 4. The five accuracy questions — how each is answered

### 4.1 What is being painted

| Level | Interior | Exterior |
|---|---|---|
| Quick look | Scope preset (whole interior / some rooms / walls & ceilings / trims & doors) × room tree seeded from bedrooms and storeys | Elements (house / fence / deck / shed) × sides seeded from the footprint |
| Tighten | Per room: each surface as a tile with counts for doors and windows; add a surface from the rate card; per-room removal | Per side: painting it or not, length × height, wall materials with a share of the wall, elements on that side with metre runs |

Room count is read from the tree, never from a property label (allowances spec §11.7). Hallways, stairwells and laundries are always in the tree because they carry setup.

### 4.2 How many coats each surface needs — derived, never asked

The customer answers **colour intent** once (same colours / new colours / going much lighter or bold) and **overall condition** once. The engine derives a paint system per surface group. The customer sees the result on the paint-systems screen and corrects it with one tap per line.

⚑ **These rules are painting judgement, and yours to set.** Starting proposal, written to be Settings-editable alongside the rate card:

| Surface group | Same colours | New colours | Much lighter or bold | Condition adds |
|---|---|---|---|---|
| Walls | 1 coat (1.25 factor, spec §7) | 2 coats | Undercoat + 2 coats | Filling and sanding per band; patching lines from flagged spots |
| Ceilings and cornices | 1 coat flat white | 1 coat (2 if marked or coloured) ⚑ | 2 coats | Stain-block where water marks are flagged |
| Skirtings, architraves, frames | Sand + 1 coat enamel ⚑ | Sand + undercoat + 2 coats enamel | As new colours | Bonding primer where existing gloss is oil-based |
| Doors | As trims, both sides, frame included | As trims | As trims | — |
| Windows (timber) | Sand + 2 coats | Sand + fill + 2 coats | As new colours | Putty and rot treatment from flagged spots |
| Feature wall | Priced as its own colour: 2 coats; +1 if bold | | | |
| New plaster (flagged) | Sealer + 2 coats | | | |
| Bare timber (flagged) | Primer + 2 coats | | | |

Two rules from the allowances spec carry through unchanged: single coat is only reachable via "same colours" (§7.6 — one coat over a colour change does not cover, and that's a warranty claim), and the 1-coat factor is an override on the total, not a change to the marginal rule (§7.3).

**The one prep question worth asking a homeowner:** are the trims currently a shiny gloss? Old oil-based gloss under water-based enamel needs a bonding primer, and it's a common cause of a blown estimate. It sits on the paint-systems screen with a "not sure" default that routes to the estimator's check. ⚑ Worth the friction, or default to not-sure?

### 4.3 Condition — a band, then spots

- **Quick look:** three bands — good/just tired, some wear, needs work. Sets the prep allowance and the width of the range.
- **Tighten, per room or side:** "same as the rest / better / worse", then **point out a spot**: a photo and a tag (crack, flaking, water mark, hole, mould, wallpaper; rot, cracked render, rust outside). Each spot becomes a repair line pinned to that room, visible to the estimator and later to the painter on the work order.
- ⚑ Minor tags (crack, nail hole) can auto-price from `defect_prep_rates`; the rest go to estimator review. Proposed boundary — yours to confirm.
- The assistant's plan-reader (already in the build) reads windows, doors and visible condition from side photos on exterior jobs; the same hook applies to room photos later.

### 4.4 Access

- **Interior (new):** rooms cleared / mostly / furniture stays · floors carpet / hard / mixed · ceiling height · stairwell or void · parking · lift and building booking for units · asbestos · pets. These are the four allowance modifiers from the spec §4 plus the two hard-stop questions, in one screen.
- **Exterior:** storeys · steep block · tight side access · double-height entry · needs a lift or scaffold (flags for a person; the range still shows, with equipment excluded and said so).
- ⚑ Exterior allowances per elevation do not exist yet (spec §8). The exterior guide range shouldn't be trusted until that spec lands.

### 4.5 Extras

Per room: feature walls (counted, priced as their own colour), wallpaper to strip, built-in robe doors, "something else in here" (flagged). Whole job: a sheet of the common extras — mould treatment, ceiling roses, stain or varnish, help choosing colours — plus a description box. Named extras price; unusual ones flag.

---

## 5. Accuracy tiers and routing

Bronze / Silver / Gold become **Guide / Detailed / Confirmed** — the same three accuracy bands the platform already has (±15 / ±8 / ±4), named for what they mean to a customer.

| Tier | How it's reached | Band | What the customer can do |
|---|---|---|---|
| Guide | Quick look | ~±15% | Tighten, book, keep |
| Detailed | Rooms confirmed, systems checked, access answered | ±8% → ±4% | Fix online if the job qualifies; otherwise send for confirmation |
| Confirmed | A person fixes it (remotely or on site), or the customer fixes it online on a qualifying job | Fixed price, held 60 days | Accept |

**Routing uses the existing policy ladder** (`lib/wizard/policy.ts`): hard stops → outside area → hand-off → below minimum → reveal. The self-serve caps (interior ≤ $6,000 at ≥ 90%, exterior never, `requires_site_check` never) decide whether "fix online" appears. Commercial follows the six gates; small offices and shop fronts price online with a wider band and no self-acceptance in v1.

**Remote confirmation is the new mechanism.** It's an estimator-console action, not a new customer path: the console shows the confirmed tree, the flagged spots with photos, the derived systems and the access answers; the estimator either fixes the price and sends it, asks a question in-thread, or books a visit. This is how jobs get quoted without being looked at. Start it on interiors under a cap you're comfortable with, measure fifty, then widen. ⚑

---

## 6. The three customers this serves

| Customer | Their path | What they get |
|---|---|---|
| **Time-poor homeowner** | Quick look → guide range → book a visit or call back → keep it | A number in a minute, a person on the way, nothing to fill in |
| **Small job or careful homeowner** | Quick look → tighten (5–10 min, photos) → fix online or send for confirmation | A price they helped build, itemised, without waiting for a visit |
| **Trade — agent, facilities manager, insurer** | Saved spec or address book → spec sheet → send for confirmation | A repaint quoted from their desk in two minutes; a person confirms it |

All three see a range, never a fixed number, until a person or a qualifying self-fix confirms it. All three can reach a person from every screen.

---

## 7. Trade portal — what it does for each persona

The trade portal runs the **same estimate tree and the same engine** (Tom's ruling, 26 Aug: one codebase, one tree). What differs is defaults, gates and views.

**Shared capabilities**
- Range shown immediately, unlimited wizard runs, full AI (plan-reader, photo read) — per the existing trade gates
- **Saved specs** as templates: "end-of-lease repaint", "vacate touch-up", "common-area refresh" — scope, systems, condition band and colour policy saved once
- **Address book** that seeds the room tree and pre-fills from the last job
- **One-tap rebook** from a completed job — the prior tree is the starting point, the wizard only asks what's changed
- **The spec sheet** — rooms × surfaces × coats on one screen, editable cell by cell, range in the header. It's the room builder without the hand-holding: same tree, denser view
- **Tenant or occupant photo link** — a link they open on their phone; photos pin to the property, feed condition and the remote confirmation
- **Per-property colour register** as the default colour answer — the fix for the colour-collapse bug at `QuoteBuilder.tsx:1128` becomes a feature
- A person confirms every trade price before work starts (v1) ⚑

**By persona**

| Persona | Leads with | Later |
|---|---|---|
| Real estate agent | Speed, end-of-lease specs, tenant photos, one-tap rebook, statements | Bulk quotes across a rent-roll, PM-to-PM handover of the register |
| Facilities manager | Repeatable specs, after-hours and staging flags (the commercial gates as fields, not stops), job timeline, consolidated billing | Portfolio reporting, compliance documents on file |
| Insurer | Scope matched to a claim line by line, photos as evidence, itemised systems | Claim-reference field, adjuster access, before/after report |

---

## 8. How the moving parts fit

The artefact that flows through everything is the **scope tree** — rooms or sides × surfaces × derived systems × condition flags × access answers. The wizard builds it, the engine prices it, the estimator confirms it, the work order executes it, the portal shows it, the register keeps it. Nothing in this plan creates a second copy of anything.

| Platform piece | What v2 does with it | Dependency direction |
|---|---|---|
| **Pricing engine** (`lib/pricing`) | Reads the tree; gains a coat/prep derivation lookup (Settings-editable) and reads the interior allowance modifiers | Engine stays the only place prices are computed |
| **Allowances spec** | The site-and-access screen is its four modifiers, verbatim | Spec must land first; exterior per-elevation spec still needed |
| **Policy ladder** (`lib/wizard/policy.ts`) | Unchanged order; gains the remote-confirmation outcome and the commercial segment gates | v2 reads it, never re-implements it |
| **Wizard state** | Server-first `wizard_state` on `wizard_sessions` is a prerequisite — the tighten stage is exactly the thing that must survive a refresh and be joinable by staff | Blocks assisted sessions and this build; the 26-second wait (A1b) fixes first |
| **Assisted sessions** (`wizard_assist_patch`) | Staff join the tighten stage during a call; the banner and attribution chips apply to the room cards | v2 is the surface they operate on |
| **Estimate builder** (customer-facing document) | The finish-line summary *is* the estimate document; the paint-systems lines become its itemised body | One component, embedded in the portal (B4) |
| **Estimator console** | New action: remote confirmation — tree + photos + systems in one view; fix, ask, or book | The "quote without looking" capability lives here |
| **CRM events** | `estimate_saved` fires on "keep it"; guide-range views and tighten progress become events for the segment evaluator, not a new list | One event log, one evaluator — no module builds its own badge |
| **WO completion loop** | Flagged spots and derived systems flow into the work order as the contractor's checklist; the customer's photos are the day-one reference | Tree is the source; `wo_events` stays append-only |
| **Customer portal** | "Keep it" creates the account and magic link; the tighten stage is resumable from the portal; the register feeds rebook | Per the experience map, phase 3 |
| **Trade portal v2** | Saved specs, address book, spec sheet, tenant photo link — all views over the same tree | Same components, trade defaults |
| **AI assistant** | "Describe it" moves from screen 1 to the assistant; the plan-reader reads side and room photos; the guided-interview mode drives the same tree | Nine-session plan unchanged; v2 gives it a cleaner surface |
| **Inbound calls** | Call transcript → pre-filled quick look → staff opens an assisted tighten session | Pre-fill target is the same state object |
| **Help content** | Each new screen gets a `docs/help/estimator/<role>.md` entry under the Phase A rule | Same-day commit rule applies to this plan and the brief |
| **Calibration gate** | Still the hard prerequisite before real customers receive fixed prices — v2 changes what's asked, not the numbers | Validate coats-by-surface against real worked hours before "fix online" is turned on |

**Standing rules that apply to the build:** one source of truth for every list and badge; migrations between gate runs, never during; briefs committed the day they're produced; worktrees for concurrent sessions; stop-and-report on missing references.

---

## 9. Build sequence — proposed

Gate-driven, each session reporting before the next starts. Not the brief yet — that follows your sign-off on the journey.

1. **Prerequisites** — server-first wizard state; the 26-second wait; allowances spec merged. Nothing below starts until these are green.
2. **Quick look + guide range** — four screens, the reveal, the assume list, the three doors. Ships behind the existing Online estimates switch. Email capture placement per ⚑1.
3. **Coat and prep derivation** — the lookup in `lib/pricing`, Settings-editable, golden tests: 2-coat and 3-coat totals unchanged; single coat only via same-colour; a same-colour job and a new-colour job differ only in walls and trims.
4. **Tighten — rooms and paint systems** — room list, room card, systems screen, flagged spots with photos as repair lines.
5. **Tighten — site and access, extras** — the modifiers wired to allowances; extras sheet; the finish line with the policy-driven options.
6. **Remote confirmation** — estimator console action, notification, the hand-off screen. Interior only, under a cap ⚑.
7. **Commercial gates and exterior quick look** — segment question, six gates, exterior five answers, photo-per-side. Exterior allowances spec in parallel.
8. **Trade** — saved specs, address book, spec sheet, tenant photo link, register as default colours.
9. **Assistant hooks** — describe-it via the bubble; plan-reader on side and room photos.

Each phase ends with a phone walkthrough on the preview deploy before merge, as with the WO loop.

---

## 10. ⚑ Decisions for you

| # | Decision | Why it matters | My suggestion |
|---|---|---|---|
| 1 | Email before the price (today) or after, as "keep this estimate"? | Conversion to contact vs. the started-not-finished retarget | After, with a soft "email me a copy" bar under the range |
| 2 | The coat and prep derivation table (§4.2) | Every price in the system | Ship as Settings values; validate against worked hours in the proving window |
| 3 | Ceilings: one coat white-on-white by default, or two always? | Common line, material cost difference | One, with "they're marked" as the two-coat tap |
| 4 | Trims on a same-colour job: one coat or two? | Enamel finish quality vs. price | Two; one only when condition is "good" |
| 5 | Ask the gloss-trims question, or default to not-sure → estimator check? | Friction vs. a common blown-estimate cause | Ask it; three taps, one screen |
| 6 | Flagged spots: auto-price minor tags, review the rest? | Accuracy vs. estimator load | Yes — crack and nail hole auto-price; everything else reviewed |
| 7 | Remote confirmation cap and scope for v1 | The "quote without looking" risk | Interior only, ≤ $12,000, fifty jobs then review |
| 8 | "Fix online" locks the top, the midpoint or a computed point of the range? | What the customer accepts | A computed point at the engine's central estimate, shown as a single number |
| 9 | Raise the $6,000 interior self-serve cap once remote confirmation has data? | Growth of the no-visit path | Revisit at fifty jobs, not before |
| 10 | Bathrooms: ask, or infer 1 for ≤ 2 beds and 2 for 3+? | One more tap vs. a wrong room count | Infer, let them add |
| 11 | Trade self-acceptance: never in v1, or under a per-account cap? | Volume vs. exposure | Never in v1 |
| 12 | Trade default view: spec sheet always, or guided for a new address? | Speed for the repeat case | Sheet by default; guided only when the address is new |
| 13 | Turnaround promise on the hand-off screen | It's written as "next working day" | Confirm what you can hold to on a busy week |
| 14 | Keep "describe it" as a card on screen 1, or move it behind the chat bubble? | Screen 1 simplicity vs. discoverability | Behind the bubble, and in the Messenger channel |
| 15 | Exterior guide range: show it before the per-elevation allowances spec exists? | Trust in the exterior number | Show it, wider band, with the equipment exclusion said plainly |
| 16 | The hard-stop copy on the asbestos screen | Joins the three scripts already flagged for legal review | Send with that set |

---

## 11. What happens next

1. Walk the prototype on your phone. The NOTES button on each screen has the reasoning and the flags.
2. Mark up anything that misses the reality of running the business — that's the feedback this needs most.
3. Rule on the decisions above, or tell me which ones you want argued further.
4. I write the Claude Code brief for phases 2–5: reference files, acceptance criteria, golden tests, and every ruling recorded — and it gets committed to `docs/briefs/` the same day.
