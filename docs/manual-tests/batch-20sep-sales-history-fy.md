# Manual test — recorded sales months, financial year, payables (20 Sep 2026, second batch)

After migration 20270186 is pasted and read back, and the branch is deployed.

## 1. Recorded sales (Settings → Dashboard → Recorded sales)
1. The card lists the months already recorded (Sep 2025 → Jul 2026 from the PR's SQL). Add **August 2026** from PaintScout's Total Sold (inc GST) and Save. The row appears.
2. Home → Month for September: Sales $ is the platform's signed jobs only (September has no recorded row).
3. Home → Custom → 1–31 July 2026 → Apply: Sales $ reads **$244,632** (PaintScout's July), the rows list shows one line "PaintScout · July 2026 (recorded)", Contracts signed shows $222,393 (÷ 1.1).
4. Custom 1–15 July: Sales $ is about half (15 of 31 days), the row says "48% of the month".
5. Remove a recorded month: that month falls back to the imported estimates.

## 2. Financial year
1. Home → **Financial year** chip: the line under your name reads "1 July – <today>", compared with the same stretch of last FY.
2. The target card's bars run July → June with the months ahead showing target only; "FY 2026/27 so far: $X of $Y".
3. Settings → Dashboard → Monthly sales target: Financial year defaults to FY 2026/27; pick January, type a figure, Save — the row reads "January 2027".

## 3. Payables and contractor invoice colours
1. Home (finance/owner) → Invoicing → **Materials to match**: the count equals the rows behind it and the same tile on /invoicing.
2. /invoicing → contractor invoices: awaiting approval amber, approved and unpaid clay ("outstanding for payment"), overdue stronger with "overdue N d", paid emerald, rejected grey.
