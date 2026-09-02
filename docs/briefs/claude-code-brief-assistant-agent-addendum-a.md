# Claude Code brief — Assistant Addendum A: trade "write it, we build it" flow + channels

**Status:** ruled by Tom 1 Sep 2026 · **Parent brief:** `docs/briefs/claude-code-brief-assistant-agent.md` · **Module:** `agent`
Commit as `docs/briefs/claude-code-brief-assistant-agent-addendum-a.md`. Read the parent brief §1 list first; this addendum adds three items and amends two rulings.

---

## 1. Rulings from Tom (1 Sep) — update `docs/briefs/agent-rulings.md`

| # | Ruling |
|---|---|
| R1 | **One assistant, many channels.** Website widget and Meta (Messenger / Instagram / WhatsApp) are channel adapters onto the same assistant — same Brain, same guardrails, same tool contract, same live-chat inbox. No second bot. |
| R2 | **Channel order:** website widget first (it hands straight into the estimator), Meta second. ⚑ D18 flip the order if most enquiries actually arrive via Facebook/Instagram today. |
| R3 | **Trade build flow tightens as you go.** A trade client's paragraph builds a draft tree immediately, priced at once as a wide range with every assumption listed; each answered question narrows the range on screen. No "ask everything, then price, then send to the wizard" step — the builder is on screen throughout. |
| R4 | **D4 amended:** early range shown for **trade** accounts; **residential** sees no number until every area is confirmed (anchoring risk). |
| R5 | **Catalogue prerequisites** (pricing work, not assistant work): door style flat vs panel as a priced attribute; cupboard interiors as a scope item; window type as picture chips reusing the exterior wall-mix chip pattern. ⚑ D19 the rates. |

---

## 2. Extra reference files

| File | Why |
|---|---|
| Parent brief §4 (question graph) and §7 (tool contract) | this addendum adds a second gap class and a tightening order rule |
| `lib/pricing` catalogue items for doors, windows, cupboards; `defect_prep_rates` | R5 prerequisites |
| Exterior wall-mix chip component; window S/M/L group component | reuse for window-type picture chips |
| Wizard business inputs — accuracy bands (≥90 ±4 / 70–89 ±8 / <70 ±15) | range width comes from these only |
| Customer-portal brief — trade vs residential entitlement; anonymous → account linking at email/OTP | widget conversations must survive account creation |
| Inbound-calls brief — the programmable number | "Call us" in widget and Meta replies |
| Approval-queue rules (draft-only month) | any outbound the assistant composes |

Missing reference = STOP and report.

---

## 3. Design

### 3.1 Two classes of gap (amends parent §4)

- **Required gaps** — the tree cannot price without them (rooms, what we're painting, sides). Asked in graph order, one per turn.
- **Tightening gaps** — the tree prices without them at a wider band; answering narrows it. Asked **in descending order of price impact** (the engine reports the $ swing between the assumed value and the alternatives; largest first). This is the class Tom's example is made of:
  - photos of the defect areas (cracks) → amber prep line until seen; widens band
  - door style: flat or panel
  - window type: picture chips
  - current colours known? (colour match requested → colour coordination allowance state, colours recorded, never a row)
  - inside cupboards: yes/no per room type
  - plus existing: occupied property, access, timing
- Every unanswered tightening gap is an **assumption chip** on the range card ("Assumed: flat doors · standard windows · cupboard interiors not included"). Tapping a chip asks that question. The chips are the honest list — nothing assumed is hidden.

### 3.2 Golden fixture — Tom's paragraph

Input (trade account, interior):
> 3 bedroom 1 bathroom house requires painting with a colour match throughout. The walls are in good condition with a few minor cracks to the kitchen area, all trims including windows, doors, frames and skirtings to be painted.

Expected draft tree (provenance in brackets):
- Areas: Bedroom ×3, Bathroom ×1, Kitchen ×1, Hallway ×1 [assumed — a 3-bed house has one; chip], Living [assumed; chip] — sizes from typical-room defaults [assumed]
- Every area: walls [ai_extracted], trim / doors / windows / skirting [ai_extracted]; ceilings **not** stated → not included, chip "Ceilings not included — add?" (never silently $0, never silently added)
- Kitchen: prep line "minor cracks" [ai_extracted] at the minor-defect rate, amber until photos attached
- Colour match requested → colour coordination allowance state on; colours = TBC (state, not row)
- Doors: count from room defaults [assumed], style flat [assumed; chip]; windows: count from defaults, size M [assumed; chip]; cupboard interiors: excluded [assumed; chip]
- Range: <70 band (±15) on first price; after doors + windows + cupboards + photos answered and the sweep confirms counts, expected ≥90 band

Test asserts the tree, the chip list, the band, and that no `$` in the reply lacks a logged `price_scope` result.

### 3.3 Trade build flow in the builder (customer-side)

Trade account → New estimate → **"Describe the job"** box beside "Fill it in" (interior + exterior). Paste or type → `propose_diff` → for the client's *own* draft the diff applies straight into their tree (it is their estimate; provenance still `ai_extracted`/`assumed`) → range card + assumption chips appear → assistant asks tightening gaps largest-first, one per turn, chips update as answered → sweep confirms counts → band narrows → threshold → accept online or "Confirm my price — book the visit". Split view as the parent brief; the client can tap tiles at any point.

Staff co-work (parent §3.2) keeps the diff-then-Apply gate because staff are editing *someone else's* estimate.

### 3.4 Website widget (channel: `website`)

- One-line embed (script tag; iframe fallback) for the Paint Group site; opens in support-and-qualify mode; disclosure line; big-type mode available.
- Does: Brain FAQs, service-area check, inside/outside/both, rough size, email capture, "Get my estimate" → portal estimator with those answers pre-filled (anonymous conversation carries a token; on email/OTP the conversation is linked to the new account — never re-asked).
- Does not: show prices, run the editor, book visits (hands into the portal for those).
- Human handoff and "Call us" identical to the portal; lands in the same inbox and attention queue.
- Rate limit and anonymous-purge (D12) apply. Emits `crm_events` on email capture and hand-into-estimator.

### 3.5 Meta adapter (channel: `meta`) — after the widget

- Webhook receiver for Messenger, Instagram DMs, WhatsApp → `agent_conversations` with `channel=meta`, external thread id, no account until they follow the link.
- Support-and-qualify only, link out to the estimator with a pre-fill token; plain-text replies (no cards); handoff to the same inbox; staff replies from the console go back through the adapter.
- Claude Code to verify current Meta Business Platform requirements at session start — business verification, app review, and the rules on when a business may message a user — and STOP-and-report anything that needs Tom to act (verification is a Tom task, not code). ⚑ D20 which of the three Meta surfaces to switch on first.

---

## 4. Sessions (slot into the parent plan)

**A0 — Rulings + catalogue check.** Update `agent-rulings.md` with R1–R5; audit `lib/pricing` for door style, cupboard interiors, window type; report gaps with proposed rate rows for Tom (⚑ D19). Prerequisite for A2.

**A1 — Tightening gaps + impact ordering.** Extend the question graph with the `tightening` class; `price_scope` returns the $ swing per open assumption; `gapsFor` sorts tightening gaps by swing; assumption chips model. Tests: Tom's paragraph fixture (§3.2); ordering flips when a swing changes; ceilings-not-stated never silently added or $0. *Accept:* fixture green; swing values reconcile to the engine.

**A2 — Trade build flow in the builder.** "Describe the job" entry; own-draft direct apply; range card with chips; chip-tap asks the question; residential sees chips but no number until confirmed (R4). e2e as a trade user: paste the paragraph → range appears → answer 4 tightening questions → attach 1 photo → sweep → band narrows → accept CTA. e2e as residential: same paragraph → no number until sweep done. *Accept:* both flows green; every assumption visible as a chip until answered.

**A3 — Website widget.** Embed + iframe; anonymous conversation token; pre-fill hand-in; account linking on email/OTP; handoff + call; rate limit + purge job. e2e as anonymous visitor: FAQ → service-area check → email → "Get my estimate" → portal with address/job type filled → later account creation keeps the transcript. *Accept:* no re-asked question across the hand-in; widget renders on a blank test page at phone width; lead event emitted.

**A4 — Meta adapter (after A3 and Tom's Meta verification).** Webhook + signature check, thread mapping, plain-text mode, inbox round-trip. e2e with a Meta test app: DM → reply → handoff → staff reply lands in the DM. *Accept:* messages persisted before reply; no price or booking possible in-channel; adapter isolated behind a feature flag.

---

## 5. Acceptance — addendum

- Tom's paragraph fixture produces the expected tree, chips and band, and the same tree prices identically to a tile-built one.
- Trade users see a range from the first turn; residential users never see a number before confirmation.
- No assumption is ever hidden: chips = open tightening gaps, exactly.
- Website and Meta conversations reach the same inbox as portal chats and hand into the estimator without repeating a question.
- Nothing in any channel can produce a fixed price or a booking outside the portal's gated flows.

---

## 6. ⚑ Decisions (adds to the parent's D1–D17)

| # | Decision | Default |
|---|---|---|
| D18 | Widget-first vs Meta-first | Widget first |
| D19 | Rates for panel vs flat doors, cupboard interiors, window types | Claude Code proposes from current door/window rates; Tom sets |
| D20 | Which Meta surface first (Messenger / Instagram / WhatsApp) | Messenger |
| D21 | Trade early range: shown from the first price, or only once required gaps are all answered | From the first price |
| D22 | Does a trade client's photo of defects get auto-priced at the minor-defect rate or always wait for staff | Auto-priced amber, staff review before fixed |
