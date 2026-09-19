# P&L vs Platform Settings — reconciliation

**Source documents**
- `2026.03.31_Profit__Loss_MultiPeriod_1.pdf` — Enlvn Pty Ltd t/a Paint Home, Jul 2025 – Mar 2026 (9 months), monthly columns
- `2026.03.31_Profit__Loss_Cash.pdf` — same entity, Jan – Mar 2026, cash basis

**Basis chosen:** full 9 months, Jul 2025 – Mar 2026 (274 days = 39.14 weeks)
**Prepared:** 21 Aug 2026

---

## 0. What I could not check

I do not have the three values currently saved on the Settings page. Folder access to
`paint-group-platform` was refused by the sandbox, so the repo could not be read.

**To close this out:** click **Add folder** in the Claude desktop app and point it at the
`paint-group-platform` checkout, or paste the three numbers. Everything below is the
P&L-derived figure each Settings field *should* hold. Compare and report the deltas.

---

## 1. The three numbers

| Settings field | P&L-derived value (9 mo, ex GST) | Also expressed as |
|---|---|---|
| **Weekly marketing spend** | **$1,741 / week** | $7,570 / month · $90,841 / year · 4.63% of sales |
| **Fixed overhead** | **$5,847 / week** | $25,431 / month · $305,168 / year |
| **Overhead per billable hour** | **$20.97 / hour** | on 14,162 billable hours (362 hrs/week) |

All three are **ex GST**, because the P&L is prepared ex GST and input tax credits are
recoverable. ⚑ **Decision 1** below.

---

## 2. How each was built

### 2.1 Weekly marketing spend — $1,741/wk

Advertising, 9 months: **$68,131.03** ÷ 39.14 weeks.

Adjacent lines deliberately excluded:

| Line | 9 mo total | Included? | Why |
|---|---|---|---|
| Advertising | $68,131.03 | **Yes** | This is the spend |
| Website Expense | $536.11 | No | Maintenance, not acquisition. Adding it gives $1,754/wk |
| Subscriptions and Membership | $22,516.73 | No | Mixed bag — see below |

⚑ **Decision 2 — the subscriptions line needs splitting.** $22,516.73 over 9 months
($2,502/mo) is a large number sitting in one bucket. If it contains lead-generation
platforms (Hipages, Oneflare, Google Ads management retainers) those are marketing, not
software. Splitting the correct portion out moves weekly marketing spend anywhere up to
**$2,316/wk**. Until it is split, the $1,741 figure is a floor, not a measurement.

### 2.2 Fixed overhead — $5,847/wk

Total Expenses of $335,255.79 was decomposed into four buckets. The decomposition
reconciles to the cent.

| Bucket | 9 mo | Treatment |
|---|---|---|
| **Fixed overhead** | **$228,876.35** | The Settings figure |
| Marketing (Advertising) | $68,131.03 | Its own Settings field — must not be double-counted |
| Job-related costs | $13,805.03 | Belongs in cost of sale, not overhead |
| Non-recurring | $24,443.38 | Excluded — will not repeat |
| **Total** | **$335,255.79** | ✓ ties to the P&L |

**Job-related costs excluded from overhead** — Equipment Hire $12,661.55, Client Exp
$929.85, Tip Fees $213.63. Equipment hire in particular is scaffold and lifts, which the
estimating model already treats as a customer pass-through. Leaving it in overhead charges
it to every job a second time.

**Non-recurring excluded** — Consulting Fees Kay&Burton $10,754.13, Fine & Penalties
$7,013.10, Migration–Saul $4,798.26, Legal $1,200.00, ATO Interest $348.89, Filing Fees
$329.00.

⚑ **Decision 3 — Fine & Penalties $7,013.10 and ATO Interest $348.89** are all in Jan–Mar
and are climbing ($1,109 → $1,734 → $4,170). I have treated them as non-recurring. If this
is an ongoing compliance issue rather than a one-off, they are overhead and the weekly
figure rises by $179.

**Three defensible definitions** — pick one and label the Settings field accordingly:

| Definition | Per week | Per month |
|---|---|---|
| A. Recurring fixed only *(recommended)* | $5,847 | $25,431 |
| B. Fixed + non-recurring | $6,472 | $28,147 |
| C. All expenses less marketing | $6,824 | $29,681 |

### 2.3 Overhead per billable hour — $20.97/hr

```
billable hours   = subcontractor cost ÷ $60/hr
                 = ($802,670.52 + $47,063.70) ÷ 60
                 = 14,162 hours over 9 months  (362/week, 1,574/month)

overhead per hr  = (fixed overhead + marketing) ÷ billable hours
                 = ($228,876.35 + $68,131.03) ÷ 14,162
                 = $20.97
```

**Sanity check on the hours figure:** $1,472,813.84 of sales ÷ 14,162 hours = **$104.00
revenue per billable hour**. That sits exactly where it should against the $85 interior /
$100 exterior card plus materials margin, prep and pass-throughs — and it matches the
"~$110/hr achieved" note already in the pricing work. The hours number is sound.

⚑ **Decision 4 — does the Settings field include marketing or not?** Both readings are
defensible, and they are $4.81 apart:

| What the field means | $/hr |
|---|---|
| Fixed overhead only | $16.16 |
| **Fixed overhead + marketing** *(recommended)* | **$20.97** |
| Fixed + marketing + non-recurring | $22.70 |
| Every expense line | $23.67 |

Recommend **fixed + marketing**, because the number's job is to answer "what must an hour
earn before it makes money", and marketing is a real cost of winning that hour.

---

## 3. Internal consistency test for the Settings page

The three fields are **not independent**. Whichever values are saved must satisfy:

```
overhead_per_billable_hour ≈ (fixed_overhead_weekly + weekly_marketing_spend) ÷ billable_hours_per_week
                           = ($5,847 + $1,741) ÷ 362
                           = $20.96  ✓
```

⚑ **Decision 5 — this should be enforced, not typed.** If all three are free-text fields,
they will drift apart the first time one is updated. Recommend: Tom enters weekly marketing
spend, fixed overhead and target billable hours per week; **overhead per billable hour is
computed and read-only**, with the arithmetic shown underneath. Build item.

---

## 4. Findings that matter more than the reconciliation

### 4.1 Interior work at $85/hr does not clear its overhead by much

| | Interior $85/hr | Exterior $100/hr |
|---|---|---|
| Charge-out | $85.00 | $100.00 |
| Less contractor | ($60.00) | ($60.00) |
| Labour margin | $25.00 | $40.00 |
| Less overhead recovery | ($20.97) | ($20.97) |
| **Net per hour** | **$4.03** | **$19.03** |

Interior labour returns **$4.03 an hour** after overhead. The business is profitable
because of materials margin, prep lines, sundries and pass-throughs — not because of the
interior labour rate. Whole-of-business it works out at $30.83 gross profit per hour
against $23.67 of all-in overhead, leaving $7.16/hr, which is the 6.88% net margin.

This is not a Settings bug, it is a pricing finding. ⚑ **Decision 6:** the interior rate,
the contractor rate, or both need reviewing. A $5/hr move on interior charge-out is worth
roughly $70k a year at current volume.

### 4.2 Overhead per hour has more than doubled inside the period

| Quarter | Billable hrs | Overhead/hr (all-in) | Advertising/wk |
|---|---|---|---|
| Jul–Sep 2025 | 5,040 | $12.70 | $1,341 |
| Oct–Dec 2025 | 4,519 | $28.65 | $1,498 |
| Jan–Mar 2026 | 4,603 | **$30.80** | **$2,397** |

Wages went $5,560/mo → $17,430/mo. Training went from nil to $2,580/mo standing. Advertising
went $6,466/mo → $9,976/mo. **The 9-month averages you asked for describe a smaller business
than the one running today.** On a Jan–Mar basis the same three fields would read roughly
**$2,397/wk marketing**, **$7,622/wk fixed overhead**, **$28.22/hr overhead**.

Meanwhile hours sold fell 9% (5,040 → 4,603) while sales rose. Fewer hours, more revenue per
hour — consistent with a mix shift, and it means overhead is being recovered over a shrinking
hour base.

⚑ **Decision 7:** use the 9-month figures as instructed, but diarise a review at 30 June.
If the Settings page is meant to price *tomorrow's* jobs, $20.97/hr under-recovers by about
**$7 an hour** against the current run rate — roughly **$100k a year** at 14,000 hours.

### 4.3 Minor

- The Cash P&L is numerically **identical** to the accrual columns for Jan–Mar (income
  $501,061.02, expenses $141,770.17 both ways). There is no cash/accrual timing gap to model.
- The Sub-Contractor – Tom Roman line shows **–$7,428.00 in December**. A reversal, and it
  distorts the Oct–Dec hour count. Worth understanding before that quarter is used for
  calibration.
- The entity on both reports is **Enlvn Pty Ltd trading as Paint Home**, not Paint Group.
  ⚑ Confirm this is the trading entity behind the platform's numbers — if there is a second
  entity, these figures are incomplete.
- Registered address shows **Elsternwick VIC 3205**; Elsternwick is 3185. Cosmetic, but it
  will appear on invoices the platform generates.

---

## 5. Open decisions

| # | Decision | Effect if changed |
|---|---|---|
| 1 | Are Settings cost values ex or inc GST? | ×1.10 on all three fields |
| 2 | Split Subscriptions into software vs lead-gen | Marketing $1,741 → up to $2,316/wk |
| 3 | Are Fines/ATO interest ongoing? | +$179/wk on fixed overhead |
| 4 | Does overhead/hr include marketing? | $16.16 vs $20.97 vs $23.67 |
| 5 | Make overhead/hr computed and read-only | Prevents the three fields drifting |
| 6 | Interior charge-out review at $4.03/hr net | ~$70k/yr per $5/hr |
| 7 | 9-month average vs current run rate | ~$100k/yr of under-recovery |

---

## 6. Acceptance criteria — for whoever updates Settings

1. Settings shows weekly marketing spend **$1,741**, fixed overhead **$5,847/week**,
   overhead per billable hour **$20.97**, all labelled ex GST — or the deltas against the
   saved values are reported with a reason for each.
2. The field labels state the basis: "9-month average, Jul 2025 – Mar 2026".
3. Advertising appears in exactly one of the two spend fields — never both.
4. Overhead per billable hour is derived from the other two, not independently entered,
   and the page shows the arithmetic.
5. A test job priced through the engine shows overhead recovery of $20.97 × estimated
   hours, and that figure reconciles to the estimate's margin line.
