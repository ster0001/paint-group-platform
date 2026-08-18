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

9. **Contractor portal — Phase B** (2026-08-16). **PG finish levels** (`lib/workorder/finish.ts`): PG-2 Utility / PG-3 Premium / PG-4 Showcase, each defining the prep committed *and* the acceptance test. The chip sits on the work-order header and taps through to the standard; areas can override the job level (`work_orders.area_finish`) and only the exceptions show a chip. **Work orders in the portal**: contractors now reach their jobs through their login (`/portal/jobs`, `/portal/jobs/[id]`) rather than only the anonymous share link — grouped current / upcoming / previous. Read-only; ticking surfaces off is still to build. Verified live: correct contractor sees it, others see nothing, drafts stay hidden, and the only dollar figure on the contractor page is their own payment.

10. **Contractor portal — Phase C: booking offers** (2026-08-16). Staff offer an issued work order to a contractor for a date range from the **Booking** panel on the work order; the contractor gets it in **Requests** with a 24-hour countdown and can accept, propose a different start date, or decline with a reason. Accepting locks the date onto the work order; declining or expiring puts the job back in the pool. **One live offer per job** and **expiry** are enforced by the database, not the screen, so a stale page can't double-book or answer late. **Privacy gate**: suburb only until the contractor commits — the real address is redacted server-side and never reaches their browser. Verified live across every branch, including that a full offer→accept cycle touches no customer-facing record. *Not built: the drag-and-drop scheduling timeline board, and notifications (no email/SMS service is wired up, so contractors see offers when they open the portal).*

11. **Contractor portal — Phase D: scheduling timeline** (2026-08-16). **/schedule** in the staff sidebar: contractor lanes × days, with blocks for accepted / in-progress / offered (hatched amber + countdown) / unavailable, an unscheduled job tray, and a today line. **Drag** is pointer-based rather than HTML5 drag-and-drop, so it's smooth and works on touch; dropping opens a confirmation rather than firing an offer. **Blocked-out days work from both sides** — contractors block their own in the portal Calendar tab, staff block anyone's from the board, and neither can clear the other's. Dropping onto blocked days turns the row red and warns, but still allows it. **Zoom** animates the blocks (day width is a CSS variable) with a 2/4/8-week range. **Views** filter lanes by tier, readiness or hand-picked contractors and can be saved by name. *Tiers are just the `contractors.tier` field and still have no admin screen.*

12. **Contractor onboarding + access control** (2026-08-16). **/contractors** in the staff sidebar: invite a painter and copy a private join link (single-use, 7-day expiry, tied to the invited email so a forwarded link can't be claimed), revoke pending invites, set tier, and suspend or restore access. Suspending withdraws any live offer and locks the portal. **You no longer need a developer to create a contractor account.**

13. **Internal wizard — Step 7, W1–W3** (2026-08-18). `/wizard` from the estimates
    list ("Start with the wizard"): five dark mockup-styled pages (listing URL /
    floorplan upload / no-plan basics with the open-plan toggle; surfaces;
    condition tier; door-window-height-damage details; paint), all conditional
    logic, English copy tone. Uploads read in the background; submit rebuilds the
    tree server-side from stored readings or the typical-size starter list,
    merges the answers (unticked surfaces filtered, coats set by tier, "mostly"
    door/window styles resolve the reader's deferred openings — "not sure" stays
    deferred), and lands a draft with provenance + the wizard snapshot in
    `builder_state`. Editor: accuracy ring, point price + margin, pinned plan,
    one-tap confirm height / confirm size / add / remove — every edit repriced
    server-side. Verified live on the no-plan path end to end. **Needs migration
    `20260915000000_wizard_source.sql` + a re-run of
    `npx tsx scripts/seed-extraction-settings.ts`** (kitchen/hallway typicals).
    Manual test: `docs/manual-tests/step7-wizard.md`.

14. **Exterior envelope E2 — Step 6** (2026-08-19). The envelope pipeline is
    fully wired: elevation-photo + site-plan vision readers (reference-based
    measurements only — no reference, no number), the read route forks by page
    class, and the wizard's exterior path now assembles the envelope into
    priced Exterior areas with `requires_site_check` and an
    `exterior_envelopes` record. Scorer: `npx tsx scripts/score-envelope.ts`.
    **Blocked on Tom for accuracy scoring: facade photos** (front + each
    visible side) for jobs 2494, 3109, hutton48 and lombardy46-ext — add the
    file paths to each job's `"photos"` array in `regression-set/manifest.json`.
    The interior gate scorer also now excludes exterior-shaped work orders
    that were polluting it (3000, 3087).

## PENDING MANUAL STEPS (run in the Supabase SQL editor)
- **`20260915000000_wizard_source.sql`** — lets wizard estimates carry
  `source='wizard'` (and reserves `trade_wizard`). Until run, the wizard saves
  with the old tag and shows a staff-visible note. Also re-run
  `npx tsx scripts/seed-extraction-settings.ts` for the two new typical sizes.
- **`20260909000000_offer_requires_compliance.sql` — NOT YET RUN, and it's the important one.** `send_offer` checks that a contractor isn’t suspended but never checked `offerable`, so a painter with **no verified insurance certificate** could be offered — and accept — a job in a customer’s home. Found by the offer→accept browser test on its first real run, 2026-08-17. The fix also re-derives `offerable` from the certificate at send time, closing the long-standing “a certificate that lapses untouched leaves the flag stale-true” gap.
- ~~R6 `20260908000000_input_constraints.sql`~~ **APPLIED + verified live 2026-08-17** (6/6: crew_size 99000 refused, 500-char company name refused, 2099 expiry refused, invite clamped 3650→30 days, ordinary values still save).
- ~~R4 migrations~~ **APPLIED and verified live 2026-08-17** (`20260905000000_upload_limits.sql`, `20260906000000_bank_change_alert.sql`, `20260907000000_work_order_contractor_index.sql`): uploads now have a server-enforced size and type limit on every bucket, a change to a contractor’s bank details raises an alert on the Contractors page, and `work_orders.contractor_id` is indexed. 11/11 checks — see `docs/manual-tests/r4-uploads-and-alerts.md`.
- **`20260814010000_contacts.sql`** (creates the `contacts` table). Until then the estimate’s **Save to Contacts** and the **Contacts page** are inert.

All four contractor-portal migrations (`20260823000000`, `20260823010000`, `20260824000000`, `20260824010000`) are **APPLIED and verified against the live database** — bank details round-trip, insurance upload flips `offerable`, and a contractor attempting to grant themselves `offerable` is refused. The compliance gate is enforced by **column privileges**, not a trigger: `offerable` and the bank columns are withheld from every signed-in user and written only by SECURITY DEFINER functions. See the AI memory note `contractor-portal` for the three lock designs that failed first — don’t repeat them.

**Known gap for the scheduling phase:** `offerable` is recomputed only when a document row changes, so a certificate that lapses untouched leaves it stale-true. The UI derives status live (`docState()`), but *sending an offer must re-check expiry server-side*.

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
