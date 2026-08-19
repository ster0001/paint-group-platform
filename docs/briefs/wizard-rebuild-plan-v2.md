# Rebuild plan v2 — from the diagnostic to a customer-ready wizard

**To Claude Code.** This responds to `docs/wizard-diagnostic.md`. The diagnostic was exactly what was asked for — keep that standard. The verdict it supports: **foundations stay, the surface gets fixed in five phases, and the process changes so "compiles + unit tests" is never again the definition of done.** The definition of done from today: **the customer journey passes end-to-end tests that drive the real flow, and every interaction demonstrable in the reference mockups is demonstrable in the build.**

---

## 0 · Rulings and housekeeping (do first, one session)

**Ruling — thresholds (this resolves the contradiction; no further debate needed):** Tom's later policy supersedes `wizard-business-inputs.md`. Update that doc to v2 with: self-serve = interior ≤ **$6,000** with accuracy ≥ **90%**, OR straightforward exterior (workflow definition) ≤ **$12,000** with accuracy ≥ **85%**. Everything else = human sign-off ("Confirm my price — book the visit"). The $15k walkthrough rule is **deleted**. All four numbers are Settings values. Note in the doc's header that v2 supersedes v1's thresholds, dated today.

**Working tree:** commit the diagnostic doc, the Playwright assessment spec, and the mockup copy. **Revert** the `app/estimate/page.tsx` staff-preview fallback — R1.1 below replaces it properly; a workaround and a fix must not coexist.

**Missing references:** Tom is supplying `customer-scope-editor-workflow.md` and `wizard-recovery-plan.md` (its §2 contains the exterior question set) — commit both to `docs/briefs/` before any R-phase work. Add one line to `CLAUDE.md` under Process: **"A referenced file that doesn't exist is a stop-and-report, never a build-around."** Flagging it three times and proceeding anyway was the second-worst failure in this project; the rule makes it impossible to repeat.

**Testing law (add to `CLAUDE.md`):** the assessment spec becomes the seed of `e2e/customer-journey/`. From now on: every fix/feature PR **starts** by writing the failing e2e spec that reproduces the problem or encodes the mockup interaction, **as an anonymous customer**, then makes it pass. Staff-preview specs run alongside, because staff-as-tester is precisely how the contract bug hid. No PR merges with the journey suite red.

## R1 · Four surgical fixes — one branch each, e2e spec first

**R1.1 — The response contract (clears #1 and #6).** The wizard-edit endpoint must return a payload determined by the **requesting surface** (explicit `view=customer|staff` contract), never by the caller's role. Staff preview explicitly requests the customer payload. Type the two payloads separately; a response missing range/room fields must fail loudly in dev, not render as blank. *e2e:* staff preview AND anonymous session both: load → range visible → remove a tile → tile disappears, range updates. Also assert the specific regression: first edit after load keeps the range rendered.

**R1.2 — Doors and windows priced by default (clears #4 and part of #5).** The wizard already asks door style and window style on page 4 — those answers populate **every** door/window tile's style. "Not sure" is reserved for a customer who genuinely can't answer, and an unsure style **still prices at the default rate** (medium window, flat door) with an amber "style to confirm" chip and a deferred-question entry — deferred means *visible and provisionally priced*, never silently omitted. A scope element the customer told us exists must never contribute $0 without an on-screen trace. Steppers render on any tile that's on. *e2e:* complete wizard picking Panel/Sash → every room's doors/windows tiles on, priced, steppered; complete it again choosing nothing → same tiles present with amber chips, total includes them.

**R1.3 — The document model (clears #2 and #3).** Three document types, enforced in schema, storage path and UI copy: `floorplan` (interior only, **exactly one**, replace-not-add, feeds extraction), `condition_photo` (many, feeds the damage AI + estimator), `facade_photo` (exterior, 2–3, estimator's eyes for v1). Exterior has **no floorplan field anywhere**. Then harden the damage pipeline: enumerate the six fragile preconditions in the PR description and collapse them — every path ends in a visible state: "analysing photo…", prep lines with hours, or amber "couldn't analyse — your estimator will review." Silent failure is the bug, not just the failures themselves. *e2e:* upload 2nd floorplan → replaced; condition photo → never appears as a plan, produces prep line or amber state; each precondition forced → visible state, never nothing.

**R1.4 — One confidence score (clears #5).** Delete the room-card lookup. One server-side function — provenance-weighted, including the assumed-height penalty, deferred items, and missing-surface penalties — feeds header, room cards, and the range band. Caps: a no-plan, no-photo estimate cannot exceed the band that honesty allows (cap ~65% until confirmations). Bands per the ruling above. *e2e:* header and every room card agree; confirming a height moves both; the 41%-vs-90% split is a regression test.

## R2 · The exterior path (build — nothing to patch)

Implement `wizard-recovery-plan.md` §2 verbatim: the eight exterior questions (storeys · substrate · what's painted with roofline pre-ticked · extent · condition with the lead-era hard stop · extras incl. fence metres/"not sure" · access · 2–3 facade photos). The wizard **branches** at job type — an exterior customer never sees ceiling heights or interior door styles. Editor gets the element groups **including Extras**, extent segmented control, read-only geometry with "Not right? Tell us" → non-straightforward flag. Geometry is question-driven for v1; the envelope AI plugs in later without changing the questions. *e2e:* full exterior journey, no interior question appears, Extras add/remove reprices, flag flips the CTA tier.

## R3 · The visual column (ship v1 now, don't block on AI schema)

**v1 (this phase):** the left panel exists — interior pins the uploaded floorplan image; exterior pins the facade photo; room cards highlight-sync by list selection. Ships without tappable geometry. **v1.5 (separate follow-up brief):** extend the extraction schema to emit per-room bounding boxes, then wire tap-on-plan ↔ card sync per the mockup. The AI-schema change gets its own branch and its own regression set — it must not delay R1–R4.

## R4 · Mockup parity pass (the checklist becomes the test suite)

Walk both reference mockups interaction by interaction and turn **each** into an e2e spec: add-room chips · pairing advice (skirting/walls, Keep/Leave) · delta toasts (behind the Settings switch, default ON) · "Something else?" → amber estimator note · not-sure vocabulary per the now-committed workflow doc · ladder CTA flipping live at $6k · booking slots → visit + prep pack · snapshot-on-accept. The PR that closes R4 includes the checklist with every box ticked and its spec named. Anything the mockup shows that the build can't do is a failing test, not a footnote.

## R5 · Acceptance and proving

R4 merged → Tom runs the scripted 90-second phone walkthrough (provided per phase: exact taps, expected result each screen). Anything that diverges is a screenshot → punch-list item → fix before proceeding. Then the 2–3 week internal proving window as planned. Customers only after exit criteria: accuracy holding, median correction < $150, zero guardrail misses.

## Sequencing and sizing

R0 half a day · R1.1 S · R1.2 S/M · R1.3 M · R1.4 S/M — all four inside week one · R2 M · R3 v1 S · R4 M · total roughly three weeks of disciplined PRs before the proving window. One branch per item, journey suite green on every merge, root-cause note in every fix PR.
