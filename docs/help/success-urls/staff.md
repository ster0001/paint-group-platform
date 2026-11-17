---
feature: success-urls
role: staff
title: Count paid-marketing conversions with the success pages
summary: Every success moment — a range seen, a visit or call asked for, a call tap, a message, an estimate accepted, a deposit paid — loads its own /thanks/… page, so Google Ads and Meta can count it by URL.
---

## What this is for
Your ad platforms count a conversion when a page with a known address loads. Each moment a customer succeeds has its own address under `/thanks/`, on both Paint Group and Paint Home. Give these to whoever runs your Google Ads or Meta ads.

## Before you start
- The ad tags load only on these pages, and only for a visitor who pressed **Allow analytics** on the cookie sheet, the same rule as Clarity. Without that, our own events still record every moment.
- The tag ids are set in Vercel (Project → Settings → Environment Variables), then the site is redeployed. Leave a box unset to load nothing:
  - `NEXT_PUBLIC_GOOGLE_TAG_ID`: the Google tag (`AW-…` for Google Ads, or `G-…` for Analytics)
  - `NEXT_PUBLIC_META_PIXEL_ID`: the Meta pixel
  - `NEXT_PUBLIC_GOOGLE_TAG_ID_PAINTHOME` and `NEXT_PUBLIC_META_PIXEL_ID_PAINTHOME`: Paint Home's own

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

"Counted behind the page" means the success page loads invisibly in the same browser tab. Ad platforms count it exactly as if the customer had opened it. We do it that way wherever leaving the page would lose what's on screen, such as their price or the visit they just booked.

## What the colours and labels mean
The thank-you page shows the brand name, one line and a **Back** button. It returns on its own after about two seconds.

## If something goes wrong
- **No conversions in Google Ads.** Check the tag id is set in Vercel and the site was redeployed after. Then open a success page in a private window, press **Allow analytics**, and use Google's Tag Assistant to see the tag load.
- **Counts look low.** Visitors who chose **Only what's needed** load no ad tags, by design. Our own events still record them.

## Related
- `automations/staff`
