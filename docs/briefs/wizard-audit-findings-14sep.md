# Quoting wizard — end-to-end audit findings (14 Sep 2026)

**Method.** Every customer path driven on the C1 test stack with the merged
build (`c6f102d`): inside (quick look → guide range → room-by-room editor →
finish → sent), outside (quick look → range → sides editor → finalise),
both (choice screen → inside + outside → two-part range → editor), the
describe card, the floorplan upload on the place screen, the chat bubble,
save & book. Commercial (office, warehouse, retail, strata brief + booking)
and trade (spec sheet, tenant link) were read rather than re-driven — their
own e2e passed today. The staff side (queue, pack, fix / ask / visit) is
covered by C17's story specs. Numbers below come from the wizard-edit route
called directly, so they are the engine's, not read off a screen.

Nothing here is changed yet. Each finding has a severity, what I saw, why it
matters, and the change I would make, sized S / M / L.

---

## 1 · Pricing and the range

### 1.1 The two-part range on a "both" job does not add up — HIGH · S
- **Seen:** headline `$10,750 – $19,910`; parts Inside `$6,860 – $9,290` +
  Outside `$3,890 – $5,270` = `$10,750 – $14,560`. The low ends match, the
  high ends are $5,350 apart.
- **Why:** the headline is now the envelope (14 Sep); the two parts are still
  the old accuracy band (`lib/wizard/view.ts:245` → `customerRange`). A
  customer who adds the parts up sees a number that isn't the headline.
- **Change:** price each part's envelope (`envelopeFor` on the interior tree
  and the exterior tree separately) and make the headline the sum of the two.
  One call site, one test.

### 1.2 The worst case is inflated by cupboards nobody asked about — HIGH · S
- **Seen:** on the both job above the spread was ±30%. Taking the open
  questions out one at a time: door style −$790; cupboards −$3,660 (three
  robes $1,270, the kitchen fronts $1,810, bathroom vanity $290, laundry
  $290); ceiling height the rest. Cupboards were **40% of the whole spread**.
- **Why:** "the whole interior" on the job screen promises "walls, ceilings,
  skirtings, doors and frames". Cupboards are an add-on the editor asks per
  room, not part of that promise — so pricing "every cupboard painted" as the
  worst case answers a question the customer never saw. The kitchen alone
  adds $1,810 to the top of a range for a job that may never include it.
- **Change:** drop `cupboards` from the envelope's open questions (keep
  doors, windows, height). Cupboards stay an add-on that raises the price
  when the customer says yes — which is honest, and what they expect.
  Re-measured on the 3-bed: worst case falls from $19,910 to about $16,250.

### 1.3 Confirming the ceiling height does not close the height question — HIGH · S
- **Seen:** after `confirm_height 2.4` the range stayed `$10,750 – $15,460`
  and `openQuestions` still said `height`.
- **Why:** the envelope reads `state.details.ceilingHeight` (still "unsure")
  instead of the tree, where the confirmed height has already replaced the
  assumption (`assumedFields` no longer holds `H`). My bug from this morning.
- **Change:** treat the question as answered when no interior area still
  carries `H` in `assumedFields`. One line plus a test.

### 1.4 Two confidence numbers on one screen — MEDIUM · S
- **Seen:** the sides editor shows "18% Confidence score" beside a range
  whose band is 15%; the rooms editor shows a "Confidence score GUIDE" pill
  and a "±N%" band that no longer move together (the band is now the
  envelope's width, the score is the accuracy model's).
- **Why:** two numbers that look like the same thing and disagree invite the
  question "which one is right?".
- **Change:** show one: keep the tier words (Guide / Detailed / Confirmed)
  and the envelope's "±N%", retire the percentage confidence score from the
  customer editors (it stays in the staff pack).

### 1.5 "Narrows this to within about 8%" is a guess in copy — LOW · S
- **Seen:** the Tighten door says "narrows this to within about 8%" (4% when
  tight) — a hardcoded pair (`app/wizard/Reveal.tsx:198`), not the Settings
  bands, and not the envelope's actual behaviour any more.
- **Change:** say what the envelope does: "narrows as you answer — sizes
  confirmed and the four open questions take it to within about N%" with N
  from `wizard_bands.tightPct`.

### 1.6 "The price is held for 60 days" is hardcoded — LOW · S
- **Seen:** the Keep door on the reveal (`Reveal.tsx:213`). The hold is a
  Settings value (`wizard_hold_days`, default 60); prod has no row, so today
  they agree by accident.
- **Change:** pass `holdDays` (the finish line already has it) to the reveal.

---

## 2 · The quick look

### 2.1 "Some rooms — You'll pick which ones next" never asks — MEDIUM · M
- **Seen:** the preset is identical to "The whole interior" downstream
  (`lib/wizard/quick-look.ts:168`: same surfaces, same starter list of eight
  rooms). The editor then shows all eight and the customer has to delete the
  ones they don't want with the × on each card.
- **Why:** a promise on screen 3 that screen 4 doesn't keep. It's the
  cheapest quick-look answer to get wrong and the one most likely to be
  chosen by someone with a two-room job.
- **Change:** on "Some rooms", the reveal's first tighten step becomes "Which
  rooms?" — the eight starter rooms as tick tiles, unticked ones removed
  (via the existing `remove_room` action) before the range shows; or ask it
  as a fifth quick-look screen for that preset only. I'd do the former: no new
  screen, and the range is honest from the first number.

### 2.2 The restatement reads badly with every colour ticked — LOW · S
- **Seen:** "new colours on the walls, ceilings and doors and trims" — the
  default sentence now, after this morning's all-ticked change.
- **Change:** "new colours throughout" when all three are ticked; the list
  only when some are.

### 2.3 The outside screen's material is stated as the customer's answer when they gave none — MEDIUM · S
- **Seen:** with no material ticked the reveal says "Walls — material to
  confirm … priced at a placeholder rate", but the sides editor's plan-from-
  above says "WEATHERBOARD CLADDING · FROM YOUR ANSWERS".
- **Why:** `defaultExterior()` seeds `substrates: ["weatherboards"]`
  (`lib/wizard/state.ts:626`), and the sides view labels the wall line from
  that. The customer reads a fact they never gave.
- **Change:** when no material was ticked, the sides view says "material to
  confirm" (amber), matching the reveal; the wall line stays at the
  placeholder rate as it is now.

### 2.4 The outside reveal talks about rooms — LOW · S
- **Seen:** Tighten door: "Confirm the rooms, the surfaces and the
  condition" on an outside-only job.
- **Change:** "Confirm each side, what's on it and the condition" when the
  job is exterior; both jobs get "rooms and sides".

### 2.5 Eight windows appear from nowhere on an outside job — LOW · S
- **Seen:** "8 windows · 2 coats · the type is confirmed by your estimator"
  on the reveal after ticking Windows without giving a count (the outside
  screen's count stepper defaults to 8).
- **Why:** the count is a real question the customer skipped; 8 reads as
  something they said.
- **Change:** show the window count on the reveal's assumed list ("we've
  assumed 8 — tap to change") rather than as a settled line, and include
  windows-count in the envelope's open questions (cheap = 4, dear = 12, or
  the storey-based typical ±50%).

---

## 3 · The editor and the finish line

### 3.1 The sent page names a person the reveal never did — HIGH for launch · S
- **Seen:** the reveal and editor say "One of our estimators confirms your
  price" (no patch match, no coordinator on test); the sent page then says
  "Thanks — Felipe Martinez has it". On production the same happens: the
  company profile has no `coordinatorName`, and the fallback in
  `lib/portal/data.ts` (`getCompanyContact`) is the literal "Felipe Martinez".
- **Why:** a placeholder name in front of a real customer, and an
  inconsistency between screens two taps apart.
- **Change:** the sent page uses the same `resolveEstimator` the reveal uses
  (patch estimator, else the coordinator, else "one of our estimators");
  remove the literal fallback name — an unset coordinator is a Settings gap
  the switch checklist already flags.

### 3.2 "Shiny trims" is asked but only prices when water-based-only is set — LOW · S
- **Seen:** answering the shiny question in the editor moved nothing;
  `lib/wizard/merge.ts:236` adds the adhesion prep only when
  `paint.waterBasedOnly` is also true, which the customer flow never sets.
- **Change:** either price the bonding primer whenever trims are shiny (a
  prep line at the defect rate), or drop the question from the customer's
  "details to settle" and leave it to the estimator. I'd price it — it's
  what the copy promises ("Shiny old paint needs an extra primer").

### 3.3 The "details to settle" card is the one place to answer the open questions, and it's below the fold — MEDIUM · S
- **Seen:** after the envelope, door style / shiny / ceiling height are the
  levers that narrow the range, and they sit under "A few details to settle"
  after the estimator strip and the What-we'll-do panel.
- **Change:** move that card directly under the range on the editor (it is
  the fastest way for a customer to tighten), and name the money: "answering
  these closes about $N of the range" from the envelope.

### 3.4 Exterior finish line offers no online send — by design, but the copy doesn't say why — LOW · S
- **Seen:** "Finalise my price" on an outside job opens "Ask us to call you
  back / Request a site visit"; no "Send for confirmation" and no fix online.
  That is the 21 Aug ruling (every exterior is signed off in person).
- **Change:** one line above the two buttons: "Outside work is always priced
  by a person — pick how."

---

## 4 · Ways in

### 4.1 Two describe doors — DECISION · S
- The screen-1 "Describe it" card builds a whole estimate and lands in the
  editor (7 Sep); the chat bubble fills the quick look in (C16). Both work;
  both say "describe". Tom's call which survives. If the card goes, the four
  journeys that use it move to the bubble and the build-to-editor path is
  retired for customers.

### 4.2 The old five-page path is still one click away for outside jobs — LOW · M
- "Upload photos or a listing" on screen 1 (outside only, after today) opens
  the old pages. It works, but it is the last old-style path a customer can
  reach. Folding facade photos and the listing onto the outside screen
  (as the floorplan went onto the place screen) retires it.

### 4.3 Resume banners — LOW · S
- A converted draft resumes with "Welcome back — you were at Scope" at the
  top of the quick look even when the customer is starting a new job. Once an
  estimate is created the banner should say "Your last estimate is saved —
  open it / start a new one" with both links.

---

## 5 · Settings and launch (already on the switch checklist, repeated for completeness)
- `wizard_policy` is empty on prod → the $2,000 floor and the $6k / $12k
  fix-online caps are the code defaults. Decide them.
- `service_area.postcodes` is empty → nobody is ever outside the area.
- No `coordinatorName` → see 3.1.
- No `scope_editor.visitSlots` → "Book a visit" is the callback path.

---

## 6 · What I did not find
- No path reached fix-online on a commercial or trade job.
- No money is computed in the browser on any screen (the envelope runs
  server-side; the screens re-read it).
- The versioned draft held through every path; the assistant's writes went
  through it.
- Every screen reached a person by phone or callback; the phone number is on
  every screen.

## Proposed order
1. 1.1, 1.2, 1.3 together (the envelope, one small PR, golden tests) — before
   anyone else looks at ranges.
2. 3.1 (the placeholder name) — before the switch flips, whatever else waits.
3. 2.1 (some rooms), 2.3 (material), 1.4 (one confidence number).
4. The copy items (1.5, 1.6, 2.2, 2.4, 2.5, 3.4) in one pass.
5. 3.2, 3.3, 4.2, 4.3 as time allows; 4.1 is a ruling.
