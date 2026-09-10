# Photo uploads, staff alerts, phone view + hold-to-drag — Tom, 10 Sep 2026 (items 6–8)

Branch `fix/tom-batch-10sep`. **One migration to run on production: `20270134000000_staff_notifications.sql`**
(profiles.phone, profiles.staff_notify, the staff_notifications guard table). Until it runs, the staff alerts
fail soft (nothing sent, an error report per event) and Staff logins still work. Paste the read-back (2 rows) here.

## 1. Photo uploads in the estimate
Builder → open a line item → *Crew note & photos* → **+ Photo** → pick 4–5 phone photos at once. The tile counts
`1/5 … 5/5` and all five land together — they went up in parallel, each shrunk in the browser to 2048 px on the
long edge (JPEG). Open one from the customer view: no visible difference on any screen. **Assumption to confirm:**
these line photos are shown on screens only, so 2048 px is "full quality" for them; work-order site photos and
sign-off photos are untouched and keep their originals. If a line photo ever needs to be printed at A3 or used in a
dispute, say so and that path keeps originals too.

## 2. Staff alerts — Settings → Communications → Automations
The page is now **Customers / Contractors / Staff**. Under Staff: the existing "Estimate accepted — tell the office"
plus five new switchable rows (Job accepted by the painter · Job declined · Invoice paid · Variation raised ·
Contractor invoice submitted). Below them, **Who gets each staff alert**: one row per staff login, Email / Text
ticks per alert → *Save who gets what*. Text is greyed until the login has a mobile — **Settings → Company →
Staff logins** now has a *Mobile* box per person (and on the create form). The master sets anyone's; each person
can change their own row.

To see one fire on the test stack: tick Email on *Invoice paid* for yourself, record a payment on any invoice →
one email, subject "Invoice paid — $x · <job>". Record a second payment on the same invoice → a second alert (it is
per payment); re-run the same webhook → nothing (once per event, `staff_notifications`). Every alert is logged in
`messages` like any other send. The accepted-estimate alert still goes to the office address AND to each ticked
person, without doubling up when they are the same address.

## 3. Phone view
On a phone (or the browser at 412 px): Estimates, Contacts, Invoices and Wizard sessions — the table scrolls
**sideways inside its card** (swipe on it) instead of being cut off; the page itself stays phone-width. The builder's
top bar wraps onto three lines (Builder/Estimate/Work order · Payments · Capture · Draft · name · Save · Send…) so
nothing is clipped and the page no longer zooms out. Projects → Project progress: swipe the seven lanes sideways.
Schedule and Payments were already fine.

## 4. Hold to move a block (builder, phone/iPad)
Builder list → press and **hold the ⠿ grip for one second** (a small buzz on Android) — the row goes pale and the grip
turns blue — then slide your finger over another row (it gets a blue ring) and let go. Sliding straight away without
the hold scrolls the page as usual. A mouse still drags immediately.
