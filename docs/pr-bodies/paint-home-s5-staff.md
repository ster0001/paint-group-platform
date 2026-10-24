# Paint Home — Session 5: the staff side (one brand pill, one brand filter, the dashboard by shopfront)

**Brief:** `docs/briefs/paint-home.md` §6, §8.5. Follows #365, #366, #369, #371 (brand, words, wizard, comms), all live.

## What this is
Every staff list gains the same two things and nothing else: a **Paint Home** pill on rows that came through painthome.com.au (Paint Group rows wear nothing, being the default) and a brand filter, **All · Paint Group · Paint Home**, read from `?brand=`. No separate views. The dashboard splits *Where estimates go* by shopfront once Paint Home has sessions, and *Marketing* gains a **By shopfront** row for the side-by-side test.

## What changed
- **`lib/brand/filter.ts`** + **`app/components/BrandPill.tsx`** — the whole vocabulary (`parseBrandFilter`, `matchesBrand`, `brandPillLabel`; `BrandPill`, `BrandFilterChips`), tested.
- **Estimates** — `brand` on the list select and row; the list narrowed before anything is derived; chips at the right of the status tabs and carried on every tab link; the Wizard tab filters its query by brand and shows the pill beside the entry source.
- **CRM → Today** — work items stay derived and unstored (CRM shell brief §1), so the brand is read alongside, by subject, in four small reads (`lib/crm/itemBrands.ts`); `?brand=` narrows the queue; the pill follows the title.
- **PC Command → Flow** — `work_orders.brand` on the console read; `?brand=` narrows each lane at render while the evaluator still runs over every job; the pill in the card's flag row.
- **Invoicing** — `estimates.brand` carried onto the job money row; `?brand=` beside Show paid; the pill beside the address. Nothing here adds money up (`jobMoney.boundary.test.ts` still holds).
- **Dashboard** — `wizard_drafts.brand` on the funnel slice; `buildFunnel(input, range, brand?)`; two funnels (Paint Group, then Paint Home) once Paint Home has sessions in the range; `mk.by_brand` **By shopfront**: started, saved, sent, accepted, calls requested, visits booked per brand. Page visits, `address_typed` and `see_price` come from the website events table, which already carries the audience; wiring that table into the dashboard is a launch-session item.
- Help `docs/help/paint-home/staff.md`; `docs/ARCHITECTURE.md` paragraph.

## Proof
- Unit: `lib/brand/filter.test.ts`, `lib/reporting/metrics/brand.test.ts`; full suite 4073 green; typecheck clean; lint 0 errors.
- e2e `e2e/marketing/painthome-staff.spec.ts`: a seeded Paint Home estimate and a Paint Group one — the pill on one and not the other; each filter keeps its own; the brand carried across the status tabs; the dashboard row for an owner login. **Run status in the PR's e2e job** — main's e2e runs have held the test project all day, so no local run (one attempt per session, then stop).

## For Tom
1. No migration.
2. Manual test: Estimates → the Paint Home chip at the right of the tabs → only painthome.com.au rows, each with the pill; switch tabs, the chip stays. CRM → Today, PC Command → Flow and Invoicing → All jobs: the same chip. Dashboard: once a Paint Home session exists in the range, two funnels and the By shopfront row.

## Not in this PR
Session 6 (launch): Clarity project, sitemap/robots/canonicals, Tom's phone walk, removing `noindex`, and the website events table on the dashboard.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
