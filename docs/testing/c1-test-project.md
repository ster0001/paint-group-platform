# C1 — the dedicated test Supabase project

The audit's C1 and Tom's 24 Aug ruling: **money e2e never runs against
production.** C1 is a second, disposable Supabase project that carries the
same schema (synced from `supabase/migrations/`), seeded test logins, a
documented reset, and — alone in the whole system — **Stripe TEST keys**.
The test-card e2e (`e2e/stripe-live.spec.ts`) runs only here, through
`scripts/c1/run-e2e.sh`, which starts its own dev server on **:3101** so the
normal :3000 server and production are never involved. Every C1 tool carries
a tripwire that refuses to run against the production project ref.

## One-time setup (Tom — about 10 minutes)

**1. Create the project** at supabase.com/dashboard → *New project*:
   - Organisation: yours · Name: `paint-group-test` · Region: Sydney
   - Database password: click *Generate*, and SAVE it (you'll paste it below)

**2. Collect four values** (Project Settings → *API keys* / *Data API*, and
   the *Connect* button at the top for the connection string):
   - Project URL (`https://<ref>.supabase.co`)
   - `anon` public key
   - `service_role` secret key
   - Connection string — choose **Session pooler**, and put your database
     password into it where it shows `[YOUR-PASSWORD]`

**3. Stripe TEST key**: Stripe dashboard → flip **Test mode** ON (top right)
   → Developers → API keys → copy the **Secret key** (`sk_test_…`).
   (The webhook secret below is one WE make up — Stripe isn't told about the
   local test endpoint; deliveries are signed by the test suite itself.)

**4. Create `.env.test.local`** in the project folder with:

```bash
# --- C1 test Supabase project (never production values) ---
NEXT_PUBLIC_SUPABASE_URL=https://<test-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<test anon key>
SUPABASE_SERVICE_ROLE_KEY=<test service_role key>
C1_DATABASE_URL=<session pooler connection string, password filled in>

# --- e2e logins (same emails/passwords as the prod e2e users is fine) ---
E2E_STAFF_EMAIL=pg.sam.staff@gmail.com
E2E_STAFF_PASSWORD=<same as usual>
E2E_CONTRACTOR_EMAIL=<as usual>
E2E_CONTRACTOR_PASSWORD=<as usual>
E2E_CUSTOMER_EMAIL=<as usual>
E2E_CUSTOMER_PASSWORD=<as usual>

# --- Stripe TEST mode only ---
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_c1_local_anything_you_like
```

`.gitignore` already covers `.env*` — this file can never be committed.

## The tools (in order, from the project folder)

```bash
node scripts/c1/apply-migrations.mjs   # schema sync — every migration, in order
node scripts/c1/seed.mjs               # the e2e logins + a contractors/customers row
./scripts/c1/run-e2e.sh                # the Stripe test-card suite on :3101
./scripts/c1/run-e2e.sh e2e/invoicing.spec.ts   # any other spec, on the test stack
node scripts/c1/reset.mjs              # documented reset: business data wiped,
                                       # schema/settings/logins kept
```

`apply-migrations.mjs` records what it has applied (`_c1_migrations`) and
stops at the first failure naming the file — fix forward, re-run. After any
new migration lands in the repo, re-run it to keep C1 in step (this replaces
the SQL-editor paste ritual on the test project — the connection string
makes it automatic).

## What the money suite proves (`e2e/stripe-live.spec.ts`)

1. **Pay in full with a test card** (4242…): the hosted Checkout charges the
   exact balance + the disclosed surcharge; the redirect page *confirms*
   without writing; the webhook (signature-verified) records the payment,
   splits the surcharge, allocates the receipt, marks the invoice paid; the
   customer's page flips to "Payment received" on its own.
2. **Duplicate webhook delivery processes once** — same event, and same
   payment-intent under a different event id: still exactly one payment row.
3. **The Stripe processing fee** lands on the payment row behind the response.
4. **An abandoned session is inert** — a session created and never paid
   leaves zero rows and an unchanged invoice.
5. **A refund flips the payment, never the invoice** — `needs_credit_note`
   goes on the feed; un-paying is a human decision.
6. **Forged signatures bounce** at the door with a 400.

## Known divergences from production (deliberate)

- Migration `20260924` (listing-photo, withdrawn) was run on production then
  deleted from the repo — C1 never gets it. Nothing references it.
- Production carries pre-invoicing-era rows the migrations don't recreate;
  C1 starts empty. Fixtures create everything they assert on.

## CI (later, optional)

A GitHub Actions job can run `apply-migrations → seed → run-e2e` on a
schedule once the values above are added as repository secrets. Not enabled
yet — it needs those secrets in GitHub, which is Tom's call.

## Going LIVE with cards (after this suite is green)

1. Vercel → Project → Settings → Environment Variables:
   `STRIPE_SECRET_KEY` = the **live** secret key (`sk_live_…`).
2. Stripe dashboard (Test mode OFF) → Developers → Webhooks → *Add endpoint*:
   `https://paint-group-platform.vercel.app/api/webhooks/stripe`, events:
   `checkout.session.completed`, `charge.refunded`,
   `payment_intent.payment_failed`. Copy the signing secret it shows →
   Vercel env `STRIPE_WEBHOOK_SECRET`.
3. Redeploy. The "Pay by card" button appears on customer invoices the
   moment both values exist. Also confirm `NEXT_PUBLIC_SITE_URL` is set.
