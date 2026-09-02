# Assistant agent — rulings log

**Module:** `agent` · **Parent brief:** `docs/briefs/claude-code-brief-assistant-agent.md` (⚠ not yet in the repo as of 2 Sep 2026 — the parent's rulings D1–D17 are to be merged into this file when it lands) · **Addendum A:** `docs/briefs/claude-code-brief-assistant-agent-addendum-a.md`

One row per ruling. Newest at the bottom of each table. A ruling is a decision Tom has made; a ⚑ item is a decision still waiting on Tom.

---

## Rulings (Tom, 1 Sep 2026 — Addendum A §1)

| # | Ruling | Source |
|---|---|---|
| R1 | **One assistant, many channels.** Website widget and Meta (Messenger / Instagram / WhatsApp) are channel adapters onto the same assistant — same Brain, same guardrails, same tool contract, same live-chat inbox. No second bot. | Addendum A §1 |
| R2 | **Channel order:** website widget first (it hands straight into the estimator), Meta second. ⚑ D18 flips the order if most enquiries actually arrive via Facebook/Instagram today. | Addendum A §1 |
| R3 | **Trade build flow tightens as you go.** A trade client's paragraph builds a draft tree immediately, priced at once as a wide range with every assumption listed; each answered question narrows the range on screen. No "ask everything, then price, then send to the wizard" step — the builder is on screen throughout. | Addendum A §1 |
| R4 | **Amends parent D4:** early range shown for **trade** accounts; **residential** sees no number until every area is confirmed (anchoring risk). | Addendum A §1 |
| R5 | **Catalogue prerequisites** (pricing work, not assistant work): door style flat vs panel as a priced attribute; cupboard interiors as a scope item; window type as picture chips reusing the exterior wall-mix chip pattern. ⚑ D19 the rates. Audit: `docs/briefs/agent-catalogue-audit-a0.md`. | Addendum A §1 |

---

## ⚑ Decisions waiting on Tom (Addendum A §6)

| # | Decision | Default (what gets built if Tom says nothing) | Status |
|---|---|---|---|
| D18 | Widget-first vs Meta-first | Widget first | open |
| D19 | Rates for panel vs flat doors, cupboard interiors, window types | Claude Code proposes from current door/window rates; Tom sets — see the A0 audit | **proposal written, awaiting Tom** |
| D20 | Which Meta surface first (Messenger / Instagram / WhatsApp) | Messenger | open |
| D21 | Trade early range: shown from the first price, or only once required gaps are all answered | From the first price | open |
| D22 | Does a trade client's photo of defects get auto-priced at the minor-defect rate or always wait for staff | Auto-priced amber, staff review before fixed | open |

---

## Parent rulings D1–D17

Not recorded here yet: the parent brief is not in the repo. When it is committed, copy its rulings table above this section and mark D4 as amended by R4.
