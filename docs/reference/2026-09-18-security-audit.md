# Security audit — 18 Sep 2026

Whole-repo review against the rules in `CLAUDE.md`: dependencies, secrets, the
service-role boundary, token routes, input validation, RLS and function grants,
HTML escaping, redirects, headers. Fixed on branch `fix/security-updates-18sep`;
migration `20270167000000_security_hardening_function_guards.sql` for Tom to paste.

## What was found and fixed

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | **Critical** | `next@16.3.0` — two unauthenticated remote-code-execution advisories (AVIF image optimisation, Windows hosts). Also `sharp` (libheif), `vitest`/`@vitest/mocker` (path traversal), `js-yaml` (CPU). | `next` + `eslint-config-next` → 16.3.5, `sharp` → 0.35.4, `vitest` → 4.1.11, `js-yaml` → 4.3.2. `npm audit` = 0. |
| 2 | High | `contractor_invoice_attach_pdf` and `contractor_invoice_attach_remittance_pdf` are SECURITY DEFINER, granted to `authenticated`, with **no** auth check — any contractor could point any contractor invoice's PDF at any storage path (attach-once, so permanently). | Guarded with `is_staff() or auth.role() = 'service_role'`, matching `invoice_attach_pdf`. Migration 20270167. |
| 3 | High | `sendSignedReportEmail` built the customer's link from the request's `Origin` header, which the caller sets. Anyone able to invoke the sign action could have the customer emailed a link to an attacker host carrying the customer's sign-off token. Same in `tickActions.ts`. | `lib/security/trustedOrigin.ts` — site URL from env, then Vercel's forwarded host; `Origin` is never read. |
| 4 | Medium | `app/s/[token]/actions.ts` interpolated a length-only-validated token into a PostgREST `or=` filter through the **service** client — `,`/`)` in the token rewrites the filter (reads another row's `customer_token`). | Token schema is now `^[A-Za-z0-9_-]{24,200}$`, like the sibling token pages. |
| 5 | Medium | Wizard per-visitor limit bypass: `contact.email` (length-only) interpolated into the same `or=` grammar; a bogus column made the count query fail and the dropped `error` read as "0 estimates". | Unsafe address counts by IP alone; a failed count returns 503 and reports, never assumes zero. |
| 6 | Medium | No rate limiting on any of the 12 public token routes (a CLAUDE.md rule). | `lib/security/tokenRouteLimit.ts` — one shared per-IP budget (240/min) answered in `proxy.ts` before any DB work, with unit tests. In-memory per instance: a brake, not a wall. |
| 7 | Medium | No browser security headers anywhere. | `next.config.ts`: `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (keeps `/e/<token>` out of third-party referrer logs), `Permissions-Policy`, HSTS. |
| 8 | Low | `wo_seed_qa_items` and `wo_assignment_conflict` had no grant *and* no revoke, so Postgres's default EXECUTE TO PUBLIC applied (nuisance writes / RLS-bypassing read of booking conflicts). | Revoked from public, anon, authenticated. Both are only called from other definer functions. Migration 20270167. |
| 9 | Low | `company-docs` bucket's `on conflict do update` did not re-pin `public = false`. | Pinned. Migration 20270167. |
| 10 | Low | `app/crm/api/search` gated on "any signed-in user" and left staff-only-ness to RLS; sibling `badge` route checks the role. | Explicit staff role check, 403 otherwise; a failed profile read is a 503, not a pass. |
| 11 | Low | Request bodies cast with `as {…}` instead of zod: `api/gcal/sync`, `api/gcal/staff`, `api/agent/cowork`; `[id]` route param unchecked in `properties/[id]/colour-card`. | zod schemas (uuids where uuids are expected); 400 on a bad body, 404 on a bad id. |
| 12 | Convention | `lib/marketing/siteContent.ts` reads the service client but lacked `import "server-only"`; a type-only client import was one dropped `type` keyword from a leak. | Added. Vitest aliases `server-only` to an empty stub (`lib/testing/server-only-stub.ts`). |

## Checked and clean

- No secrets in tracked files or in git history (patterns: Supabase JWTs, Anthropic, Resend, Twilio, AWS, GitHub, Slack, Google). Only `.env.example` is tracked and every value is blank. Supabase project refs appear in CI, but those are URL components, not secrets.
- Service-role key read in exactly one file; no `"use client"` module imports a service-touching module by value.
- No secret-looking `NEXT_PUBLIC_*` variable. The Google Maps key is server-only.
- All 6 cron routes check `CRON_SECRET`; all 8 webhook/inbound routes verify a signature or bearer secret (Stripe, svix, Twilio HMAC, Airtable bearer).
- No client-computed total reaches the database; every money write is bounded intent handed to an RPC that recomputes.
- All 133 tables have RLS enabled; the 4 with zero policies (gcal connection/token tables) also `revoke all` — deny-all on purpose. All 13 storage buckets have `storage.objects` policies except `invoice-docs`, which is service-role-only by design.
- Bank details: `contractor_get_bank` gates on staff-or-own before decrypting; column-level update on the encrypted column is revoked.
- Contractor render (`/w`, `/crew`) rebuilds the document field-by-field in the server component (`lib/workorder/crew.ts`); no customer pricing or contact detail is in the type at all.
- Every email/PDF HTML builder escapes interpolations. Open redirect guarded by `safeNextPath` (tested). Auth is enforced in each area's server layout, not only in the proxy.

## Left open (needs a ruling or a bigger change)

1. **Rich-text descriptions are not sanitised.** `RichTextEditor` stores raw `innerHTML`, which renders through `dangerouslySetInnerHTML` on the public `/e/[token]` page. The write path is staff-only today, so this is stored-XSS-by-privileged-author, but it is the one unescaped user-string → HTML path and it ends on the most public page. Fix: an allowlist sanitiser (`<p> <br> <b> <strong> <i> <em> <u> <ul> <ol> <li> <a href=https…>`) applied at save time in the builder and once more at render.
2. **A full Content-Security-Policy.** Pages carry inline scripts (JSON-LD, Clarity, tour) and Google/YouTube embeds; a CSP needs a nonce pass through the layouts first. Only `frame-ancestors` is set now.
3. **`presentation-docs` is a public bucket** with no MIME or size limit. If anything customer-confidential ever lands there, it is readable by URL. Consider `public = false` + signed URLs.
4. **`alter default privileges in schema public revoke execute on functions from public`** so a future function without an explicit grant is not callable by default. Needs a sweep of every function that relies on the default today before it can be applied safely.
5. **Rate limiting is per Vercel instance.** A shared store (Upstash / Vercel KV) would make it a wall. Same caveat already applies to `lib/places/publicLimit.ts`.
6. **`/photos/[token]` returns 200 with a friendly line for an unknown token** rather than 404, unlike its siblings. Harmless but inconsistent with the rule.
7. **Reply-To routing tokens are 16 chars** (`lib/messaging/record.ts`, 96 bits) — below the repo's 24-char floor for URL tokens, though not URL-facing and not brute-forceable in practice.
8. **Stripe webhook credits `metadata.invoice_cents`** (our own signed value) rather than the captured `amount_total`; a partial capture would overstate the ledger. Informational.

## How to verify after the paste

The migration's final `select` must print five `true` columns. Then `npm audit` → 0, `npm run lint`, `npx tsc --noEmit`, `npm test` all green (2644 tests), and `curl -I https://<host>/login` shows the six security headers.
