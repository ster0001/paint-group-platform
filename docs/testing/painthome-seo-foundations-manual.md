# Paint Home SEO foundations — manual check (after deploy)

About ten minutes, signed out, on painthome.com.au.

1. **`/work` is open to Google.** View source on `https://painthome.com.au/work`. Expect `<meta name="robots" content="index, follow">` and `<link rel="canonical" href="https://painthome.com.au/work">`.
2. **Legal pages.** Same check on `/privacy`, `/terms`, `/warranty`: each canonical is its own address.
3. **Sitemap.** Open `https://painthome.com.au/sitemap.xml`. Expect five addresses: `/`, `/work`, `/privacy`, `/terms`, `/warranty`. No job page (P9 stands). The dates are not all today's.
4. **Old addresses.** Open each: `/guarantee/` lands on Warranty; `/contact-us/` lands at the call line at the foot of the home page; `/portfolio/kitchens/` lands on `/work`; `/blog/` and `/referral/` land on the home page.
5. **404.** Open `https://painthome.com.au/anything-not-real`. The tab reads "Page not found | Paint Home". Paint Home's nav and footer, two buttons: home, and real jobs and prices. No "Paint Group" other than "Powered by Paint Group".
6. **Paint Group is unchanged.** `curl -sI https://new.paintgroup.com.au/ | grep -i x-robots` still shows `noindex, nofollow`.
7. **Rich results.** Run Google's Rich Results Test on `/`, `/work` and one job page. Expect no errors. (This was not run from the build session: it needs the deployed pages.)
8. **Settings → Company → Brands → Paint Home.** Two new fields, Facebook page and Instagram profile. Enter the two addresses and save; within a minute the home page's LocalBusiness block lists them under `sameAs`.
9. **Search Console.** Submit the sitemap and request indexing of `/` and `/work`.

Still Tom's to decide: P9 / D2 (job pages), D6 (title and H1 wording, editable now in Settings → Website copy → Paint Home), D11 (`/referral`), the two social addresses, Adi R's quote and the one review that name Paint Group.
