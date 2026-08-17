# Manual test — R6 errors, speed, and input limits

**What changed:** failures that used to disappear now show up; the portal does
fewer database queries per page; and the database refuses nonsense values it
used to accept.

Most of this you can't see, which is rather the point. About 10 minutes.

## The SQL

`20260908000000_input_constraints.sql` — **run 2026-08-17 ✅**, and all four
limits were then tested against the live database (see the table at the bottom).

**One more to run: `20260909000000_offer_requires_compliance.sql`** — see the
section at the end. That one came out of the end-to-end test and matters more
than anything else on this page.

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

### The constraints, checked against the live database after you ran the SQL

| Check | Result |
|---|---|
| `crew_size = 99000` as a contractor | refused (check constraint) |
| An ordinary crew size | still saves |
| A 500-character company name | refused |
| A certificate expiring 2099 | refused — *expiry date is too far in the future* |
| Its real expiry | still saves |
| An invite asked to last 3650 days | comes back lasting **30** |

6/6.

---

## 5. The one still to run — and why it matters

`20260909000000_offer_requires_compliance.sql`

The offer→accept browser test found something on its first real run: it dropped
a job on the first lane of the board, which was **Mira — who has no verified
insurance certificate** — and the offer went out perfectly happily. Had she
accepted, an uninsured painter would have been booked into a customer's home.

`send_offer` checked that a contractor wasn't suspended, but never checked the
"Ready for work" flag that the whole insurance-verification process exists to
set. The migration adds that check, and re-derives the flag from the actual
certificate at the moment of sending — so an offer can't go out on the strength
of one that quietly expired last month either.

After running it, try to offer a job to a contractor who isn't "Ready for work":

✅ You get *"That contractor has no current, verified insurance certificate —
check their paperwork on the Contractors page before offering them work."*

(I cancelled the offer my test accidentally sent Mira. Nothing is outstanding.)
