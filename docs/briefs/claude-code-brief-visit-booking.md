# Claude Code brief — Visit booking + visit policy (REGEN)

**Status:** REGENERATED 1 Sep 2026 from recorded rulings — original produced in chat, never committed. RECORDED = standing rulings, do not re-ask. RECONSTRUCTED ⚑ = confirm with Tom. **A found original wins.**
**Commit to:** `docs/briefs/claude-code-brief-visit-booking.md` · **Module:** visits (wizard, portal, assistant, PC console all consume it)

---

## 1. Purpose

One function decides how a site visit happens; one flow books it. "Confirm my price — book the visit" is the release valve for everything the estimator won't price fixed online, so the visit must be the *easy* path — bookable in under a minute — never a punishment.

## 2. Standing rulings — RECORDED, do not re-ask

1. **One visit-policy function** (`lib/visits/policy.ts`) returns exactly one of **`self_serve` | `phone_first` | `manual`** for a given estimate + account + property. Every surface (wizard threshold CTA, portal, assistant's `visit_policy` tool, PC console) calls it; no surface makes its own ruling.
2. **Four hard gates before a self-serve booking confirms** — all enforced in this module, server-side, never in chat:
   - **Service area** — property inside the zone (50 km Melbourne today; Sydney zones later).
   - **Mobile verified** — OTP on the mobile number (this is where mobile is first demanded; email alone never books a visit).
   - **Price acknowledged** — the customer has seen and acknowledged the current range/estimate state (no "free quote fishing" visits with no scope behind them).
   - **Authorised** — the booker confirms they are the decision-maker or authorised for the property (tenanted/managed properties route `phone_first`).
3. **Zone half-days:** self-serve slots are offered from zone-batched half-day windows so visits cluster geographically. **The zone map itself is a standing OPEN decision (Tom)** — until ruled, a single Melbourne-metro zone with AM/PM windows is the placeholder.
4. **Routing to `phone_first`** (a person calls to arrange, one-tap "Request a call" card → PC task with full context): lead-paint flag, damage beyond minor, tenanted/not-authorised, commercial/multi-property, anything with an amber custom line the office should read first. **`manual`**: staff-created visits from the console.
5. Visits appear on the Diary, emit `crm_events`, and the outcome (measurements confirmed, scope changes) flows back through the confirm-loop editors — provenance `human_confirmed` by staff.

## 3. Flow — RECONSTRUCTED ⚑

Threshold CTA / assistant → `policy()` →
- `self_serve`: slot picker (zone half-days, next ~10 business days ⚑V2) → four gates → confirmed screen + SMS/email with reschedule link (self-serve reschedule up to ⚑V3 24h before) → Diary entry + PC visibility.
- `phone_first`: "We'll call you to arrange" + preferred window chips → PC console task (severity: warm lead).
- No-show / cancel states feed CRM follow-up rules.

## 4. Acceptance criteria

1. No booking can confirm with any of the four gates failed — proven by adversarial API-level tests, not just UI.
2. Every surface shows the same ruling for the same estimate (parity test across wizard, portal, assistant tool).
3. A qualifying customer books in < 60 seconds on a phone; the confirmation states date-window, what happens on the day, and who is coming.
4. Lead-paint-flagged jobs can never reach `self_serve`.
5. All writes via RPC; Diary and `crm_events` entries created atomically with the booking.

## 5. ⚑ Open

| # | Item | Status |
|---|---|---|
| V1 | **Zone map** for half-day batching | RECORDED as open — still Tom's |
| V2 | Booking horizon (default 10 business days) | Reconstructed |
| V3 | Self-serve reschedule cutoff (default 24h) | Reconstructed |
| V4 | Visit duration assumptions per job type for Diary blocking | Reconstructed |
| V5 | Who attends (Tom vs estimator) — roster rules | Reconstructed |
