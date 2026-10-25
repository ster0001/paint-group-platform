---
feature: paint-home
role: staff
title: Paint Home — the second shopfront: its words, its cards, and Settings → Brands
summary: Paint Home (painthome.com.au) is the same business, wizard, painters, CRM and invoicing under a second name; its words are edited on the Paint Home tab of Website copy, its three cards are home jobs under the phone-close price with their own featured rank, and Settings → Brands holds each shopfront's domain, phone, legal line and accent colour.
sources: lib/wizard/publicFlag.ts, app/(app)/settings/OnlineEstimatesSettings.tsx, lib/wizard/policy.ts, lib/brand/filter.ts, app/components/BrandPill.tsx, lib/messaging/brand.ts, lib/marketing/brand.ts, lib/marketing/audience.ts, lib/marketing/copy/painthome.ts, app/(marketing)/painthome/page.tsx, app/(app)/settings/BrandsSettings.tsx, app/(app)/settings/SiteCopyEditor.tsx, app/(app)/settings/showcase/ShowcaseEditor.tsx, lib/showcase/rank.ts, lib/wizard/brand.ts, app/wizard/Reveal.tsx, app/api/wizard/submit/route.ts
---

## What this is for
Paint Home is a second door into the same business, for homeowners with smaller jobs who want to price it themselves online. Nothing behind the door is new: the estimator wizard, the painters, the CRM, the invoicing and the Supabase project are the ones Paint Group already uses. What is Paint Home's own is the domain, the logo, the words on its homepage and, from Session 3, a brand tag on every lead so you can see which door a customer came through.

This page covers what the office sees of it today: how the site is served, and the Brands folder in Settings.

## Before you start
- The domain `painthome.com.au` (and `www`) must be added to the Vercel project before the public can reach it. Until then the Paint Home homepage is reachable for a preview at `/painthome` on the platform's own address and on a local server.
- Both sites stay out of Google until they are flipped on. Paint Home's switch is its own (`PAINTHOME_INDEXABLE=1` in the Vercel environment), independent of Paint Group's.

## Steps
1. **See the Paint Home homepage.** Open `/painthome` on the site you are logged in to, or painthome.com.au. Same sections as the homes site, under the Paint Home mark, Inside / Outside chips in the address box instead of home / business, ten questions in the FAQ (the first is "Who is Paint Home?"), a Paint Home footer with the Enlvn legal line, and no "For business" link or trade lane. Paint Group is named in exactly three places: the line under the reviews, the end of the first FAQ answer, and the footer.
2. **Edit the words.** Settings → Company → **Website copy** → the **Paint Home** tab. The sections are in page order; every field is labelled; the preview on the right is the real Paint Home page. Save, and it is live within a minute. The tone to keep: short statements, plain nouns (price, invoice, guarantee, walk-through), nothing that names businesses, agents or trade.
3. **Pick the three cards.** Settings → Showcase jobs → a job → **Featured on the homepage** → the **Paint Home** rank, 1 to 3. Only home jobs whose top price is at or under the phone-close ceiling (Settings → `wizard_policy`, remote confirmation cap, $12,000 by default) can appear; a ranked job over that price is simply skipped, and gaps are filled with the newest qualifying home jobs.
4. **Settings → Company → Brands.** Two cards, Paint Group and Paint Home. Each has four fields: domain, phone number, legal line and accent colour. A blank field uses the default shown as the placeholder, so you only type what differs.
5. **Change a phone number.** Type it as it should read on the site (digits and spaces). The `tel:` link is worked out from it. Save, and the line under the fields shows the number and link now in use. The websites pick it up within a minute.
6. **Change the accent colour.** A six-digit hex, like `#17F9F1`. On Paint Home this is the logo cyan used on the address field border, the selected chip, the focus ring and small highlights; it never fills a whole section.
7. **Logos.** They are not edited here. Paint Group's is Company details → logo 1. Paint Home's is the supplied vector mark, drawn inline on every page, so there is nothing to upload.

## What the customer receives
A Paint Home estimate page (`/e/…`) and a Paint Home invoice (`/i/…`, and the PDF, which is a print of that page) carry the **Paint Home mark**, not the Paint Group wordmark: the dark estimate view shows the slate mark, the white printable card and the invoice show the ink-on-light mark. Emails already carried it. Nothing is rewritten on a sent estimate; the mark is laid over at render from the estimate's or invoice's brand.

## The address from the homepage
Typing an address on painthome.com.au (or paintgroup.com.au) and pressing **See my price** now carries the suburb and postcode into the wizard: a picked suggestion travels with its parts, and words typed without a pick are looked up once when the wizard opens and the top match is used. The "We couldn't look that address up" line appears only when the lookup finds nothing, and the suburb and postcode fields are there for that case.

## The wizard on Paint Home
**Paint Home's wizard is live on its own switch.** Settings → Online estimates has two switches: the first is Paint Group's (paintgroup.com.au stays on its holding page until you turn it on); the second, **Paint Home**, is on by default, so an address typed on painthome.com.au opens the estimator straight away. Turn the Paint Home switch off and painthome.com.au shows the same holding page and call-me form as Paint Group's. Staff and logged-in customers always get through on either site.

A Paint Home visitor uses the same estimator, served under painthome.com.au, with two doors shut: there is no commercial property kind and no "inside and outside" job (two separate estimates instead). Their address and Inside / Outside choice arrive pre-answered. At the price step Paint Home only takes jobs a person can confirm on the phone: when the top of the range is at or under the phone-close ceiling (Settings → `wizard_policy`, remote confirmation cap) and nothing needs seeing, the one door is **Confirm my price. Book a call**, which files a call request on CRM Today the same way "Speak with us" does. Only interior and exterior home jobs are priced on Paint Home — there is no commercial kind to choose. **An outside job's range reaches 5% further under its price** than an inside job's (Settings → `wizard_policy`, `exteriorUnderPct`, 5 by default): the top of the range, the central price, the phone-close ceiling and the caps are exactly as before; only the low figure the customer sees is lower, on both sites, so an exterior price has room to come in 5% cheaper when it needs to. Over the ceiling, or when the job needs a person on site, the customer sees a hand-off ("This one's bigger than we can price from your phone"), is told the Paint Group team looks after larger jobs, and books a site visit; every answer is kept on the estimate.

Every Paint Home session, estimate, work order and invoice carries `brand = painthome`. The pill and filter that show it in the lists come in Session 5; until then it is in the database and on the estimate row.

## What a Paint Home customer receives
Every customer-facing message is the same template with the brand laid over it: the estimate email and text, the invoice email and text, the payment receipt, the booking confirmation, the walk-through calendar invite and the welcome all name Paint Home, carry the Paint Home mark, and link to painthome.com.au. The sender stays our verified mailbox with "Paint Home" as the display name. An invoice for a Paint Home job trades as Paint Home with the line *Enlvn Pty Ltd trading as Paint Home*; the ABN, address and bank details are the company's and do not change. The estimate page and the invoice page show the brand of the estimate, whichever address the customer opens them from.

The customer portal is shared: one login sees every job from either door. A customer whose jobs all came through Paint Home sees the Paint Home mark and number in the portal header; a customer with jobs from both doors sees Paint Group's header and a *Paint Home* tag on each Paint Home job.

## Finding Paint Home work in the office
Every staff list carries the same two things. A **Paint Home** pill on a row that came through painthome.com.au (Paint Group rows wear nothing, since that is the default), and a brand filter, **All · Paint Group · Paint Home**, that narrows the list without changing anything else about it:

- **Estimates** — every enquiry wears a pill under its title saying which shopfront it came through: **Paint Home** in the Paint Home slate-and-cyan, **Paint Group** in plain grey (Tom, 25 Oct 2026: both named, so the list reads at a glance). The filter sits at the right of the status tabs and stays with you as you change tab. The Wizard tab has its own Paint Group / Paint Home chips beside Home / Business, and the same pill on each session.
- **CRM → Today** — the pill after the card's title; the filter beside the group chips. The brand is read from the record each card is about.
- **PC Command → Flow** — the pill on the job card; the filter above the river. Counts and alerts are still over every job.
- **Invoicing → Customers** — the pill beside the address on the All jobs table; the filter beside Show paid.
- **Dashboard** — once Paint Home has sessions in the range, *Where estimates go* draws two funnels, Paint Group then Paint Home; *Marketing* gains a **By shopfront** row: sessions started, estimates saved, sent, accepted, calls requested and visits booked, per brand. Page visits and the address-typed and see-price counts join that row when the website events table is wired in at launch.

## Opening Paint Home to search
The order, the 90-second phone walk and the flip are in `docs/testing/paint-home-launch.md`. In short: a second Clarity project (`NEXT_PUBLIC_CLARITY_ID_PAINTHOME`), the Resend sending domain, three ranked cards, then `PAINTHOME_INDEXABLE=1` in Vercel. Each site has its own robots file and sitemap, decided by the address it is opened on; Paint Home's sitemap lists its homepage and job list only, because the job pages belong to Paint Group in search. The dashboard's *By shopfront* row now carries the website's own numbers too: visits, addresses typed and See-my-price taps, per brand.

## What the colours and labels mean
- **Accent in use** — the hex, the phone link and the address that the site is rendering right now, after your save.
- **Saved** (green) — the row is written and the public pages have been told to refresh.
- A red line names the field that would not save and why (a malformed hostname or colour).

## If something goes wrong
- **painthome.com.au shows the holding page.** Settings → Online estimates → the **Paint Home** switch is off. Paint Group's switch does not affect Paint Home.
- **A Paint Home card I ranked is not showing.** Its top price is over the phone-close ceiling, or it is a business job, or it has no price range. Only priced home jobs at or under the ceiling qualify.
- **The homes site changed when I edited Paint Home.** It should not. Each card writes only its own brand; if you see otherwise, note which field and report it.
- **The number did not change on the site.** The public pages refresh within a minute. Check the Brands folder shows your value saved, then reload the site with a fresh URL.

## Related
- `docs/help/estimator/staff.md` — the online estimate queue the Paint Home wizard feeds.
- `docs/briefs/paint-home.md` — the build brief and its open decisions.
