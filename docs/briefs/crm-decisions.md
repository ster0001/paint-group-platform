# CRM — rulings and Phase 0 record

Companion to `claude-code-brief-crm-retargeting.md` (rev 2). Rulings recorded
as they are made, so no session has to guess. Sessions reconcile against this
file and the brief, in that order.

---

## Rulings

### A3 · Tenancy — **later-but-cheap-insurance** (Tom, 29 Aug 2026)

Every table created from this point carries a `tenant_id`, not null, defaulting
to the single Paint Group tenant, and every RLS policy is written tenant-aware.
No tenant switching, no tenant admin, no second tenant seeded — the column and
the policy shape are the whole of it.

**Why:** the Sydney partner-painter model is live enough as an idea that a
retrofit is plausible, and the retrofit is the expensive version — every table,
every policy, every query, all at once. The column costs one line per table now.

**How it lands:** with the FIRST CRM migration (`crm_events`), not before. A
`tenants` table plus the Paint Group row ships in that same migration, so the
default has something to point at. Existing tables are not backfilled: the
ruling is forward-looking by construction.

**What a session must do:** any new table gets `tenant_id uuid not null
references public.tenants(id) default public.current_tenant()`, and its RLS
policies filter on it. A migration that adds a table without one is a
stop-and-report.

### C10 · Frequency — one marketing message per customer per MONTH (Tom, 29 Aug)

Not per fortnight. A repaint cycle is measured in years, so monthly is already
frequent relative to how often somebody needs a painter, and it makes two
campaigns matching the same person harmless. Lives in `DEFAULT_POLICY`
(lib/campaigns/guard.ts), enforced by the guard chain as a HOLD, not a cancel —
they will be due later.

### C11 · Timing — weekdays, 9am to 6pm (Tom, 29 Aug)

An email landing at 9pm reads as automated, which undoes the personal tone the
whole studio is built for. Also a hold: the message waits for the morning.

### C12 · Which campaign runs first — deliberately NOT decided (Tom, 29 Aug)

Tom: "Unsure which campaign we will run first, that's the point of having this."
So no campaign is baked into the product. The engine takes any segment plus any
template and any number of steps, and the builder must let the office create one
without a developer. A pre-baked "first campaign" would have been a guess
wearing the authority of a feature.

### M9 · Referrals — the referrer sends the introduction themselves

Carried from the brief. **No send-to-a-friend form is to be built**, not behind
a flag. Acceptance-gate item, reviewer-verified.

### Google Photos is not the estimating photo store

Carried from the brief. Site Capture replaces it. Session 5.1 is optional and
last.

---

## Phase 0 record

### 0.1 · Portal identity model — **built, backfill partial**

`accounts` / `account_users` / `properties` shipped 26–27 Aug (migration
20261128). The brief's premise — "70 of 71 estimates have no customer" — was
already out of date when rev 2 was written.

State after the 29 Aug sweep below:

| | |
|---|---|
| `accounts` | 5 |
| `account_users` | 4 |
| `properties` | 9 |
| `estimates` | 25 — **10 linked**, 15 not |
| `invoices` | 7 — all 7 linked |

The 15 unlinked are the STAFF-PATH gap `customer-identity-link.md` names: the
internal wizard captures no email or phone anywhere, so there is nothing to link
them by. That is a product decision (capture contact on the staff path), not a
migration, and it is the last piece of 0.1.

### 0.2 · Test project and production sweep — **done, 29 Aug 2026**

The recurrence half already shipped with the audit: `e2e/global-setup.ts`
carries a hard-coded production ref and refuses to run against it, so the suite
can no longer write to production. The debris was historical.

**Swept, on Tom's approval:**

- **105 test estimates deleted** through the `delete_estimate` RPC as staff —
  the guarded path, which structurally refuses anything accepted or carrying an
  invoice or work order. All 105 returned `ok:deleted`. (96 × "Murrumbeena
  3163" journey-driver rows, 5 wizard test runs, 2 perf probes, 2 typo/untitled.)
- **10 orphaned accounts deleted** — unnamed residential accounts the identity
  backfill had built out of e2e journey runs, each re-checked for attachments
  immediately before deletion. `ENLVN PTY LTD` was in the orphan list and was
  **kept**: it is Tom's own trade account with a real portal login.
- Full row backup written to `~/Documents/paint-group-sweep-backup-2026-08-29.json`
  before anything was deleted.

Verified after: the estimates list, invoicing dashboard and contacts pages all
load, and the invoicing figures are real money against real jobs.

**Why it mattered to the CRM specifically:** 10 of 15 `accounts` were e2e
artefacts. The customer spine the whole module hangs off was two-thirds fake,
which would have made every segment count, board lane and campaign preview
fiction.

### 0.3 · Tenancy — ruled above.

---

## Open, and blocking

- **Revision 1** of the CRM brief and the three sub-briefs (site capture,
  campaign studio + referrals, full audit) are not in this repo or on the
  machine. Rev 2 defers the stage list, segment fields and attribution detail to
  revision 1, so Phase 2 has no source. Requested from Tom 29 Aug.
- **C9 · marketing consent** — needs legal. Blocks auto-send, not the build.
- **C17 · email + SMS provider** — settle with the cost-capture inbound parsing.
  Recommendation on the table: a SEPARATE Resend account/domain for marketing.
  Spam complaints on a shared domain damage the deliverability of estimates and
  invoices — the emails that actually make money.
- **C7 · repaint-cycle intervals** — needed before any warranty or repaint
  campaign can state a number.
