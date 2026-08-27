# Portal 3a-5 — My colours, Documents & the warranty card

**One migration to paste:** `supabase/migrations/20261129000000_portal_documents.sql`

## 1 · Paste the migration

Expected read-backs, in order:
1. Row security: `company_documents | true`, `warranty_issues | true`
2. Policies: `company_documents_staff_all`, `warranty_issues_staff_all`
3. Bucket: `company-docs | false (private) | 20971520`
4. Storage policies: `company_docs_delete/read/update/write` (4 rows)
5. `warranty_issues.account_id` FK: `r` (RESTRICT)

## 2 · Upload your certificates (5 minutes, once)

Settings → **Documents**: title ("Public liability certificate of currency
— $20M"), kind Insurance, expiry date from the certificate, choose the PDF,
**Upload & display**. It's now in every customer's portal under Documents →
Our credentials. When it's within 30 days of expiry (or past it) the PC
console shows an amber banner until you replace it — a lapsed cert can
never quietly stay on display (⚑13).

Same folder: the **"Warranty terms legally approved"** tick. Until you tick
it (after the lawyer's review), customers see the warranty terms with a
DRAFT watermark. The terms rendered are the committed draft
(docs/briefs/paint-group-workmanship-warranty.md) — the unresolved
transfer-to-new-owner clause shows as "being finalised".

## 3 · What customers now have

- **My colours** — the permanent paint register per job: per area, each
  surface's colour name with a real swatch, finish, coats, and the
  painter's match code when recorded. Unconfirmed colours read "Colour to
  be confirmed" on an amber hatched swatch — never invented. "Download as
  PDF" prints the white register.
- **Documents & warranty** (linked from Home) — the live warranty card per
  signed-off job (real start/end dates + "1 year 11 months left"), the
  **Report an issue** photo-first form (lands as an amber card in your PC
  console; mark it handled and the card clears), your credentials with
  one-tap downloads, each job's completion report, and the full terms.

## Proof

- `e2e/portal-aftercare.spec.ts` 3/3 on C1: register with code + honest
  TBC, warranty countdown, member-only credential downloads (anonymous =
  404), DRAFT watermark tracking the Settings flag, report-an-issue
  landing open with its photo in storage.
- `lib/portal/colours.test.ts` (5) + `lib/workorder/console.warranty.test.ts`
  (2): register rules, PC card shape and auto-clear.
- Unit 996 · portal + PC console e2e regression re-runs green.
