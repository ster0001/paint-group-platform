# Pricing model v8 — revision 4 (recommended for decision)

**Prepared:** 20 August 2026 · **supersedes revisions 1–3**
**Data set:** every job accepted in the **last 12 months** (Aug 2025 – Aug 2026) that carries **timesheet entries**, with material-cost and margin outliers removed — **230 jobs, $1,645,717 ex GST, 14,553 estimated hours, 15,955 actual hours**
**All money AUD, ex-GST unless stated.**

---

## How the set was built

| | Jobs |
|---|---|
| Accepted in the last 12 months | 398 |
| …with timesheet entries and actual hours | 283 |
| **…after outlier removal** | **230** |

Removed, and why:

| Removed | Reason |
|---|---|
| 21 | material cost not recorded |
| 10 | material cost above 30% of job value |
| 9 | actual/estimated hours beyond 2.5× or below 0.4× |
| 7 | material cost below 2% of job value |
| 3 | gross margin above 70% |
| 2 | gross margin below 5% |
| 1 | status Cancelled or On Hold |

The eight largest removals are worth a look in Airtable — they are real jobs with bad records, not bad jobs: Factory 1, 3 Sir Laurence Drive ($18,850, materials over 30%); 65 Finch St ($18,494, margin over 70%); 757 Hampton Street ($16,954, hours ratio); 14 Tara Avenue ($16,035, materials under 2%).

---

## The numbers

| | |
|---|---|
| Revenue | $1,645,717 |
| Revenue per **estimated** hour | **$113.09** |
| Revenue per **actual** hour | **$103.15** |
| Actual ÷ estimated hours | **1.096** |
| Contractor offers | $873,155 — 53.1% |
| Materials | $173,161 — 10.5% |
| Gross profit | $599,401 — **36.4%** |
| Net after overhead | $429,281 — **26.1%** |

**Overhead is better than I said.** Across all 398 accepted jobs in the 12 months, you ran **445 billable hours a week — 93% of the 480 assumption**, not the 84% the 17-month view showed. Overhead per billable hour is **$11.69**, and break-even charge-out is **$71.69**. The business has got busier; the older figure was dragged down by early-2025 months.

### By side

| | Jobs | Revenue | $/est hr | $/actual hr | Actual ÷ est | Materials | GP | **Implied labour rate** |
|---|---|---|---|---|---|---|---|---|
| Interior | 151 | $1,048,578 | $109.01 | $100.47 | 1.085 | 11.2% | 33.7% | **$95.52** |
| Exterior | 59 | $538,651 | $123.41 | $107.73 | 1.146 | 9.1% | 42.3% | **$111.11** |
| Real estate | 20 | $58,487 | $102.92 | $112.91 | **0.912** | 10.9% | 30.8% | **$90.55** |

### By size

| Band | Jobs | Revenue | % of revenue | $/est hr | Materials | GP | Actual ÷ est |
|---|---|---|---|---|---|---|---|
| Under $5k | 111 | $285,672 | 17.4% | $108.89 | 13.4% | 31.5% | 1.079 |
| $5–10k | 69 | $500,196 | 30.4% | $107.01 | 10.1% | 33.8% | 1.025 |
| $10–20k | 40 | $594,280 | 36.1% | $113.92 | 10.2% | 37.1% | 1.109 |
| Over $20k | 10 | $265,568 | 16.1% | **$130.31** | 9.0% | **45.0%** | 1.250 |

Big jobs earn 45% margin at $130 an hour and run 25% over estimate. Small jobs earn 31.5% at $109 and carry 13.4% materials. Half your job count sits in the band that earns least.

---

## What the bigger sample settles

**Revision 3 said exterior hours were 10% short and needed +15%. On five jobs. With 59, that's wrong.**

| | v7 uplift | Actual ÷ est | **v7 hours ÷ actual** |
|---|---|---|---|
| Interior (151) | 1.043 | 1.085 | **0.961** |
| Exterior (59) | 1.122 | 1.146 | **0.979** |
| Real estate (20) | 1.043 | 0.912 | **1.144** |

**Both interior and exterior land within 4% of the hours actually worked.** The production rates are sound on both sides. Do not add 15% to exterior — that would have over-quoted every exterior job by roughly a seventh.

**Real estate is the genuine problem, and now it has a sample.** Those jobs finish in **91% of estimated hours** while every other category over-runs, so v7 would quote them **14% high** before any rate change. Combined with the interior charge-out, real-estate quotes would rise **21.4%**. Twenty jobs, $58,487, 3.6% of revenue, your worst margin at 30.8%.

**Production-rate change: soffits only, as in revision 3.** Everything else stays. Revision 2's other four corrections remain withdrawn.

---

## Recommendation

| Scenario | Revenue | vs today | GP | Net | **vs today** |
|---|---|---|---|---|---|
| Today | $1,645,717 | — | 36.4% | $429,281 | — |
| v7 as seeded (85/100/85) | $1,640,756 | −0.3% | 32.7% | $354,740 | **−$74,541** |
| 95 / 105 / 95 | $1,815,838 | +10.3% | 38.9% | $523,150 | +$93,869 |
| **95 / 108 / 95 — RECOMMENDED** | $1,830,809 | **+11.2%** | 39.4% | $538,121 | **+$108,840** |
| 98 / 108 / 95 | $1,860,908 | +13.1% | 40.3% | $568,221 | +$138,939 |
| 100 / 110 / 95 | $1,890,955 | +14.9% | 41.3% | $598,268 | +$168,986 |

**Interior $95 · Exterior $108 · Materials markup 20% · Sundries $350/$250 · Soffit rate fix · Overhead setting $11.69**

Contractor stays at $60 on 100% of estimated hours. **+$108,840 over the last 12 months on jobs with clean records — and since the clean set is 65% of accepted revenue, the whole-book figure is roughly $167,000, about $14,000 a month.**

What it does to each side's prices:

| | Today | Under v8 | Change |
|---|---|---|---|
| Interior | $1,048,578 | $1,147,540 | **+9.4%** |
| Exterior | $538,651 | $612,289 | **+13.7%** |
| Real estate | $58,487 | $70,980 | **+21.4%** |

And **v7 as seeded still costs you $74,541** — flat prices, more contractor hours. That has held across every revision.

---

## The one decision left

**Real estate at +21.4%.** Three ways to go:

1. **Let it ride.** It is 3.6% of revenue at your worst margin. If half of it walks you lose about $18,000 of gross profit and free up capacity for work earning 42%.
2. **Build the segment** — a job-type column, a selector, and its own charge-out. 1–2 days of Claude Code time, and it lets you hold real estate near $87 where its price barely moves.
3. **Fix the hours instead.** Real-estate jobs finish under estimate because they are simpler and repetitive. A job-type modifier below 1.0 is the same feature as option 2 by another route.

Everything else in v8 is a data-only migration and can ship without touching this.

---

## Still worth knowing

- **Recent months are thin** — 8 jobs in each of June and July against 29 in March. Not a slowdown: timesheets on recent jobs are not closed yet. It does mean the newest pricing behaviour is under-represented.
- **115 of 398 jobs in the window have no timesheet entries at all.** They are excluded here. Whether they behave differently is unknowable, and closing timesheets on every job is what would make the next version of this better.
- Contractors are paid $60 on estimated hours while working 1.096× them — **$54.75 per hour actually worked.** v8 closes part of that on interior and exterior; it does not close it entirely.
- Airtable's record, not your ledger. Reconcile the 26.1% net before acting on it.

---

## Track record of these revisions

| | Claimed | Held up? |
|---|---|---|
| Rev 1 | v7 costs $226k in revenue; interior 14% low, exterior 10% low | **No** — ignored hours entirely |
| Rev 2 | Five production-rate corrections | **No** — four made accuracy worse |
| Rev 3 | Exterior hours 10% short, need +15% | **No** — five jobs; 59 say 0.979 |
| Rev 4 | Charge-out too low; materials markup too low; v7 as seeded pays contractors more for the same price; real estate over-estimated | Built on 230 jobs with timesheets and outliers stripped |

What has survived every revision: **the charge-out rates are too low, materials markup at 10% leaves money behind, and shipping v7 unchanged costs you money on the cost side.** The rest has moved each time the data got better, which is the argument for shipping the data-only part and leaving the real-estate segment until it has earned its place.
