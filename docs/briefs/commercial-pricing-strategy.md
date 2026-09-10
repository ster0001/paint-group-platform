# Commercial pricing strategy — end to end

**Prepared:** 20 August 2026
**Scope:** offices, hospitals, strata exteriors, industrial interiors, industrial exteriors, shop fronts
**Built on:** the wizard and pricing engine as they exist in `paint-group-platform` today
**All money AUD, ex-GST unless stated.**

---

## The headline: you have already built most of this

Before designing anything, I read what's there. Three things matter.

**Your wizard already has the exact ladder you're describing.** `lib/wizard/policy.ts` evaluates in order of severity: hard stops (lead, asbestos) → outside service area → **human handoff** → below minimum → reveal a price range. The self-serve caps are already tiered by job type and accuracy: interior up to $6,000 at ≥90% accuracy, exterior up to $12,000 at ≥85%, and never for a job flagged `requires_site_check`.

**Commercial is already a handoff — just a blanket one.** Line 216: `if (a.propertyKind === "commercial") reasons.push("commercial_property")`. Every commercial enquiry, from a $1,200 office touch-up to a hospital, gets the same "a person will call you" treatment. Your own comment in that file notes the commercial portal was handing its own users off.

**The account already gets created.** `ensureAccountAndProperty` runs on wizard save and creates the account and property; the magic link then proves the email and grants access. There's an `account_type` of `residential | trade`, and `lib/portal/portfolio.ts` is already a commercial workspace view — "every property, every job, one screen".

So the work is not "build a commercial wizard". It is **promote commercial from a blanket handoff to a tiered policy, and make the handoff feel like a start rather than a dead end.**

---

## The strategy in one page

**Three layers, and only the third is new.**

**Layer 1 — the engine, unchanged.** Hours × charge-out, plus materials, sundries and pass-throughs, in the order `engine.ts` already runs. Commercial does not get its own maths.

**Layer 2 — the sector band as a cross-check.** After the estimate is built bottom-up, compare it to a $/m² band for the sector. Inside the band, proceed. Outside it, stop and look. Your `commercial_rates` table already exists for this and nothing reads it.

**Layer 3 — the routing gate, which is the new part.** Every commercial enquiry is scored against a short list of gates. Any single gate trips it to appointment. Nothing trips, and it prices online like a residential job.

**The principle behind the gate:** price online where the variables are bounded, and refuse to guess where they aren't. A wrong assumption on a $4,000 office is recoverable. The same assumption on a strata block is a five-figure mistake, and the customer will hold you to the number they saw.

---

## The routing gate

**Any one of these sends the job to an appointment. No exceptions, no scoring, no override.**

| Gate | Why |
|---|---|
| Working height above safe ladder reach | Access equipment changes both cost and method |
| Access equipment needed — EWP, scissor, boom, scaffold, swing stage | Your own jobs show $925–$2,000 of hire on a single job |
| Work required outside standard hours | Loading is real and unmeasured; needs negotiating, not calculating |
| More than one mobilisation or stage | Staged works carry setup cost the calculator can't see |
| Site compliance required — induction, SWMS, permit, security clearance | Time and paperwork before a brush is lifted |
| Regulated environment — hospital, aged care, school, childcare | Infection control, clearances and approvals dominate |
| Owners corporation or committee decision | You're not quoting a person, you're quoting a process |
| Measured wall area above the segment cap | Beyond a point, measurement error compounds |
| Estimated value above the segment cap | The existing residential caps, re-tuned per segment |

The first seven are yes/no questions a customer can answer honestly. The last two fall out of the estimate itself. **`requires_site_check` already exists in your schema and already blocks self-acceptance — reuse it rather than inventing a second flag.**

---

## Segment by segment

### 1. Offices — small to large

**Small offices are your best self-serve commercial case.** Plasterboard walls, standard heights, repeatable room types, and your own data shows they price cleanly — the Box Hill floor came in at $12.91/m², the St Kilda Road suite at $8.89/m².

| | |
|---|---|
| **Measured on** | Wall area by area/room. Ceilings usually excluded (tiles) or priced separately |
| **Sector band** | Office fitout / Commercial interior Level 3 |
| **Self-serve when** | Single tenancy, standard hours, one mobilisation, ground or lift access, no ceiling tiles, under the area and value caps |
| **Appointment when** | Multi-floor, occupied and needing staging, after-hours access, sprayed ceiling tiles, fire-door schedules, base-building coordination |
| **Watch for** | Fire-stair doors, server rooms and comms cupboards priced as separate areas — the Box Hill job had all three |

### 2. Hospitals — always an appointment

**Never price this online, at any size.** The painting is the small part.

| | |
|---|---|
| **What drives price** | Infection control, ward-by-ward staging, night and weekend work, permits, inductions, containment, low-VOC and anti-microbial specifications |
| **Sector band** | None of the seven fit. Needs its own band, built from a completed job |
| **Commercial shape** | A program of works, not a job — staged, with progress claims |
| **Product implication** | Anti-microbial and low-VOC systems aren't in your products table |
| **Strategic question** | Do you want this work? It is high-compliance, slow-paying and specialist. Worth a deliberate yes rather than drifting into it |

### 3. Strata exteriors — always an appointment

| | |
|---|---|
| **What drives price** | Access above everything — EWP, swing stage or full scaffold. Then multiple mobilisations across blocks |
| **Sector band** | Body corporate / strata, currently seeded $11.20–13.20/m² |
| **Decision process** | Committee or AGM approval, often against two or three competing quotes with a scope written by someone else |
| **Scope risk** | "Common property" is a contested boundary — balconies, balustrades, front doors |
| **Already handled** | Your policy already flags `bodyCorporate === "yes"` as a handoff. Keep it |

### 4. Industrial interiors — split by height

**This is the one segment where a single question decides the route.**

| | |
|---|---|
| **Low bay, under ladder height** | Can self-serve. Small factory units, workshops, back-of-house |
| **High bay** | Always appointment. EWP, spray application, and usually a production shutdown to negotiate |
| **Sector band** | Warehouse — accessible ($11.20–12.20) vs Warehouse — high bay ($13.20–15.50) |
| **Substrates** | Face brick, block work, cement sheet, structural steel — none currently on your rate card |
| **Evidence gap** | You have no completed high-bay job in the data. That band is a guess and the seed says so |

### 5. Industrial exteriors — always an appointment

| | |
|---|---|
| **What drives price** | Tilt slab, metal cladding, roller doors, bollards, loading docks. Boom lift almost always. Traffic management when near a road or car park |
| **Sector band** | Nearest is Warehouse, but exterior industrial is really its own band |
| **Your evidence** | Chemist Warehouse Frankston at $23.91/m² with a 34ft knuckle boom; Don Kyatt with a $2,000 boom-lift line; Wolseley Place with a $925 scissor lift |
| **Why never online** | Access equipment is 15–20% of job value and cannot be inferred from an address |

### 6. Shop fronts — small ones self-serve

| | |
|---|---|
| **Self-serve when** | Single ground-level facade, no awning or verandah, no signage work, standard hours, one mobilisation |
| **Appointment when** | Shopping centre (contractor rules, night work, centre induction), awnings or verandahs, signage removal or reinstatement, heights beyond ladder reach, multiple tenancies |
| **Sector band** | Retail / chemist warehouse, seeded $11.20–13.20/m², noted as "after-hours staging usually applies" |
| **Note** | Your own seed already says retail usually runs after hours — which by the gate above means most shop fronts route to appointment anyway. Worth being honest about that |

---

## What this means the wizard has to do

### Step 1 — ask the property question earlier

`propertyKind` already exists with a `commercial` option. Today it triggers a blanket handoff. Change it to open a **segment question**: office · hospital or healthcare · strata common property · industrial · shop front · other. That single answer selects the sector band, the substrate set, the area names, and which gate questions to ask.

### Step 2 — ask the gate questions

Six or seven yes/no questions, asked once, early, before any measuring. Phrase them plainly:

- Is any of the work higher than a person can safely reach from a ladder?
- Will we need a lift or scaffold to reach it?
- Does the work need to happen outside normal business hours?
- Will it need to be done in stages, or in more than one visit?
- Does the site need an induction, permit or security clearance?
- Is the decision made by a committee or owners corporation?

**Any yes routes to appointment immediately** — before the customer invests fifteen minutes measuring. That respect for their time is worth more than the completed form.

### Step 3a — the self-serve path

Runs the existing interior or exterior flow with commercial area names and substrates. Three changes from residential:

1. **A wider range band.** Residential shows ±4% at ≥90% accuracy. Commercial should never be that tight — the variables are worse and the customer is comparing quotes. Start wider and narrow it once you have evidence.
2. **A higher accuracy threshold for self-acceptance.** Residential interior accepts at ≥90%. Commercial should be higher, or should not self-accept at all in version one.
3. **The sector band cross-check runs before the price is shown.** If the built-up estimate falls outside the band for that sector, the job routes to appointment regardless of everything else. This is your safety net against a missed area, and it costs nothing to add because the table already exists.

### Step 3b — the appointment path, done properly

This is where the value is, and where the current experience is thinnest. A handoff today ends in "a person will call you". It should end with the customer **logged in and watching their job start.**

The order matters:

1. **Capture everything they've already told you** — segment, address, rough size, the gate answers. Don't throw it away because you can't price it.
2. **Ask for photos and a floor plan.** You already have a plan reader and photo capture built. A commercial enquirer will happily upload a floor plan; it turns a two-hour site visit into a forty-minute confirmation.
3. **Create the account and property** — `ensureAccountAndProperty` already does this.
4. **Send the magic link.** They log in and see a real status: *Site visit requested*, what happens next, and when to expect it.
5. **Show them their own scope back.** The thing they described, laid out properly. It proves you were listening and it's the first artefact of the job.
6. **Put a booking step in front of them.** "Pick a time that suits" beats "we'll call you" every time.
7. **The estimator arrives pre-loaded** with the customer's answers, photos and plan. The visit becomes confirmation, not discovery.

**The strategic point:** a large commercial handoff isn't a failed quote. It's a qualified lead with a verified email, a property record, a scope and an account — which is a better position than most of your residential wins start from.

### Step 4 — the trade account

`account_type: "trade"` and the portfolio view already exist. A commercial customer with more than one property should land there by default: every property, every job, one screen. Facilities managers and strata managers have portfolios, and the tool that shows them their whole portfolio is the tool they keep using.

---

## Pricing decisions you need to make

I'm not setting these. Each one changes what the tool does.

**On rates**

1. **Does commercial get its own charge-out rate?** Your commercial jobs realise $120–135 per estimated hour against $106–124 residential, but they were quoted at anything from $82.50 to $120 with no rule.
2. **Fix the square-metre denominator.** Wall area only, or all paintable surface? Every band and every benchmark is meaningless until this is defined, and your own jobs currently measure wall area only — with two of ten recording no dimensions at all.
3. **Re-set the seven sector bands.** Currently $9.90–15.50/m². Your own commercial work realises $17–24/m² on wall area, or roughly $14–18 if ceilings and trim were counted in the denominator. The bands look low against your own evidence.
4. **After-hours loading.** Seeded at 1.35 and never measured. The market signal is 1.5–1.9×, and your own seed notes say retail and office fitout usually run after hours.
5. **Access equipment — pass-through at cost, or marked up?** You currently bill it as a round allowance. The engine can carry billed price and true cost separately.
6. **Minimum commercial job value.** Your residential floor is $2,000. Commercial has a fixed setup cost that doesn't shrink with the job.

**On routing**

7. **The self-serve caps per segment** — value and area. My suggestion is to start tighter than residential and loosen with evidence, but the numbers are yours.
8. **Should commercial self-accept at all in version one?** The safest launch is: price online, show a range, but always require a human to confirm before acceptance. You can relax it once you've seen fifty of them.
9. **Do you want hospital and healthcare work?** It needs its own band, its own products and its own compliance workflow. Worth a deliberate decision rather than accepting whatever arrives.

---

## Build order

**First — routing, no pricing.** Segment question, gate questions, and the improved handoff: capture, photos, account, magic link, status, booking. This works for all six segments immediately and every commercial enquiry gets better, including the ones you'll never price online. Nothing here touches the pricing engine.

**Second — the data.** Commercial substrates, products, area names and access pass-throughs as rate-card rows. A migration and a seed.

**Third — the sector band cross-check.** Wire up `commercial_rates` and show the comparison to the estimator internally, before it ever gates a customer price.

**Fourth — self-serve for the two segments that earn it.** Small offices and small shop fronts. Wide bands, no self-acceptance, human confirms every one. Measure fifty jobs, then decide whether to loosen.

Hospitals, strata and industrial exteriors stay on the appointment path indefinitely. That isn't a limitation — it's the correct answer, and building the handoff properly is what makes it feel like one.

---

## Where I'd push back on myself

- **The evidence base for commercial is thin.** Thirteen quotes, one of which turned out to be residential. No high-bay job, no hospital, no strata exterior in the data at all. Three of the six segments here are designed from industry norms and your seeded notes, not from your own completed work.
- **Self-serve commercial carries more risk than residential**, and the failure mode is worse — a customer who saw a number online and holds you to it. Every recommendation above leans conservative for that reason.
- **The gate questions rely on honest answers** from someone who may not know. "Does the site need an induction?" is obvious to a facilities manager and meaningless to a shop owner. Phrase for the least informed reader and let the estimator catch the rest.
