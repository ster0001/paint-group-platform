# Manual test — B1: customer scope editor (interior)

What it is: after the customer wizard reveals a range, "Open the editor"
gives the customer full control of WHAT is painted — never hours, rates or
allowances, and only ever a price RANGE.

## Steps (phone if possible, 10 minutes)

1. As staff, run **/estimate** (customer preview), finish a no-plan interior
   run. On the result screen tap **Open the editor**.
2. ✅ The editor matches the mockup: accuracy ring, live range top-right,
   room cards with tick tiles, steppers on Doors/Windows, "More surfaces…",
   a "Something else in this room?" box, and the locked line "Includes
   filling minor cracks and sanding — allowances set by us".
3. Untick **Ceiling** in a room → toast "Removed ceiling — about −$X from
   your range", range flashes and drops. Retick → it comes back.
4. Untick **Skirting** while Walls is on → the amber advice appears
   ("usually painted with the walls") with Keep it in / Leave it out.
5. Step Doors from 1 → 3 → range moves each tap.
6. Type "paint inside the pantry" in Something else → **Add** → the ⚑ chip
   appears. Open the estimate as staff in the wizard editor/builder — the
   note is in the review list ("price this WITH the customer").
7. **× a room** → gone, range drops. "+ bedroom" chip → added and priced.
8. **The security check (the important one)**: in the browser devtools
   console on the editor page, run:
   ```
   fetch(location.origin + "/api/estimates/" + new URLSearchParams(location.search).get("id") + "/wizard-edit",
     { method: "POST", headers: { "Content-Type": "application/json" },
       body: JSON.stringify({ action: "set_rate", rateOverride: 1 }) }).then(r => r.status)
   ```
   ✅ Must log **400** (schema refusal). Also confirm no dollar figure other
   than the range appears anywhere in the page or its network responses
   (search a response for "marginCents" — absent).
9. Crossing the ladder: add rooms until the range mid passes the self-serve
   line — the bottom bar flips from "Accept estimate" to "Finalise my price" (was "Confirm my price —
   book the visit" (booking slots arrive with B2).
