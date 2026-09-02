# Assistant agent — rulings log

**Module:** `agent` · **Parent brief:** `docs/briefs/claude-code-brief-assistant-agent.md` (v1, 1 Sep 2026) · **Addendum A:** `docs/briefs/claude-code-brief-assistant-agent-addendum-a.md`

One row per decision. A **ruling** is a decision Tom has made. A **default** is what Claude Code builds until Tom says otherwise — marked "default, awaiting Tom" per parent §9 S0.

---

## Rulings (Tom, 1 Sep 2026 — Addendum A §1)

| # | Ruling | Source |
|---|---|---|
| R1 | **One assistant, many channels.** Website widget and Meta (Messenger / Instagram / WhatsApp) are channel adapters onto the same assistant — same Brain, same guardrails, same tool contract, same live-chat inbox. No second bot. | Addendum A §1 |
| R2 | **Channel order:** website widget first (it hands straight into the estimator), Meta second. D18 ruled 2 Sep: widget first stands. | Addendum A §1 |
| R3 | **Trade build flow tightens as you go.** A trade client's paragraph builds a draft tree immediately, priced at once as a wide range with every assumption listed; each answered question narrows the range on screen. No "ask everything, then price, then send to the wizard" step — the builder is on screen throughout. | Addendum A §1 |
| R4 | **Amends parent D4:** early range shown for **trade** accounts; **residential** sees no number until every area is confirmed (anchoring risk). | Addendum A §1 |
| R5 | **Catalogue prerequisites** (pricing work, not assistant work): door style flat vs panel as a priced attribute; cupboard interiors as a scope item; window type as picture chips reusing the exterior wall-mix chip pattern. Audit: `docs/briefs/agent-catalogue-audit-a0.md`. D19 ruled 2 Sep — see below. | Addendum A §1 |

---

## Decisions ruled by Tom on 2 Sep 2026 (Addendum A §6 — "go with your suggestion")

| # | Decision | Ruled |
|---|---|---|
| D18 | Widget-first vs Meta-first | **Widget first.** |
| D19 | Rates for panel vs flat doors, cupboard interiors, window types | **Doors and windows: no change — the card already prices both as attributes.** Cupboard interiors: the four rows proposed in the A0 audit, shipped as migration `20261227000000_cupboard_interiors.sql` — Kitchen Cupboard Interior ≈ $50/carcass · Robe Interior ≈ $143/robe · Vanity Interior ≈ $57 · Linen / Broom Cupboard Interior ≈ $95 (2 coats, indicative; edit in Settings like every rate). Per **carcass**, shelves included, interiors follow the room's colour unless told otherwise. |
| D20 | Which Meta surface first | **Messenger.** |
| D21 | Trade early range | **Shown from the first price.** |
| D22 | Trade client's defect photo | **Auto-priced amber at the minor-defect rate (plaster_cracks sev 1, placeholder 3 lin m per room mentioned), staff review before fixed.** |

---

## Parent decisions D1–D17 — defaults, awaiting Tom (parent §11)

| # | Decision | Default being built | Status |
|---|---|---|---|
| D1 | Where it launches first | Portal only; website in the addendum's A3 (supersedes "S9") | default, awaiting Tom |
| D2 | Customer-facing name | "Paint Group assistant" (no persona name) | default, awaiting Tom |
| D3 | What "limited" means for residential | Guided + support unlimited; co-work hidden; 2-estimate rate limit stands | default, awaiting Tom |
| D4 | Early ballpark before all areas confirmed | **Amended by R4:** trade sees a range from the first price (D21); residential sees no number until confirmed | ruled via R4 |
| D5 | Assistant opens visit booking directly? | Opens it; gates enforced by the visit module | default, awaiting Tom |
| D6 | May co-work propose margin/price overrides | No — overrides stay in the builder click-throughs | default, awaiting Tom |
| D7 | Which staff roles get co-work | Staff only; contractors never | default, awaiting Tom |
| D8 | Support hours | Mon–Fri 08:00–17:00 Melbourne time, Settings-editable | default, awaiting Tom |
| D9 | Who is on live chat / pinged on admin's off days | Admin on her days; Tom on Wed/Fri; both pinged if unclaimed at 2 min | default, awaiting Tom |
| D10 | Live-chat claim SLA before offering a callback | 3 minutes | default, awaiting Tom |
| D11 | In-app calling in this module | After the inbound-calls module — `tel:` link in v1 | default, awaiting Tom |
| D12 | Retention of anonymous conversations with no email | Purge after 30 days | default, awaiting Tom |
| D13 | AI disclosure wording; transcripts in portal timeline | "You're chatting with Paint Group's assistant. A person is one tap away."; transcripts shown under "Conversations" | default, awaiting Tom |
| D14 | Brain source of truth and approver | `brain_entries` table, Tom approves; chat-captured content imported as drafts | default, awaiting Tom |
| D15 | Token budget per conversation and daily cap per account | Settings values; seeded 60,000 tokens per conversation and 400,000 per account per day until S8 measurements replace them | default, awaiting Tom |
| D16 | Does a hard stop end the online path | Keep building, visit tier locked in | default, awaiting Tom |
| D17 | Trade clients with several properties from one pasted schedule | Yes, one draft per property, each needing Apply | default, awaiting Tom |

Model IDs (parent §2 non-negotiable 9): Haiku-class default, Sonnet-class for build-from-prompt and extraction, both stored in `agent_settings` not code. Seeded as `claude-haiku-4-5` and `claude-sonnet-5` (verified against the Anthropic model list on 2 Sep 2026).
