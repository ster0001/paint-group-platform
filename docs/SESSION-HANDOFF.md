# Session handoff — 20 Aug 2026 (parity build, two-session day)

The next session starts HERE, not from memory. Memory files
(`wizard-rebuild` and friends) hold background; THIS file holds the state.

## PRIORITY 1 — the two production killers: SHIPPED, VERIFIED, MEASURED

Tom flagged these as unshipped; they are shipped — do NOT rebuild them.
The evidence, per the definition of done:

| Killer | Merged+deployed | Named e2e spec | Production evidence |
|---|---|---|---|
| Pending/busy feedback on every tap (optimistic selection, SAVING… pill, Confirming… buttons) | `30847aa` (P1) + hardening `f5fa66f` | `e2e/customer-journey/pending-indicator.spec.ts` (slows a reprice 1.5s, requires the indicator visible then gone; verified-by-breaking) | passed against production twice — peer run + this session's closing run (17.5s, green) |
| Hydration-safe early clicks (`wz-waking` gate + `data-ready`, editors AND wizard pages; session-gated uploads) | `30847aa` + `f5fa66f` | `e2e/customer-journey/hydration-early-click.spec.ts` (clicks within moments of load, must not be lost) | passed against production twice — peer run + this session's closing run (2.1s, green): a tap within 500ms of load is never lost |
| Round-trip measurement | — | `e2e/perf-roundtrip.spec.ts` (new, this session) | PRODUCTION MEDIAN 2,870 ms (min 2,678 / max 3,000, n=3 taps, 20 Aug closing run) — this is why optimistic taps exist |

If Tom still experiences dead taps on production, treat it as a NEW bug
with a repro (which screen, which tap), not as absence of the feature.

## Shipped and on production (chronological, all pushed to main)

- R0–R4 rebuild (19 Aug): response contract view=customer|staff · unsure
  styles priced with amber trace · document model (one floorplan, run-less
  condition photos) · ONE confidence fn + 65% honesty cap · exterior
  5-page wizard branch · sides confirm-loop editor · interior confirm
  loop + cupboards (migration 20260920, RUN) · v2 ladder ($6k/90 interior,
  $12k/85 straightforward exterior, both→always visit) · builder-save
  spread fix. Estimates multi-select delete.
- Parity batches (20 Aug, alternating with the peer session
  "Deployment verification"):
  - `44b3fcd`→`82e0311`: priced condition/access/catalogue/sweep (C5/C8/
    C10) + interior "+ Add a surface" panel (B6, Air Vent countable).
  - `45ae5b6`→`96f48f1` (+`d044962`): gentle clamps (1–15 / 3–40×2–8),
    tier line names its visit reason (`ladder.reason`), >25% size-fix
    prep-pack threshold.
  - `c9105a9`→`f5fa66f`: P1 hardening — the two killer specs above +
    wizard-page hydration gate.
  - `6f43408`: batch 3 — interior card collapse + confirm auto-advance +
    scroll, window GROUPS as tiles with S/M/L inside, sides geometry chips
    + "Not right? Tell us", $ delta toasts exterior, windows-label parity
    fix, turbopack.root pin.
  - `8d4f123`→`007eaf4`: batch 5 — skip-restore e2e assert; excluded side
    verified rendering as explicit exclusion on /e/[token].
  - `306b2c6`: staff wizard submit lands in the NEW confirm-loop editor
    (/estimate/scope) instead of the old W3 internal editor — Tom's
    request after seeing the old view; spec staff-wizard-new-editor.spec.
  - batch 4 (`451503c`): Both jobs = stacked Inside→Outside
    loops (SidesEditor `embedded` + onState feeding ONE combined progress
    and ONE CTA; both→visit tier), old element-grouped exterior editor
    DELETED (pre-rebuild estimates get a restart holding message), spec
    `both-stacked.spec.ts`.

## Verified on production (against the live Vercel site)

- Local gate, clean UNTRUNCATED serial run: 19 journey tests — 18 green +
  pending-indicator green on isolated rerun (its full-run failure was the
  anon sign-in burst limit at test #18, root-caused via the disabled
  Continue button; earlier "11/12-test" reports were tail-pipe
  truncation, not failures). 347 unit tests green.
- Prod runs green: sides loop, interior loop, ladder+booking, both
  response-contract tests, parity-mechanics, both killer specs (peer run);
  killer specs + perf probe verified on the batch-4 PRODUCTION build
  (closing run). NOT yet run on prod: both-stacked.spec (verified locally
  only — it's a 2-minute prod run, FIRST TASK for the next session).
  Fresh prod screenshots captured post-batch-4 deploy (test-results/
  pr-shots/).
- Live DB state: migrations 20260914–22 applied (incl. real price list,
  EXT-WEATHERED ×1.8 modifier in group 'Condition', per-item units fix).
  wizard_public ON (noindex). wizard_limits.maxEstimatesPerVisitor=500
  (proving window — DROP TO 2 AT LAUNCH).

## R5 editor batch — 20 Aug PM (Tom's six asks + photos), ON MAIN

All driven on the real screen; `e2e/customer-journey/r5-editor.spec.ts` is the
new guard (5 tests). 376 unit tests green, `npm run build` clean.

| Ask | What was actually wrong | Fix |
|---|---|---|
| "confidence score" wording | header said "Shape your estimate" | renamed; the sub-line now explains that it climbs. Exterior-only jobs had NO ring at all — added |
| score should start low and climb | it was FROZEN. `applyRoomSizeOk` ("Looks right") set a flag and nothing else, so a full walk-through left it at 18% start AND finish (measured) | `accuracy.ts` gains `confirmState`: unconfirmed in-loop areas cap at 0.62, confirmed floor at 0.95; size-ok now settles L/W as `customer_stated` like typing them does; dw/sweep checks worth +2 each (max +6). Measured no-plan ramp 18→68%; plan job now starts 55% instead of ~92% |
| floorplan not showing | `PlanViewer` existed only in the OLD `app/wizard` editor — /estimate/scope never had one | `lib/wizard/documents.ts` signs the estimate's own sources; `PlanPanel.tsx` = sticky desktop column + phone peek/sheet + photo strip + lightbox. Verified pinned after a 2200px scroll with a card open |
| all surfaces in the add panel | interior offered the room type's optional rules + the ONE row filed Interior/Extras; exterior offered 4 cladding + 4 extras | `lib/wizard/add-catalogue.ts` derives the offer FROM THE CARD. Interior now 7 chips in 4 groups (picture rails, mantle, balustrades, window reveals…); a side now 29 chips in 7 groups. New `add_side_surface` action. Both verified to reprice, not $0 |
| freeze the header + progress + score | only `wz-top` was sticky | ONE `.sc-freeze` ancestor (never nested stickies — that is what detaches on iOS); `scroll-margin-top` so auto-advance doesn't land under it |
| autosave feels like a crash | NOT a React crash — could not reproduce one under hammering (dropped connection and 500 both degrade to a toast). The real faults: every +/- was its own save (8 taps = 8 queued × ~2.9s prod = ~23s of SAVING), the interior stepper computed each tap from the SERVER's stale count so rapid taps were **silently lost**, and a double tap re-sent the same instruction and 400'd | `useCoalesced.ts`: a burst = ONE save with the final value, flushed before any confirm. Tiles/steppers read optimistic state. **Measured: 8 taps → 1 save, count lands on 9/9, zero double-tap errors.** Reference data cached per process (`loadPricingContext` + new `scope-cache.ts`, 20s TTL): local median 314→273ms |
| the customer's photos on file | run-less condition photos were inserted with `estimate_id = null` and NOTHING ever claimed them, so a completed submit still left them attached to nothing — **18 such rows live** (the other 77 orphans are abandoned uploads, which is by design) | the photos route returns its ids, they ride `state.conditionSourceIds` into submit and get claimed with `.is(estimate_id,null).eq(created_by,user)`. Verified live: `{"kept":1,"sourceIds":["de4cf7fb…"]}` |

**SQL Tom must run: NONE.** This whole batch is pure code.

**⚠ KNOWN, DELIBERATE DB↔REPO DRIFT.** A `20260924000000_listing_photo_kind.sql`
was written for the listing-photo import and **Tom ran it live before the
feature was withdrawn**. The file is gone from the repo; the change is still in
the database. So `estimate_sources_kind_check` on production accepts
`'listing_photo'`, and no migration in this repo explains why. That is fine and
deliberate: it is a widened CHECK permitting a value nothing writes. Verified
20 Aug — 0 `listing_photo` rows, 0 stranded probe rows, no data touched. Do NOT
"fix" it by rebuilding the feature. If exact parity is ever wanted, the revert
is safe while that count is still 0:
`alter table public.estimate_sources drop constraint estimate_sources_kind_check;`
then re-add it with the original eight values (floorplan, site_plan, elevation,
exterior_photo, defect_photo, listing, aerial).

**Tom's ruling, 20 Aug (do not rebuild this):** agency photos scraped from a
real-estate listing are NOT to be put on file — "just add photos added by the
customer". The import route, its SSRF-guarded URL checks, its tests and its
migration were all removed the same session. `estimateDocuments` reads the
customer's OWN uploads only. The listing URL still feeds the existing
bedroom/bathroom cross-check (words, not pictures) — that was never in scope
here and is untouched.

## R5.1 — the autosave stall (Tom, 20 Aug evening)

"The screen doesn't crash, but while it continually autosaves it stops
working, so you can't add any further detail and you have to wait."

REPRODUCED at production latency (3s injected locally): three taps on a
surface chip produced **nothing visible for 15 seconds**, and only ONE of the
three landed — because the chip never disappeared, the customer taps it again,
and the repeats came back "that surface is already on this room". Two causes:

1. **Adds had no optimistic state.** Tiles and steppers reacted on the tap
   (R5); the add-panel chips did not. `pendingAdds` now removes the chip and
   shows a dimmed pending tile the instant it is tapped.
2. **Taps queued as REQUESTS.** Saves are serialized (they read-modify-write
   ONE builder_state row, so they must be) at ~3.4s each. Now they queue as
   WORK: a send step sweeps up everything tapped since the last one and posts
   it as `{ actions: [...] }`. **Measured: 6 taps → 2 requests, 0 errors, all
   six landed, every one visible within ~150ms of its tap.**

Route: the per-action mutation body is now `applyAction()` and the handler
loops it. 17 early `return NextResponse.json({error})` became refusal values.
Semantics, all guarded by `e2e/customer-journey/batch-edits.spec.ts`:
- ordered — a confirm later in a batch sees answers from earlier in it;
- a refusal mid-batch STOPS the batch but KEEPS what applied, and rides back
  with the authoritative payload as `error` + `appliedCount`;
- a batch whose FIRST action fails saves nothing and answers as an error, no
  price on the wire;
- `accept_intent` / `book_visit` are never batched (they write events and a
  prep pack) — refused server-side, not just avoided client-side.
- **A CONFIRM ENDS ITS BATCH.** This one cost a real bug, found only by
  re-running: a confirm's refusal is a NORMAL part of the walk ("the wall
  surfaces need to add up to 100%"), and a batch stops at its first refusal.
  So `50% → confirm → 100% → confirm` tapped quickly arrived as ONE batch,
  the first confirm refused exactly as designed, and the customer's
  CORRECTION was discarded. `sides-editor`'s "amber to cyan" failed 2 runs
  in 3; it now passes 4/4. The guard is documented in that spec — if it goes
  flaky again, look at batch composition, not at timeouts.

**Tom must know:**
1. **The ladder moved.** Self-serve needs ≥90% (interior); a plan job now starts
   at ~55% and only crosses 90 once the loop is finished. That is the intended
   incentive, but it means fewer instant online accepts than yesterday.
2. The "crashes on autosave" report has no reproduction here. If it still
   happens, I need the screen and the tap.
3. The 18 unclaimed condition photos predate the fix and are NOT retro-claimed.
   Deleting the rows would leave their FILES in the bucket, so that cleanup
   belongs with the Step 10 "clear test data" script, not raw SQL.

## Remaining queue (in order)

1. Tom runs the archive SQL (pre-rebuild customer drafts → expired; sent
   in chat 20 Aug — re-send from wizard-rebuild memory if lost).
2. R5 proving window: Tom's 90-second phone walkthrough
   (docs/manual-tests/customer-flow-walkthrough.md) on production, both
   paths; then 2–3 weeks of real enquiries through the wizard. Exit
   criteria: accuracy holding, median correction < $150, zero guardrail
   misses. Then Step 10: point the website at /estimate, drop
   wizard_limits to 2, re-enable email confirmation, clear test data
   (e2e drafts labelled e2e-*/Murrumbeena).
3. Deferred (explicitly NOT next): visual column v1.5 (tappable plan —
   needs extraction schema to emit room boxes; own branch + regression
   set), /e/[token] pricing outside lib/pricing (M), per-item charge-out
   shared helper cleanup, prod session hardening.

## Working agreements that must survive the session boundary

- Two sessions share ONE checkout: claim the tree + :3000 explicitly via
  cross-session message, land, ping, hand over. Worktrees DO NOT work
  (Turbopack resolves through the git common dir and panics — full clone
  if parallel servers are ever needed; turbopack.root pin is in).
- Migrations run BETWEEN gate runs, never during.
- Full journey gate runs SERIAL (--workers=1): parallel anon journeys
  trip Supabase's anonymous sign-in burst limit (~6) — env, not code.
- Playwright output: never pipe through tail/grep for a GATE — truncation
  has repeatedly mimicked missing tests. Write to a file, read the file.
- Curly-apostrophe trap in specs: match /That.s right/ not /That's/.
- e2e-spec-first as an anonymous customer; mockups win; STOP on
  data-model conflicts (Tom rules).
