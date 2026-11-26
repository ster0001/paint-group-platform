# Paint Home SEO foundations (Phase 1): /work open to Google, sitemap, old-address redirects, branded 404

Brief: `claude-code-brief-painthome-seo-foundations.md` (26 Nov 2026). No migration. `lib/pricing/**` untouched.

## What changed

1. **`/work` on Paint Home is indexable with its own canonical.** It inherited the marketing layout's noindex and had no canonical. Privacy, Terms and Warranty get a self-referencing canonical. Both come from one module, `lib/marketing/seo.ts`, keyed on the brand; Paint Group pages get nothing from it, so `new.paintgroup.com.au` is unchanged.
2. **Sitemap.** Paint Home lists home, `/work` and the three legal pages. `lastmod` is a real change date or absent (it was today's date on every request).
3. **Old WordPress addresses** redirect for good on the Paint Home host only: `/guarantee` → `/warranty`, `/contact-us` → `/#contact`, `/portfolio*` → `/work`, `/blog*` → `/`, `/referral` → `/`. One table, `lib/marketing/legacyRedirects.ts`; a new address is one row.
4. **404.** One title, "Page not found | Paint Home", Paint Home's nav and footer, links to home and `/work`. The live page carried two titles and the first was "Paint Group Platform".
5. **`<html lang="en-AU">`** on every host.
6. **Structured data.** Paint Home's LocalBusiness gains hours, logo, image, email, price band and a suburb list from its listed jobs; `sameAs` appears once the two profile addresses are entered in Settings → Brands (two new fields). No rating or review markup. `/work`: BreadcrumbList + ItemList. Job pages: BreadcrumbList; the Article names the brand whose site it is.
7. **Images and headings.** Alt text on the hero, painter photos, video stills and every job photo (generated from caption, stage, job and suburb). Job names on `/work` are H2; FAQ questions are H3.

## Not done, on purpose

- **Job pages on Paint Home (brief §1–2).** Ruling P9 stands until Tom rules: they keep the Paint Group canonical, stay noindex and stay out of the Paint Home sitemap. The per-job flag and its migration were not built. So two acceptance lines are open: "every flagged job page is index, follow" and "no page on painthome.com.au has a canonical pointing at another domain".
- **Two reference docs were missing** (`painthome-go-live-check-25nov.md`, `seo-audit-and-deployment-plan.md`). Tom said to build without them (27 Nov).
- **Brand leaks that are data, not code:** Adi R's quote and one Google review name Paint Group. Neither was edited.
- **Rich Results Test** needs the deployed pages; not run.

## For Tom

D2 / P9 · D6 title and H1 (already editable: Settings → Website copy → Paint Home → meta title, hero H1) · D11 `/referral` · the two social addresses · Adi R's quote and the replacement review · the hero photo's description is generic ("A freshly painted Melbourne home, by Paint Home").

## Proof

- Unit: 464 files, 4,538 passed, 2 skipped (`npm test`), including the new `lib/marketing/seo.test.ts`. Golden tests green.
- Lint: `npx eslint --max-warnings 4 .` → 0 errors, 4 warnings (all four were there before).
- e2e on the C1 test stack, 27 Nov: `e2e/marketing/painthome-seo.spec.ts` 16/16 (8 tests × phone 390 × 780 and laptop 1470) and `e2e/marketing/painthome-launch.spec.ts` 2/2. Both are now on the CI list.
- `e2e/marketing/painthome.spec.ts` run alongside: tests 1, 1b, 2 green; **3, 4 and 5 red**. Read from the failures, none comes from this change: 3 = the staff chat dock is open over the Brands Save button (waiting chats left in the test project); 4 = a leftover row already holds `featured_rank_painthome = 1` (unique key 23505); 5 = the copy preview's `src` is `?preview=0`, not `/painthome?…`. Not checked against `main`. That spec is not on the CI list.
- `PAINTHOME_INDEXABLE` is not set on the test stack, so the e2e proves the canonical and that robots follows the switch (noindex there). "index, follow" with the switch on is proven by the unit test and is to be read on the live page after deploy (manual check, step 1).
- Lighthouse (mobile, live site, 26 Nov, before this change): `/` score 58, LCP 3.8 s (the hero photo, already `priority` and preloaded), TBT 2,640 ms of which about 2.8 s of main-thread time is unattributed; `/work/2-bedroom-apartment-malvern-east` score 99, LCP 2.0 s. The 13-second reading did not reproduce. No one-line fix; the blocking time needs its own look.

Manual check: `docs/testing/painthome-seo-foundations-manual.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
