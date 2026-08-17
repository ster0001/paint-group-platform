# Manual test — R6 errors, speed, and input limits

**What changed:** failures that used to disappear now show up; the portal does
fewer database queries per page; and the database refuses nonsense values it
used to accept.

Most of this you can't see, which is rather the point. About 10 minutes.

## Run this first, in the Supabase SQL editor

`20260908000000_input_constraints.sql` — one file, pasted below in the chat too.

Nothing breaks if you don't run it; the limits just aren't enforced.

## 1. Nothing looks different

1. **Estimate builder** — open one, change a paint sheen from the Materials
   panel, edit work-order colours and crew notes. ✅ All still save.
2. **Schedule** — the board still shows the right jobs, offers and blocked days.
   ✅ It now fetches a date window instead of every offer ever made, so if
   anything is *missing* that used to show, tell me.
3. **Contractors** page and **Settings** ✅ still load with the same numbers.
4. **Portal as Josef** ✅ Home, Requests, Jobs, Calendar, Profile all load.

## 2. Failures now speak up

This is the real change. Previously these went silently nowhere.

5. Open an estimate, press **F12 → Console**, and keep it open while you work.
   Anything that fails now prints a line naming where it happened, e.g.
   `[workorder.patch] permission denied for table work_orders`.
6. If a save genuinely fails you'll now see a message on screen rather than the
   change appearing to stick and then vanishing on reload.

**The one that mattered most:** when a customer accepts an estimate, their
drawn signature is saved separately from the acceptance. If that save failed,
the old code threw the error away and told the customer everything was fine. It
now says, on the confirmation: *"Your acceptance is recorded, though we
couldn't store the signature image — we may ask you to sign again."*

## 3. The database now refuses nonsense

You'd have to go out of your way to trigger these — that's deliberate, they're
there for requests that don't come from your screens. If you want to see one
work, in the SQL editor:

```sql
update contractors set crew_size = 99000 where crew_size is not null;
```

✅ Refused: *violates check constraint "contractors_crew_size_sane"*.

Also enforced now: an insurance certificate can't expire more than ten years
out, and an invite link can't be minted to last longer than 30 days.

## 4. Speed

7. The portal used to run its "who is this contractor" check **twice** on every
   page — three redundant queries each time. It now runs once.

Measured rather than assumed: with a counter on the guard, two portal page loads
ran it **4 times before the change and 2 after**.

---

## Verified before handing this over (2026-08-17)

| Check | Result |
|---|---|
| `npm test` | 110/110 (5 new, on the error reporter) |
| `npm run test:e2e` | 4/4 pass, 1 skipped (needs a staff login) |
| Typecheck | clean |
| Lint | 0 errors (2 pre-existing warnings) |
| `npm run build` | passes |
| Session guard executions, 2 page loads | 4 → 2 |

**Not verified, because it needs the SQL run:** the four constraints. That's
section 3 above.
