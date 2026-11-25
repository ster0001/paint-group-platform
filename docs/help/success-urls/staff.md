---
feature: success-urls
role: staff
title: Count paid-marketing conversions with the success pages
summary: Every success moment — details given, a range seen, a visit or call asked for, a call tap, a message, the estimate saved, the quote range settled, sent to the estimator, fixed online, accepted, a deposit paid — loads its own /thanks/… page, so Google Ads and Meta can count it by URL.
---

## What this is for
Your ad platforms count a conversion when a page with a known address loads. Each moment a customer succeeds has its own address under `/thanks/`, on both Paint Group and Paint Home. Give these to whoever runs your Google Ads or Meta ads.

## Before you start
- The ad tags load only on these pages, and only for a visitor who pressed **Allow analytics** on the cookie sheet, the same rule as Clarity. Without that, our own events still record every moment.
- The tag ids are set in Vercel (Project → Settings → Environment Variables), then the site is redeployed. Leave a box unset to load nothing:
  - `NEXT_PUBLIC_GOOGLE_TAG_ID`: the Google tag (`AW-…` for Google Ads, or `G-…` for Analytics)
  - `NEXT_PUBLIC_META_PIXEL_ID`: the Meta pixel
  - `NEXT_PUBLIC_GOOGLE_TAG_ID_PAINTHOME` and `NEXT_PUBLIC_META_PIXEL_ID_PAINTHOME`: Paint Home's own
- A Tag Manager container id (`GTM-…`) is not a Google tag. Paint Home's container (`GTM-MRW23TH`) loads on every Paint Home page by itself, so a `GTM-…` id typed into a Google tag box is left alone rather than loaded twice.

## Paint Home: counting in Tag Manager
Each success page tells Paint Home's Tag Manager container which moment it was. It sends one event called `pg_success`, carrying the moment's name in `success_moment` (for example `lead`, `visit`, `call-tap`, `accepted`). Set up a conversion in the container like this:
1. Variables → New → **Data Layer Variable**, name `success_moment`.
2. Triggers → New → **Custom Event**, event name `pg_success`. Fire on "Some custom events" where `success_moment` equals `lead` (one trigger per moment you bid on).
3. Tags → New → your Google Ads conversion or Meta tag, fired by that trigger. Publish the container.

The event is sent only after the visitor presses **Allow analytics**, and once per moment (most moments count behind the page). A "Page View" trigger on Page URL contains `/thanks/lead?` also works, but the custom event is clearer and never confuses `/thanks/call` with `/thanks/call-tap`.

## The pages
| Moment | Address | What the customer sees |
|---|---|---|
| Saw their price range | `/thanks/range` | Nothing. It is counted behind their price, and they stay on it |
| Booked a visit, or asked for a visit time | `/thanks/visit` | Nothing (counted behind the page) |
| Asked us to call | `/thanks/call` | Nothing (counted behind the page) |
| Tapped our phone number | `/thanks/call-tap` | On the website, a short "calling us" page after the call opens, then back. In the wizard and on estimates, nothing |
| Sent a message or email | `/thanks/message` | Nothing (counted behind the page; the estimate chat counts the first message) |
| Accepted an estimate | `/thanks/accepted` | Nothing. They stay on their signed estimate, so they can download it |
| Paid the deposit | `/thanks/deposit-paid` | A short thank-you on the way back from the card payment, then their invoice |
| Gave their details and proved their mobile (a lead) | `/thanks/lead` | Nothing (counted behind the page) |
| Saved the estimate for later (Keep this estimate, Save and come back later) | `/thanks/saved` | Nothing (counted behind the page) |
| Settled their quote range (the end of the quote stage) | `/thanks/quote` | Nothing (counted behind the page) |
| Sent the estimate to their estimator (Finalise, a commercial brief) | `/thanks/sent` | Nothing (counted behind the page) |
| Fixed their price online | `/thanks/fixed` | Nothing (counted behind the page) |

"Counted behind the page" means the success page loads invisibly in the same browser tab. Ad platforms count it exactly as if the customer had opened it. We do it that way wherever leaving the page would lose what's on screen, such as their price or the visit they just booked.

## What the colours and labels mean
The thank-you page shows the brand name, one line and a **Back** button. It returns on its own after about two seconds.

## If something goes wrong
- **No conversions in Google Ads.** Check the tag id is set in Vercel and the site was redeployed after. Then open a success page in a private window, press **Allow analytics**, and use Google's Tag Assistant to see the tag load.
- **Tag Manager shows no `pg_success`.** Open Tag Assistant's preview on painthome.com.au, press **Allow analytics**, and trigger a success (or open `/thanks/lead?bg=1` in that preview session). The event appears in the preview's timeline. Publishing the container is a separate step in Tag Manager.
- **Counts look low.** Visitors who chose **Only what's needed** load no ad tags, by design. Our own events still record them.

## Related
- `automations/staff`
