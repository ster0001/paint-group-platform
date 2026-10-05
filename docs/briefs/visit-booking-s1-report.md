# Visit booking, addendum A — S1 report (zones)

**Date:** 5 October 2026 · **Branch:** `feat/visit-booking-s1` (contains S0) · **Migration:** `20270212000000_visit_zones.sql` (applied on the TEST project, read-back matched; NOT on production — Tom pastes it)

## Tom's answers to the S0 decisions (recorded)

| | Decision | Answer |
|---|---|---|
| a | Google scope | OK to proceed as recommended; which kind of account info@ is stays open for S5 |
| b | Chat store for messages | Pre-range → website chat, post-range → estimate chat, **and the estimate chat is shown together with the website chat on the staff side** (one conversation per customer in the platform). Lands in S4 |
| c | Weekday helpers honour the holiday list | Yes |
| d | Lead-paint / tenanted flags | No longer bar booking (R2); shown to staff on the visit |

## Bugs fixed first (Tom: "fix bugs and start S1")

1. **Range-screen links to `#reach`.** `Reveal.tsx`, `WizardApp.tsx`, `Finish.tsx` and the scope editor's "Tell us" link all pointed at `/estimate/scope?id=…#reach`; the reach strip only renders on `/estimate/book`. They now go to `/estimate/book?id=…`. Spec: `e2e/customer-journey/reveal-book-link.spec.ts` (anonymous customer).
2. **Save & book read the wrong address keys** (`address.address/city/postal` instead of the wizard's `street/suburb/postcode`), so it never linked a property. New `propertyAddressFromState()` in `lib/wizard/save-and-book.ts` with unit tests; the route uses it.

## What was built

- **Migration `20270212000000_visit_zones.sql`**: `visit_zones` (5 rows, estimator per zone), `visit_suburbs` (unique on lower(suburb) + postcode, status check, far_edge, reviewed, basis, centre point), `visit_unmapped_suburbs` (the fact behind the work item). RLS on all three, staff-only policies, anon revoked, read-back with `_expect_` values, `_prod_migrations` row.
- **Resolver** `lib/visits/zones.ts`: `resolveFromList()` (pure) and `resolveZone(db, …)` (one indexed read; records an unmapped Victorian suburb unless `record:false`). Rule: suburb + postcode match wins; a unique suburb name with a wrong postcode still matches by name; a name with two postcodes and no postcode match is unmapped; a non-Victorian state is out of area.
- **Outline test** `lib/visits/zoneGeo.ts`: point-in-polygon with holes, features by ascending priority, first hit wins.
- **Seed** `scripts/seed-visit-zones.ts build <dataset>` → `docs/briefs/data/visit-zones-review.csv`; `… seed [--prod]` upserts it (leaves rows Tom has reviewed in Settings alone unless `--force`).
- **Settings → Company → Visit zones** (`VisitZonesSettings.tsx`, `visitZonesActions.ts`): zone cards with estimator drop-down, unmapped list with "Add as…" / Dismiss, Check an address, filters + search, per-row status and far-edge, bulk move, Approve everything shown, Add a suburb, Remove. All writes are zod-validated server actions under the staff session.
- **Work queue**: kind `unmapped_suburb` (weight 16, group follow-ups, tag "Suburb"), `buildUnmappedSuburbItems()` from `visit_unmapped_suburbs` where `resolved_at is null`, due next business morning, action → `/settings#visit-zones`.
- Help: `docs/help/visit-zones/staff.md`. Architecture paragraph and inventory row added.

## The suburb list: source, licence, method

- **Source**: Matthew Proctor's Australian postcodes dataset, `https://www.matthewproctor.com/Content/postcodes/australian_postcodes.csv` (8.8 MB, downloaded 5 Oct 2026). **Licence: CC0 1.0 (public domain)**, stated on `https://www.matthewproctor.com/australian_postcodes`. The raw file is not committed; only the derived review CSV is.
- Kept: `state = VIC`, `type = Delivery Area`, postcode `3xxx` → **3,482 suburb + postcode rows**. The per-locality `Lat_precise` / `Long_precise` columns were used; the dataset's plain `lat/long` is per POSTCODE (Glen Waverley and Wheelers Hill share one point there), which would have defeated the whole exercise.
- Each centre point was tested against `visit-zones-draft2.geojson` by ascending priority, first hit wins, no hit = out of area. Then the rulings CSV was applied; it always wins.

### Proposed status counts

| Status | Rows |
|---|---|
| Zone 1 | 174 |
| Zone 2 | 94 |
| Zone 3 | 74 |
| Zone 4 | 33 |
| Zone 5 | 26 |
| Pre-arranged | 84 |
| Out of area | 2,997 |

Far-edge rows: 24 (the CSV's `proposed` column). Reviewed (from the CSV): 212 rows for 210 names.

### Outline vs CSV disagreements (CSV applied; for Tom to confirm)

| Suburb | Outline said | CSV says | CSV basis |
|---|---|---|---|
| Beaconsfield 3807 | zone_3 | pre_arranged | approved_on_map |
| Hillside 3037 | out_of_area | pre_arranged | approved_on_map |
| Lower Plenty 3093 | zone_2 | pre_arranged | approved_on_map |
| Macleod 3085 | out_of_area | zone_2 | approved_on_map |
| Kallista 3791 | out_of_area | zone_3 | named_by_tom_as_dandenong_ranges |

Three of these (Beaconsfield, Lower Plenty, Macleod) are marked `approved_on_map` yet the drawn outline puts their centre point elsewhere — the outline and the suburb list disagree with each other, not just with the code. Tom may want to nudge those polygon edges in a draft 3; nothing in the build depends on it, because the CSV wins.

### Same name, several postcodes

- **Hillside**: 3037 (near Sydenham) and 3875 (Gippsland). Neither centre point is inside an outline, so the ruling went to the one nearest Melbourne (3037 → pre-arranged); 3875 stays out of area.
- **Melbourne**: 3000 and 3004, both Zone 1 by outline and by ruling.
- Also present in the dataset but excluded by the `3xxx` / Delivery Area filter: Docklands 8012, East Melbourne 8002, Dandenong 8785 (PO box ranges).

## Done-when, as verified

| Check | Result |
|---|---|
| All 210 CSV suburbs resolve to `expected_status` | ✅ `lib/visits/zones.test.ts` (15 tests) |
| Glen Waverley 3150 = Zone 1, Wheelers Hill 3150 = Zone 3; Parkdale 3195 = Zone 1, Mordialloc 3195 = Zone 4 | ✅ unit |
| Greensborough, Bundoora, Werribee, Tarneit out of area; Thomastown, Eltham, Cranbourne, Pakenham, Officer, Clyde pre-arranged; Lynbrook, Langwarrin, Baxter Zone 4 | ✅ unit |
| Made-up suburb → unmapped + work-queue item | ✅ unit (unmapped); work item + Settings answer in `e2e/visit-zones.spec.ts` — **not yet run** |
| Tom moves a suburb and the resolver follows at once | encoded in `e2e/visit-zones.spec.ts` via Check an address — **not yet run** |
| Typecheck, lint, unit suites (lib/crm, lib/visits, save-and-book: 244 tests) | ✅ |
| Migration on the test project, read-back `zones 5 / policies 3 / ledger 1` | ✅ |
| Seed on the test project | ✅ 3,482 rows |

**e2e did not run.** The single attempt was REFUSED by the run lock: the test project was held by a CI e2e run started at 11:23Z (7 minutes before). Per the standing rule I did not retry in a loop (a delayed single retry was also refused by the permission classifier). Command for Tom or the next session once CI is idle:

```bash
./scripts/c1/run-e2e.sh e2e/visit-zones.spec.ts e2e/customer-journey/reveal-book-link.spec.ts
```

CI will run both specs on the PR in any case.

## For Tom

1. Open the PR from `feat/visit-booking-s1` (includes S0's docs).
2. Paste `supabase/migrations/20270212000000_visit_zones.sql` into production, compare the read-back row to its `_expect_` values.
3. Seed production once the migration is in: `SEED_ALLOW_PRODUCTION=1 npx tsx scripts/seed-visit-zones.ts seed --prod`.
4. In Settings → Visit zones, pick yourself as the estimator on all five zones (left unassigned by the seed on purpose).
5. Review the five disagreements above and `docs/briefs/data/visit-zones-review.csv` (filter Reviewed = Not yet for the 3,270 outline-placed rows; "Approve everything shown" when happy).

## Next: S2

Estimators, weekly slots, conditional rules, booking rules; the one pure availability function and its golden tests. `settings.visits` becomes Booking rules.
