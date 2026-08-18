# Master build plan — estimator tool + AI quoting engine

One sequence, twelve steps, merging: the remediation (server boundary), the
room-loop on-site estimator, the AI plan-reader pipeline, the floorplan
wizard + editor (internal then customer), and the phase-2 chat front door.
Each step = one engagement on its own branch, governed by `CLAUDE.md`.
Existing briefs are referenced, not rewritten.

Shared foundations that make this ONE build, not four:

- `lib/pricing/` is the single pricing authority (Step 1)
- `room_type_scope_rules` drives tile sets, presets and starter lists
  everywhere (Step 3)
- `storey_heights` is the one ceiling-height model
- scope-capture components (room tiles, room cards) are shared with a `mode`
  prop (staff capture / customer editor)
- the provenance model (ai_extracted / ai_derived / ai_assumed /
  human_confirmed) powers the review queue AND the customer accuracy score

If any step is tempted to fork one of these, stop and flag.

Size key: S = days · M = ~1–2 weeks · L = bigger.

## Foundation

**Step 1 — R1: extract `lib/pricing/`** · Brief:
`claude-code-brief-remediation-server-boundary.md` Phase R1 · M
Golden tests against every existing estimate first; pure pricing functions;
QuoteBuilder becomes a consumer. Done when: golden tests pass, no money
arithmetic outside `lib/pricing/`.

**Step 2 — R2: server boundary for money + state** · Same brief, Phase R2 · M/L
SECURITY DEFINER RPCs for every transition, zod'd server actions, client write
access to money/status columns revoked. Done when: the audit's C1–C3
reproduction steps fail safely. (R3 remaining mutations + R4 uploads are
fill-in work — see "Parallel track".)

## Estimator track (on-site tool)

**Step 3 — Shared scope components + `room_type_scope_rules`** · Brief:
room-loop brief, foundations section · S/M
The rules table (room types -> default surfaces, tile order, typical sizes),
`storey_heights` on estimates, and the room-tile / room-card components built
`mode`-aware from day one. Done when: rules editable in Settings; components
render in a storybook-style test page in both modes.

**Step 4 — Room-loop capture** · Brief:
`claude-code-brief-room-loop-capture.md` · M
The full loop: add area -> name -> capture page (measurements top, surface
tiles, qty badges) -> description view for prep -> next room. IndexedDB
persistence, batched sync, AreaPicker hub. Done when: the parity test passes —
same room via capture and via the classic builder produces identical rows,
hours and total.

## AI track (plan reader -> wizard)

**Step 5 — Plan reader P0–P3: extraction core** · Brief:
`claude-code-brief-ai-plan-reader.md` · L
Normalise -> vision extraction with per-field confidence -> geometry
validation -> scope mapping into the area/surface tree with provenance tags.
Done when: a sample plan set extracts into draft estimates with provenance on
every value.

**Step 6 — Plan reader P4–P7: defects, exterior envelope, review queue,
gate** · Same brief §5 + later phases · L
Defect photos -> `defect_prep_rates` prep lines; exterior envelope
(plan+photos, height methods, `requires_site_check`); review queue ordered by
dollar impact; $150 pre-send gate. Done when: the accuracy gate passes —
ceiling m² +/-7%, wall m² +/-10%, hours +/-12% on the 25-job regression set.
Tom supplies the 25 floorplan+estimate regression jobs.

**Step 7 — Internal wizard + editor (W1–W3, internal mode)** · Briefs:
`floorplan-engine-phase-plan.md` W1–W3 + reference mockup
`floorplan-wizard-mockup.html` · M/L
Five-page wizard with all conditional logic; both geometry paths (plan/URL
extraction + no-plan starter list from basics); editor with pinned plan,
plan<->card sync, add/remove rooms, per-item confirmations, accuracy score.
Output = draft in builder, review queue `source=wizard`.

**Step 8 — Customer layer (W4)** · Brief: phase plan W4 · M
Email gate before reveal (lead + account-on-save), range bands
(>=90 +/-4 / 70–89 +/-8 / <70 +/-15), every guardrail (commercial/heritage/
body-corp handoff, $2k floor, lead-paint + asbestos hard stops, service-area
check, rate limiting), walkthrough policy (>= $15k or <80%, Settings value).
Done when: an adversarial test script fails safely.

**Step 9 — Proving window (W5)** · Tom's — 2–3 weeks calendar
Every real enquiry through the internal wizard. Exit: accuracy gate holding on
live jobs, median staff correction <$150, zero guardrail misses.

**Step 10 — Customer launch (W6)** · Brief: phase plan W6 · S/M
Public route on, presentation auto-select at reveal, step analytics, CRM
warm-lead wiring. Done when: first customer estimate flows wizard -> review
queue -> formal send -> accept.

## Phase 2

**Step 11 — Chat front door (C1–C3)** · Briefs: phase plan C1–C3 +
`guide-paint-group-website-ai-agent.md` · M/L
Agent as translator into the wizard state object; two-way handoff; replay +
adversarial evals; shadowed launch first.

**Step 12 — C4 launch** beside the wizard; follow-up agent draft-only first
month.

## Parallel track

Whenever a main step is blocked on Tom (proving window, regression set, SQL
pastes): R3 mutation batches, R4 uploads, the Presentations build. Never
parallel-branch two steps that touch the same tables.

## Checkpoints

- After Step 2: re-run audit -> Criticals must be closed before Step 4 merges.
- After Step 6: accuracy gate is a hard stop — no wizard work ships to
  customers on a failing gate.
- Before Step 10: run health check (Part C) + the Step 8 adversarial script
  once more on main.

Sequence in one line: R1 -> R2 -> shared components -> room-loop -> P0–P3 ->
P4–P7+gate -> internal wizard -> customer layer -> proving window -> launch ->
chat.

---

# Status against this plan — reconciled 18 Aug 2026

Much of this plan was built before the plan arrived. The honest mapping:

| Step | Status | Evidence |
|---|---|---|
| 1 (R1 pricing) | **DONE, merged** | `lib/pricing/` + golden tests repricing every estimate; 42 tests |
| 2 (R2 boundary) | **DONE, merged** | R2 + R2b + R3 batch 1 + R4–R6; audit Criticals closed; verified live with 4 identities |
| Parallel (R3/R4/Presentations) | **DONE, merged** | R3 work orders, R4 uploads, R6 constraints; Presentations shipped pre-plan |
| 3 (shared components) | **DONE, merged (18 Aug 2026)** | tile metadata on `room_type_scope_rules` (migration 20260913) so one table drives reader + tiles; `estimates.storey_heights`; `area_name_presets` + seed; `lib/capture/quantities.ts` + `presets.ts` (pure, 29 tests); mode-aware SurfaceTileBox + RoomCard rendering both modes on `/dev/scope-components`; Settings folders for scope rules / typical sizes / area presets. Awaiting Tom running migrations 20260912 + 20260913 (app degrades gracefully until then) |
| 4 (room-loop capture) | **CORE DONE, merged (18 Aug 2026)** | `/quote/capture`: AreaPicker hub (presets + progress cards + auto-increment names), capture screen (storey-inherited H, derived visible perimeter, wall segments, grouped tile grid with badge/increment model), RoomReview (prep steppers, coats, crew notes), IndexedDB draft store + offline queue + restore prompt, live total bar; `POST /api/estimates/[id]/rooms` (zod, staff-only, geometry-in/never-prices, server repricing); parity test green (capture room == hand-built room, per-surface). Verified end-to-end on live dev. REMAINING for full Step 4: per-tile long-press detail sheet, exclusion-tile UX, §13 instrumentation (tap/time counters), offline/crash e2e specs, tap-count targets measured on a real 12-room job. Needs migration 20260914 (storey_heights column grant) |
| 5 (plan reader P0–P3) | **DONE, merged** | five-stage pipeline; provenance on every node; 9 real plans read live, 15/15 dimensions exact; Tom's scanner rules (no guessed types, no assumed cornices, compulsory ceiling height); photos + listing inputs; multi-file plans -> one estimate |
| 6 (P4–P7) | **PART-DONE** | Gate machinery built and run twice (18 Aug): v1 whole-job, v2 PER-ROOM matched vs scraped work-order truth (which carries per-room L/W/H incl. true ceiling heights). Per-room: ceilings median 5.0% (42/75 in ±7%); walls median 17.6% under assumed 2.4 m but **3.9% with true heights (50/83 in ±10%)** — height assumption, not plan-reading, is the walls error, and production always confirms height. Photo-detected defects -> server-priced prep lines SHIPPED (same rates + code as capture chips; review-queue confirmation; unmatched rooms deferred). Production-conditions gate run DONE (confirmed heights: per-room walls 48/84 in ±10%, median 5.2%). Dollar-ordered review gate + $150 pre-send acknowledgement SHIPPED (reviewGate.ts, SendDialog; aiDeferred persisted). Envelope E1 SHIPPED (lib/extract/exterior.ts: reference-based measurement rules + Exterior node drafting, 5 tests); E2 remaining = elevation-photo vision prompt + site-plan footprint reading + route wiring + scoring the 8 exterior corpus jobs. DESIGN CONSTRAINT from data (18 Aug): deriving envelope walls from interior room boxes (footprint x shape factor x storeys) was tested against 6 exterior work-order truths and REJECTED - errors -53% to +49% (2494 -7% was the only near hit). The envelope MUST measure from its own sources per the brief: site-plan footprint reading + elevation photos with reference-based height methods, requires_site_check until confirmed. Do not resurrect the heuristic |
| 7–8, 10 (wizard) | **NOT STARTED** | `floorplan-engine-phase-plan.md` + mockup not on disk; business inputs committed beside this file |
| 9 (proving window) | Tom's, after 7 |
| 11–12 (chat) | **NOT STARTED** | guide not on disk |

**Deviations already made, flagged per the plan's own rule:**

- The provenance model lives INSIDE `estimates.builder_state` jsonb nodes, not
  on `areas`/`surfaces` tables (they don't exist — the tree is jsonb).
  Recorded in `docs/ARCHITECTURE.md` and migration 20260910000000.
- Ceiling height is currently ONE value per apply (Tom's rule: asked before
  publishing, transfers across all rooms). `storey_heights` (per-storey) is
  the plan's model and supersedes it in Step 3 — the schema already reads
  per-page storeys, so this is an additive change.
- Typical dimensions live in a new `room_type_defaults` table keyed
  (version, room_type) rather than as columns on `room_type_scope_rules` —
  the rules table is one row per room-type x surface, so a per-room-type
  value would be duplicated across every surface row. Same versioning, same
  Settings ownership, same seed script.

---

## Path check — 18 Aug 2026, late

Audited against this plan's own rules. **Verdict: on path.**

**Sequence.** R1 ✓ R2 ✓ 3 ✓ 4-core ✓ 5 ✓ 6-in-progress. Step 4's remainder
(field test, instrumentation, long-press sheet) waits on Tom using capture on
a real job — the plan's parallel-track rule covers working Step 6 meanwhile.
The Step 6 gate stays the hard stop before any Step 7+ work ships to
customers; building the internal wizard (Step 7) is permitted in parallel but
launching it is not.

**Shared foundations, verified in code (the "stop and flag" list):**
1. Single pricing authority — no money arithmetic outside `lib/pricing/`;
   capture displays only server-computed totals. HOLDS.
2. One rules table — `room_type_scope_rules` consumed by reader scope, capture
   tiles, and the rooms route (3 consumers, same rows). HOLDS.
3. One ceiling-height model — `estimates.storey_heights` written by both the
   apply route and capture; per-node H remains the pricing input. HOLDS.
4. Mode-aware components — one SurfaceTileBox/RoomCard used by the workbench
   and capture; Step 7's customer editor must consume these, not fork. HOLDS.
5. Provenance — capture emits human_confirmed; reader emits ai_*; the review
   queue reads both (incl. the new photo-prep confirmations). HOLDS.

**One watched mirror (flagged per the plan's rule, not a fork):**
`lib/capture/quantities.ts` restates the geometry that
`lib/pricing/estimate.ts#computeQuantity` owns (walls = perimeter x H etc.)
so tiles can show live numbers without mounting the pricing context. The
parity test in `lib/capture/commit.test.ts` pins them together per-surface.
RULE: any change to computeQuantity must run and, if needed, extend that
parity test in the same commit.

**Order of upcoming work:** finish Step 6 (production-conditions gate run,
exterior envelope, dollar-ordered review queue, $150 pre-send gate) -> Step 7
internal wizard -> Step 8 customer layer. Tom-side: field-test capture, plans
for 28 Bute / 10 Scotland / 56 Main, Northcote photos.

**Files needed from Tom to proceed:**
`claude-code-brief-room-loop-capture.md` (blocks Steps 3-remainder and 4),
`floorplan-engine-phase-plan.md` + `floorplan-wizard-mockup.html` (block
Steps 7–10), `guide-paint-group-website-ai-agent.md` (blocks 11), and the
25-job regression set (blocks the Step 6 gate).
