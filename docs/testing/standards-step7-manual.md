# What the colour changes — Step 7 — manual test script for Tom

Branch `feat/status-offers-payment-bonus`.

## Before you start
1. Paste `supabase/migrations/20270230000000_status_offers_payment_bonus.sql`. Read-back: status_cols 3, ci_cols 4, fns 10, triggers 3, offer_gate true, draft_terms true, decide_grant true, approvals false, bonus_policies 2, fri_plus_3 2026-10-14.
2. Deploy. Settings → Staff logins → tick **Painter bonus review due** and **Painter dropped to Red** for yourself.

## Offers (PC)
1. PC Command → Schedule: every lane shows its colour in words (GREEN, YELLOW, NEW…). Lanes are in colour order, Green first.
2. A Red painter's lane reads **RED · NO OFFERS**. Try to offer them a job: "This painter is on Red…" refused.
3. Open the painter (Contractors → name) → **Status and bonus**: type what was agreed → **Spoken with — offers allowed**. The offer now goes. The clearance clears itself when their colour next changes.

## Payment terms (Payments → Payables)
1. A Green painter's sign-off invoice shows **Green · 3 business days** and a due date 3 working days after the signed day (weekends and the Booking-rules public holidays skipped).
2. **Hold fast payment** → a reason → the chip reads **Held — reason**, the due date is the normal 7 days, and PC Command has a **Payment hold** card. **Release** puts the fast date back.

## Bonus
1. When a Green painter's fourth clean 16-hour job finalises, PC Command shows **Bonus due: name** and you get the alert. The PC presses **Tell Tom**.
2. On the painter's page the review shows **With Tom** with the amount prefilled ($500 or their last bonus). **Approve** is greyed with "approvals are off" until Settings → `painter_status_rules.bonusApprovalsEnabled` is true. **Decline** works regardless.
3. With the switch on: set the amount, **Approve**. Contractor gets the text with the amount; their Invoicing tab shows **Bonus approved $X — Claim now**; claiming raises a submitted invoice "· bonus" that you approve and pay as usual. Employee: the text says next pay run; the payroll CSV has a `bonus` row with the cents.

## What to tell me
- ⚑10 GST on bonuses and ⚑11 payroll — the switch stays off until you say.
- Whether an Orange painter's PC card should also ring an alert (today: card only; Red alerts).
