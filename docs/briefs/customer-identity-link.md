# The customer identity layer does not exist

**Status:** open, unscheduled · **Raised:** 23 Aug 2026, out of A2 (invoicing batch 1)
**Not an invoicing bug.** Invoicing is only where it surfaced first.

---

## The finding

No code anywhere writes `estimates.customer_id`, nothing inserts into
`customers`, and the wizard's anonymous auth users never become customer
records. `grep -rn "customer_id\|customers" app lib` returns **nothing**.

Live, 23 Aug 2026:

| | |
|---|---|
| `estimates` rows | 71 |
| …with a `customer_id` | **1** (13 Aug, seed) |
| `customers` rows in the whole project | **3** |
| `invoices` rows | 37 |
| …with a `customer_id` | **0** |

`public.customers` carries **`id`, `profile_id`, `created_at` and nothing
else** — no name, no email, no phone. It is a join row to an auth profile,
not a customer record.

## Where the contact details actually are

They are not lost. `wizard_leads` holds them:

| | |
|---|---|
| `wizard_leads` rows | 299 |
| …with a non-empty `email` | **299 (100%)** |
| …with `user_id` | 299 |
| …with `estimate_id` | **46** |
| distinct estimates reachable from a lead | **46 of 71** |

Columns: `id, created_at, email, estimate_id, ip_hash, job_type, outcome,
postcode, reasons, suburb, user_id`.

**So it is a linking job, not a data-loss problem — for the customer wizard
path.** Every customer-wizard estimate has an email, a suburb, a postcode and
an auth user id already sitting beside it.

**But there is a real gap on the staff path.** The 25 estimates with no lead
row are staff-created internal estimates, and internal mode captures no email
or phone anywhere — `estimates` has no contact column (`accepted_name` is
filled on only 3 rows, and is a signature name, not a contact). Notably, the
three estimates that carry the live deposit invoices are all in this group:
they have no reachable contact detail at all.

Two problems, then, not one:
1. **Customer wizard** — data exists in `wizard_leads`, needs promoting into
   `customers` and linking onto `estimates`.
2. **Staff-created estimates** — contact detail is never captured. Needs a
   product decision, not just a migration.

## What it blocks

- `invoices.customer_id NOT NULL` — deferred out of A2. Applied today it
  would throw on **every future acceptance**, because the estimate
  `accept_estimate` reads from has no customer either.
- **`invoices_customer_select`** (`20260813000000_initial_schema.sql:564`) —
  `customer_id = current_customer_id()` cannot match until `customers` rows
  exist and carry `profile_id`. The policy is correct and unreachable.
- **The customer-facing half of invoicing.** A staff list can be built
  without this; a customer view cannot.
- **The customer portal** (buildout item 3).
- **CRM leads** (buildout item 4) — pipeline over estimate states needs a
  person to attach the pipeline to.

## The product decisions this needs — not code decisions

- **When does an anonymous user become a customer?** First save, email
  capture, or acceptance?
- **What happens to a token-URL customer who never logs in?** They have an
  estimate and an email but no session to hang `profile_id` off.
- **How does `account_type residential | trade` fit?** `customers` has no
  such column today.
- **What does a staff-created estimate capture?** Nothing does today.

## Also for this work, deliberately NOT actioned in A2

`estimates.customer_id` is `ON DELETE SET NULL`. It should become `RESTRICT`
for the same reason `invoices.estimate_id` did in A2 — otherwise a correctly
linked estimate silently loses its customer when a customer row is deleted.
Not done now because with 1 linked row there is nothing to protect yet.

## Related

- `docs/audit-2026-08-23.md` — S1, S2 (this is the root cause under S2)
- `supabase/migrations/20261026000000_invoices_customer_link.sql` — A2
- `docs/briefs/post-wizard-buildout-order.md` — items 3 and 4 depend on this
