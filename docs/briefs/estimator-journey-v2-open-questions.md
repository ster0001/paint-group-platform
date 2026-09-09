# Estimator journey v2 — what's still waiting on Tom

**Updated:** 9 September 2026, after Tom's answers on site access, condition and actuals.

---

## 1. ⚑4 — same-colour trims: one coat or two? *(open, and it moves real money)*

Phase 3 took same-colour trims from **one coat to two** (⚑4's ruling: "two; one only when
condition is good"). That single change is most of the **+17% to +25%** on same-colour jobs.

Tom, 9 Sep: *"our current production rates for the painting of the trims is pretty accurate
already — it is just additional prep for bad, damaged, peeling trims which we need to factor in
extra time."*

Those two things pull in opposite directions, and the difference is worth thousands a year:

| If "production rates are accurate" means… | Then ⚑4 is… | What we do |
|---|---|---|
| the per-coat **rate** is right, but a same-colour job really is two coats of enamel | **correct** | leave it; the +25% was under-pricing being fixed |
| a same-colour trim job is genuinely **one coat**, and what's missing is prep | **an over-correction** | set `trims.same.coats` back to 1 and put the money into extent-based prep instead |

**The question:** on a same-colour job with sound trims, does your crew put **one coat or two**
on the skirtings?

It is one number in Settings → Estimates → Paint systems either way — no deploy, no code.

---

## 2. Condition by EXTENT, not presence *(designed, not yet built)*

Tom, 9 Sep: *"on some jobs, there may be peeling in 1 or 2 spots, which wouldn't require a 1.8
margin, whereas others are peeling across the whole job, this difference needs to be
differentiated."* And: *"previously, as we were seeing these by eye, we were just manually adding
the prep time for each substrate."*

That is a straight verdict on the current model. `EXT-WEATHERED` is **×1.8 on every painting hour
in the job** — right for a whole house that has gone, badly wrong for two flaking spots on a
south wall.

**The shape that matches what Tom actually does:** prep HOURS, per surface, scaled by how much of
it is affected — not a job-wide multiplier.

The machinery already exists and is half-used:

- `defect_prep_rates` carries **`hours_sev1` / `sev2` / `sev3`** per defect type, with a unit
  (m² / lineal m / each). Three severities is exactly "a couple of spots / patches here and
  there / most of it".
- Phase 4b's flagged spots already write prep lines from that table — but hard-code **severity 1**,
  on my reasoning that a customer cannot judge severity. Tom's framing shows that was the wrong
  call: nobody can judge "severity 2", but anyone can answer *"a couple of spots, patches here and
  there, or most of it?"*

**What ships next (no numbers needed from Tom to start):** an extent question on every flagged
spot and on the exterior condition answer, mapping the customer's words onto sev1/2/3. That alone
makes "peeling in two spots" cost two spots' worth.

**What Tom does need to supply, later:** the per-substrate prep hours themselves — the numbers he
used to add by eye. `defect_prep_rates` may already be seeded for some; the exterior ones are the
gap.

**And a consequence worth stating:** once extent drives prep, **`EXT-WEATHERED` ×1.8 should
probably go**, or shrink a long way. Keeping both would charge the same damage twice.

---

## 3. Exterior paint systems *(my earlier ask was wrong)*

I asked which exterior substrates "share a sealer or primer". Tom: *"these are just groups to make
it easier to find the substrate, not because they share anything in common."*

He is right, and it means exterior needs **less** from him than I said, not more. Each exterior
substrate already has its own rate row with its own coat columns, and `brick_unpainted` already
carries `default_coats: 3`. There is no grouping to invent.

**So the only exterior question left is the interior one, asked per substrate:** does *same
colours / new colours / going bold* change the coat count the way it does inside? If it is the
same 1 / 2 / 3 rule, exterior derivation is a table with no new judgement in it and can ship
immediately. If particular substrates differ — render taking two even on a colour match, say —
those are the exceptions to name.

---

## 4. Actuals — what we can and cannot settle today

Tom, 9 Sep: the work-order actuals feature **has not been built for contractors yet**; he plans a
switch letting selected subcontractors record task times and total job hours. The only data he
currently trusts is **Airtable: estimated vs actual hours per job — not per substrate.**

What that means honestly:

- Airtable **can** settle whether jobs are systematically under- or over-quoted at the job level.
  That is enough to sanity-check the phase-3 movements in aggregate.
- Airtable **cannot** settle ⚑4, because it does not split trims from walls. Question 1 above has
  to be answered from the crew's practice, not the data.
- The per-substrate prep hours in question 2 need the contractor time-tracking Tom is planning.
  **That is the piece that unlocks tightening the whole estimate**, and it is worth building
  before the remote-confirmation cap (⚑7) is widened on anything but nerve.
