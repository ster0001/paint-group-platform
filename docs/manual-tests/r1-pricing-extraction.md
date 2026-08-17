# Manual test — R1 pricing extraction

**What changed:** the estimate maths moved out of the builder screen into a
shared module. **Nothing about pricing should look different.** This test is
about confirming that — if any number has moved, stop and tell me.

About 10 minutes. Sign in as staff.

## Before you start

Have last week's figures to hand if you have them, or take a screenshot of the
totals panel on a couple of estimates *before* pulling this branch. The whole
point is that they match.

## 1. Existing estimates price identically

1. **Estimates** → open **Whitfield — Armadale interior** → **BUILDER** tab.
2. Check the totals panel on the right reads exactly:
   - Subtotal **$2,940.77**
   - GST (10%) **$294.08**
   - Total **$3,234.85**
   - Deposit **$1,617.43**
   - Total hours **26.69**
   - Sales rate **$110/hr**
   - Contractor **−$1,601.39**
   - Materials cost **−$201.97**
   - Margin **$1,137.41 / 39%**

✅ Every one of those must match to the cent.

3. Open two or three other estimates and compare against your earlier
   screenshots. ✅ Identical.

## 2. Live editing still recalculates

4. In an estimate, open an area and change a wall's **coats** from 2 to 3.
   ✅ The subtotal, hours, contractor figure and margin all move immediately.
5. Change it back. ✅ Everything returns to the original numbers.
6. Change **Level of Finish** from Level 3 to Level 4.
   ✅ Labour and the total rise; **materials cost does not change**.
7. Put it back to Level 3.

## 3. The adjustments still work

8. Set a **discount** of 10%. ✅ Discount line appears, GST recalculates on the
   reduced amount, margin drops by the discount.
9. Switch the discount to a **fixed amount** larger than the job.
   ✅ It caps at the subtotal — the total goes to $0.00, never negative.
10. Clear the discount.
11. Change the **deposit %**. ✅ The deposit figure tracks it.
12. Set an **hourly rate override**. ✅ Labour and totals move; materials don't.
    Clear it afterwards.

## 4. Options and hidden items behave as before

13. Mark an area as an **option**. ✅ It leaves the subtotal.
14. Un-mark it. ✅ It returns to the same figure as before.
15. Mark a surface **hidden from customer**. ✅ The subtotal does **not** change
    — hidden only affects what the customer sees, not the price.

## 5. The customer's copy is unchanged

16. Switch to the **ESTIMATE** tab. ✅ Same document, same total as before.
17. Open the customer's link in a private window. ✅ Matches.

## What to do if something is off

Note the estimate name, which number is wrong, and what it used to be. A single
cent of difference is worth reporting — the automated tests assert every
existing estimate to the cent, so a visible difference means something the tests
don't cover.

## For reference: the automated safety net

`npm test` runs 42 tests, including a **golden test** that reprices every
estimate in the database and asserts it matches what the old code stored. If
that passes, no existing estimate has changed price.

One estimate (Whitfield) carries a documented exception: its stored figure
($3,338.83) is older than the reference prices it was based on, so a fresh
calculation gives $3,234.85. Both the old code and the new code agree on
$3,234.85 today — the difference is age, not a bug. See
`lib/pricing/__fixtures__/golden-overrides.json`.
