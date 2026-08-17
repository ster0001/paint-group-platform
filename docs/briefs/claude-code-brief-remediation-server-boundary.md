# Remediation brief: pricing extraction + server boundary (fixes C1–C5, S7)

**Context:** the audit found all Critical issues share one root cause — there is no server boundary. 58 mutations write from the browser to the database directly, pricing math lives inside `QuoteBuilder`, and therefore the server can never verify an amount or guard a transition. This brief fixes the architecture once rather than patching each symptom.

**Non-negotiable ground rules for this work:**
- No feature work mixed in. Behaviour-preserving refactor: after each phase, the app does exactly what it did before, just safely.
- Work in phases on separate branches, in this order. Do not start a phase until the previous one's tests pass and Tom has merged it.
- Every phase ends with: tests green, lint/typecheck clean, a manual test script for Tom, and a short summary of what moved where.
- The critical insight to preserve: **client-supplied money is display data, never truth.** After this work, the server computes every cent and the database refuses forged writes even from a devtools user with the anon key.

---

## Phase R1 — extract pricing into `lib/pricing/` (fixes S7, unblocks C1)

1. Create `lib/pricing/` as **pure functions**: input = estimate structure (areas, surfaces, rate items, product prices, adjustments) in plain typed objects; output = every derived amount in integer cents (line totals, area totals, subtotal, GST, total, contractor payment amount, deposit amount). No React, no Supabase imports, no Date.now — fully deterministic.
2. **Golden tests before refactoring:** write a script that pulls every existing estimate from the dev database, records its current stored totals, then asserts `lib/pricing` reproduces each one exactly. These tests are the safety net for the whole remediation — pricing behaviour must not change by one cent. Commit the fixture snapshot.
3. Refactor `QuoteBuilder` (and any other component doing arithmetic — grep for `* `, `.toFixed`, `/100` around money) to call `lib/pricing` for every displayed number. The component keeps UI state only.
4. Add unit tests for the pricing functions themselves (edge cases: zero-quantity lines, pinned per-area overrides, pass-through items, GST rounding — banker's vs standard, match current behaviour).

**Acceptance:** golden tests pass; no arithmetic on money anywhere under `app/` or `components/`; `lib/pricing` has no framework imports.

## Phase R2 — the server boundary for money + state (fixes C1, C2, C3, C4 for the critical paths)

Scope: the mutations where forgery or partial failure costs real money. Everything else waits for R3.

1. **Postgres RPCs (SECURITY DEFINER, one transaction each)** for every state transition and money write:
   - `send_offer(job_id, contractor_id, dates)` — computes nothing from the client: derives `payment_cents` from the job's accepted estimate via the stored pricing data, creates the offer, updates job stage, writes the audit row — one transaction (fixes C1 + C2).
   - `withdraw_offer`, `reassign_offer`, `expire_offer` — each takes the expected current status and fails with a typed conflict error if the row isn't in that state (`WHERE id = $1 AND status = 'offered'`; zero rows updated = raise). This kills the stale-tab problem (C3).
   - Same pattern for: estimate send (snapshot creation), estimate accept, variation approve, invoice create, invoice record-payment, contractor invoice submit (reconciliation check against approved amounts moves INTO the RPC).
   - Contractor-side RPCs already exist and are correct — align the staff side to the same pattern, do not duplicate.
2. **Server actions** wrapping each RPC: zod-validate input → auth + role check → call RPC with the server client → return typed result. All zod schemas in `lib/validation/` (C4). Client components call actions only.
3. **Revoke the back door.** Server actions alone don't stop a devtools user calling supabase-js directly with the anon key. In the same migration: RLS policies on offers, invoices, payments, estimates, jobs change to **deny INSERT/UPDATE from client roles entirely** on money and status columns — writes happen only inside the SECURITY DEFINER RPCs (or via service-role in server actions). Client role keeps SELECT per existing read policies. Test this explicitly: a supabase-js call from the browser attempting `update offers set payment_cents = 1` must fail.
4. **Server recomputation rule:** any action that stores a total recomputes it via `lib/pricing` from source data on the server. Client-sent totals are accepted nowhere — not even "for display consistency."
5. Migrations delivered as paste-ready SQL with verification queries, as always.

**Acceptance:** the five audit reproduction steps for C1–C3 now fail safely (forged `payment_cents` impossible from devtools; killing the network mid-send leaves no half-state; stale-tab withdraw returns a conflict the UI surfaces as "this offer has changed — refresh"); Playwright smoke paths (build → send → accept; offer → accept → confirmation) still pass.

## Phase R3 — migrate the remaining mutations

Batch the other ~45 mutations into server actions with zod, grouped by domain (products/settings, presentations, work orders, availability, profile). Most don't need bespoke RPCs — a validated action with the server client and existing RLS is enough. Rules:
- Any mutation touching more than one table in sequence gets an RPC transaction.
- Delete the browser-side Supabase **write** helpers when the last caller is migrated, so no new direct writes can be added by habit. Reads stay as they are.
- Chip away domain by domain; each batch is a small PR with its own test script.

## Phase R4 — uploads (fixes C5)

- Server-side validation on every upload path: allow-list MIME types by sniffing magic bytes (not filename/`accept=`), size caps per bucket (product photos, presentation media/video, presentation docs, WO photos, contractor compliance docs).
- Storage bucket policies enforce content-type and size limits at the bucket level as the backstop.
- Uploads route through a server action that returns a scoped signed upload URL — the client never writes to storage with broad permissions.

## Afterwards

- Re-run the audit (Part B of the standards doc) and confirm C1–C5 and S7 are closed; append the result to `docs/audit-2026-08.md`.
- Add to `CLAUDE.md` under Security: "Client roles have no INSERT/UPDATE on money or status columns; all such writes go through SECURITY DEFINER RPCs called from validated server actions." That makes the fix permanent policy, not a one-time cleanup.
- Then resume the feature roadmap (Presentations build next).
