# Paint Home — Session 4: comms and portal (one brand parameter, no second template set)

**Brief:** `docs/briefs/paint-home.md` §5 (lead and account data), §8.4. Follows #365, #366 and #369 (brand, words, wizard), all live.

## What this is
Every customer-facing message and page now reads the row's `brand` (from #369's migration) and renders the same template in that brand: name, mark, sender display name, link domain and, on invoices, the trading name and legal line. Paint Group rows pass through untouched; staff and contractor messages are not changed (the brief: never).

## What changed
- **`lib/messaging/brand.ts`** (pure, tested) — `messageBrandOf`, `companyForBrand` (Paint Home: name, phone, logos → the mark the app serves at `/painthome/email-logo.png`; estimator, email, address kept), `fromForBrand` (verified mailbox, "Paint Home" display name), `publicOriginFor` (links on painthome.com.au), `entityForBrand` (trades as Paint Home, *Enlvn Pty Ltd trading as Paint Home*; ABN/address/bank kept).
- **`/painthome/email-logo.png`** — a PNG of the mark on its slate background (dark-mode mail clients cannot invert it), from the same path data as every other rendering. `sendEmail` gained a `from` option.
- **Send sites** that pass the brand through: estimate email/SMS (`app/quote/actions.ts`), invoice email/SMS and payment receipt (`lib/invoicing/sendInvoice.ts`; the invoice email takes the brand's mark instead of the wordmark), receipt PDF (`lib/invoicing/pdf.ts`), booking confirmation, walk-through invite, welcome.
- **Customer pages** — `/i/[token]` lays the brand's entity over the invoice (this page is the PDF); `/e/[token]` lays the brand's name, phone and mark over the sent snapshot's company block at render, and its tab title follows (`lib/estimate/brandByToken.ts`, one service read; the snapshot is never rewritten).
- **Portal** (⚑ P8, shared accounts): all estimates Paint Home → Paint Home mark and number in the header; jobs from both doors → Paint Group header and a *Paint Home* tag on each Paint Home job. Account tab title is now "Your account".
- Help `docs/help/paint-home/{staff,customer}.md`; `docs/ARCHITECTURE.md` paragraph.

## Proof
- Unit `lib/messaging/brand.test.ts`; full suite 4068 green; typecheck clean; lint 0 errors.
- e2e `e2e/marketing/painthome-comms.spec.ts` (anonymous → customer, phone): a seeded Paint Home estimate's `/e` page shows Paint Home's name, mark and title on the Paint Home host and on the platform host alike; the magic link opens a portal with the Paint Home header for a Paint Home-only account; a Paint Group estimate joining the account flips the header to Paint Group and tags the Paint Home job. **The local run was refused** — main's e2e runs (from the #366 and #369 merges) hold the test project; the PR's e2e job is the result.
- A manual send was not exercised against Resend/Twilio from this session (test stack has the log driver); the unit test pins the adapter and the call sites type-check against it.

## For Tom
1. No migration.
2. ⚑ Resend: the From address stays `email@paintgroup.com.au` with "Paint Home" as the display name until painthome.com.au is verified as a sending domain in Resend; then set a `PAINTHOME_EMAIL_FROM` (one line in `fromForBrand`).
3. Manual test: send a Paint Home estimate (one made through painthome.com.au) to yourself — the email is from "Paint Home", carries the mark, links to painthome.com.au/e/…; open it: Paint Home header and title. Issue its deposit invoice: the invoice names Paint Home with the Enlvn line. Then sign in to the portal with that email: the Paint Home header.

## Not in this PR
Session 5 (brand pill and filters on the staff lists, dashboard split, Showcase/Website settings) and 6 (launch).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
