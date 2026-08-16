# Paint Group Platform — Build Status & Strategy

_Last updated: 2026-08-14. Hand this to a new chat to get up to speed fast._

## What this is
An all-in-one platform for a painting business (Paint Group). The current focus is a
**production-rate estimating engine + estimate builder** that beats the tool they use now
(PaintScout). Owner (Tom) is **non-technical** — explain in plain English, give exact
click-by-click steps, and verify things actually work.

## Where everything lives
- **Live app:** https://paint-group-platform.vercel.app — Vercel is connected to GitHub, so **every push to `main` auto-deploys** (~1–2 min).
- **Repo:** `git@github.com:ster0001/paint-group-platform.git` (private, pushes over SSH).
- **Supabase project:** ref `llmrvgdequpmzzuaxdhq` · URL `https://llmrvgdequpmzzuaxdhq.supabase.co`
  - Publishable (anon) key `sb_publishable_dKZcxa3TRZRgKScwuZmn1g_Mp8wh0LF` (public, safe to expose).
- **Stack:** Next.js 16 (App Router, Turbopack) · TypeScript · Tailwind · Supabase (auth via `@supabase/ssr`, session refresh in `proxy.ts`).

## Local dev quirks
- **Node is via nvm and NOT on the default PATH.** Prefix shell commands with:
  `export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"` (Node v24.19.0, npm 11).
- Run: `cd ~/Documents/paint-group-platform && npm run dev` → http://localhost:3000
- Tests: `npm test` (pricing engine, 12 tests). Build check: `npm run build`.

## Test logins (password `painttest123`)
- `pg.sam.staff@gmail.com` — **staff** (full app)
- `pg.alice.customer@gmail.com`, `pg.bob.customer@gmail.com` — customers
- Test estimates in the live DB: “Test — 14 Smith St”, “Presentation test”, “Untitled quote” (safe to delete before launch).

---

## DONE (working & deployed)
1. **Auth & roles** — sign-up/in/out; `profiles.role` = staff | customer | contractor. RLS on every table (staff see all, customers own records, contractors assigned jobs). Verified live isolation.
2. **Database schema + RLS** — money as **integer cents** everywhere; migrations in `supabase/migrations/`.
3. **Rate card v7 loaded** — versioned `rate_cards` + `rate_items`; plus `modifiers`, `colour_rules`, `products`, `sundries`, `commercial_rates`, `area_names`, `line_items`, `settings`.
4. **Pricing engine** (`lib/pricing/`) — pure, tested functions. Order of operations, marginal-coat rule, per-line interior/exterior charge-out. **Contractor offer = ALL estimated hours × $60** (calibrated against 2 real jobs: 3140 → $4,155, 3108 → $5,070, both exact). Reprices job 3140 within **2.6%**.
5. **Estimate builder** (`app/quote/`): areas with **Room/Surface geometry** (area-level dims flow to surfaces), substrate picker grouped into folders, per-surface editor (override rate/prep hr/painting hr/qty/paint volume/$), **line items** (Hourly/Quantity/Custom), per-area totals, **duplicate**, **Options** (excluded from total), **hidden-from-customer**, notes, **photos** (Supabase Storage bucket `estimate-media`), **drill-in area view**, **save/load** (`estimates.builder_state` jsonb + `title`), live **Quote + Margin** panel.
6. **App shell** — left sidebar (Estimates / Invoices / Contacts / Settings), staff-only, under route group `app/(app)/`. `/estimates` list with status filters. Login lands on `/estimates`.
7. **Estimate document header** — company block (top-left) + “Estimate”/estimator/ID/date (top-right), from `settings.company_profile` (editable at **/settings**). **Contact** + **Job Address** cards with edit modals. Contacts list page.
8. **Contractor portal — Phase A** (`app/portal/`, 2026-08-16). Mobile-first dark shell built to `design/reference/contractor-portal-mockup.html`: sticky header + tab bar (Home / Requests / Jobs / Money / Calendar), scoped theme in `app/portal/portal.css` (`.pt`). `requireContractor()` gates every page; login, the staff shell and `/dashboard` now all route by role, so staff → `/estimates`, contractors → `/portal`, customers → `/dashboard`. **My profile** is the real content: company details, logo upload, bank details (encrypted via RPC), and insurance/licence documents with expiry. `offerable` is computed by the database from a valid insurance certificate — contractors can't set it themselves (verified live). Requests / Jobs / Calendar are honest empty states, no sample data.

## PENDING MANUAL STEPS (run in the Supabase SQL editor)
- **`20260814010000_contacts.sql`** (creates the `contacts` table). Until then the estimate’s **Save to Contacts** and the **Contacts page** are inert.
- **`20260823000000_contractor_bank_pgcrypto_fix.sql`** — fixes a bug in the Phase A migration: the bank RPCs couldn’t find pgcrypto (it lives in Supabase’s `extensions` schema, which their `search_path` left out). Until it runs, **saving bank details in the portal fails** (with a plain-English message, not a crash).
- **`20260823010000_contractor_docs_bucket.sql`** — creates the private `contractor-docs` bucket. Phase A added the documents table but no bucket, so **uploading insurance fails and no contractor can become offerable** until this runs. Also tightens `contractor-logos` writes to each contractor’s own folder.

## TEST CONTRACTOR LOGINS (password `painttest123`)
- `pg.josef.contractor@gmail.com` — Josef Kovac, Kovac Painting Pty Ltd (details pre-filled)
- `pg.mira.contractor@gmail.com` — Mira Delaney (profile deliberately blank)

Created by `npx tsx scripts/create-test-contractors.ts` (idempotent, safe to re-run). Staff have no screen for creating contractors yet — that script is the only path.

## KEY GOTCHAS (important for the next session)
- **DDL (schema changes) must be run by the user in the Supabase SQL editor** — the AI can’t run DDL (no DB password; the publishable key can’t). Data writes (DML) the AI CAN do via the Supabase API.
- **Pasting SQL into Supabase can mojibake special characters** (em-dashes → `‚Äî`). Prefer loading reference data over the API. (Already repaired once.)
- `git push` may be **blocked by the auto-mode classifier** — the user approves or runs it.
- **Photo file-picker & drag-and-drop can’t be verified by browser automation** (OS dialogs / synthetic drags) — they work for a real user.
- **Email confirmation is OFF** in Supabase (dev convenience) and **test data is in the live DB** — both must be handled before real customers.

---

## STRATEGY GOING FORWARD

**The pivot (current direction):** the estimate builder itself IS the customer-facing document. What staff build is exactly what the customer sees when sent; all internal detail (pricing table, margin, overrides, hidden items) is tucked behind click-throughs. The separate “Presentation” tab was removed.

**Roadmap, in priority order:**
1. **Customer-view estimate (THE BIG ONE, do next).** The estimate defaults to the clean document (client labels, area names + prices). Clicking an area/line opens the internal detail (surface pricing table with Qty/Prep/Painting/Total/Materials/Labor/Total, margin, overrides) in a modal. (Ref: PaintScout “line item view” + “Edit Surface” screenshots.)
2. **Select Rate modal** (surface-category folders) + **Edit Surface modal** — internal vs client labels, edit all variables (sizes, hours, override price, add product/materials), Custom Rate.
3. **Work Order** — auto-generated crew view + Estimate/Work-Order tab switch (hidden items shown, internal labels, prices optional).
4. **Contacts** — proper search/link from the estimate; click contact to open contact file.
5. **Send / PDF / accept** — read-only customer copy (hidden items removed), e-sign, and a **snapshot at send** so the customer’s copy never changes.
6. **Invoices** — accepted estimate → invoice.
7. **Rate-management admin UI** — edit rates/modifiers/products without SQL.
Later (per the original build plan): contractor portal, CRM/follow-ups, AI intake, marketing site.

**Also outstanding — the real Phase 1 “gate”:** validate the engine’s estimated hours against **actual worked hours** (timesheets), not just PaintScout’s estimates. Needs one or two completed jobs’ real hours.

**Non-negotiables to preserve** (from the build plan): money in cents; RLS on every table from day one; rate cards versioned (quotes never re-price); level of finish required before send; every pass-through carries a cost; contractors log hours; nothing hardcoded (every number has an admin screen); AI output always lands in a staff queue.

## Full reference specs (in the repo / provided by owner)
- `~/Downloads/paint-group-build-plan-v2.md` — phased build plan.
- Owner’s pasted “Estimating Engine & Builder” spec — PaintScout feature-by-feature parity + the 4 additions. (Saved in the AI’s project memory as `estimator-spec`.)
- `~/Downloads/Paint_Group_Rate_Card_v7.xlsx` — source of the rate card.
