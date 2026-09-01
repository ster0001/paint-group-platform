# Manual test — the 31 Aug wizard batch (Tom's nine items)

All on the live site after deploy. Open **/estimate** in a private window
(anonymous customer) unless a step says otherwise.

## 1 · Contact details are the LAST question
- Walk an interior no-plan estimate. Pages run: property → surfaces →
  condition → details → paint → **"Who should we send your estimate to?"**
  (name, email, phone) → See my estimate.
- No name/email/phone question appears before that final page.
- Signed in as a **trade member** (full details on the account): the contact
  page never appears — "See my estimate" sits on the paint page.

## 8 · Condition prices from the first reveal
- Exterior job, pick **Weathered** on the condition page → the FIRST range you
  see already includes the extra prep (compare against a "Good overall" run —
  it should open noticeably higher, not jump later).
- In the editor, the "Condition & access" card arrives with your wizard
  answers already selected — only the fascia-rot question still needs you.
- Interior job, damage = "In real need of repair" → the first range includes
  the poor-condition loading.

## 6 · Walls under 100% save
- Exterior editor, any side: set the wall to **50%** → the line under the grid
  reads "Painting 50% of this side's walls ✓ …" and **Confirm** works.
- Push shares OVER 100% (add a second wall surface, set both high) → confirm
  refuses and says it can't total more than 100%.

## 7 · A ticked extra answers the extras card
- Tick **Deck** on the "Freestanding extras" card → Confirm works immediately.
  You are NOT asked to also tap "Nothing else".

## 9 · "Something else" opens a box
- Final sweep card → **+ Something else** → a text box appears. Type
  "Bungalow" → Add → the toast names it, and the estimator's review list
  carries "Bungalow", not "Something else". Same on the interior sweep.

## 3 · Exterior from scratch
- Exterior job, page 1: no listing, no photos → tap **"No photos to hand?
  We'll size it from your answers"** → Continue works; the editor opens with
  four sides at typical sizes to confirm.

## 2 · Read the floorplan from the listing (interior)
- Interior job, paste a **domain.com.au** listing that has a floorplan → tap
  **"📐 Read the floorplan from this listing"** → the plan ingests like an
  upload and the room list builds from it.
- Paste a **realestate.com.au** listing → expect the honest failure telling
  you to screenshot the plan and upload it (that site blocks automated
  access). The button never silently does nothing.

## 5 · The wait screen
- Submit any estimate → the processing screen shows step-by-step ticks, a
  moving progress bar, and rotating lines (reviews, colour samples, …).

## 4 · Speed
- After the deploy, taps in the editor should land well under a second
  (functions now run in Sydney next to the database — they were in US East).
  If /pc pages or the builder still feel slow, tell the session — there may
  be a second cause.

## Funnel note (deliberate trade)
Because contact moved to the end, an abandoned wizard run is only chaseable
if the person reached the final page and typed their details. Drop-outs
before that are anonymous — no draft, no campaign.
