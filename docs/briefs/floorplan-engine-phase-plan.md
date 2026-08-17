# Floorplan quoting engine — Phase 1 + Phase 2 plan

**Decisions locked:** price shown as a **range** driven by the accuracy score (≥90% → ±4% · 70–89% → ±8% · <70% → ±15%; fixed price only at staff review/send). **Wizard is the primary path**; the conversational agent is Phase 2 on the same plumbing. **Exterior:** listing-URL photos feed the envelope pipeline; with no listing, the wizard requires 2–3 facade photos before quoting exterior. Walkthrough policy adopted as the recommended default — jobs ≥$15k or accuracy <80% require a walkthrough before acceptance (a Settings value, adjustable).

**Prerequisites (unchanged, in flight):** remediation R1–R2 (`lib/pricing` extraction + server boundary) and plan-reader phases P0–P7 with the accuracy gate (ceiling m² ±7%, wall m² ±10%, hours ±12% on the 25-job regression set). Phase 1 work below can be built in parallel with late P-phases but nothing customer-facing ships before the gate passes.

---

## Phase 1 — the wizard + editor

**W1 · Wizard shell & state.** The five paginated pages exactly per the workflow doc (Property → Surfaces → Condition → Details → Paint), visible 5-dot pagination, conditional logic (dark-to-light per-surface follow-up limited to ticked surfaces; water-based → oil-trims follow-up; damage tiers 3–4 require photos; exterior without listing URL requires facade photos). Wizard state is one typed object, zod-validated server-side on submit. Mobile-first.

**W2 · Extraction integration.** Page-1 upload/URL kicks off the plan-reader pipeline in the background; listing URLs also scrape address (service-area check immediately), facade photos and stated m². Wizard completion + extraction result merge into a generated estimate in the existing area/surface tree with full provenance tags. No-floorplan fallback path generates from the micro-form with everything tagged ai_assumed.

**W3 · Editor.** Plan pinned (left desktop / docked top mobile), rooms clickable and status-tinted (cyan active, emerald confirmed, amber low-confidence), room cards reusing the room-loop tile pattern, plan↔card highlight sync, provenance chips on measurements, one-tap confirmations (ceiling height first; exterior wall height for exterior jobs). Every edit reprices server-side; accuracy score and range recompute live.

**W4 · Range pricing, email gate, guardrails.** Accuracy score from the provenance model (dollar-weighted share of extracted-or-confirmed data); range bands as locked above. Email gate before reveal (creates the lead; save creates the account per existing auth decision). All escalation stops enforced in the wizard: commercial / heritage / body-corporate handoff, $2k floor, pre-1970s + peeling paint and asbestos hard stops, rate limiting per email/IP.

**W5 · Internal mode + proving window.** Same wizard from the estimates list: no gate, margin visible, point price, output = draft in the builder, review queue tagged `source=wizard`. **2–3 weeks internal use on real enquiries**; staff corrections in the review queue are the calibration set. Exit criteria: accuracy gate passing on live jobs, median staff correction <$150, no guardrail misses.

**W6 · Customer launch.** Flip on the public route: presentation auto-select at reveal, walkthrough policy enforcement, step-level analytics (completion per page, drop-off, accuracy-at-reveal vs final sent price), "when are you looking to start?" on save, CRM warm-lead wiring for drop-outs. Marketing-site CTA "Build your estimate" points here.

## Phase 2 — the conversational front door

**C1 · Translator, not a new engine.** The chat agent (per the existing website-agent guide: five-stage conversation, Haiku turns / Sonnet scope assembly, tool-user that never computes or states an unread price) gets one new job: translate conversation into **the wizard's state object** — same fields, same validation, same generated estimate. "3-bedroom house, freshen up, water-based" fills pages 1–5; anything unresolved, the agent asks the wizard's own question for it.

**C2 · Seamless handoff both ways.** Chat can drop the customer into the wizard at any page with everything answered so far pre-filled, and the wizard's "ask a question" assist is the same agent scoped to the current page. One journey, two input modes.

**C3 · Evals before exposure.** The guide's 30-job replay set (±15%) plus the fixed adversarial behavioural suite (rate probing, discount pressure, guardrail evasion) re-run on every prompt change; chat launches shadowed (agent fills state, wizard UI still shown) before going fully conversational.

**C4 · Launch + follow-up.** Chat becomes an alternative front door beside the wizard, never a replacement; the separate follow-up agent (draft-only first month, Batch API) proceeds as already planned.

**Order: W1→W2→W3 (parallel where sensible) → W4 → W5 proving window → W6 · then C1→C4.** Each workstream ships as its own Claude Code brief when reached; W1–W3 can be briefed together once the mockup is approved.
