# 25 Aug batch — migration + eyeball script (Tom)

One migration to paste, then a look around. Until the SQL runs, everything
except two features works already; the two that wait for it are the ✕ on
dashboard cards and the contractor's "Start the job" button (both fail
politely, nothing breaks).

## 1. Paste the migration

Supabase SQL editor → paste the whole of
`supabase/migrations/20261124000000_pc_dismiss_and_contractor_start.sql` → Run.

**Read-backs (bottom of the run) — expect:**

1. One row: `pre_start | in_progress | {system,staff,contractor}`
2. **2 functions**, both `security_definer = true`:
   `wo_contractor_start`, `wo_dismiss_card`

If a read-back differs: stop and tell the session.

## 2. Eyeball script (after deploy)

**PC Command (`/pc`):**
- Every attention card now has a small **✕** — clicking it closes the card
  permanently (it's recorded as an event, so it stays closed).
- A freshly accepted job shows an **info** card immediately ("They accepted
  today"), turning amber after a day, red at three.
- If a contractor asks to move a start date, a card appears here (as well as
  on the schedule board's tray).

**Schedule board:** clicking a booked job → **"Open the job — stage view"**
now goes to the PC job page, not the builder.

**PC job page (`/pc/wo/…`):**
- New **"Send the customer an update"** card: write words, tap the site
  photos to attach (up to 8), send — the customer gets an email with the
  photos and a "View your job" button, and a text with the link. The
  Updates-tab flow delivers too now (it only *recorded* before).
- A raised variation's primary button is **"Price it in the builder —
  working scope"**; the hours-only quick price is behind a secondary toggle.
  A priced variation has **Email / Text / Both** buttons for the signing link.
- Checklist boxes tick instantly (no more lag).

**Contractor portal (as a test contractor):**
- Tab says **INVOICING** (was Money); offer cards say **Calculated labour
  hours**.
- Live offers appear on the **front page** with the countdown; opening the
  job pins the clock + **Accept / Decline** to the top.
- Before accepting: suburb only — including the job title.
- At pre-start: **"Ready to start?"** card — unlocks when the office's
  pre-start list is done; starting moves the job to In progress.
- "Request a new start date" disappears once the job has started.
- Work orders show **Included** as well as Not included (new issues only).
- Invoicing: a job with an agreed amount can claim (30% etc.) even if it was
  set up before Step 5; with several jobs you must PICK the job first.

## 3. Walkthrough booking — the answer to your question

Nothing books itself. When QA passes, the job moves to the walkthrough stage
and the dashboard raises **"Call the customer — book the walkthrough"** (it
also fires within 2 days of the booked finish while still in progress). When
you book it and leave the date blank, **the date defaults to the booking's
last day on site** (`booking_offers.end_date`). So: booked by you, prompted
by the console, defaulting to the final site day.

## 4. Second migration — walkthrough time (added later on 25 Aug)

Paste `supabase/migrations/20261125000000_walkthrough_time.sql` → Run.

**Read-backs — expect:** `scheduled_time | time without time zone`, and exactly
ONE `wo_book_walkthrough` with `pronargs = 5`, `prosecdef = true`.

**Eyeball:** drag a job onto the schedule → the booking sheet now has
**"Final walkthrough — confirm the date & time with the client"** (date
defaults to the last day on site; add the agreed time). Sending the offer
books the walkthrough — the pin on the board shows the time (e.g. "WALK
15:30"), and the PC job page's Walkthrough card has a time box too. These
date+times are what the client/contractor reminder automations will hang off.
