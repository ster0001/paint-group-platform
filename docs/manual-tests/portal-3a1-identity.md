# Portal 3a-1 — the identity model (accounts → properties → estimates/invoices)

**What this ships:** every customer becomes an *account* found by their email;
accounts own *properties*; estimates and invoices link into the chain. The
wizard now creates the account and property at save time. Nothing customer-
visible changes yet — 3a-2 (login + portal shell) is what shows it.

Deployed code is **inert-but-safe** until the migration runs: the wizard keeps
saving estimates exactly as before, it just can't link them yet.

---

## 1 · Paste the migration

In the Supabase SQL editor, paste the whole of:

    supabase/migrations/20261128000000_customer_accounts.sql

It ends with seven read-back queries. Expected results:

1. **Row security** — 2 rows: `account_users | true`, `accounts | true`.
2. **Policies** — 5 rows: `account_users_self_select`, `account_users_staff_all`,
   `accounts_member_select`, `accounts_staff_all`, `properties_member_select`.
3. **Functions** — 2 rows, both `prosecdef = true`:
   `invoice_inherit_account`, `is_account_member`.
4. **account_id columns** — 3 rows: `estimates`, `invoices`, `properties`.
5. **properties.customer_id nullable** — 1 row: `YES`.
6. **Trigger** — 1 row: `t_invoices_inherit_account`.
7. **FKs to accounts** — 3 rows, all `confdeltype = r` (RESTRICT):
   `estimates`, `invoices`, `properties`.

If anything differs: stop and tell the session — don't patch around it.

## 2 · Backfill report (read-only — run it and read it)

In Terminal:

```bash
cd ~/Documents/paint-group-platform && node scripts/portal/backfill-accounts.mjs
```

It prints how many existing estimates can be linked (via wizard leads and via
the builder's Contact card), how many accounts that would create, what looks
like test debris (skipped), and which estimates have no reachable contact at
all. **It writes nothing.** When you're happy with the buckets:

```bash
node scripts/portal/backfill-accounts.mjs --apply
```

then run it once more *without* `--apply` — the report should now show
everything linkable as `already_linked`.

## 3 · Eyeball check (2 minutes)

1. Open the public wizard (`/estimate`) in a private browser window, run a
   quick interior estimate with a real-looking email and pick an address from
   the suggestions, and save it.
2. In Supabase → Table editor → `accounts`: one new row with that email.
3. `properties`: one row with the address, linked to the account.
4. `estimates`: the new estimate carries `account_id` + `property_id`.
5. Run the same wizard again with the **same email, different address** — no
   second account appears; a second property does.

## 4 · What proved it in CI

- `lib/accounts/identity.test.ts` + `lib/accounts/schema.contract.test.ts`
  (unit, in `npm test` — 953 green).
- `e2e/account-rls.spec.ts` — 7/7 on the C1 test project through **real
  customer sessions**: a member reads exactly their own chain, a stranger
  reads nothing, customers can't create/edit accounts, estimates/invoices
  stay unreadable to customers (margins live in `builder_state`), and an
  invoice inherits its estimate's account at the database.
