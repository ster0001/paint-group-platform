# Homepage v2 — session 2 (showcase data) · what Tom does

Nothing to click yet — this session is the table the job cards read from.
The editor (session 3) and the pages (session 4) come next.

## 1. Run the migration on production

Paste `supabase/migrations/20270101000000_showcase_jobs.sql` into the SQL
editor and run it. It ends with a read-back: expect **two rows**
(`showcase_jobs_public_read`, `showcase_jobs_staff_read`). If the `do $$`
block raises instead, paste the error in chat — that is the migration
telling you a statement did not apply.

## 2. Seed the three placeholder jobs (optional now, needed before session 3)

```bash
SEED_ALLOW_PRODUCTION=1 node scripts/seed-showcase-placeholders.mjs --prod
```

Prints the project ref it is about to write to, then `3 inserted`. They are
drafts: no photo, consent unticked, so they cannot be published by accident.
Re-running is safe (`0 inserted, 3 already present`).

## 3. What the public can see (already true on the test project)

- Anyone can read published rows only; drafts are invisible.
- Nobody — not even a staff login — can write the table from a browser; the
  editor's Save button goes through one server action.
