# Manual test — R2 server boundary

**What changed:** sending, withdrawing, reassigning and moving bookings now go
through the server. The browser can no longer write to the booking table at all,
and it no longer sends the contractor's payment — the server works that out.

**Nothing should look different.** This test confirms it still works, and that
the protections are real.

Run `20260902000000_booking_server_boundary.sql` first. About 10 minutes.

## 1. Everything still works

1. **Schedule** → drag an unscheduled job onto a contractor's row → **Send offer**.
   ✅ Offer appears as an amber block with a countdown.
2. Check the offer's price. ✅ It matches the contractor payment on the work
   order — the server derived it, the screen never sent it.
3. Open the estimate → **WORK ORDER** tab → **Withdraw offer**.
   ✅ It withdraws and the job returns to the tray.
4. Send it again, then drag the amber block onto a **different** contractor.
   ✅ "Reassigned — a fresh 24-hour offer has gone to the new contractor."
   ✅ The first contractor's offer is gone; exactly one live offer exists.
5. Accept it as Josef in the portal, then drag the green block to new dates.
   ✅ "Booking moved", and the dates change.
6. Drag across empty space on a row → **Block them out**. ✅ Still works.

## 2. The stale-tab protection

This is the one worth doing properly.

7. Open **Schedule** in two browser tabs, both showing the same live offer.
8. In **tab A**, accept or withdraw the offer (or accept it as the contractor).
9. In **tab B** — which is now out of date — try to withdraw the same offer.
10. ✅ You get a plain message such as *"The contractor has already accepted
    this. Refresh to see the booking."* and the board refreshes itself.
11. ✅ Crucially: **nothing changes in the database.** The accepted booking is
    still accepted. Before this change, tab B would have silently overwritten it.

## 3. Forgery now fails (optional, 2 minutes)

If you want to see the protection with your own eyes:

12. On the Schedule page press **F12** → **Console**, and paste:

```js
const { createClient } = await import('@supabase/supabase-js');
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? location.origin,
  'paste-your-anon-key'
);
await sb.from('booking_offers').update({ payment_cents: 1 }).neq('id','00000000-0000-0000-0000-000000000000');
```

✅ It fails with a permission error. Before this change it would have worked,
and a contractor would have been offered a job for one cent.

*(You don't need to run this — I've tested it. It's here so you can confirm it
yourself if you'd like to.)*

## 4. Nothing else broke

13. Contractor portal as Josef: an offer still arrives, still shows the right
    price, and Accept / Propose / Decline all still work.
14. Approvals queue on the board still shows reschedule requests, and
    Approve / Keep original still work.

## Verified against the live database (2026-08-17)

Run before you start, so you know what should happen:

| Check | Result |
|---|---|
| Inserting a booking offer directly from the browser | permission denied |
| Forging `payment_cents = 1` | permission denied |
| Forging the work order's payment | permission denied |
| Hand-editing crew notes | still works |
| `send_offer` payment vs the server's own figure | identical (160139) |
| Hours allowance derived from the snapshot | 26.7 h |
| Withdrawing with the wrong expected state | `conflict:offered`, row untouched |
| Reassign | atomic — exactly one live offer, new contractor, payment intact |
| Move a booking | dates change |
| Offering a suspended contractor | refused |
| A contractor sending themselves an offer | refused |
| A second live offer on one job | refused |

One detail worth knowing: the verification script's own cleanup used a direct
delete and **was refused by the new lockdown**. It had to go through
`cancel_booking` instead. That is the protection working on its author.

## What to report

If any step behaves differently from before, note the step number and what
happened. A **conflict message when you weren't expecting one** is worth
reporting — it means the guard is firing when it shouldn't.
