# Paint Home — launch checklist (brief §7, §8.6)

The site is live at painthome.com.au and hidden from search. This is the order to open it, and the 90-second walk that says it is right.

## Before the flip (Tom)

1. **Clarity.** Create a second Clarity project, "Paint Home". In Vercel → Settings → Environment Variables add `NEXT_PUBLIC_CLARITY_ID_PAINTHOME` = its id (Production + Preview). Redeploy. Paint Group's `NEXT_PUBLIC_CLARITY_ID` stays as it is; each site loads only its own project, and only after "Allow analytics".
2. **Resend.** Add painthome.com.au as a sending domain in Resend and verify it. Until then Paint Home emails come from the Paint Group mailbox with "Paint Home" as the display name, which is deliberate and works.
3. **Settings → Brands.** Check the Paint Home phone number (P10: Paint Group's 1300 for launch) and the legal line.
4. **Settings → Showcase jobs.** Give three home jobs priced at or under $12,000 the Paint Home rank 1–3 (P4: real anonymised jobs).
5. **Settings → Website copy → Paint Home.** Read the ten FAQs once more as a customer would.

## The 90-second walk (on your phone)

1. painthome.com.au → the Paint Home mark, "powered by Paint Group" in small print, *Your qualified local painters.*
2. Tap **Outside**. The chip lights.
3. Three job cards, every price at or under $12,000, none commercial.
4. Scroll to the FAQ: ten questions, the first *Who is Paint Home?*, the fifth *My job is larger than a few rooms*.
5. Type an address → **See my price** → the wizard on painthome.com.au with the Paint Home mark, Outside pre-selected, no Both, no Commercial.
6. Tap through to the range → **Confirm my price. Book a call** → request the call.
7. Estimates: the row wears the Paint Home pill. CRM → Today: the call item.
8. paintgroup.com.au: nothing moved. Both and Commercial are still there; the range still offers a site visit.

## The flip

- Vercel → Settings → Environment Variables: `PAINTHOME_INDEXABLE` = `1` (Production). Redeploy.
- Check: `curl -sI https://painthome.com.au/ | grep -i x-robots` shows `all`; `https://painthome.com.au/robots.txt` allows `/` and names `https://painthome.com.au/sitemap.xml`; the sitemap lists `/` and `/work` only (the job pages' canonical is Paint Group's, P9).
- Paint Group's own flip (`SITE_INDEXABLE=1`) is separate and unchanged.
- Google Search Console: add the painthome.com.au property, submit the sitemap, confirm the LocalBusiness with `parentOrganization` → Paint Group in the Rich Results test.

## The side-by-side test (brief §7)

Dashboard → Marketing → **By shopfront**: visits, address typed, see price, started, saved, sent, accepted, calls requested, visits booked, per brand, over the range. *Where estimates go* draws a funnel per shopfront once Paint Home has sessions. Paint Home traffic comes from its own ads and social; nothing is redirected from Paint Group. A bug found in the Paint Home wizard is fixed once, in the shared wizard.

## Open decisions (brief §9) still assumed

P1 no self-sign (one call stays) · P3 no link from Paint Group's site yet · P6 two estimates, no "both" · P7 same ceiling as Paint Group · P8 portal header only · P9 Paint Group owns the job pages in search · P10 same number · P11 the wizard behind "Bigger jobs".
