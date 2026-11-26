# Claude Code brief: finish the Paint Home go-live fixes

**Project:** paint-group-platform (Next.js 16 / Supabase)
**Worktree:** `~/pgp-golive` (a git worktree of `~/pgp-estimates-funnel`)
**Date:** 25 Nov 2026. Paint Home goes live 26 Nov.
**Read with:** `painthome-go-live-check-25nov.md` (project docs; commit it to `docs/briefs/` if it isn't there).

## Where things stand

A chat session edited files in this worktree tonight and was cut off before it could type-check, run the tests or commit. **Every change listed in Part A is uncommitted and unverified.** Your job is to review them, make them pass, add the chat fix in Part B, and open a PR. Do not deploy to production; Tom will walk a preview first.

Start with `git status` and `git diff`. If the changed files don't match the list in Part A, stop and report before doing anything else.

## Rulings that bind (do not reopen)

- Paint Home is homeowner-only. No commercial, no "business" wording.
- "Paint Group" appears on Paint Home only as the "powered by" credits and the one FAQ sentence (`lib/marketing/copy/painthome.test.ts` is the proof).
- No tolerance figure a customer can see; the price is never called "exact".
- No price maths outside `lib/pricing`. Nothing in this brief touches pricing; golden tests stay green.
- Customer-facing copy in an English tone, not Australian. Money in AUD inc GST.
- CLAUDE.md applies in full: migrations go in the PR body for Tom and are never run by you; missing reference = stop and report.

---

## Part A: review and verify the uncommitted changes

### Clean up first
- Delete `tsconfig.golive-check.json` in the repo root. It is a scratch file and must not be committed.

### Files changed (expect exactly these)

| File | What changed |
|---|---|
| `lib/marketing/brand.ts` | `Brand` gains `email` (`info@paintgroup.com.au` / `hello@painthome.com.au`) |
| `lib/messaging/brand.ts`, `brand.test.ts` | New `documentCompanyForBrand`: Paint Home's email and the landline on the estimate a customer reads. `companyForBrand` is unchanged, so reply-to and calendar organiser stay the office mailbox |
| `app/quote/page.tsx`, `app/e/[token]/page.tsx` | Use `documentCompanyForBrand` for the header / snapshot overlay |
| `lib/wizard/otpFormat.ts`, new `lib/wizard/gateContact.test.ts` | New `gateContactProblem`: names the field that is wrong |
| `app/wizard/WizardApp.tsx` | Both gate checks call `gateContactProblem` |
| `app/wizard/QuickLook.tsx` | Error line scrolls into view; privacy line under the details fields |
| `app/wizard/MobileQuickLook.tsx` | Privacy link added to the consent note |
| `app/wizard/wizard.css` | Styles for the privacy line |
| new `lib/marketing/legal.ts`, `legal.test.ts` | Privacy policy sections per brand; `termsForBrand` |
| new `app/(marketing)/_components/LegalPage.tsx` | Shared shell for the legal pages |
| new `app/(marketing)/privacy/page.tsx`, `terms/page.tsx`, `warranty/page.tsx` | The three pages. Warranty renders from `lib/warranty/terms.ts`; terms from the `terms_conditions` setting |
| `app/(marketing)/marketing.css` | `.legal` styles |
| `app/(marketing)/_sections/Footer.tsx` | Legal links go to the pages; Paint Home service links start an estimate; Contact is a `mailto:` |
| `app/(marketing)/work/page.tsx`, `work/WorkList.tsx`, `work/[slug]/page.tsx` | Titles take the brand; no Homes / Businesses filter on Paint Home |
| `app/(marketing)/not-found.tsx`, new `app/not-found.tsx` | 404 titles no longer read "Paint Group Platform" |
| `lib/wizard/journey.ts`, `journey.test.ts` | Page counter clamps to its total (was "6 of 5") |
| `app/(marketing)/HomePage.tsx` | `LiveStrip` not rendered on Paint Home |
| `lib/marketing/copy/painthome.ts` | Fallback copy reworded (see Part C) |
| `e2e/marketing/painthome.spec.ts` | `#live` expected absent on Paint Home |

### Things to check closely
1. **`lib/marketing/legal.ts`:** the strings contain `“` / `·` escapes. Confirm they render as curly quotes and a middle dot, not literal backslashes.
2. **`app/not-found.tsx` and the marketing 404** render a `<title>` element inside the component. Confirm Next 16 hoists it and the tab title is right; if not, use the supported metadata route.
3. **`work/[slug]/page.tsx`:** `getAudience()` was moved up in `generateMetadata`; confirm there is one declaration and the canonical logic is unchanged.
4. **Seed parity:** `lib/marketing/copy/painthome.ts` is the source the seed migration `20270299000000_paint_home_content.sql` was generated from. If a test compares them, do not edit the applied migration. Write a new migration that updates the changed rows and put its SQL in the PR body for Tom.
5. **`/privacy` on every host:** it must render on painthome.com.au (Paint Home policy), the Paint Group site, and the platform host the wizard runs on.
6. **Existing e2e that assert the old strings** ("Please fill in your name, email and mobile number", footer `data-todo` links, `#live` on Paint Home): update them to the new behaviour, don't revert the change.

### Acceptance
- [ ] `git status` shows no `tsconfig.golive-check.json`.
- [ ] `npx tsc --noEmit` clean. `npm run lint` clean. `npm test` green, including the new `legal.test.ts`, `gateContact.test.ts` and the extended `brand.test.ts` / `journey.test.ts`.
- [ ] Signed out on the Paint Home host: Privacy, Terms and Warranty in the footer each return a 200 page titled "… | Paint Home"; no footer link is `#`.
- [ ] The Paint Home privacy page contains `hello@painthome.com.au` and "Enlvn Pty Ltd trading as Paint Home" and does not contain "Paint Group".
- [ ] Details step, laptop and 390 × 780: a bad email shows "Please enter a valid email address, like name@example.com."; a landline shows "That looks like a landline. We need a mobile number to text your code."; the message is on screen without scrolling; no network request is made.
- [ ] The privacy link is visible above the button on the details step at both widths and opens `/privacy`.
- [ ] A Paint Home estimate in the staff builder and at `/e/[token]` shows `hello@painthome.com.au` and 03 8840 9414; a Paint Group estimate is unchanged. Emails sent for a Paint Home estimate still carry the office reply-to.
- [ ] `/work` on Paint Home: no Businesses chip, no job tagged business, title "Real jobs, real prices | Paint Home".
- [ ] An unknown URL on the Paint Home host does not show "Paint Group" in the tab title.
- [ ] Estimates list never shows "N of M" with N greater than M.
- [ ] No "This month at Paint Home" panel on the Paint Home homepage; it still shows on Paint Group.
- [ ] `lib/pricing/**` untouched; golden tests green.
- [ ] e2e as an anonymous customer on the Paint Home host, phone and laptop: `e2e/marketing/painthome.spec.ts` and the wizard gate specs.

---

## Part B: the live chat says "Paint Group" on Paint Home (new)

**Problem (Tom, 25 Nov):** on painthome.com.au the chat names Paint Group. It must say Paint Home everywhere a Paint Home visitor or customer can see it.

### Reference files (read first; I could not open these tonight, so confirm each exists and report any that don't)
- `app/(marketing)/_components/SiteChat.tsx` (the bubble on the marketing site; mounted in `app/(marketing)/layout.tsx`)
- `app/wizard/ChatWidget.tsx` (already takes a `brandName` prop from `WizardApp.tsx`)
- `app/wizard/TalkCard.tsx`, `TalkSheet.tsx`, `MobileContact.tsx`
- `app/(marketing)/_components/Audience.tsx` (`AudienceProvider` / `brandView`: how a client component reads the brand)
- `lib/marketing/brand.ts`, `lib/messaging/brand.ts`
- The chat API routes and any greeting / auto-reply / offline text they send (search `app/api` and `lib/estimates/chat*`, `lib/automations/chatStep.ts`)
- `lib/messaging/config.ts` (default templates that hard-code "Paint Group")

### Work
1. Find every customer-visible chat string that names the brand: the bubble label, the panel header, the greeting, the placeholder, the "we'll reply" / offline line, any automatic first message, and the notification email or text a customer gets about a chat reply.
2. Each one reads the brand from the request (marketing site: `AudienceProvider`) or from the record (wizard state `brand`, `estimates.brand`). No second component; a `brandName` prop or the existing brand helpers.
3. The estimate page chat (`/e/[token]`) and the customer account chat for a Paint Home estimate say Paint Home too.
4. Staff side is unchanged, except the Customer chats panel should show which brand a conversation came from if that is one line of work. If it isn't, flag it and leave it.

### Acceptance
- [ ] On the Paint Home host, opening the chat on the homepage, `/work`, a legal page and inside the wizard shows no "Paint Group" anywhere in the chat UI or its first automatic message.
- [ ] A chat started from a Paint Home estimate page says Paint Home; the same on a Paint Group estimate says Paint Group.
- [ ] The email or text a Paint Home customer gets when staff reply names Paint Home.
- [ ] A unit or e2e test asserts the chat's rendered text on the Paint Home host contains "Paint Home" and not "Paint Group".
- [ ] Paint Group's chat is unchanged (existing specs green).

---

## Part C: live wording (Tom does this, or approves you doing it)

The Paint Home homepage words live in the database (Settings → Paint Home website), so the code edits to `painthome.ts` do not change the live site. These are the approved replacements:

| Field | Now | Change to |
|---|---|---|
| Hero lead | "…We confirm it on one short call. No site visit, no waiting." | "…We confirm it on one short call. Most jobs need no site visit." |
| How it works, step 1 | "…Your price appears on screen in about ten minutes." | "…A guide range appears in a couple of minutes; the full price takes about ten." |
| Promise, row 2 sub | "One short call. After that, the number doesn't change." | "One short call. Your price is then confirmed in writing." |
| Painters lead | "Our own painters. Qualified, insured, and used to working in occupied homes. …" | "Our trusted network of painters. Quality-checked, insured, and used to working in occupied homes. …" |
| FAQ, "Who does the painting?" | "Our own painters, who are quality-checked…" | "Painters from our trusted network, who are quality-checked…" |
| Meta description | "…No site visit, no waiting." | "…Most jobs need no site visit." |

If you ship these as a data migration instead, the SQL goes in the PR body; do not run it.

---

## Flagged for Tom ⚑ (do not decide these)

1. **Privacy policy wording** is a rewording of Paint Group's and has not been legally reviewed.
2. **Terms page** shows the Settings → Terms & conditions text with the trading name swapped. If that text reads wrongly for Paint Home, Tom edits it in Settings.
3. **Meta pixel:** set `NEXT_PUBLIC_META_PIXEL_ID_PAINTHOME` in Vercel. It loads on the success pages only, after "Allow analytics".
4. **Range floor:** two test estimates showed ranges of about ±5% and ±7%. The code floors at the Settings → Tiers tight band; check that value is 8.
5. **Wizard defaults** (House / 3 bedrooms on a brand for apartments and units): not changed. It touches how rooms are seeded; needs its own small session with e2e.
6. **Painter quotes:** Adi R's quote names Paint Group and Saul G's uses doubled apostrophes. Both are edited in Settings → Website, by Tom.
7. **`hello@painthome.com.au`:** confirm the mailbox exists and is monitored before launch.

## Out of scope
Pricing · the laptop one-press layout · commercial paths · anything on the Paint Group homepage.

## Deliver
One PR from the worktree's branch: what was reviewed, what you changed beyond Part A and why, test output, any SQL for Tom, and a Vercel preview link. Update the session ledger. Do not merge.
