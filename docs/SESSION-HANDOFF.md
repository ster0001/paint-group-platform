# 4 Sep 2026 — Tom's four items: editable number boxes · capture no longer loses rooms on exit · office email on acceptance · landline on the site. NO SQL.

1. **Number boxes you can edit.** Every `type="number"` in the builder (17)
   and capture (8) was controlled by the parsed number, so clearing it wrote
   "0"/the calculated fallback straight back — the first digit could never be
   deleted. `app/components/NumInput.tsx` keeps the TEXT while focused and
   commits a number only when it parses (`empty` = what a blank means: null
   for "back to auto", 0 for a plain figure). e2e `builder-number-inputs`.
2. **Capture — Coppin St.** Investigation (prod data): NOTHING from the capture
   ever reached the server — storey_heights NULL, the one block carries none
   of the capture markers; Tom retyped it. Structural cause: only "Next
   room →" committed (fire-and-forget), "Exit to builder" was a bare link
   with no flush/guard, and every server refusal was shown as "offline ·
   queued" and retried forever. Now: **"Save & exit to builder"** commits the
   room on screen + flushes the queue + waits for in-flight saves before
   navigating (stays put with the reason if one is refused); HTTP refusals
   show their reason in red (`sync === "error"`) and are NOT queued;
   in-flight commits are tracked; beforeunload guard while anything is unsent.
   e2e `capture-exit-saves`. Recovery: the IndexedDB draft (db `pg-capture`)
   on the device Tom used may still hold the Coppin rooms — reopen
   `/quote/capture?id=cfcec60c-…` there and the Restore banner offers them.
   ⚠ Follow-ups NOT done: Fence/Deck/Garage presets (`exterior_other`) have
   no scope rules → empty tile grid + 422 on commit (now at least SAID);
   the builder's blind `blocks` overwrite on Save can still wipe a capture
   committed from another tab; no `capture_room_committed` event.
3. **Office email on acceptance.** Automations row "Estimate accepted — tell
   the office" (recipient editable, default info@paintgroup.com.au).
   `lib/estimate/acceptedNotify.ts` — once per estimate (estimate_events
   `office_accept_notified`), honours the switch. Three acceptance paths all
   end there: /e pings `/api/estimates/accepted` with its token (the
   appointment-confirm pattern), the trade in-portal approval and the /a
   external approver go through `acceptViaToken`. e2e `office-accept-email`.
4. **Landline.** `settings.company_profile.phone` on PROD set to
   "03 8840 9414" (was the mobile) over REST on Tom's instruction;
   estimatorPhone (Tom's direct line on the estimate sign-off) left as the
   mobile — flag if it should follow. The `tel:` links in code were already
   the landline.

5. **"Viewed" on the estimates list.** `lib/estimate/displayStatus.ts`: a
   sent estimate with `viewed_at` (the customer's first open, stamped by
   record_estimate_view) READS "viewed" and has its own tab; the Sent tab
   is now the unopened ones. DB status untouched (no enum surgery — the
   state machine still says sent until accepted/declined). e2e
   `estimates-viewed`.

GATES: tsc clean · eslint 0 errors · unit green · C1 e2e (serial): estimates-viewed 1/1 · estimates-multi-delete 2/2 · capture-exit-saves 1/1 · builder-number-inputs 1/1 · office-accept-email 3/3 · presentation-tick 2/2 · condition-hours-golden 1/1 · settings-automations 2/2.

---

# 3 Sep 2026 — Tom's four-item batch: Settings in buckets · condition hours reach the painter · approved variations go straight to the painter · Settings → Automations. ONE data-only migration AWAITS TOM ON PROD: 20261229 (or flip the switch on the new Automations screen).

Per item:
1. **Settings in buckets.** Six sections (Company · Communications & automations ·
   Estimates · Pricing · Rooms & scope rules · Money), a sticky jump bar, a
   "Find a setting…" filter, `#<folder-id>` deep links. `SettingsShell.tsx`
   takes the buckets as data; folder titles unchanged (tom-batch-23aug e2e
   still clicks "Pricing & job numbers"). `SettingsFolder.tsx` and
   `MessagingSettings.tsx` removed — the latter lives on inside Automations.
2. **Extra prep → the painter.** The Condition modifier already scaled painting
   HOURS (so contractor hours, offer allowance, days booked all moved) — but
   nothing SAID so, and the wizard's exterior "Peeling & flaking" priced
   nothing at all (visit deferral only). Now: `conditionExtraHours()` splits
   the condition's slice out; WO doc carries `condition{…extraHours}` +
   per-surface painting/prep/condition hours; job sheet shows "Condition ·
   extra prep: … +N h across the job", surfaces "incl. N h prep"; offer card
   "Extra prep allowed". Peeling → COND-POOR (worst-wins) in the wizard, the
   loop's Condition card and the assistant; the visit deferral still stands.
   Pinned: estimate.test "a poor-condition job gives the contractor more hours
   and more pay"; exteriorAnswers.test peeling cases.
3. **Auto-release.** `wo_customer_sign_variation` released on signature since
   20261002 when `wo_loop.variationRelease="auto"`; the seed said 'pc' and no
   screen could flip it. Migration 20261229 flips the row (data-only); the
   switch is on Settings → Automations ("Approved variations go straight to
   the painter"); the /v sign action already texts the painter. Revision
   panel's "Already signed" list names where each change is. New e2e
   `variation-auto-release.spec.ts` (auto side); `wo-variations.spec` pins the
   manual side by setting the mode for its run (`setVariationRelease`
   fixture); revision-contractor / reconcile / full-loop tolerate either mode.
4. **Automations.** `lib/automations/registry.ts` — every outbound message
   (34 send sites audited): audience, channels, trigger, automatic / manual /
   planned, template fields. `messaging` row gains `disabled[]` + templates
   for the hard-coded automatic sends (offer text+email, variation released,
   QA fail, walkthrough invite, signed report, chat reply, receipt,
   remittance, wizard saved-link). Every send site asks `automationOn()`
   (`lib/messaging/load.ts` is the loader). Manual sends listed, not gated.
   Planned rows name the events that send nothing (sign-off nudges, review
   request, booking chase, wizard abandoned) so nobody assumes they do.
   `e2e/settings-automations.spec.ts` drives the screen and the saves.

Rulings I made (flag if wrong):
- Peeling exterior = Poor condition up front (×1.35, the 31 Aug worst-case
  rule) AND the visit; interior damage tier 1 "minor" still adds nothing.
- Auto-release ON is the shipped default; `released_by` stays NULL (system).
- Switching an automatic message OFF never deletes the record it announces
  (offer/variation/QA card still on the portal; appointment skip event
  written with reason "automation off"; pre-start/digest write nothing so
  switching back on resumes).
- Manual sends (estimate, invoice, update, variation signature, magic link)
  have NO kill switch — off would just break the button.

⚠ Known: trade-digest + agent-sweep crons are still not in vercel.json (the
Automations row says so). `offer_notified` written but never read (a
re-offer texts again, by design).

**Tom must:** paste 20261229 on prod (or tick the switch in Settings →
Automations and Save). GATES: see the bottom of this entry.


**Follow-up same evening — "my Residential Exterior presentation isn't showing
up".** Two builder bugs, both in `app/quote/QuoteBuilder.tsx`: `presentationId`
was NOT in `builderFingerprint`, so ticking a presentation left the header at
"Saved ✓", nothing wrote it, and the Estimate tab kept showing the last
PUBLISHED snapshot (which had no presentation); and the presentations list
was loaded once with the page, so one made in Settings after that never
appeared in the picker. Now: the tick is in the fingerprint AND saves itself
at once; the Estimate tab previews the live build whenever there are unsaved
edits (banner says so); the picker refreshes on window focus and when opened.
`e2e/presentation-tick.spec.ts` pins both. No SQL.

GATES: tsc clean · eslint 0 errors (2 pre-existing warnings) · unit 1528/1528 ·
C1 e2e (serial, :3101): variation-auto-release 4/4 · settings-automations 2/2 · wo-variations 10/10 · revision-contractor 5/5 · revision-reconcile 6/6 · wo-full-loop 13/13 · condition-hours-golden 1/1 · tom-batch-23aug pricing-settings 1/1. Screens driven for real: Settings buckets + search, Automations edit/save/reload, the Poor-condition job sheet.

---

# 1 Sep 2026 (evening) — Tom's second batch of the day: 18 items across the portals, variations, wizard. FOUR MIGRATIONS AWAIT TOM ON PROD: 20261223 → 20261226 (all applied + proven on C1).

Per item:
1. **Variation sign → dashboard.** /v post-sign lands on /account/money when
   the estimate has an account (service-client check on the page); /e#changes
   stays the pre-portal fallback. VariationDecision takes `dashboardHref`.
2. **Contractor home: variations waiting.** Portal home card lists
   customer-approved variations awaiting the painter (released non-credits +
   ready credits — the job page's own rule), linking the job. Batched query.
3. **Contractor app logo.** The portal header now actually shows Settings
   logo 1 — the old session-client settings read ALWAYS came back null
   (staff-RLS'd); it goes through getCompanyContact() now.
4. **Offer notifications.** send/reassign/re-offer → text + email to the
   painter ("you have a job offer", 24h, link /portal/requests) via
   lib/contractor/notify.ts. NEW `contractors.phone` (migration 20261223,
   column-granted; portal Profile "Your mobile" card, best-effort reads via
   lib/contractor/weekend.ts's pattern — card hidden pre-migration).
5. **Customer dashboard crew.** "Who's at your home" = painter ONLY with
   Tom's sentence; new "Who is managing and overseeing the job" section:
   company_profile.coordinatorName (Settings → Company details → Project
   coordinator; DEFAULT "Felipe Martinez"), Tom's blurb, phone, and a
   "Message me" button → /account/messages/<estimateId>. The thread page no
   longer 404s an owned estimate with no thread — it opens an empty
   conversation (found live: the demo estimate has no sent_at).
6. **Internal variation approval** (migration 20261224):
   wo_approve_variation_internal — pays the painter, charges the client $0,
   client NEVER sees it (customer_token null + priced_inputs.internal=true;
   estimate_changes_by_token + invoice_draft_final filter it; completion
   report filters $0 approvals client-side). PC card button with
   window.prompt amount+note; releases immediately + texts the painter.
7. **Contractor amount override** (same migration):
   wo_set_variation_contractor_amount — staff set what the painter receives,
   any time before they accept. Buttons on the priced + approved states.
8. **Timeline only shows customer-facing variations.** The `raised`
   "We spotted something" card is GONE (the office may absorb it); approved
   cards gate on customer_token. Portfolio attention already filtered.
9. **"Money" → "Invoicing"** across the customer portal (tab, both h1s,
   property sub-tab display label; routes/testids unchanged).
10. **"Progress claim" → "Deposit"** (migration 20261225):
    invoice_request_payment's line wording + existing DRAFT lines re-worded
    (issued documents immutable, keep what they said).
11. **Invoice back button.** /i/[token]?portal=1 renders "← My account" in
    the chrome; all five portal links into /i carry it (portfolio tests
    repointed).
12. **Blank address on Get a new estimate.** The ?property= address prefill
    is gone (name/phone/email prefill stays); REBOOK keeps its address
    (?property=&rebook= — the e2e caught that regression in-session). Home
    card copy no longer promises "we already know the address".
13. **Wizard windows/doors "Not applicable".** New na enum member + tile;
    auto-set when the surface isn't ticked on page 2, backs off to Not sure
    when it is (PageDetails effect). Merge semantics untouched (na prices
    like unsure if lines exist; unticked surfaces never generate lines).
14. **Wizard paint & colours.** Brand question: Dulux/Haymes/Taubmans/
    Porters/Wattyl/Not sure (unsure exclusive, array shape kept — stored
    snapshots parse). "I know the colours" → free test-pots line;
    "Looking for advice" → NEW crm event colour_advice_requested (catalogue
    + timeline label + submit-route write, deduped per estimate). New
    water/oil question (paint.base) with Tom's extra-coats note — picking
    water keeps waterBasedOnly + the oil-trims follow-up exactly as before.
15. **PC job page names the painter** — "· Painter: X" on the ref line
    (profiles.name || company_name via the page's own join).
16. **QA fail photos.** The fail form has a multi-photo box (kind 'qa',
    area = the "Where", caption from the "What"); no capture attr (camera OR
    gallery).
17. **QA fail reaches the painter.** recordQa(fail) → text (notify.ts,
    once per check via qa_fail_notified event); portal home "Quality check —
    put right" card (outstanding rectification count per job); the job page
    gets a fail card: inspector's notes + missed areas + the qa photos.
18. **Fuel/consumables out of colour match** (migration 20261226):
    wo_colour_match_outstanding + ColourMatchCard both skip
    /fuel|consumable/i — screen and gate agree.

**Gates:** tsc clean · eslint 0 errors (10/23 warnings) · unit 1318/1318 ·
C1: portal-timeline 4, portal-shell 4, wo-variations 15, portal-full-loop,
invoicing 9 (one stale 25 Aug send-sheet assertion repointed), pc-console,
wo-qa-ruling, offer-accept, portal-money, colour-records, trade-money-team
(24 green), customer-journey openings/doors 5, portal-commercial rebook
fixed. Screens driven for real: customer timeline (painter-only + Felipe
card + Message me → working thread), contractor home (logo + variation +
QA-fail cards on REAL prod data).

⚠ PRE-EXISTING, left for the trade-portal-v2 session (their b7f89d4 home
rework): portal-commercial "tiles/attention" + "consolidated Money" specs
red at HEAD (assert the old .tile home). Also their TradePortfolioHome owns
the trade home now.

**Tom must:** paste 20261223…20261226 in order, read the read-backs. Until
then: no painter texts (no phone column — sends skip quietly), internal
approve / amount override buttons error politely, colour-match gate still
lists fuel, "Progress claim" still prints on new payment requests.

---

# 1 Sep 2026 — Tom's 14-item PC-view batch. FIVE MIGRATIONS AWAIT TOM ON PROD: 20261218 → 20261222, paste in order (all applied + proven on C1).

The whole 1 Sep list, shipped in one batch. Per item:

1. **Variation photos forced.** The contractor raise path was already
   photo-gated three layers deep; the real gaps were the REVISION builder
   (variations there could never carry a photo) and the customer never seeing
   them. Now: `sendVariationForSignatureAction` refuses a photo-less
   non-credit variation (all three send surfaces go through it — credits are
   exempt, nothing on site to photograph); the revision panel has a per-row
   "Add a photo" uploader (send buttons disabled until one's up); /api/wo/photos
   ingest takes `variationId` (links via service client — authenticated writes
   on wo_photos are revoked by design); and /v renders the actual photos
   (service client, token = authorisation, the /s report rule).
2. **Final invoice on the PC job page** — money strip gains "Final invoice →"
   (number or “draft”) linking to /invoicing/inv/[id] (view / edit-draft /
   issue / send again all live there).
3. **Update links → the dashboard.** sendUpdate's email button + SMS link go
   to /account when the estimate has an account; /e token fallback for
   pre-portal rows. Button reads "Open your dashboard".
4. **Booking sheet walkthrough rules.** The final-walkthrough date field
   starts EMPTY; the estimated date (last day on site) is a one-tap suggestion
   BESIDE it; Send offer is refused (client + zod refine) until date AND time
   are entered or "Walkthrough not required" is ticked. The booking moved
   from a client fire-and-forget into sendOfferAction (still best-effort by
   the 25 Aug ruling). Cancel now resets every sheet field.
5. **Weekend availability** — `contractors.works_saturday/works_sunday`
   (migration 20261221, default false, column-granted). Contractor ticks them
   in portal Profile ("When you work" card); staff toggle Sat/Sun pills on
   /contractors. Reads ride `lib/contractor/weekend.ts` (best-effort,
   feature hidden until the migration runs — NOT in CONTRACTOR_COLUMNS on
   purpose). Board shading/gating deliberately not wired yet.
6. **After photos forced.** The tick that would COMPLETE an area opens the
   photo picker instead (TickList pre-empt, both portals), and migration
   20261220 adds the server gate: `wo_tick_surface` refuses
   `error:after_photo_required:<heading>` on the completing tick until a
   completion photo exists (`wo_has_after_photo`, mirror of the before gate;
   removed-from-scope rows don't count). e2e fixtures plant completion shots
   the way they plant before shots.
7. **Camera OR gallery** — `capture="environment"` removed from all three
   photo inputs (TickList / SitePhotos / Variations): the phone now shows its
   own Take Photo / Photo Library chooser.
8. **Painter's view fixed.** (a) `/pc/wo/[id]/as-contractor` no longer 404s
   on a job without a v1 snapshot — renders what exists + a "no job sheet
   yet" card linking the builder; (b) migration 20261219 adds the missing
   `is_staff()` branch to `wo_contractor_accept_variation` /
   `wo_contractor_acknowledge_variation` (they answered error:not_yours to
   every staff press; actor recorded honestly as staff).
9. **Ticks → instant update draft.** After every successful tick,
   `draftUpdateFromTodaysTicks` (service client, behind after()) recomposes
   TODAY's wo_updates draft — the composer and /pc/updates carry the day's
   work immediately; the overnight sweep stays as backstop. The existing
   "N customer updates drafted" console card is the send reminder and now
   fires same-day. One update per Melbourne day still holds (wo_draft_update
   never overwrites approved/sent).
10. **Deposit invoice shows remaining payable.** Migration 20261218 widens
    invoice_by_token's ledger context to deposit/progress; InvoiceSheet +
    staff InvoiceDoc render "Contract total" + "Remaining payable after this
    deposit — not due yet". Degrades to nothing until the migration runs.
11. **Tagline gone.** Every hardcoded "Painting · Plastering · Restoration"
    fallback removed (InvoiceSheet, InvoiceDoc, receiptHtml, remittanceHtml,
    Settings default); migration 20261218 blanks the stored settings value
    (only if still the seeded string). NOTE: the tagline stays on prod
    documents until Tom pastes 20261218 — the stored value is what renders.
12. **Walkthrough calendar invites.** lib/workorder/ics.ts (pure, unit-pinned)
    + walkthroughInvite.ts: customer AND painter each get an email with a
    text/calendar .ics — "Final walk through — (customer x painter)", stable
    UID per job, SEQUENCE climbs, so a date change EDITS the calendar entry;
    cancellation sends METHOD:CANCEL. Reconciler-shaped + content-hash
    idempotent (the gcal-sync rule); triggered from bookWalkthrough,
    setWalkthroughStatus(cancelled), setWalkthroughRequired, the painter's
    finish-date move, the accept ping, and the sweep backstop. Painter email
    via auth.admin.getUserById. Migration 20261222 fixes
    wo_contractor_set_finish_date dropping scheduled_time on a re-book
    (live bug — the confirmed time silently vanished on every painter move).
13. **Appointment confirmation.** Editable template in Settings → Messaging
    (apptConfirmSubject/Body, drafted per Tom's spec: painter name,
    07:30–08:00 start window, {{walkthrough_line}}, why attendance matters,
    dashboard updates). Sent by lib/workorder/appointmentEmail.ts the moment
    the job is booked: contractor accept (new /api/appointments/confirm ping
    from OfferCard/OfferBar — the gcal ping pattern), staff direct assign
    (after() in setWorkOrderScheduleAction), sweep backstop for lost pings.
    Idempotent per start_date via appt_confirm_sent/skipped events;
    isTestEmail guarded.
14. **Tray regression found & fixed** (bonus, via the offer-accept e2e): the
    31 Aug volume fix's tray filter dropped issued jobs at stage `offered`,
    so a cancelled/lapsed booking never returned to the tray. Filter now
    admits offered + pre_start.

**Gates:** tsc clean · eslint 0 errors (11/23 warnings) · unit 1318/1318
(5 new ics pins) · C1 e2e: wo-ticks 6, wo-updates 10, wo-full-loop 14,
colour-records 1, revision-builder 7 (one stale 25 Aug assertion repointed),
revision-contractor + revision-reconcile + wo-variations 21, offer-accept 1
(now walks the new walkthrough-confirm flow), walkthrough-v3 + checklists +
signoff/batch3/batch4/stage-advance/qa-ruling/photos/pc-console 56+14.
Screens driven for real on :3000 (booking sheet gate refuses, final-invoice
button, painter's view, Settings block).

**Tom must:** paste 20261218…20261222 in the prod SQL editor, in order, and
read the read-backs. Everything code-side degrades quietly until then
(tagline still shows, deposit remainder absent, weekend card hidden, after
photo gate client-only, staff variation buttons still refused).

---

# 31 Aug 2026 (later) — the volume-scale fixes: silent 1000-row truncation + unbounded sweep. Migration 20261214 AWAITS TOM ON PROD (paste with 20261213).

The two production-scale bugs the volume battery exposed (previous entry,
item a) are fixed, and the whole wo-* battery now runs GREEN on C1 with the
full 3a-8 volume dataset (20k work orders) left in place: 118 passed,
5 skipped (pre-existing gates), 0 failed. Before: 94/15.

- `lib/supabase/fetchAllRows.ts` — ONE shared pager for PostgREST's silent
  1000-row response cap. Rule of thumb now in force: any query whose row
  count grows with the business pages through it (with a stable `.order`);
  state-bounded queries (open offers, unsigned sign-offs) stay single-shot.
  Used by loadConsole (work orders, quiet flags, fortnight ticks, colours
  ticks, dismissals, sent updates), loadBoard (work orders, offers, chase
  notes) and the sweep's id fetches. It THROWS on a page error rather than
  returning a partial set; loadBoard wraps it to feed its on-screen
  `errors` array.
- loadConsole tick counts: only for OPEN jobs (a closed job's progress is
  over; the flow chip hides at 0), ids chunked ~100 per `in()` (a thousand
  ids overflows the request line), 5 chunks in flight.
- wo-sweep: the QA backstop loops no longer run one RPC per active job
  serially. Contractor-less jobs skipped up front (wo_schedule_qa answers
  ok:0 for them anyway), newest-first, capped at 500/run with
  `qaDeferred`/`qaRouteDeferred` REPORTED in the response (never a silent
  cap), 6 RPCs in flight.
- loadBoard (the /pc/schedule loader — the second, separate loader with the
  same disease): closed jobs now windowed to the visible range the way
  offers already were; tray restricted to jobs actually awaiting booking
  (unissued or still pre_start — anything past pre_start was necessarily
  booked to get there).
- **`20261214000000_quiet_site_needs_contractor.sql` — QUEUED FOR PROD,
  paste alongside 20261213.** wo_zero_tick_sweep flagged tickless
  in_progress jobs with NO contractor as quiet sites (one sweep run minted
  2,000 flags on the volume data and flooded the console queue). Rule now:
  no contractor, no quiet-site flag; migration also deletes stray flags and
  ends with a read-back (`guard_present = true, strays_left = 0` — verified
  on C1).
- seed-volume.mjs: `--teardown` flag (wipe vol rows and stop), and volume
  work orders now carry stage_entered_at = issued_at (the 20260926 backfill
  rule) so long-closed volume jobs don't crowd the 30-day Closed lane. NO
  test-only markers leaked into prod code — the app-side changes are the
  production fixes, and the battery passes WITH the volume rows present.

Gates: wo-* battery 118/118 running on C1 with volume data; unit suite
green except app/crm/diary/page.tsx (the PARALLEL CRM session's file,
Melbourne-offset convention — they've fixed it their side); tsc clean.

---

# 31 Aug 2026 — wo_* RLS policies inverted (57014 fix). Migration 20261213 AWAITS TOM ON PROD.

A bare `select id from wo_events limit 5` by an authenticated user with no
contractor/customer link 57014'd on the C1 volume seed (found by the
trade-org-rls finance e2e, 30 Aug): the loop tables' policies called the
SECURITY DEFINER helpers PER ROW — the accounts/properties disease of
20261130, on the wo_* tables. `20261213000000_wo_policies_indexed.sql`
(branch feat/trade-portal-v2) is the cure, applied + proven on C1:

- The invertible rewrite needed one more step than 20261130: OR'd per-role
  policies stay ~3s even inverted (initplan + hashed-subplan probes × 500k
  rows), so the 8 three-way loop tables collapse to ONE `<t>_read` policy —
  a single IN over the new OWNER-RIGHTS VIEW `wo_visible_jobs` (reads
  work_orders as owner the way the definer helpers did, but stays a plain
  subquery). 57014 → 12–51ms warm; keyed reads never evaluate the subplan.
- Grants were AUDITED before folding staff FOR-ALL policies into the read
  policy: those tables give authenticated SELECT only (20261008 revoked
  writes). Tables with real write grants keep staff FOR-ALL (work_orders,
  wo_booking_notes, wo_walkthroughs, wo_reports). Rulings preserved:
  wo_qa_items contractor-only, wo_reports customer-only (role-specific
  set-returning helpers `wo_my_job_ids_as_*`, not the view).
- Probe: `node scripts/portal/wo-plans.mjs` (non-member EXPLAINs, warm,
  100ms bar). Gates: wo-rls 8/8 + trade-org-rls 6/6 on C1.
- The migration ends with a read-back — expect 18 policies, all
  inverted=true. Paste it in the PROD SQL editor and read that table.

Also found running the full wo-* battery on C1 (94 passed, 15 failed — ALL
15 pre-existing/environmental, none from the policy change): (a) the 3a-8
volume seed breaks the battery — /api/cron/wo-sweep (service client,
RLS-free) times out over ~4k active volume jobs, and loadConsole has no
limit so PostgREST's 1000-row cap silently drops fixture jobs from the
boards (task chip filed; the unbounded sweep + silent console truncation
are production-scale bugs in their own right); (b) e2e/wo-photos.spec.ts:121
asserted `href` on a photo tile that became a lightbox BUTTON on 22 Aug
(e49e183) — failing ever since; assertion moved to the thumbnail img src.

---

# 27 Aug 2026 (final) — cert on display, warranty CERTIFICATE, demo customer (main @ 87f8478, PUSHED/DEPLOYED)

Everything through the phase-3a close-out is LIVE. This last batch:
- Tom's real $20M certificate of currency uploaded to company-docs and on
  display (expires 2026-09-30 — PC console goes AMBER ~31 Aug; upload the
  renewal in Settings → Documents when it arrives).
- /account/warranty/[woId] = the per-job warranty CERTIFICATE (holder,
  property, dates, cover summary, ACL text, ENLVN ABN footer; DRAFT
  watermark until the Settings warranty_terms tick; Download as PDF =
  print pattern). Linked from each Documents warranty card. Tom wants the
  certificate + full warranty "recreated nicely as a downloadable pdf" —
  the certificate page IS that v1; his §3 warranty ⚑ decisions + lawyer
  still pending before the watermark comes off.
- Demo customer for touring: /login as pg.alice.customer@gmail.com /
  painttest123 → /account ("Margaret Attwood": 2 properties, day-3 live
  job w/ photos/updates/$340 variation, paid deposit + receipt, closed
  job w/ register + warranty). Reseed:
  `node scripts/portal/seed-demo-customer.mjs` (idempotent, wipes by
  alice's account email; demo photos under wo-photos/demo/).
- Tom's next stated intent: FURTHER EDITS to the customer portal in a new
  session. Read [[customer-portal]] memory first — it holds every ruling
  and trap from sessions 3a-1…3a-8.

---

# 27 Aug 2026 (close) — PORTAL 3a-8 SHIPPED: the volume gate. PHASE 3a BUILD COMPLETE.

Migration `20261130_member_policies_indexed` — applied+proven on C1,
AWAITS TOM ON PROD (the per-row-policy fix matters there too; read-back
in the file). Seeder scripts/portal/seed-volume.mjs (C1 only, tripwired,
vol-marked, --reseed). Measurements + findings + fixes:
docs/manual-tests/portal-3a8-volume-gate.md (Home p95 1012→324ms ✓;
timeline 1483→648, median 457 — co-location analysis for ⚑14; RLS member
policies 559/1006ms → 3–7ms; waterfalls collapsed; photo signing
render-driven via /account/photo/[id]; pagination swept). RLS plans all
hot paths <10ms (scripts/portal/volume-plans.mjs <uid>). Full-loop e2e
both personas + viewports (portal-full-loop.spec.ts 2/2). FINAL BATTERY:
all portal suites 17/17 on live + account-rls/aftercare/volume on C1.

Still with Tom: paste 20261130 · upload liability cert (Settings →
Documents) · warranty terms legal review before removing the DRAFT tick ·
⚑14 blessing of the measured figures (or a Sydney-runner strict run) ·
⚑5 trade payment terms before commercial launch. Deferred by design:
saved-spec templates; warranty-issue "mark handled" UI (staff table edit
meanwhile); retargeting/comms-hub (phases 4–5).

---

# 27 Aug 2026 (later) — PORTAL 3a-7 SHIPPED (the commercial workspace)

NO SQL. Trade = aggregation, never schema: lib/portal/portfolio.ts
(tiles/attention/underway, 5 unit tests) over the same safe reads +
getPortalVariations (WO→estimate→account chain) + getRebookCandidates
(wizard-presence marker only). Trade tabs Home/Properties/New estimate/
Money; PortfolioHome; Properties w/ register+warranty lines + ONE-TAP
REBOOK: /estimate?rebook= → ownership via account chain → prior wizard
state parsed, STRIPPED of file/run refs, RE-VALIDATED (plan-dependent
states fall back to address-only) → WizardApp prefillState (keeps prior
surfaces). Money trade header + /account/statement/[month] (⚑5 display
"14-day terms" only). Settings → Trade accounts (⚑2 grant + ⚑1
unblocked). Saved-spec TEMPLATES deliberately deferred (rebook covers
the promise) — note for a later batch.

- Gates: portal-commercial 4/4 live (incl. rebook seeding: basics screen
  + prior answers + no email field) · builder/shell/journey regressions
  12/12 · unit 1008 · trade-Home screenshot sent.
- NEXT: 3a-8 the volume gate (seed C1: ~25k accounts / 60k jobs / 500k
  photo rows ⚑14; measure portal home + timeline p95 ~500ms, wizard save
  <1s; RLS query plans on hot paths; full-loop e2e both personas, phone
  + desktop; fix regressions before reporting).

---

# 27 Aug 2026 (night) — PORTAL 3a-6 SHIPPED (embedded builder + multi-property)

NO SQL. The portal's "Get a new estimate" IS /estimate (no fork —
lib/portal/builder.contract.test.ts fails any second mount). Signed-in
customers: getWizardActor admits role=customer w/ real email as customer
actor + verifiedEmail; WizardApp `prefill` prop (email → gate page gone,
lastPage 5; address from property via caller-RLS read); submit trusts
session email over typed, skips saved-email for members, and
bypassesWizardLimits (trade unlimited / flags.unlimited office unblock /
residential standard ⚑12 account-wide). Members bypass wizard_public
holding (B4 ruling, documented). Multi-property: ensureProperty =
the one dedupe rule (extracted from ensureAccountAndProperty);
/account/addresses/new (shared AddressField w/ .acct wz-* styles);
Home switcher at 2+ properties (?property= filter), builder card.

- Gates: portal-builder 3/3 live (prefilled no-email run lands on SAME
  account+property; stranger no-prefill; add-address switcher + dedupe)
  · portal-shell 4/4 + journey interior-loop/document-model re-run green
  · unit 1003 · switcher screenshot sent.
- Fixture lesson: test properties must use the REAL addressKey in
  address_norm or wizard saves fork a duplicate property.
- ⚠ Recurring shell quirk this session: the harness cwd sometimes gains a
  trailing space → npm ENOENT; fix = explicit `cd` to the absolute path.
- NEXT: 3a-7 commercial workspace (portfolio Home tiles + attention
  queue, per-property registers, one-tap rebook, saved specs,
  consolidated Money + statement PDF ⚑5 display-only 14-day terms,
  trade granting office-side ⚑2).

---

# 27 Aug 2026 (night) — pc-console spec repaired (the 3a-5 pre-existing red)

The two variation quick-price tests in e2e/pc-console.spec.ts were STALE, not
a regression: the 25 Aug ruling made "Price it in the builder — working scope"
the variation card's primary action, with the hours-only quick price behind a
"Quick price — hours only" toggle, and the priced message now reads "the
signing link has been emailed". The spec still filled `hours-<id>` directly
(never rendered → timeout; the second test cascaded because nothing got
priced). Fix in the SPEC only: assert the builder link's exact
`/quote?id=<estimate>&mode=revision` href (the ruling, encoded), click the
toggle, then price; message assertion updated. Console code untouched.
Gates: pc-console 10/10 on C1 · unit 996/996.

---

# 27 Aug 2026 (late) — PORTAL 3a-5 SHIPPED (colours, Documents, warranty)

Migration `20261129_portal_documents` (company_documents + private
company-docs bucket + warranty_issues) — applied + proven on C1, AWAITS
TOM ON PROD (paste script: docs/manual-tests/portal-3a5-aftercare.md).
Inert-but-safe until run (aftercare queries degrade to empty; portal
suite probe-skips).

- Settings → Documents (DocumentsManager): certs w/ expiry + active
  toggle + the warranty-terms approval tick (settings key warranty_terms
  — DRAFT watermark until ticked).
- PC console: expiringDocs amber banner (≤30 days, ⚑13) + warranty-issue
  warning cards (buildQueue, clears on status=handled — no manual UI to
  mark handled yet beyond SQL/staff table edit; small follow-up).
- Portal: /account/colours = the register (lib/portal/colours.ts —
  snapshot areas × materials × live match codes, TBC honest);
  /account/documents = warranty card (warranties dates + countdown),
  report-an-issue (photo-first → warranty_issues via service after
  account-chain check), credential downloads (/account/document/[id],
  active-only, anon=404), completion-report /s link, full §2 terms
  (transfer clause renders "being finalised" — §8 undecided).
- Gates: portal-aftercare 3/3 on C1 · portal-shell 4/4 live (stranger
  test updated: Home now carries a .job-classed Documents link) · console
  warranty card unit 2 · unit 996 · colours+documents screenshots sent.
- ⚠ PRE-EXISTING red found: pc-console.spec.ts 2 tests (variation
  quick-price) fail on C1 even at base commit — task chip spawned; NOT
  from this session.
- NEXT: 3a-6 (embedded estimate builder + multi-property: same wizard
  components, prefill from property, logged-in skips email gate, AI
  gates by account_type ⚑12 account-wide default, add-address flow).

---

# 27 Aug 2026 (evening) — PORTAL 3a-4 SHIPPED (the Project Timeline)

/account/project is the day-by-day feed, NO migration. lib/portal/
timeline.ts (pure, 8 tests): sent-only updates, Melbourne-day photo
grouping onto the day's leading card, milestones, variation cards → /v,
rollups in the four customer words. QA ruling encoded at the QUERY level
(pass milestone only; fails + qa-kind photos never fetched). Photos =
640/1600px storage-transform renditions behind signed URLs (probe proved
transforms live: 17KB vs 124KB) — originals never reach the feed.
getPortalProject = stage-precedence job pick + safe columns; painter
first-name only. PhotoGrid = grid + lightbox client component.

- Gates: portal-timeline e2e 1/1 on live (the whole visibility law in one
  spec) · unit 989 · tsc/lint clean · phone screenshot eyeballed + sent.
- Traps hit: boundary.test bans +10:00 literals (use UTC-noon day
  anchors); react-hooks/immutability bans render-time mutation (derive
  day headings up front).
- NEXT: 3a-5 (colour register + Documents + warranty card — needs the
  Settings → Documents company-doc store w/ expiry amber, DRAFT watermark
  on warranty terms until Tom marks approved).

---

# 27 Aug 2026 (later) — PORTAL 3a-3 SHIPPED (Money in the portal)

/account/money is real — read-only over invoicing's rows, NO migration.
lib/portal/money.ts = pure customer view-model (issued+ only; drafts/void/
written_off never render; chips via lib/invoicing/derive so customer and
staff dashboards share one overdue/paid rule; GST inc-anchored; remainder
= accepted − issued as "Balance on completion · Not due yet"). Rows link
to the EXISTING /i/[token] surface (PDF + Stripe — no fork); receipts get
/account/receipt/[paymentId] (ownership through the account chain, 404
otherwise). Print stylesheet across the portal. Estimates keep opening
via /e (the mount decision: portal lists, /e renders — one component).

- Gates: portal-money e2e 3/3 live · portal-shell 4/4 re-run · unit 981 ·
  screenshots eyeballed (money view lands on the mockup's exact figures).
- e2e/fixtures/portal.ts = shared portal fixtures (magicLinkFor,
  destroyAccountChain — deletes payments→invoices→estimates in FK order).
- NEXT: 3a-4 (project timeline from wo_events: photos via signed
  thumbnails, per-area rollups in customer words, PC-approved updates,
  who's-on-your-job, variation cards).

---

# 27 Aug 2026 — PORTAL 3a-2 SHIPPED (magic-link auth + the portal shell)

`/account` is live in code — NO migration this session. Passwordless
sign-in: lib/portal/auth.ts mints the Supabase magic-link token
server-side and emails OUR /account/auth?token_hash link via Resend
(lib/messaging) — Supabase SMTP and the redirect allowlist are not
involved. The verified click is what joins the login to its account
(ensureMembership; first login = owner). Shell per the approved mockup:
account.css scoped .acct, call chip on every page, bottom tabs phone /
sidebar desktop in one responsive stylesheet, state-aware Home
(lib/portal/home.ts, pure precedence fn) with one primary action, honest
stubs for Project/Colours/Money/Messages (3a-3…3a-5 fill them).
lib/portal/data.ts = the read layer (session RLS for the chain; service
client scoped to proven account ids for estimates/WOs, safe columns only;
company contact via service — settings is staff-RLS'd, found by
screenshot-driving the real screen). Customer logins land /account;
/dashboard redirects (same-day retirement).

- Gates: portal-shell e2e 4/4 LIVE (wizard → save → magic link → portal,
  no registration form/password anywhere; membership only at the verified
  click) · unit 971/971 · journey sanity re-run green · screenshots
  phone+desktop sent to Tom (e2e/_look-portal.spec.ts is the rig).
- Wizard saves now email "Your estimate is saved" + sign-in button —
  real addresses only (isTestEmail guard; test suites are never emailed,
  protecting Resend deliverability).
- Known follow-ups: durable cross-instance rate limit on link sends
  (in-memory 3/hr/address today); journey-suite teardown leaves empty
  test ACCOUNTS behind (estimates are torn down; accounts flagged by
  isTestEmail — sweep later); ⚑10 portal name default "Your Paint Group
  account".
- NEXT: 3a-3 (estimate + money views inside the portal — read-only over
  invoicing's objects, honest empty states, white print stylesheet).

---

# 26 Aug 2026 (eve) — PORTAL 3a-1 SHIPPED (the identity layer: accounts)

Phase 3 (customer portal) opened: brief + experience map v2 + warranty draft
+ approved mockup committed (kickoff ritual done, all read-order files
present). Session 3a-1 built the accounts → properties → estimates/invoices
chain — the resolution of customer-identity-link.md.

- Migration `20261128000000_customer_accounts.sql` — applied + proven on C1,
  **AWAITS TOM ON PROD** (paste script + expected read-backs:
  `docs/manual-tests/portal-3a1-identity.md`). Deployed code is
  inert-but-safe until it runs (the wizard link step no-ops on the missing
  schema).
- Design rulings (documented in the migration header): account_users only
  from VERIFIED auth (3a-2 magic link) — an unverified wizard email links
  the ESTIMATE, never a login; NO member select on estimates/invoices
  (margins in builder_state — rendered views only); invoice→account
  inheritance is a BEFORE INSERT trigger so no insert site can forget.
- `lib/accounts/` (identity keys + find-or-create), wizard submit links every
  customer save, `scripts/portal/backfill-accounts.mjs` (dry-run default,
  report-and-confirm; NOT NULL constraints land after Tom confirms).
- Gates: unit 953/953 · `e2e/account-rls.spec.ts` 7/7 on C1 through real
  customer sessions · customer-journey suite re-run (see below).
- Audit question answered on live data: linking, not data loss — 46/73
  estimates via wizard_leads; all 4 invoice-bearing estimates reachable via
  builder_state.contact; ~22 unreachable test/driver rows.
- NEXT: 3a-2 (magic-link auth + portal shell + state-aware Home; e2e:
  wizard → save → portal with zero registration screens).

---

# 25 Aug 2026 (PM) — STEP 6a SHIPPED (cost capture: pipeline + intake queue)

Built to the NEW briefs (`claude-code-brief-cost-capture.md` supersedes Step
6's materials scope; updated invoicing brief committed alongside). Migration
**20261122_cost_intake** is applied on C1 and **AWAITS TOM ON PROD** —
read-backs + eyeball script in `docs/manual-tests/cost-capture-6a.md`.
Deployed code is inert-but-safe until it runs (every cost query degrades to
empty; bills@ answers 503 until ⚑16 lands a provider + BILLS_INBOUND_SECRET).

- What shipped: `cost_intake` pipeline (4 doors: bills@ webhook w/ svix
  signature + 3-state idempotency door · airtable transition webhook w/
  Bearer secret · staff manual + Add cost w/ required document · photo door
  reserved for 6b), `lib/costs/*` (rules/AI reader/matching ladder), intake
  queue + accuracy readout + unmatched-materials assign + job-cost
  recorded→approved→paid rows on the Payables tab, Costs tab groups on the
  job money view, Settings → Cost intake, `work_orders.job_no` (the PG-0087
  order reference, ⚑A3/⚑21 — exact matching is real now).
- Gates: unit 914/914 (53 new incl. migration contract tests) ·
  `e2e/cost-intake.spec.ts` 9/9 on C1 · regression suites re-run green ·
  build + tsc clean. Known pre-existing lint error in portal RequestClaim
  (react-compiler memoization warning) — untouched.
- ⚑A1 auto-confirm: setting exists, seeded OFF, deliberately NOT implemented
  in any code path (first-month rule); the accuracy readout is live.
- e2e traps for 6b/6c: destroyLoopFixture now deletes job_costs/
  material_costs/cost_intake (RESTRICT-FK lesson); test env secrets
  BILLS_INBOUND_SECRET/AIRTABLE_SYNC_SECRET live in .env.test.local; C1 has
  no ANTHROPIC key so e2e exercises the rules reader deterministically.
- NEXT: 6b (snap receipt + reimbursements — photo door, who-paid,
  est-vs-actual bars), then 6c (contractor expenses), Step 7 still ⛔ on
  acceptance-to-paid-workflow rulings. ⚑16 provider decision now also gates
  bills@ go-live (Resend recommended — it already sends our email and does
  inbound).

---

# 25 Aug 2026 — HANDOFF TO THE STEP 6 SESSION (costs)

State: main @ e84f432, deployed, live-verified. Migrations 20261111–20261121
ALL RUN on prod and C1 (109 files, in sync). Working tree clean. The
invoicing/payments/portal surfaces are DONE through Step 5 + Tom's follow-up
batches — do not rebuild them; Step 6 fills the gaps they deliberately left:

- **Scope (brief §6.4/6.5/§8.6):** vendors + job_costs (photo/PDF upload,
  recorded→approved→paid, estimate pass-through linking), materials Airtable
  sync (`sync_material_costs`, upsert by airtable_record_id, auto-match by
  order-ref/address, unmatched queue with one-tap assign), Costs tab
  est-vs-actual bars + margin preview, Payables tab rows for approved-unpaid
  job costs + the materials unmatched-queue badge.
- **Where the UI hooks in:** /invoicing Dashboard.tsx Payables tab (tiles +
  rows pattern established — contractor invoices already live there, with the
  job's PC stage on each row); the job money view's Costs tab
  (app/invoicing/job/[estimateId]/MoneyView.tsx — "Materials · other trades"
  card is the placeholder); derive.ts is where every screen figure must come
  from (payablesTiles is the sibling pattern).
- **House rules that bit this build:** migrations idempotent + end with a
  read-back select; Tom pastes prod SQL (give it paste-ready with expected
  read-back values; code must deploy inert-but-safe first); C1 harness =
  scripts/c1/* (apply-migrations, seed, reapply-one for edited files,
  run-e2e.sh); loop-fixture teardown must delete any new RESTRICT-FK rows;
  Playwright beforeAll/afterAll are per-describe — hoist shared fixtures.
- **Coordination:** the Step 5/invoicing session may still be open in another
  tab. ONE session per working tree — if both are active, coordinate via
  SendMessage before editing (parity-batch lesson).

---

# 24 Aug 2026 (later) — ADDENDUM A1–A4 + STEP 5 SHIPPED (one session, gates green)

Tom ruled the addendum's four §4 flags at their defaults (drawn-sig wording
drafted + flagged for the legal batch · sign-first release · PC-manual
deductions · no auto-email), then A1–A4 built and shipped:

- **A1** (migration `20261116`, RUN LIVE, read-backs matched): variation
  approval = DRAWN signature (`wo_customer_sign_variation`; one-tap approve
  refuses), shared `app/components/SignaturePad`, accepted estimates DB-frozen
  (`estimates_frozen` trigger), `wo_working_scopes` (immutable baseline),
  strike machinery (`removed_from_scope` — tick refuses, gate skips, reseed
  keeps), acknowledge + `wo_set_variation_deduction`.
- **A2** (`20261117`, RUN LIVE): QuoteBuilder `mode="revision"` over the
  working scope, priced on the estimate's OWN rate card; `lib/revision/diff.ts`
  chains whole-estimate re-prices so Σ deltas ≡ working − accepted to the
  cent; `wo_draft_revision_variation` (one live draft per block, re-draft
  updates in place, signed variations subtract from re-drafts).
- **A3** (`20261118`, RUN LIVE): contractor acknowledge for credits (no veto;
  started work routes the deduction to the PC — card on the job page + /pc
  queue), strike-through on portal/console/job-sheet, `lib/workorder/
  contractorPay.ts` = the one adjusted-pay rule.
- **A4 PROOF** — `e2e/revision-reconcile.spec.ts`: ledger = engine working
  total exactly, final invoice = ledger with each signed variation its own
  GST-backed-out line, drift 0, estimate row byte-identical. All five new
  suites green on C1; A1–A4 pushed to main @ 50bcdf9 after Tom's read-backs.

**Step 5 — contractor invoicing v2** (migration `20261119`, RUN LIVE by Tom;
code @ 7aa02cb): sign-off AUTO-DRAFTS the contractor invoice (offer + accepted
additions − deductions; `contractor_invoice_amounts` twins
lib/workorder/contractorPay, contract-tested); INC-ANCHORED GST pinned at
submit (Tax Invoice vs Invoice heading — ⚑ accountant); portal Money =
review + one-tap submit (validated: entity, 11-digit ABN, bank, ⚑10
pending-deduction refusal; CI- number at submit); dashboard Payables tab =
tiles + inline Approve / Mark paid (bank ref) → REM- number + remittance PDF
emailed behind after(); RCTI toggle on the contractors page (⚑9 — approve
straight from draft once the agreement is recorded). e2e
`contractor-invoicing.spec.ts` 7/7 on C1 + 45 regression across the sign-off
tails; unit 858. Tom's eyeball script: `docs/manual-tests/invoicing-step5.md`.

⚠ Standing: `setval('invoice_no_seq', …)` before the first real invoice.
ci_no_seq/remittance_no_seq are fresh on prod (test numbers burned on C1 only).
NEXT: Step 6 (costs) → Step 7 (⛔ until acceptance-to-paid-workflow.md rules).

---

# 24 Aug 2026 — INVOICING IS LIVE ON PRODUCTION (main fast-forwarded to ceb6af9)

Tom put the live Stripe values into Vercel (sk_live + webhook signing secret,
endpoint registered for checkout.session.completed / charge.refunded /
payment_intent.payment_failed), said "go live", and main was fast-forwarded
(08c9f15..ceb6af9 — the 12 invoicing commits, nothing else). Verified on the
deployed site: the webhook refuses an unsigned probe with 400 "Bad signature."
(PROOF the secret is loaded — unconfigured answers 503), /invoicing bounces
anon to /login, an unknown /i token gets the friendly 404. Card payments are
armed: the Pay button appears on the next ISSUED invoice's customer page.

⚠ BEFORE THE FIRST REAL INVOICE: test runs burned INV-0001..~0016 on the live
sequence — Tom runs  select setval('public.invoice_no_seq', <last real PaintScout number>);
so numbering continues from his real book.

---

# 24 Aug 2026 (later still) — C1 LIVE and the Stripe money suite GREEN 6/6

Tom created the test project (qarfyjrzgdeoqbnbbxfp, Sydney). All 103 repo
migrations applied to it FIRST TRY (zero fix-forwards — the one-file-per-change
discipline held). Seeds in (3 logins + contractors/customers rows). Connection
note: the SESSION pooler (5432) kept refusing the reset DB password; the
TRANSACTION pooler (6543) took it — C1_DATABASE_URL uses 6543.

`./scripts/c1/run-e2e.sh` = production build + `next start` on :3101 (Next 16
allows one dev server per dir, and Tom's :3000 stays untouched).

e2e/stripe-live.spec.ts — 6/6 with REAL Stripe test-mode (his account is a
SANDBOX — no "Test mode" toggle in new Stripe UI):
  1. 4242 pay-in-full: hosted checkout showed invoice + disclosed surcharge
     ($1,850.00 + $31.75); redirect wrote NOTHING; self-signed webhook recorded
     payment (surcharge split, RCT receipt), invoice → paid; customer page
     flipped to "Payment received" by itself.
  2. Duplicate delivery → once. 3. Fee captured. 4. Abandoned session inert.
  5. Refund flips payment, invoice stays paid + needs_credit_note event.
  6. Forged signature → 400.
Checkout automation traps: the Card payment-method is a CUSTOM radio (click
ladder with force + wait for #cardNumber), and Link's "save my information"
checkbox must be unchecked or it demands a phone number.

STEP 4 IS FULLY PROVEN. To take cards live, Tom (only Tom, in his own hands):
sk_live secret key + webhook signing secret → Vercel env, endpoint
https://paint-group-platform.vercel.app/api/webhooks/stripe (events:
checkout.session.completed, charge.refunded, payment_intent.payment_failed),
confirm NEXT_PUBLIC_SITE_URL, redeploy. Steps in docs/testing/c1-test-project.md.

Remaining in the brief: Step 5 (contractor invoicing v2) → Step 6 (costs) →
Step 7 (⛔ until acceptance-to-paid-workflow.md's 5 flags are ruled + APPROVED).

---

# 24 Aug 2026 (night) — Step 4 CLOSED: migration 20261115 live, gates proven on production

Tom ran `20261115_stripe_payments.sql` (read-backs good). Live probes after:
the idempotency door answers new → retry → done; anon AND staff calling
`record_stripe_payment` are refused 42501 — the signed webhook (service role)
is provably the sole writer of card-payment success. Invoicing e2e 9/9 again.

Stripe is now fully built and inert: no STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET
in any env, so the card path stays invisible (bank transfer only) until keys land.
Sequence to switch cards on, per Tom's C1 ruling:
  1. C1 session — dedicated test Supabase project + Stripe TEST keys there only;
     the test-card e2e (pay in full / duplicate webhook / expired session inert /
     refund flow) is written IN that session against that stack.
  2. Then live keys → Vercel env only + webhook endpoint registered in the
     Stripe dashboard (Developers → Webhooks →
     https://paint-group-platform.vercel.app/api/webhooks/stripe).
Tom's question answered in-session: no "API build" needed on his side — two
dashboard values pasted into Vercel, that's the whole link.

Also closed this session: Settings → Invoicing folder live and verified (BSB and account rendering
from settings — values redacted from this doc, A6-01); banking single-sourced (one save writes
company_profile + invoicing_bank; live rows aligned — company_profile's acc
had a space, now normalised).

---

# 24 Aug 2026 (evening) — Invoicing Step 3 COMPLETE: PDF · send · token view (branch `feat/invoicing-payments`)

Migration `20261114_invoice_pdf_token.sql` RUN LIVE (Tom, read-backs good). e2e
`invoicing.spec.ts` now 8/8 against live: the six Step-2 tests plus (7) the token
link renders exactly one invoice — number/GST/total asserted, other invoices'
numbers and internal money fields absent from the response, viewed event written,
unknown token → 404 — and (8) the PDF downloads as a real %PDF via
/invoicing/inv/[id]/pdf, the stored path never changes, and a second attach is
refused by the DB (`error:pdf_immutable`).

How it fits together: `/i/[token]` is the customer document (white professional
A4 sheet on a dark shell; ATO tax-invoice fields; bank box with the invoice
number as reference; ENGLISH copy). THE PDF IS A CHROMIUM PRINT OF THAT PAGE
(?print=1) — one template, three faces. `lib/invoicing/pdf.ts` resolves
Chromium (@sparticuz/chromium on Vercel · local Chrome · playwright fallback in
dev), uploads to the private `invoice-docs` bucket, attaches once. Receipts
(`receiptHtml.ts`) render behind next/server `after()` on payment and email
best-effort. `sendInvoice.ts` rides lib/messaging — ⚑16 log driver when
unconfigured; issue never blocks on email. Issue & send is the one primary
action everywhere; Copy pay link + PDF + Preview-as-customer (staff-only draft
preview via the same token page) are live.

Sample PDF generated from a real pipeline run and sent to Tom (mockup-grade,
white-paper clean; duplicate less-previously-invoiced line and the dev-tools
badge were caught and fixed in the render pass).

⚠ DEPLOY PREREQ: set `NEXT_PUBLIC_SITE_URL=https://paint-group-platform.vercel.app`
in Vercel env or production PDFs/emails will point at localhost.
⚠ Test-phase INV numbers 0001–0014 burned on the live sequence — before real
use Tom runs `select setval('public.invoice_no_seq', <last real number>);`.

Next: Step 4 (Stripe) — ⛔ WAITS for the C1 test Supabase project (Tom's ruling:
its own session; schema sync, seed, CI, documented reset; Stripe test keys only
there). Step 5 (contractor invoicing) can go before C1 if preferred.

---

# 24 Aug 2026 (later) — Invoicing Step 2: the three §7 screens, live (branch `feat/invoicing-payments`)

Migrations 20261111/12/13 ALL RUN LIVE (read-backs confirmed in session). Diff for
Step 1 approved by Tom; rulings 5/6/7 landed (variation price labelled inc-GST +
golden test; builder deposit reads Settings; write-off audit trail confirmed).

Built 1:1 from the three mockups, phone-first, staff-gated (`app/invoicing/`):
- **/invoicing** — tiles (outstanding/overdue/due-week/collected+spark), filter
  chips with counts as query params, chase-order rows with stage dots (row → doc,
  address → job), aged buckets, Activity feed; Payables = labelled empty state.
- **/invoicing/job/[estimateId]** — stage rail, money strip (ledger RPC),
  Payments/Invoices/Costs tabs, request-payment sheet (%, custom, fixed — intent
  only), invoice-in-full, record-payment (bounded, RCT receipts), void, delete
  draft. PC WO money strip links here; PcNav gained "Invoicing".
- **/invoicing/inv/[id]** — the document editor: seeded lines w/ variation
  approval dates, line edit/add/remove (server recompute), deposit/progress
  "Amend the amount", the reconciliation banner (drift server-computed;
  record-as-variation moves the ledger, one-off adjustment records the decision),
  Issue locks. Send/PDF/token = Step 3 (buttons visible, disabled).
- lib/invoicing/derive.ts (+107 goldens now across the module) — ALL screen
  figures derive there or in the ledger RPC.

Gate: 780 unit · e2e `invoicing.spec.ts` 6/6 AS STAFF against live (incl. DB
immutability + both banner paths) · wo-signoff 12/12 · wo-full-loop 13/13 ·
A2 inherit 2/2 · build clean. Phone screenshots verified against the mockups
(the legacy $0 stub on 2 Beech Rise correctly raises the banner).

Next: Step 3 (PDF, issue-&-send pipeline behind the ⚑16 provider interface,
token view). Step 4 (Stripe) WAITS for the C1 test project per Tom's ruling.
Tom's eyeball script: docs/manual-tests/invoicing-step2.md.

---

# 24 Aug 2026 (later) — Invoicing Step 2: the three §7 screens, live (branch `feat/invoicing-payments`)

**ONE paste queued:** `20261113_invoice_draft_editing.sql` (§7.3 editor RPCs + the
reconciliation paths + a selected_options hardening of invoice_draft_final).
Script + read-backs: `docs/manual-tests/invoicing-step2.md`. The screens are live
without it — only the edit controls wait on it.

Built 1:1 from the three mockups, phone-first, all under `/invoicing`
(`app/invoicing/invoicing.css` is the mockups' chrome, scoped `.invx`):

1. **/invoicing (§7.2)** — four pulse tiles (sparkline from payment days), filter
   chips with counts as shareable query params, chase-order sort, per-row payment
   stage dots, aged-buckets bar, Activity feed from invoice_events; Payables is a
   labelled empty state until Steps 5–6. Row tap → document; address tap → money view.
2. **/invoicing/job/[estimateId] (§7.1)** — stage rail (emerald/cyan/amber/clay per
   mockup), 5-cell money strip off `invoice_ledger_staff`, Payments/Invoices/Costs
   tabs (Costs = contractor group only), deposit-draft card front-and-centre,
   request-payment sheet (10/25/50/custom %/fixed $ — the sheet sends the CHOICE,
   preview via lib/invoicing mirror), invoice-in-full, record-payment sheet, void
   with reason, draft delete. PC integration: PcNav "Invoicing" tab + "Money
   view →" on the WO money strip (crumbs link back).
3. **/invoicing/inv/[id] (§7.3)** — the editor IS the document: settings-driven
   letterhead (⚑11/⚑12), grouped lines (contract / variations with approval
   dates / this claim), inline line edit/add/remove (server recompute), deposit
   "Amend the amount", final totals block (adjusted · less previously invoiced ·
   subtotal · GST · balance due), the amber reconciliation banner with BOTH
   one-tap paths (one-off adjustment event / staff-override variation via the
   existing wo_variations machinery — ledger moves, document reconciles emerald),
   payments section, Issue (locks at the DB). Send/PDF/token buttons are present
   and honestly disabled "Step 3".

Every figure: lib/invoicing (`derive.ts` — tiles/buckets/stages/ages, golden-tested
on the mockup's own numbers) or the ledger RPC. Components format only.

**Gate:** 780 unit green · tsc/eslint clean · e2e `e2e/invoicing.spec.ts` **5/6
passed live** (accept→deposit draft on both surfaces→issue INV-0001→DB refuses
post-issue edits even via service key→bank payment RCT-0001→rail/strip/dashboard
follow→25% request = $4,625 server-computed); test 6 (reconciliation banner, both
paths) SKIPS until 20261113 runs — probe-gated, not hoped. Screens driven at
375×812 (`e2e/_invoicing-look.spec.ts`) — dashboard/money view/document match the
mockups on real data.

⚠ The e2e burnt INV-0001/RCT-0001 from the live sequences (by design — numbers
never reuse). Tom: `setval` both sequences before real invoicing starts.

---

# 24 Aug 2026 — Invoicing & Payments Step 1: ledger, schema, state machine (branch `feat/invoicing-payments`)

The invoicing build begins, per `docs/briefs/claude-code-brief-invoicing-payments.md`
(kickoff ritual done: brief + all three §7 mockups committed;
`acceptance-to-paid-workflow.md` is still missing from the repo — Step 7 stays ⛔).

**TWO pastes, in order:** `20261111_invoice_status_enum.sql` (enum labels alone) then
`20261112_invoicing_core.sql`. Read-backs + three safe live probes:
`docs/manual-tests/invoicing-step1.md`. Optional after: `setval` to align INV numbers
with PaintScout, and the real BSB/ACC into the `invoicing_bank` setting.

1. **The ledger** — `invoice_ledger` (SQL) + `lib/invoicing/ledger.ts` (twin, golden
   tests incl. credit variations) are THE computation of adjusted contract / invoiced /
   paid / balance. `estimates.accepted_total_cents` freezes the anchor at acceptance;
   `wo_variations.credit` marks descope credits.
2. **§3.1 model** — invoices get kind/number/token/ex+GST+inc totals/pdf_path;
   `invoice_lines` (variation single-billing partial unique index),
   payments extensions (surcharge/stripe/receipt columns), `credit_notes`,
   `stripe_events`, `invoice_events`, `contractor_invoices`, `vendors`, `job_costs`,
   `material_costs`; RLS on all, client writes revoked (money is RPC-only, §4.1).
3. **§3.2 machine** — `invoice_transitions` seed (18 rows) + guard triggers: illegal
   transitions raise, issued invoices are immutable at the DB, only drafts delete
   (service_role exempt for e2e teardown), PDF writes once, void frees billed
   variations. Mirror + lock-step test: `lib/invoicing/stateMachine.ts`.
4. **RPCs** — issue (number at issue, ⚑3 terms), send, mark_viewed (token),
   record_payment (bounded ≤ balance×1.05, RCT receipts, card refused — webhook only),
   void (reason; paid → credit note instead), write_off (⚑17), extend_due,
   delete_draft, request_payment (percent/fixed intent — server computes cents),
   create_final. GST: ⚑14 one rule in `lib/invoicing/gst.ts` + SQL twins.
5. **Producers rewired** — accept_estimate drafts the deposit (snapshot depositPct
   wins, else ⚑1 setting 10%) in-transaction; wo_sign + wo_close_without_walkthrough
   call `invoice_draft_final` (snapshot-seeded lines, "less previously invoiced"
   balancing line) instead of the $0 stub; wo_reopen_signoff deletes the final DRAFT.
6. **Settings** — every §2 value seeded under `invoicing` / `invoicing_entity` /
   `invoicing_bank` / `invoicing_myob` (bank BSB/ACC deliberately blank).

Gate: 764 unit (5 new invoicing files, 83 tests incl. the A2 suite untouched),
tsc + eslint clean. e2e untouched except `invoice-customer-inherit.spec.ts`
(direct insert made migration-window-safe). NO UI yet beyond the existing
read-only /invoices list — Step 2 builds the three screens from the mockups
and e2e-proves the whole accept→deposit→issue→pay flow in the real roles.

Open ⚑s for Tom (per brief §2, to be re-listed in the PR body): 2 (deposit cap
legal), 4/5 (surcharge rate + GST treatment), 9 (RCTI agreement), 11 (legal
entity line), 16 (email provider), 18 (MYOB codes), 17 (write-off is staff-gated
until roles can distinguish Tom), plus: variation prices are charged as approved
on /v (GST treatment of that figure needs a ruling), and the estimate builder
still defaults deposit % to 50 — decide if it should read the new setting.

---

# 23 Aug 2026 (small hours) — batch 4: walkthrough not required, pre-start list, colour match

**TWO pastes, in order:** `20261109_wo_signoff_kind_no_walkthrough.sql` (enum label alone) then
`20261110_wo_no_walkthrough_colour_match.sql` (read-back: transitions 13, wt_col 1, new_fns 4,
qa_items_left 0, gate_reads_colours true, seeder_current true).

1. **Walkthrough not required** — tick in the scheduler's offer dialog (`sendOfferInput.
   walkthroughRequired`) or on the staff Walkthrough card; `work_orders.walkthrough_required` +
   `wo_set_walkthrough_required`. Routing: `wo_contractor_confirm_prep` (no check due) and
   `wo_qa_route_passed` (last pass) call **`wo_close_without_walkthrough`** → `completion_prep|qa →
   closed` (two new matrix rows; 13 moves / 36 illegal in the drift test) and write the record a
   signing would: `wo_signoff` row (`signed_kind='no_walkthrough'`, report frozen), warranty from
   the close date, review follow-up, $0 invoice stub, event `closed_without_walkthrough`.
   `wo_record_qa` returns `ok:pass:closed`; `confirmPrepStaff` / `contractorFinish` carry
   `to: "closed"`; StageAdvance offers "Close the job — no walkthrough required" at qa; the
   contact card skips these jobs; portal shows "No customer walkthrough on this job".
2. **Pre-start list** — derived "QA schedule created" DELETED (seeder + live rows); "Customer
   'what to expect'" → **"Pre-start checklist"** (optional, `item_key pre_start_checklist`);
   "Colour schedule finalised" → **yes/no** (`item_key colours`; No = colour matches needed).
   Ticking the checklist item opts the job in: `lib/workorder/preStart.ts` (called from the sweep)
   emails the customer `messaging.preStartBody` N = `preStartDaysBefore` days before the start,
   ONCE (events `pre_start_checklist_sent|skipped` are the guard — a skip is not retried).
   Settings → Messaging has the template + days. `buildPlainEmailHtml` (no button).
3. **Colour match** — builder: "Colour match" tick per substrate beside the colour, with code /
   brand / can size (`builder_state.colourMatches`, `WOMaterial.colourMatch`). Job sheet shows it.
   `wo_colour_match_outstanding(wo)` = products flagged OR (colours=No AND no colour) with no code
   in snapshot or `work_orders.colours→product→match`; `wo_gate_blocked` refuses the pack / the
   close with "colour match codes still needed for …". Painter (or office) supplies via
   `wo_set_colour_match` — `ColourMatchCard` on both job pages (`app/components/wo/`).
   e2e fixtures: `completePreStart()` answers the colours yes/no; `wo-batch4.spec.ts` (4).
   ⚠ boundary.test: an `.insert({…})` on a loop table must not contain the WORD `status` anywhere
   inside its braces (even `result.status`) — alias it first.

---

# 23 Aug 2026 (late night) — batch 3: cadence, finish date, dashboard prompts, ideal painters, staff sign-off

Tom's third list of the night, all on `audit/workflow-23aug`. **Migration `20261105_wo_qa_cadence_finish_date.sql`
to run** (read-back: checks `["final"]`, qa_required_col 1, new_fns 4, start_unbooked_ok true,
schedule_reads_flag true).

1. **Dashboard prompts** (console.ts 5c–5e, loader queries): *Quality check to do* (job at qa with
   a check to log, or a dated mid-job check due/overdue — action "Check it"), *Customer update due*
   (in progress, nothing approved/sent for `wo_loop.updateEveryDays` = 3 days, nothing drafted →
   /pc/updates), *Call the customer — book the walkthrough* (no booked final; warning at
   Walkthrough, info within 2 days of the booking's end). Unit-tested.
2. **One quality check as standard** — `qaCadence.checks` = `["final"]`; unlogged `day_one` rows on
   live jobs deleted. `wo_add_qa_check` (staff, kind `mid`, dated) behind "+ Add a mid-job check" on
   the PC job page; `work_orders.qa_required` + `wo_set_qa_required` (staff) — the checkbox on the
   job page AND the "Quality check required on this job" tick in the scheduler's offer dialog
   (`sendOfferInput.qaRequired`, flag set before `send_offer`). `wo_schedule_qa` reads the flag.
3. **Painter's walkthrough**: `wo_start_walkthrough_mode` no longer needs a booked final. New
   **Finish & walkthrough card** on the painter's job page (booked final, else the booking's end),
   "Change the date" → `wo_contractor_set_finish_date` (assigned contractor or staff): moves the
   accepted offer's `end_date` (trigger copies to work_orders; calendar lane follows), cancels +
   re-books the final walkthrough to that day, event `finish_date_changed`. Dated QA checks
   (mid-job) show on the card read-only. Interpretation: Tom wrote "the date the quality check has
   been booked" — read as the finish/walkthrough date; flagged in chat.
4. **Staff Walkthrough card**: "📅 Pick a date" (`showPicker()`), "Estimated finish <end> · N days
   booked from <start>", and **our side of the sign-off**: "Walk through on this device"
   (`wo_start_walkthrough_mode` as staff → /s/<session> in a new tab) and **"Record sign-off
   manually"** → `wo_staff_sign(wo, name, note)`: approves every unanswered area `via:'staff'`,
   mints a 10-minute session token and runs the REAL `wo_sign` (warranty, report, invoice stub,
   close, all as usual), then stamps `captured_on='staff_recorded'` (row + frozen report) and
   writes `signed_off_by_staff`. Refuses with `areas_outstanding` only if the customer FLAGGED an
   area (approved_at null but flagged — settle first).
5. **Ideal number of painters** — `builder_state.idealPainters` + `WorkOrderDoc.idealPainters`
   (Job settings input with a live "≈ N days on site" hint); `daysFromHours(hours, painters)` =
   ceil(hours / (8 × crew)); the tray card reads "· 2 PAINTERS" and a dragged job lands with the
   right span. No estimates column (so no grant trap) — it rides builder_state/snapshot.

Tests: 692 unit (+10); e2e `wo-batch3.spec.ts` (4, needs the migration). Gate before merge.

6. **The post-sign 404 (Tom's last item):** Mode A — the customer signs on the painter's phone,
   `wo_sign` NULLS the session token, and `signAction` revalidated → Next re-rendered the current
   route against the dead token → `notFound()`. Worse: ANY `revalidatePath` inside a server action
   re-renders the current route, whatever path it names. Fix: `signAction` returns `onDevice`
   (resolved from the pre-sign lookup: token ≠ customer_token) and revalidates NOTHING on that path;
   the sign page shows thank-you then the device goes back to `?back=` (portal job page for the
   painter, `/pc/wo/<id>` for staff's "Walk through on this device") — same-site paths only. The
   portal job page now has a **Job complete — signed off by <name>** card at stage closed.
   e2e `wo-sign-return.spec.ts` drives the real buttons end to end.
7. **Closed lane + reopen (Tom, 23 Aug; migration `20261108`):** signed jobs were closing in the
   DB but vanishing from the Projects board — `loadConsole` excluded closed rows. It now includes
   jobs closed in the last 30 days (`stage_entered_at`), so the lane **"06 Closed — final invoice
   sent"** (renamed) shows them; queue/tiles still skip closed. New matrix row
   `closed → walkthrough` (staff) + `wo_reopen_signoff(wo, reason)`: stage back via wo_set_stage
   (gate applies), signoff UNSIGNED (signed_at/name/kind/captured_on/session cleared, areas reset
   so the customer looks again), the first signing's $0 draft invoice stub deleted (re-sign writes a
   fresh one), warranty untouched, event `signoff_reopened`. StageAdvance at closed: "Something
   found after sign-off — reopen" with a reason. Drift test → 20261108 (11 moves, 38 illegal).
   Known edge (unchanged): wo_sign ignores wo_set_stage's result, so a signed job with a variation
   still waiting would stay at walkthrough — the gate message is visible on the Next-step card.

---

# 23 Aug 2026 (night) — prep QUESTIONS, pass → walkthrough, the customer never sees QA

Tom's rulings, answered in one batch (branch `audit/workflow-23aug`):

1. **The finishing-up list is now questions, not five ticks** (seeder
   `wo_seed_prep_checklist`, migration `20261103`): Touch-up sweep done ·
   Site left clean · **Rubbish for collection? (yes/no)** · **Equipment for
   collection? (yes/no — yes needs the list)** · Final photos taken ·
   **All work completed to the level required** · **Any notes for the customer**
   (optional). A line under the list says ticking it is the painter's
   confirmation the work was done to scope. `wo_checklist_items` gained
   `kind` (tick|yes_no|note), `item_key`, `answer`, `answer_note`, `handled_at`.
   Questions go through **`wo_answer_checklist_item`** — the tick RPC now
   refuses them (`error:answer_required`). Old five-item lists are migrated in
   place (rubbish/equipment become the questions; a past tick reads as "yes,
   already handled", so nothing historic pops up).
2. **A rubbish or equipment YES is a dashboard card** ("Rubbish to collect" /
   "Equipment to collect", with the painter's list) on the Projects dashboard;
   **Organised** (`wo_handle_collection`, staff only) clears it. It carries
   its own ref, so it survives the job closing.
3. **The customer's note** shows on the `/s` sign-off page ("A note from your
   painter") — `wo_prep_note_by_token`, customer OR session token.
4. **A passed quality check moves the job on — in the database** (second
   ruling the same night, migration `20261104`): `wo_record_qa`'s LAST pass
   calls `wo_qa_route_passed` → `wo_deliver_evidence_pack` + draft report →
   job at Walkthrough, customer link minted, wherever the pass was logged
   (returns `ok:pass:walkthrough` / `ok:pass:gate:<why>` / `ok:pass`). Both
   job pages SELF-HEAL a job already parked passed-at-qa on view (staff or
   contractor session — the `qa→walkthrough` row admits the contractor actor
   for exactly that, never for a button) and the sweep backstops it
   (`qaRouted`). **The painter sees nothing customer-facing**: the "Quality
   check passed — send to the customer" card was removed; at qa they see the
   notice, and a pack-gate hold reads "waiting on the office: <why>". Staff
   keep "Send the pack" as a fallback. QA verdicts stay staff-only.
5. **The customer never sees the quality check.** There was no QA *stage* on
   any customer screen; the one leak — the signed report's "Quality checks on
   this job: N passed" line and our QA-kind photos — is gone from `/s`. The
   tally stays in the frozen report jsonb for our records. The sign-off flow
   itself (painter hands the phone over, customer approves areas and signs,
   report appears after signing) is unchanged — Tom prefers it as built.

Migrations `20261103` (prep questions — RUN LIVE) and **`20261104_wo_qa_pass_routes.sql`
(the in-database routing — read-back expects route_fn 1, record_fn 1,
record_routes true, draft_system_ok true)**. Until 20261104 runs, the app's
`wo_qa_route_passed` calls fail silently (best-effort) and a pass is a plain
pass — no breakage, just no auto-move.

Tests: 682 unit (4 new, console card); e2e `wo-prep-questions.spec.ts` (7 —
needs both migrations); five loop specs now complete prep through
`completePrep()` in `e2e/fixtures/woLoop.ts`. Drift test points at `20261103`.

---

# 22 Aug 2026 (later) — Projects console, pinned lanes, live ticks, site photos

Branch `feat/projects-console-photos`. Five things Tom asked for after driving
the console:

1. **Scheduling moved into the console as its first tab** (`/pc/schedule`), the
   sidebar entry "Live jobs" is now **Projects**, and the standalone Schedule
   sidebar entry is gone. `/schedule` permanently redirects, so old links and
   `e2e/offer-accept.spec.ts` still work.
2. **The contractor column pins** while the dates scroll.
3. **Day names sit above the date numbers** at every zoom level.
4. **The job sheet reads the live ticks**, so a ticked area no longer reads
   "Not started". The snapshot's per-surface status is frozen at issue — that
   was the bug.
5. **Site photos are visible**: on the console job screen (grouped by kind, and
   under the variation each one justifies), on the job sheet, and as a "Latest
   from site" strip on the Projects dashboard.

**⚑ ONE MIGRATION TO RUN:** `supabase/migrations/20261024000000_wo_ticks_by_token.sql`
— a security-definer read that lets the ANON contractor link at `/w/<token>` see
the ticks (RLS rightly refuses it `wo_surfaces` directly). Everything else works
without it; until it is applied, `/w/<token>` alone still shows "Not started",
and `e2e/wo-photos.spec.ts` skips that one test with a message saying so.

Manual test script: `docs/manual-tests/projects-console-and-site-photos.md`.
Tests: 558 unit (14 new), and `e2e/wo-photos.spec.ts` (4 tests — one skipped until the
migration lands). Note the sidebar label in the section below is now "Projects".

---

# 22 Aug 2026 — work order completion loop + PC Command console: SHIPPED

**On main, deployed, verified against production: 103 e2e, 546 unit tests, 0 lint
errors.** Every migration through `20261023` is applied to the live database.

## What a job can now do, end to end

Estimate accepted → work order → **offered** (dates land on the WO immediately,
marked *Requested* in amber) → contractor accepts (stage follows the booking by
trigger; their pre-start list appears) → **pre-start** (six items, colours derived
from the job-sheet chips, colours block materials, the gate refuses a start until
the list is true) → **in progress** (auto-starts on its booked date via the 6pm
sweep, or early with a confirm that moves the start date) → per-surface ticks
with a server-side before-photo gate, photos and notes from site, two-sided
variations → **QA** (four tickable Level-3 standards; a pass needs all four, a
fail puts rectification on the same tick list) → **completion prep** on the
painter's phone → **walkthrough** (customer approves or flags per area; a flag
returns the job to the painter) → **type-to-sign** → **closed**, which fires
warranty, review task, completion report and invoice stub in one transaction.

The PC console (`/pc`, "Live jobs" in the sidebar) reads all of it: pulse tiles,
a ranked queue, the seven-lane pipeline, and a work-order view where staff price
variations, work the checklists, record QA, reoffer a lapsed job, move the stage,
and tick on the painter's behalf.

## Still open — start here next session

1. **`job_kind` control.** The column, the enum and the SWMS consequence are
   live; there is NO UI to set it, so every job reads `residential`. A select in
   the builder header, wired to the column (its UPDATE grant already exists).
2. **Nothing writes `source='trade_wizard'`** — the wizard's "My business" path
   is not built, so commercial jobs need setting by hand once (1) exists.
3. **Completion report view** — deliberately deferred to the customer portal
   (Rulings, 22 Aug). It is generated and stored at every sign-off; nothing
   renders it.
4. **Calendar shows one job per day** — see Known limitations. Failing test to
   write first.
5. **Offer address** — Tom reported seeing a street number on an offer; I could
   not reproduce (`suburbOnly` renders "Carlton North" correctly, server-side).
   `WO-GBKAAPEK` is a live offer to TR Painters — check it as a contractor.

## How to verify anything here

    npm test                     # 546, no DB needed
    npx tsc --noEmit
    npm run lint                 # read the ✖ line, NOT the "potentially fixable" line
    E2E_BASE_URL=https://paint-group-platform.vercel.app \
      CRON_SECRET=<from Vercel> npx playwright test e2e/wo-*.spec.ts e2e/pc-console.spec.ts

Demo data: `npx tsx scripts/seed-demo-loop.ts` (and `--destroy`). Three jobs,
prefixed WO-DEMO: an offer to accept, one on site, one at walkthrough.

## What this build kept teaching

- **A migration running is not the same as its statements applying.** Four
  half-landed: policies missing, a backfill refused by its own guard, a trigger
  absent, a seeder that would have refused every contractor. Every symptom was
  SILENCE. Every migration now ends with a `select` whose output must be read
  back — and short SQL pasted into chat lands where long attached files did not.
- **Never verify RLS through the service key.** It bypasses RLS, so an absent
  policy set survived six steps. `e2e/wo-rls.spec.ts` asserts every read through
  each role's own session.
- **A test that calls the API cannot tell you a screen is unreachable.** The
  stage machine was fully tested while no button called it; Tom found it by
  trying to start a real job.
- **Run against production, not just preview.** Comparing server-action
  references works in dev and breaks in a production build — "Approve & send"
  silently did nothing.
- **Flaky usually means real.** The reoffer flake was a genuine hole: breached
  offers expire within minutes and both the card and the button ignored them.

---

# Rulings — Tom's business decisions, recorded the day they are made

**Why this section exists.** The Reoffer decision was made in an earlier session,
lived only in chat, and went missing — it had to be restated on 22 Aug. Every
business ruling from here goes in this section on the day it is made, with the
date and enough of the reasoning to act on it without the conversation.

### 2026-08-22 · A job goes live when its date arrives, not when someone remembers
The pre-start list is meant to be closeable a week or two out; finishing it and
the job going live are two different events. So: tick the list any time, and the
6pm sweep starts the job on the morning of its booked date if the list is true
(`wo_autostart_sweep`, event `via: start_date_arrived`). The gate still decides —
an unfinished list simply waits, amber on the console with the blocker named.
Starting early is still possible, but it asks first and **moves the start date to
today**, or the silent-site check would flag the job every morning for turning up
early.

### 2026-08-22 · Staff work the same tick list as the painter
The office needs to update a job from their side during a quality visit, with
the contractor's view rather than a read-only copy. `wo_tick_surface` already
allowed staff, so this was a UI gap: the component moved to
`app/components/wo/TickList.tsx` and takes a `surface` prop that switches class
names only. Same RPC, same before-photo gate (the office meets it too), same
events — recorded as `staff` rather than `contractor`.

### 2026-08-22 · Reoffer is a real action, not a deep-link
When an offer breaches its SLA, the console's **Reoffer** does all of this:
1. Tap → **confirm dialog** (a human between two contractors).
2. **Withdraw the lapsed offer**, logged as an event.
3. **Create the next offer** to the chosen contractor through the existing
   scheduling flow — not a second offer path.
4. **Notify the lapsed contractor** courteously: their offer has lapsed and the
   job has been reoffered. No blame, no silence.

### 2026-08-22 · Job kind drives SWMS
`estimates.job_kind` — `residential | commercial | body_corporate`, default
`residential`. Staff set it in the builder header; the wizard's "My business"
path writes `commercial` automatically. The SWMS / induction pre-start item is
**required** for commercial and body corporate, optional for residential.

### 2026-08-22 · The completion report waits for the customer portal
It is generated and stored at every sign-off, so nothing is lost by waiting.
Rendering it staff-only would be half a feature; it ships whole when the
customer portal lands, beside the customer's warranty and job history.

### 2026-08-21 · Deemed sign-off ships OFF
Two switches, not one. `clockEnabled: true` runs the 0/24/48h reminder ladder;
`deemedEnabled: false` until the clause passes ACL/UCT review. While deemed is
off the reminder copy must not mention deemed signing, automatic sign-off,
invoices or payment — asserted by `lib/workorder/signoff.test.ts`. Jobs wait at
walkthrough for a human signature.

### 2026-08-21 · Timestamps are computed, communications are never backdated
A late-discovered nudge still sends, late. Each rung fires at most once. A sweep
that runs a day late produces one late result, not a week of them at once.

---

# Known limitations — recorded, not forgotten

### Calendar shows one job per day
`app/portal/calendar/CalendarGrid.tsx` keys booked days by date
(`Map<date, job>`), so when two jobs fall on the same day **only the last one
renders**, and tapping it opens that one. Found 22 Aug when an e2e fixture
overlapped a demo booking and "opened the wrong job".

Acceptable while a contractor runs one job at a time. **Contractors will be
running crews across two sites within months**, so this is scheduled for the
contractor-portal polish phase, not left to be discovered.

**TODO (write the failing test first):** `e2e/wo-booking.spec.ts` — book two
jobs on the same day for one contractor, assert both are reachable from that
day's cell. It will fail today; that is the point.

---

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

---

# 21 Aug 2026 — Tom's editor batch (9 asks), ON MAIN

Driven on the real screen; `e2e/customer-journey/doors-tiles-steppers.spec.ts`
is the new guard (3 tests). 387 unit tests green, `npm run build` clean.

| Ask | What was actually wrong | Fix |
|---|---|---|
| "It only lists doors, without frames — should we offer doors only, door and frame, and architrave?" | The card has carried all four door codes plus `Architrave (1 Side)` since v7. The estimator only ever wrote the "and Frame" codes and never an architrave, so the question could not be answered at all | `lib/extract/scope.ts` gains `DoorScope` (`door` \| `frame` \| `architrave`) with `doorCodeFor` / `doorStyleOfCode` / `doorScopeOfCode` / `doorLineLabel`. New wizard question on page 4, a `With each` segment on the Doors tile, and `room_door_scope` on wizard-edit. **Default is `frame` — every estimate written before today already means that, so nothing reprices.** "+ architrave" adds a REAL Architrave line at the room's door count, visible on the Architraves tile; it is never a hidden loading, and the door count carries it |
| "When I click in the WC, skirting boards weren't available to add" + "if doors aren't included in the main estimate, they're not coming up in the tile" | Same root cause. Tiles came only from `room_type_scope_rules`, and v3 gives a WC/bathroom/kitchen/laundry/storage/garage **no Skirting Boards rule**, and storage/garage **no Door & Frame rule**. Those surfaces had no tile — only the "+ Add a surface" panel, if you thought to open it | `ALWAYS_OFFERED` in `scope-editor.ts`: walls, ceilings, cornices, skirting, doors, windows, architraves are tiles in EVERY room, off if not in scope, never in the "More surfaces…" tail. **The rules still decide what is ON** — Tom's wet-area "ceiling and door only" default is untouched |
| "Make the size question stand out so it's easy to answer first" | It sat between the tiles and the cupboard question in the same 14px weight as everything else | `.il-first` panel + `FIRST — THE SIZE OF THIS ROOM` kicker, amber edge, bigger chips; settles to cyan once answered so a finished room stops shouting. Same treatment on a side |
| "I chose winder window and it gave me awning casement in the builder" | A winder IS priced at the awning/casement rate (right rate family, no winder row on the card) but the LINE was labelled with the rate code | `windowStyleLabel()` — the line now says "Winder window (awning/casement rate)". Every style carries its own label, internal and client-facing |
| "Add unpainted brick as an option in the builder (3 x coats)" | No such row, and `default_coats` had existed since rate card v7 with **nothing reading it** | Migration `20260925000000_unpainted_brick.sql` + `brick_unpainted` substrate. `default_coats` is now read: the builder seeds a new surface's coats on the first substrate pick, and the sides "+ wall surface" add does the same |
| "I can't untick items from exterior quotes, all should be untickable" | SidesEditor rendered walls, side tiles and customs as permanently `on` with no control. The interior has had `room_remove_line` since R5 | `removeSideLine` / `removeSideCustom` + a × on every tile. A removed WALL hands its share to the biggest wall left so the side still totals 100%; the LAST wall refuses ("use No — skip this side"), because a wall-less side is a skipped side |
| "Remove accept estimate from the bottom of the exterior wizard — all exterior jobs need estimator sign-off" | — | `policy.ts`: `jobType !== "interior"` → visit tier, reason `exterior_signoff`, whatever the size or accuracy. The self-serve branch is DELETED from SidesEditor, not hidden. New `visitReason` fallback `signoff` ("Every exterior job is signed off by your estimator — "). Supersedes the v2 rung "straightforward exterior ≤$12k at ≥85%"; the interior rung is untouched |
| "Doors move quickly, but windows don't — anything with a +/- should move the same" | R5 gave the TILE stepper optimistic counts + coalescing. The window-group and cupboard steppers still posted one request per tap computed off the SERVER's count — the exact two bugs R5 fixed | ONE `stepBy()` helper behind all three. Verified on the real screen: three quick taps land on 4 within 3s and are still 4 after the save |

**SQL Tom must run: `20260925000000_unpainted_brick.sql`** (one insert + one
update, idempotent). Until then the unpainted-brick tick is simply not offered
anywhere — a substrate whose code the card doesn't carry is offered nowhere.
Everything else in this batch is pure code.

**Gate note.** The full serial journey run showed 21 passed / 9 failed, and all
nine failures were the documented **Supabase anonymous sign-in rate limit** —
`/estimate` renders "The estimate wizard isn't available just now" and Continue
stays disabled (screenshot captured). All nine were re-run in isolation with
cool-downs and **all nine pass**. This is env, not code; see the working
agreement below. Both new specs passed inside the full run too.

## 21 Aug, follow-up — "please make the floorplan view bigger"

Second time the plan's visibility has come back (R5 pinned it; this makes it
readable). Guard: `e2e/customer-journey/plan-panel.spec.ts` — the ONE spec
that uploads a real plan from the regression corpus and pays for one
extraction, because everything it checks needs a plan on file.

- **The pinned column grew with the viewport.** It was a flat `340px` at every
  width, so a 27" screen showed the same postage stamp as a laptop. Now
  400 / 480 / 580px at 900 / 1200 / 1500px, and the frame uses
  `calc(100vh - 300px)` instead of a flat `70vh`. Measured at 1512×900:
  frame 546×364, where the whole column used to be 340 wide.
- **⤢ BIGGER** on the plan header throws it over the whole page — same zoom
  and pan, ✕ CLOSE / Escape / backdrop-click to come back. Measured
  1442×763 on the same screen.
- **Two bugs found only by driving it**, both invisible to unit tests:
  1. The overlay rendered UNDERNEATH the frozen header and the sticky footer
     despite z-index 130 vs 45/60 — confirmed with `elementFromPoint`
     (`.sc-freeze` on top at the header, `.sc-row` at the footer), so ✕ CLOSE
     was unreachable and Escape was the only way out. Fixed by PORTALLING the
     overlay (and the photo lightbox, which had the same latent bug) to
     `document.body`. If you add another page-level overlay in this editor,
     portal it — do not just raise z-index.
  2. The overlay grew PAST the viewport (961px tall in a 900px window) because
     a flex item's `min-height` defaults to its content. `min-height: 0` on
     both the box and the frame.
- The full-screen frame is `background: transparent`: `object-fit: contain`
  letterboxes a 3:2 plan in a wide window, and the inherited white frame
  turned those bands into two bright slabs either side of the plan.

Note for whoever debugs this next: a Playwright screenshot can beat the image
decode, and the plan then photographs as a pure white box. `await img.decode()`
before the screenshot — the image was fine every time.
