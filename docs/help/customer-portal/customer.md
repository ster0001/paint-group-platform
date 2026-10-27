---
feature: customer-portal
role: customer
title: Your account — Home, Payments, Messages and My colours on a phone
summary: What each tab of your Paint Group account shows and how to use it — the grouped estimate list and address chips on Home, the three numbers and PDF buttons on Payments, the message threads with their unread badge, and your colours listed by colour with a By area view.
sources: app/account/(portal)/page.tsx, app/account/(portal)/money/page.tsx, app/account/(portal)/messages/page.tsx, app/account/(portal)/messages/[estimateId]/page.tsx, app/account/(portal)/colours/page.tsx, app/account/(portal)/profile/page.tsx, lib/portal/homeList.ts, lib/portal/money.ts, lib/portal/messages.ts, lib/portal/colours.ts
---

## What this is for
Your account is the one place for everything about your painting: the estimates you are shaping or have been sent, the job as it happens, what you have paid and what is owing, your conversations with us, and the colours on your walls. It is light, it works the same on a phone and a computer, and the five tabs along the bottom (down the side on a computer) are **Home**, **My project**, **My colours**, **Payments** and **Messages**. The logo at the top left takes you Home; the phone icon beside it rings us; the circle with your initial opens **My profile**.

## Before you start
- Sign in with the link or code we email you — there is no password (see *Sign in to your account*).
- The pages fill in as things happen. Before your first estimate, Home simply offers to get you a price.

## Steps
1. **Home** opens with a headline that matches where your job is up to — *ready for your look around*, *underway*, *finished* — and one big button for the next thing to do.
2. With more than one address, the chips under the headline filter the page: **Everything**, then your four most recent addresses, then **More (n)** for the rest. One address with several estimates is one chip with a count, e.g. **13 Leamington Cres · 4**.
3. Your estimates sit under three headings: **Needs you** (ready for you to open, keep shaping, or not yet submitted), **With us** (we are checking the details — you will hear from us within one business day) and **Done** (accepted, complete, declined; tap **Done** to open the list). Every card shows the address, a chip, one line saying what happens next, and when it was last updated. Tap anywhere on a card to open it.
4. **Get an estimate for another property** starts a new estimate from the address step. **Add a property (no estimate yet)** just registers an address.
5. **Payments** lists each project with **Total**, **Paid** and **Remaining**, and a chip: **Nothing owing**, **Due 4 Nov** or **Overdue**. Under it, one row per invoice: its number, kind and date, the amount, the state, and **Invoice PDF** / **Receipt PDF** buttons. An unpaid invoice has a **Pay now · due …** button that opens the invoice with its bank details and card option.
6. **Messages** lists the conversations that have something in them, newest first, with a cyan number for replies you have not read yet. **Start a conversation about…** opens a thread for an estimate with no messages. Inside a thread the address and its chip are at the top, with **Open the estimate** and **Ask the assistant**; each staff reply carries the initial of who wrote it; the message box stays at the bottom of the screen while you scroll.
7. **My colours** lists each property's colours **by colour**: the colour name, then brand · product · finish · coats, the manufacturer code when there is one, and which surfaces in which rooms. **By area** switches to the room-by-room list. **Download PDF** and **Need touch-up paint?** sit under the property heading; with more than one property, tap a heading to open it.
8. **My profile** holds your name and phone, the **Notifications & alerts** card (tap anywhere on it), a password if you want one, and **Sign out** at the bottom (also at the bottom of Home).

## What the colours and labels mean
- **Ready for you** (blue) — an estimate waiting for you to open.
- **Keep shaping** / **Not yet submitted** / **Being checked** (amber) — something is in progress; the line under the address says whose move it is.
- **Accepted** / **Complete** / **Paid** / **Nothing owing** (green) — done, or settled.
- **Due 4 Nov** (amber) and **Overdue** (red) — a payment is outstanding; the date is when it is due.
- A cyan number on a message row — replies you have not opened yet. It disappears when you open the thread.

## If something goes wrong
- **An address appears twice.** Identical addresses are shown once with a count; if two spellings differ, both show. Ring us and we will tidy the record.
- **The number on Messages does not go down.** Open the thread itself — reading the list does not mark replies as read.
- **A paid invoice still shows Pay now.** Ring us on the number at the top of the page; we will check the payment against the invoice.
- Anything else: the phone icon at the top of every page rings a person.

## Related
- logins/customer — signing in with the emailed link or code.
- work-orders/customer — *My project*, the job day by day.
- invoicing/customer — paying an invoice.
- warranty/customer — your warranty card and documents.
