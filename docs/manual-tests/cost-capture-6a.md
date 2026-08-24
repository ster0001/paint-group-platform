# Cost capture 6a — migration + eyeball script (Tom)

One migration to paste, then a five-minute look around. Until the SQL runs,
the deployed code is inert: the Payables tab just shows no intake section
content and "+ Add cost" politely fails at the upload step.

## 1. Paste the migration

Supabase SQL editor → paste the whole of
`supabase/migrations/20261122000000_cost_intake.sql` → Run.

**Read-backs (printed at the bottom of the run) — expect:**

1. `job_no_missing_backfill` → **0** (every work order now has a PG number)
2. `cost_intake · relrowsecurity = true`
3. **9 functions**, all `security_definer = true`:
   `cost_intake_insert`, `cost_intake_set_extraction`, `cost_intake_confirm`,
   `cost_intake_reject`, `job_cost_record`, `job_cost_approve`,
   `job_cost_mark_paid`, `material_cost_assign`, `material_cost_sync_airtable`
4. `cost-docs` bucket → `public = false`, `file_size_limit = 26214400`
5. **3 policies**: `cost_docs_objects_delete`, `cost_docs_objects_read`,
   `cost_docs_objects_write`
6. settings row `cost_intake` → `auto_confirm = false`, `window_days = 7`

If any read-back differs: stop and tell the session — never patch around it.

## 2. Safe probes (optional, 1 minute)

```sql
-- Your jobs now have PG numbers, oldest first:
select job_no, wo_ref, created_at from work_orders order by job_no limit 5;

-- The pipeline refuses browsers (expect an error mentioning service_only):
select cost_intake_insert('probe', 'email', null, '', '');
```

## 3. Eyeball script (after the next deploy)

1. **Payments → Payables tab** — a small mono line "Intake accuracy: no
   documents decided yet" sits above the contractor tiles. Nothing else new
   (the queue is empty until something arrives at bills@ or the Airtable door).
2. **Settings → Cost intake** — duplicate window 7 days, auto-confirm
   unticked (leave it — first month is everything-human-confirmed), threshold
   $100. Save works.
3. **Any job's money view → Costs tab** — Materials and "Other trades &
   costs" groups now exist, plus **＋ Add cost**. Add one: attach any PDF or
   photo (required — try saving without one and it refuses), vendor, category,
   total. It appears in the list with its amount and a `manual` chip; the
   Payables tab now shows it with **Approve**, then **Mark paid** (asks the
   payment date). That's the recorded → approved → paid march.
4. The cost's **doc →** link opens the document you attached (signed URL).

## 4. What's deliberately NOT live yet

- **bills@ inbound** answers 503 until ⚑16 is settled: pick the provider
  (Resend already sends our email and does inbound — recommended), point MX
  for `bills@paintgroup.com.au` at it, and put `BILLS_INBOUND_SECRET` (the
  webhook signing secret) into Vercel env. The pipeline itself is proven by
  e2e with signed simulated deliveries.
- **Airtable/Zapier transition sync**: give Zapier a "Webhooks by Zapier"
  action → POST `https://<site>/api/inbound/airtable` with header
  `Authorization: Bearer <AIRTABLE_SYNC_SECRET>` (set the same value in
  Vercel env) and body
  `{"record_id": "...", "supplier": "...", "order_ref": "...", "address": "...", "amount_cents": 41280, "invoice_date": "2026-08-22"}`.
  Same pipeline, idempotent per record, cross-door duplicate-guarded.
- **⚑A3 when pointing trade accounts at bills@**: quote the job code
  (`PG-0087`, shown per job) as the order reference — that's what makes
  matching exact instead of fuzzy.
- Snap-receipt phone flow (6b) and contractor expenses (6c) are the next two
  sessions.
