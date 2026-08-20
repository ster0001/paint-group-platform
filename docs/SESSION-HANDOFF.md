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
