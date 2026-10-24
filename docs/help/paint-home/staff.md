---
feature: paint-home
role: staff
title: Paint Home — the second shopfront: its words, its cards, and Settings → Brands
summary: Paint Home (painthome.com.au) is the same business, wizard, painters, CRM and invoicing under a second name; its words are edited on the Paint Home tab of Website copy, its three cards are home jobs under the phone-close price with their own featured rank, and Settings → Brands holds each shopfront's domain, phone, legal line and accent colour.
sources: lib/marketing/brand.ts, lib/marketing/audience.ts, lib/marketing/copy/painthome.ts, app/(marketing)/painthome/page.tsx, app/(app)/settings/BrandsSettings.tsx, app/(app)/settings/SiteCopyEditor.tsx, app/(app)/settings/showcase/ShowcaseEditor.tsx, lib/showcase/rank.ts
---

## What this is for
Paint Home is a second door into the same business, for homeowners with smaller jobs who want to price it themselves online. Nothing behind the door is new: the estimator wizard, the painters, the CRM, the invoicing and the Supabase project are the ones Paint Group already uses. What is Paint Home's own is the domain, the logo, the words on its homepage and, from Session 3, a brand tag on every lead so you can see which door a customer came through.

This page covers what the office sees of it today: how the site is served, and the Brands folder in Settings.

## Before you start
- The domain `painthome.com.au` (and `www`) must be added to the Vercel project before the public can reach it. Until then the Paint Home homepage is reachable for a preview at `/painthome` on the platform's own address and on a local server.
- Both sites stay out of Google until they are flipped on. Paint Home's switch is its own (`PAINTHOME_INDEXABLE=1` in the Vercel environment), independent of Paint Group's.

## Steps
1. **See the Paint Home homepage.** Open `/painthome` on the site you are logged in to, or painthome.com.au. Same sections as the homes site, under the Paint Home mark, with "powered by Paint Group" in small print beside the logo, Inside / Outside chips in the address box instead of home / business, ten questions in the FAQ (the first is "Who is Paint Home?"), a Paint Home footer with the Enlvn legal line, and no "For business" link or trade lane. Paint Group is named in exactly four places: the nav small print, the line under the reviews, the end of the first FAQ answer, and the footer.
2. **Edit the words.** Settings → Company → **Website copy** → the **Paint Home** tab. The sections are in page order; every field is labelled; the preview on the right is the real Paint Home page. Save, and it is live within a minute. The tone to keep: short statements, plain nouns (price, invoice, guarantee, walk-through), nothing that names businesses, agents or trade.
3. **Pick the three cards.** Settings → Showcase jobs → a job → **Featured on the homepage** → the **Paint Home** rank, 1 to 3. Only home jobs whose top price is at or under the phone-close ceiling (Settings → `wizard_policy`, remote confirmation cap, $12,000 by default) can appear; a ranked job over that price is simply skipped, and gaps are filled with the newest qualifying home jobs.
4. **Settings → Company → Brands.** Two cards, Paint Group and Paint Home. Each has four fields: domain, phone number, legal line and accent colour. A blank field uses the default shown as the placeholder, so you only type what differs.
5. **Change a phone number.** Type it as it should read on the site (digits and spaces). The `tel:` link is worked out from it. Save, and the line under the fields shows the number and link now in use. The websites pick it up within a minute.
6. **Change the accent colour.** A six-digit hex, like `#17F9F1`. On Paint Home this is the logo cyan used on the address field border, the selected chip, the focus ring and small highlights; it never fills a whole section.
7. **Logos.** They are not edited here. Paint Group's is Company details → logo 1. Paint Home's is the supplied vector mark, drawn inline on every page, so there is nothing to upload.

## What the colours and labels mean
- **Accent in use** — the hex, the phone link and the address that the site is rendering right now, after your save.
- **Saved** (green) — the row is written and the public pages have been told to refresh.
- A red line names the field that would not save and why (a malformed hostname or colour).

## If something goes wrong
- **A Paint Home card I ranked is not showing.** Its top price is over the phone-close ceiling, or it is a business job, or it has no price range. Only priced home jobs at or under the ceiling qualify.
- **The homes site changed when I edited Paint Home.** It should not. Each card writes only its own brand; if you see otherwise, note which field and report it.
- **The number did not change on the site.** The public pages refresh within a minute. Check the Brands folder shows your value saved, then reload the site with a fresh URL.

## Related
- `docs/help/estimator/staff.md` — the online estimate queue the Paint Home wizard feeds.
- `docs/briefs/paint-home.md` — the build brief and its open decisions.
