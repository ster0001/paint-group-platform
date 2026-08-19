# Wizard recovery plan — honest assessment and the path to a customer-ready model

## Part 1 — The honest assessment

First, what I can and can't claim: I can't run or read your repo from here, so I won't pretend to have audited code I haven't seen. What I *can* do is read the evidence — fifteen defects across your two testing rounds — and the pattern is unambiguous:

**The data layer is probably fine. The surface layer was not built against the references.** Look at what's failing: no range (the range spec exists in three documents), no steppers, no remove, no add-controls, exterior reusing interior questions, uploads with no distinction between a floorplan and a condition photo, a confidence score that's decorative rather than computed. Every one of these is a *front-end and wiring* failure — none of them says "the estimate tree is wrong" or "pricing is broken." That's actually the good news: the expensive, risky part of this system (the tree, the engine, the server boundary) isn't what's being reported. What got built looks like a generic form-and-viewer produced from a summary of the idea, not from the mockups — which almost certainly means the reference files weren't in front of Claude Code as the definition of done, and the work was merged without checking each interaction against them.

**Is it salvageable? Yes — and honestly, this is the recoverable kind of failure.** If the foundations check out (Phase 0 below proves it either way), the fix is a controlled rebuild of the wizard/editor surface — days of work, not months — done with a discipline that makes drift impossible. What would NOT work is what we've been drifting into: patching fifteen symptoms one by one on a surface that was never built to spec. Stop patching. Verify the base, then rebuild the layer on top of it properly, once.

**And one thing that protects you:** the master plan always gated customers behind an internal proving window. Nothing broken has been seen by a customer. This is the proving window doing its job earlier than planned.

## Part 2 — Your exterior question, answered directly

**Yes — remove floorplans from the exterior path entirely.** You have my full agreement, and it's not a compromise: a floorplan is a picture of the *inside*. It tells us almost nothing about weatherboards, storeys, fascias or access. Asking exterior customers for one was always the interior flow leaking through.

But **keep photos for exterior — with fixed semantics.** 2–3 facade photos (front + visible sides) are the only visual truth an exterior estimate has. Here's the pragmatic V1 though, and this is the "achieve something good" call: **exterior V1 is question-driven, not AI-vision-driven.** The questions (below) produce the estimate; the photos ride along for *your estimator's eyes* and for the sign-off visit — not for automated assessment. If the photo→AI pipeline isn't genuinely built (your item 3 suggests it isn't), we don't block launch on computer vision. The envelope AI becomes an enhancement that tightens exterior accuracy later, slotting into a system already working. Interior keeps its floorplan (exactly 1 file) because there the extraction pipeline is the whole point.

**The exterior question set (replaces the interior questions — your item 7):**
1. Single or double storey? (photo picker)
2. What's the house made of? — weatherboard / render / brick / mix (photo picker, multi)
3. What are we painting? — body, windows & doors, roofline (fascias, gutters, eaves, downpipes — pre-ticked), garage door
4. How far around? — whole house / front only / front + sides
5. Condition — good / weathered / peeling & flaking (peeling + pre-1970s → the lead hard-stop, as designed)
6. Extras — deck, fence (metres or "not sure"), pergola, balustrade, letterbox
7. Anything tricky about access? — steep block, tight sides, double-height entry (multi, optional)
8. 2–3 photos of the outside (camera-first upload)

## Part 3 — The step-by-step plan

**Phase 0 · Diagnose — one Claude Code session, no fixes allowed (paste Part 4 below).** Produces a truth table: what exists vs the two reference mockups, feature by feature, WORKS / PARTIAL / MISSING, plus four foundation checks. One day. Everything after depends on what this says, but the plan assumes the likely outcome (foundations sound, surface not).

**Phase 1 · Foundation verification (gate).** Confirm: wizard output lives in the same area/surface tree the builder reads (not a parallel structure); `lib/pricing` is the only price authority and golden tests pass; capture opens wizard estimates (the A5 fix); storage buckets + upload paths work at all. If any of these fail, they're fixed *first* — surface work on broken foundations is how we got here.

**Phase 2 · Rebuild the interior wizard surface to reference.** One page per PR, five PRs, each with the acceptance checklist from the mockup (Part 5). This is where your items land properly: the **document model** (a floorplan is one file, type-validated, feeding extraction; condition photos are many, tagged `condition`, feeding the defect/prep pipeline and the estimator — never ingested as floorplans); **range pricing** from the accuracy bands; and an **honest accuracy score** — computed from what's actually confirmed vs assumed, capped hard (a no-floorplan, no-photo estimate cannot show 90%; if provenance isn't fully wired yet, the score is derived conservatively from answered-vs-assumed counts — honest-low always beats fake-high, because the score is what justifies the range and the visit).

**Phase 3 · Rebuild the editor to the scope-editor mockup.** Steppers on countables, remove on everything, add-room chips, tile grids from the capture components, delta toasts, pairing advice, the $6k ladder flipping the CTA. Two PRs (rooms + shared, ladder + exterior elements). Definition of done: *every interaction demonstrable in the mockup is demonstrable in the build.*

**Phase 4 · The exterior path proper.** The question set above, element groups including **Extras**, facade photos (no floorplan field anywhere in the flow), question-driven geometry, non-straightforward flags feeding the visit tier.

**Phase 5 · Internal proving, then customers.** You run every real enquiry through it for 2–3 weeks (the existing Step 9). Exit criteria unchanged: accuracy holding, median correction < $150, zero guardrail misses. Then, and only then, the website points at it.

**Realistic shape:** Phase 0–1 within a week; Phases 2–4 roughly two to three weeks of disciplined PRs; proving window on top. A working, customer-offerable quoting flow is weeks away, not months — provided we hold the process below.

## Part 4 — The Phase-0 diagnostic brief (paste this to Claude Code verbatim)

> **Task: diagnostic audit of the estimate wizard and editor. Do NOT fix anything in this session.**
> First confirm these files exist in the repo and read them: `design/reference/floorplan-wizard-mockup.html`, `design/reference/customer-scope-editor-mockup.html`, `docs/briefs/customer-scope-editor-workflow.md`, `docs/briefs/floorplan-wizard-business-inputs.md`. If any are missing, say so first — that finding matters.
> Produce `docs/wizard-diagnostic.md` with:
> 1. **Feature truth table.** Walk both mockups interaction by interaction (every tap, toggle, stepper, toast, state change) and mark each WORKS / PARTIAL / MISSING in the current build, with file locations.
> 2. **Foundation checks:** (a) does the wizard write to the same estimate/area/surface tables the builder reads — show the write path; (b) is every displayed price computed by `lib/pricing` server-side — show where the range should come from and what currently renders instead; (c) how is the confidence score computed — exact code path; (d) map the upload pipeline end to end: what happens to a floorplan vs a condition photo today, which buckets, which validators, and where the photo→AI assessment is or isn't implemented.
> 3. **Root-cause paragraph:** why the build diverged from the references (missing references? no acceptance criteria? single mega-pass?).
> 4. **Rebuild-vs-patch recommendation per area** (wizard pages, editor, uploads, exterior), sized S/M/L.
> No fixes, no refactors — evidence only.

## Part 5 — The process fix (so this never happens again)

1. **References in the repo, always.** The two mockups + workflow docs committed before any PR; every brief names its reference file in line one.
2. **Acceptance checklist per PR, drawn from the mockup.** Each PR description lists the mockup interactions it implements as checkboxes; unchecked boxes = not mergeable. "Matches the reference" is the definition of done — not "renders without errors."
3. **One page/feature per PR.** No mega-passes. Fifteen small reviewable merges beat one unreviewable one.
4. **You review on your phone, mockup beside build.** Two minutes per PR: open both, tap the same things. Anything that diverges bounces with a screenshot.
5. **Send me screenshots any time.** I can't see the repo, but I *can* be your QA layer — screenshots of each page against the mockups, and I'll write the punch list before anything merges.
