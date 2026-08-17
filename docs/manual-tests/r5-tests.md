# Manual test — R5 tests

**What changed:** the project has automated tests now. Nothing about the app
itself changed, so there is nothing to click through — this is about the two
commands you can run, and the one thing I need from you.

No SQL to run for this one.

## 1. The unit tests — run these any time

```bash
npm test
```

✅ 105 tests pass in about a second. They touch nothing: no database, no
network, no files. Safe to run whenever, including before you push.

What they cover, in plain terms:

- **Dates.** The bug where a job dropped on 1 September was saved as 31 August.
  The tests run on Melbourne time and one of them reproduces the old broken
  calculation, so if anyone reintroduces it, six tests go red immediately.
- **Offers.** An unanswered offer expires after 24 hours; a *proposal* never
  does, because it's waiting on you and expiring it would drop the job.
- **The privacy gate.** A contractor who hasn't accepted sees the suburb and
  nothing else — no street, no phone, no customer name. The test checks the
  whole job object, not just the field we happen to look at.
- **Compliance.** A certificate that lapsed while sitting untouched reads as
  expired, even though the database column still says "valid".
- **Finish levels.** FIN-2/3/4 map to PG-2/3/4, and FIN-1 stays deliberately
  unmapped.
- **Uploads and pricing**, as before.

If you want to see them fail — which is the only way to know a test is real —
change a number in `lib/scheduling/dates.ts` and run `npm test` again.

## 2. The browser tests — run these deliberately

These drive a real Chrome against the **real database**, so they are not part of
`npm test`. They read logins from the environment and there are no passwords in
the repo.

```bash
E2E_CONTRACTOR_EMAIL=pg.josef.contractor@gmail.com E2E_CONTRACTOR_PASSWORD=painttest123 npm run test:e2e
```

✅ 4 contractor tests pass; the offer→accept test skips, because it needs a
staff login too.

## 3. The offer → accept test — now passing ✅

Run 2026-08-17 with the `pg.sam.staff@gmail.com` login. It drags a real job onto
Josef's lane, sends the offer, accepts it as Josef, checks it reads as booked,
then cancels the booking to put the job back where it found it. Verified
afterwards that nothing was left outstanding.

It found a real bug on its first run — see
`r6-observability-and-performance.md` section 5.

Two things it taught us, both now fixed in the test:

- the board's first lane is **not** the contractor you're logged in as (lanes
  sort by company name, and a blank one sorts first), so it now finds the lane
  by company;
- the board streams, so `goto()` returns while the loading skeleton is still up
  and elements exist without being laid out. It waits for a lane to be visible.

To run it yourself:

```bash
E2E_STAFF_EMAIL=you@paintgroup.com.au E2E_STAFF_PASSWORD=... E2E_CONTRACTOR_EMAIL=pg.josef.contractor@gmail.com E2E_CONTRACTOR_PASSWORD=painttest123 npm run test:e2e
```

**Read this before you run it.** It sends a real offer and accepts it against
the live database, then cancels the booking to restore things. If there's no job
in the tray it skips rather than inventing one.

## 4. Nothing else broke

- `npm run build` ✅ passes
- Typecheck ✅ clean, lint ✅ 0 errors (2 pre-existing warnings)
- The schedule board and the portal calendar were touched — their date helpers
  now come from one shared module. Worth a quick look: **Schedule** still shows
  the right days and today's line, and the portal **Calendar** still blocks out
  the day you tap. Both are covered by the date tests, but they're the screens
  the change went through.
