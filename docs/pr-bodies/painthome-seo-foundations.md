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

PROOF_PLACEHOLDER

Manual check: `docs/testing/painthome-seo-foundations-manual.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
