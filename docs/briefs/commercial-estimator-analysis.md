# Commercial estimator — analysis and build recommendation

**Prepared:** 20 August 2026
**Evidence:** 13 commercial quotes read line by line from PaintScout · 31 commercially-classified jobs in Airtable · the v7 rate card, seed and pricing engine in `paint-group-platform`
**All money AUD, ex-GST unless stated.**

---

## First, two things you should know before the analysis

**Your tags didn't come through the API.** Every quote I pulled — including ones I know are commercial, like Chemist Warehouse Frankston — returns `tags: ""` and `tagDetails: []`. The tag trigger also returns empty for every name I tried. So I worked from Airtable's job-type field and the job addresses instead, and read the quotes directly. Either the tags need a moment to propagate, or the field PaintScout exposes to Zapier isn't the one you tagged. **Tell me the exact tag name and I'll re-run this properly.**

**The Airtable classification is not reliable.** Quote 2225, tagged "Interior Commercial", is a Victorian weatherboard house in Northcote with a roof respray — residential, and it's the largest job in the commercial list. I excluded it. Worth a tidy-up before these tags drive anything.

---

## What your commercial jobs actually look like

Thirteen quotes, read in full:

| Quote | Site | Ex-GST | Hours | Charge-out | Realised $/hr | Materials |
|---|---|---|---|---|---|---|
| 3031 | Chemist Warehouse Frankston | $16,785 | 104 | **$120** | $161.38 | 25.6% |
| 1327 | Redox offices, Laverton North | $12,602 | 104.75 | $95 | $120.31 | 21.0% |
| 1511 | Don Kyatt, Sunshine Rd | $11,445 | 86 | $100 | $133.08 | 7.4% |
| 1892 | Heatherhill Primary School | $9,975 | 96.75 | $100 | $103.10 | 3.0% |
| 1803 | Office floor, Box Hill | $7,462 | 66.75 | $100 | $111.79 | 10.9% |
| 1308 | Victorian Cosmetic Institute | $7,112 | 53.25 | **$110** | $133.56 | 17.6% |
| 1626 | Wengfu, Port Melbourne | $4,792 | 32.5 | $105 | $147.44 | 28.8% |
| 1026 | 250 Wolseley Pl, Thomastown | $4,775 | 19.5 | $100 | **$244.87** | 20.1% |
| 1888 | Melbourne Savage Club | $4,751 | 47.25 | **$82.50** | $100.54 | 17.9% |
| 1869 | Palermo Joinery, Mulgrave | $4,632 | 45.75 | $85 | $101.24 | 16.0% |
| 1090 | Fronditha Care, Clayton South | $2,880 | 24 | $100 | $120.00 | 16.7% |
| 1109 | Evercold, Laverton North | $2,820 | 38 | $100 | $139.53 | high |
| 1919 | Suite G10, St Kilda Rd | $1,261 | 12.25 | $85 | $102.91 | 17.4% |

**Three things jump out.**

Charge-out runs **$82.50 to $120** with no visible logic — the heritage club got $82.50, the Chemist Warehouse got $120. Same drift you have residentially, but wider.

**Materials are roughly double residential.** Median 17.4% here against 10.5% on the clean residential set. Epoxy enamels, rust treatments, industrial coatings and specialist primers cost more than wall paint, and the current 10% markup is applied to a much bigger base.

**Realised rate is higher than residential across the board.** Commercial interior averages $119.99 per estimated hour in Airtable against $106.46 residential interior; commercial exterior $135.09 against $124.09. Commercial is your better work, and it is being priced by instinct.

---

## What commercial needs that your estimator has no concept of

### 1. Substrates that don't exist on the rate card

From these quotes: **bollards, balustrades, handrails, rusted steel posts, retaining wall caps, loading dock walls, concrete tilt slab, cement sheet, internal face brickwork, roller doors, aluminium frames, fire-stair doors, ceiling tiles (sprayed), wallpaper removal, vinyl graphics removal, painted signage removal.**

Your card has 47 rate items, all residential-shaped. It has Brick and Render on the exterior side, and nothing at all for the metalwork family — which is most of what a warehouse or industrial site actually needs painting.

### 2. Products and systems that don't exist either

**Dulux Epoxy Enamel** (bollards, balustrades, impact areas), **Dulux Metalshield primer**, **Norglass rust treatment**, **Dulux AcraTex** (render and concrete), **Haymes Solarshield**, **Resene Space Coat**, **Premier Roof Coatings**, **Viponds** (industrial). Commercial work is **specified as a system** — etch primer, then two topcoats, named per substrate. Your products table is built around choosing a colour, not specifying a system.

### 3. Area names that are wrong for the building

Commercial quotes price: Meeting Room 1/2/3, Board Room, Server Room, Locker Room, Fire Stairs A, Reception, Print Room, Gents/Ladies/Disabled, Treatment Room 8/9/10, Workspace 1/2, Loading Dock, Front/Left/Right/Back Side.

Your `area_names` table has 26 entries: Living, Lounge, Bedroom 1–4, En Suite, Walk in Robe, Rumpus. **Not one commercial space type.** An estimator on a Box Hill office floor is fighting the tool from the first click.

### 4. Access equipment is real money and has no home

- 12 m boom lift, **$2,000** as its own line (Don Kyatt)
- 10 m scissor lift, **$925** including pick-up and drop-off (Wolseley Place)
- 34 ft knuckle boom, noted on the Chemist Warehouse job

Your engine already handles this properly — `Passthrough` at step 12 carries a billed price *and* a real cost, which is exactly right. And `line_items` already has **Scissor Lift Hire, Boom Lift Hire and Scaffolding** seeded as 'Custom'. **The mechanism exists and the wizard has no way to reach it.** On a $4,775 job, $925 of lift hire is 19% of the price — getting that wrong once wipes out the margin on the job.

### 5. Conditions that change the price and are never captured

Across all thirteen quotes there is **not one mention** of after-hours work, night shift, weekend work, site induction, SWMS, permits or traffic management. Yet you pay Gradient Group for traffic management — it's in your bills and your inbox — and your own seeded sector notes say retail and office fitout work *"usually"* runs after hours.

Two of your modifiers already exist for this: **STG-OCCUPIED (1.1)** and **STG-STAGED (1.15)**. Half these jobs were plainly occupied — an operating cosmetic clinic priced room by room, an aged-care facility, a tenanted office floor, a working club — and two carry "(stage 2)" in the job name. **The multipliers exist; nothing asks the question.**

### 6. Options are how commercial actually buys

The Savage Club quote carries a $4,908 Long Room and a $2,805 Card Room as *options*. Don Kyatt has soffits as options on all three elevations. Redox has doors priced two ways — 2-coat grey at $3,040 or 3-coat white at $4,560.

Commercial clients want a base scope and a priced menu. Your snapshot type already knows about option areas; the wizard treats them as an afterthought.

---

## The thing you already built and never wired up

`supabase/migrations/20260813010000_ratecard_v7_schema.sql` creates a **`commercial_rates`** table. The v7 seed fills it with seven sector bands in cents per m²:

| Sector | Low | High | Seeded note |
|---|---|---|---|
| Commercial interior repaint — Level 2 | $9.90/m² | $11.20 | Rental-grade / budget |
| Commercial interior repaint — Level 3 | $10.80 | $12.20 | **The default band** |
| Retail / chemist warehouse | $11.20 | $13.20 | After-hours staging usually applies |
| Warehouse — accessible | $11.20 | $12.20 | Ground level or low access |
| Warehouse — high bay | $13.20 | $15.50 | Includes EWP |
| Body corporate / strata | $11.20 | $13.20 | Occupied-site staging, multiple mobilisations |
| Office fitout | $10.80 | $12.20 | Usually after-hours |

**Nothing in `lib/` or `app/` reads this table.** I grepped the whole repo — the only mentions are the migration that creates it and the seed that fills it.

That is the single biggest opportunity here. Commercial estimating norms work exactly this way: you build the estimate bottom-up from measured quantities, then **sanity-check it against a $/m² band for the sector**. If your built-up number lands outside the band, something is wrong — usually a missed area or a wrong coat count. You have the band table. You just need to show the comparison.

---

## How I'd build it — inside the design you already have

The principle: **commercial is not a second estimator.** It's the same engine, the same order of operations, the same integer cents. Everything below adds data or asks a question; almost none of it changes the maths.

**Phase 1 — data only, no logic (the fastest real win)**

1. **Commercial substrates as rate items.** New sub-categories under the existing Interior/Exterior categories: `Metalwork` (bollards, balustrades, handrails, posts, roller doors, door frames), `Structural` (tilt slab, concrete, cement sheet, face brick), `Specialist` (ceiling tiles sprayed, aluminium frames etch-primed, line marking). Same units, same coat columns, same marginal-coat rule.
2. **Commercial products** in the products table with their systems — epoxy enamel, Metalshield, AcraTex, rust treatment, Solarshield.
3. **Commercial area names** — meeting room, boardroom, reception, open plan, amenities, server room, fire stairs, warehouse floor, loading dock, elevation.
4. **Access equipment as selectable pass-through lines**, using the `Passthrough` the engine already has: billed price and true cost recorded separately, so lift hire never silently eats margin.

That is a migration and a seed. No engine change, no new maths.

**Phase 2 — the questions**

5. **A job-class flag on the estimate** (residential / commercial). It drives which area names and substrates the wizard offers, and which questions it asks. One column, one selector.
6. **Four commercial questions**, mapped to modifiers that already exist:
   - Occupied during works? → `STG-OCCUPIED`
   - Staged over multiple mobilisations? → `STG-STAGED` (and how many)
   - Access: ground / ladder / scissor / boom / scaffold → `ACC-*` plus the equipment pass-through
   - Working hours: standard / after-hours / weekend → `STG-AFTERHRS`
7. **Fill in the estimator's site checklist** — induction required, SWMS required, permits, insurance level, prequalification. These don't price anything yet; they stop the estimator finding out on day one.

**Phase 3 — the sanity check**

8. **Wire up `commercial_rates`.** After the estimate is built, show the estimator: *"$11.40/m² — inside the Level 3 band ($10.80–$12.20)"* or *"$8.20/m² — below the Level 2 floor, check the scope."* This is the industry's own check, you already have the table, and it will catch missed areas before a quote goes out.
9. **Options as a first-class step** — a base scope plus a priced menu, which is how these clients buy.

**What I would not build yet:** a separate commercial pricing engine, a bill-of-quantities importer, or anything to do with tender documents. Nothing in these thirteen jobs needs them.

---

## Decisions for you — I'm not inventing these

1. **Does commercial get its own charge-out rate?** The evidence says it should — commercial realises $120–135 per estimated hour against $106–124 residential — but v8 currently sets interior $95 / exterior $108 with no commercial rate. Options: a third rate; a commercial multiplier on the residential rate; or leave it and let the sector band do the work.
2. **Materials markup on commercial.** Materials run ~17% of value here against 10.5% residential, on more expensive coatings. The same 20% markup earns a lot more on commercial — is that right, or does commercial need its own figure?
3. **After-hours loading.** Your own seed notes say retail and office fitout "usually" run after hours, and you have no loading for it. What's the number — 1.35 as the seeded `STG-AFTERHRS` guess, or something you've actually measured?
4. **Access equipment: pass-through at cost, or cost plus markup?** You currently bill it as a round allowance ($2,000, $925). The engine can carry both figures.
5. **Sign off the seven sector bands.** They're in the seed marked as your figures, but nothing has ever checked them against a completed job. The high-bay band in particular says "confirm against a completed high-bay contract" — worth doing before it drives a quote.
6. **Traffic management** — priced as a line, or absorbed? You're paying for it either way.

---

## Where this analysis is thin

- **Thirteen quotes**, not the full commercial book. Two of the twelve I asked for came back empty from the API (887, 878).
- **Your tags never reached me** — this is built on Airtable classification and reading the jobs, not on what you actually tagged.
- **Hours accuracy on commercial is unchecked.** I've compared the residential rate card against real timesheets; I have not done that for commercial substrates, and there is no work-order corpus for them. Any new commercial rate item will be an estimate until it's measured.
- No high-bay warehouse or line-marking job appeared in this sample, so two of the seeded sector bands have no evidence behind them at all.
