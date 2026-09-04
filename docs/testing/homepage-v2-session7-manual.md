# Homepage v2 — session 7 (analytics, consent, the test subdomain) · Tom's steps

Three things are yours to do; everything else is in the code.

## 1. Clarity project id

1. clarity.microsoft.com → New project → name "Paint Group website", site
   `new.paintgroup.com.au`. Copy the **Project ID** (a short string).
2. Vercel → the project → Settings → Environment Variables → add
   `NEXT_PUBLIC_CLARITY_ID` = that id (Production + Preview). Redeploy.

Until this is set, Clarity simply doesn't load — the site works, the consent
sheet still asks, and our own events table still fills.

## 2. The subdomain (Vercel alias — dashboard, not code)

1. Vercel → the project → Settings → Domains → Add `new.paintgroup.com.au`.
2. Vercel shows a CNAME target (`cname.vercel-dns.com`). In your DNS host,
   add `new` → CNAME → that target.
3. Wait for the tick in Vercel. Open https://new.paintgroup.com.au/ — the
   new homepage. The old WordPress site on the apex is untouched.

Every page answers `X-Robots-Tag: noindex, nofollow` and carries the robots
meta while `SITE_INDEXABLE` is unset. **The flip** (later, brief §8): set
`SITE_INDEXABLE=1` in Vercel env, remove the page-level `robots` line in
`app/(marketing)/layout.tsx`, point the apex at the project, and have the
36 suburb-page redirects ready (⚑9.8 — flip blocked until then).

## 3. Check it on your phone (production)

1. First visit: a bottom sheet — "Only what's needed" (the plain one, has the
   focus) and "Allow analytics" (cyan). Tap either; it goes away and stays
   away for 12 months. "Cookie settings" at the bottom of the footer brings
   it back.
2. In Clarity, after "Allow analytics" and a minute of clicking around:
   Recordings show the session; **Filters → Custom tags** list the event
   names (nav_cta, see_price, promise_0 …). Your address is never in a tag.
3. In the CRM timeline nothing shows yet — the events sit in the same
   `crm_events` table as `web_event` rows with an anonymous visitor id, ready
   for lead-source attribution when a draft is later linked to a person.

## Compare-the-two-sites numbers (§8)

Old site vs new, same period: visitors, `address_typed` (old: contact-form
starts), `see_price` (old: form submits), estimates saved, `call_tap`.
The new-site side comes straight from `crm_events where type = 'web_event'`.
