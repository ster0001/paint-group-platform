# Movements — progress ledger

| Session | Branch | PR | Migration | _prod_migrations row | Status | Date |
|---|---|---|---|---|---|---|
| 0 recon | — (on `main`: bundle `2ef8a38f`, report) | — | — | — | ✅ report written: `docs/briefs/movements-session-0-report.md` | 19 Oct 2026 |
| 1 schema + seed | claude/focused-mirzakhani-1dffeb (worktree branch; plan said feat/movements-s1-schema) | (open from the compare link) | `20270279000000_movements.sql` | ⏳ awaiting Tom's paste — row read back on C1 only | ✅ built: migration converges on C1 (read-back 19/19), 26 RPCs, seeds run on C1 (68 branches, 12 template items), `e2e/movements-rpc.spec.ts` 7/7 on C1 | 19 Oct 2026 |
| 2 board engine | feat/movements-s2-board-engine | | — | — | | |
| 3 evaluator | feat/movements-s3-evaluator | | — | — | | |
| 4 week | feat/movements-s4-week | | — | — | | |
| 5 day + texts | feat/movements-s5-day | | | | | |
| 6 map + gear + settings | feat/movements-s6-map | | | | | |
| 7 crossings | feat/movements-s7-crossings | | | | | |
| 8 proof | feat/movements-s8-proof | | — | — | | |

## Decisions taken in sessions (⚑ numbers from the brief)
- S0: ⚑6 resolves to **titles** — both connected staff calendars hold `calendar.readonly` (report item 3).
- S0: ⚑4 **not done** — no browser Maps key in `.env.local`; Vercel unverified. Steps in report item 8.
- S0: ⚑12 — the template CSV's categories (`sprayer, ladder, sander, scaffold, trestles, exterior`) are not the brief's nine; Session 1's seed maps by name and refuses what it can't map (report item 9.1) unless Tom replaces the CSV first.
- S0: ⚑1 default — the company address is `settings.company_profile`, not a table (report item 9.7).
- S1: migration number is **20270279**, not 20270278 — `20270278000000_exterior_typicals` is taken by the exterior wizard branch (unrun); two files with one number have bitten before (20270272).
- S1: the v1 logistics brief (`claude-code-brief-pc-logistics.md`, cited as "as v1 §3.1" for equipment_items / supplier_branches / accounts) was never committed — not on main, not in history. The tables follow v2.2 §3.1's restatement plus the kickoff prompt's column list (`email, map_place_id, lat/lng, delivers_to_site, opens_weekday, favourite, active`); `equipment_status` = active · repair · retired · lost.
- S1: **§5 painter column limits are enforced by two definer read functions** (`movements_for_painter`, `supplier_branches_for_painter`), not by a base-table policy — Postgres column privileges are per role, staff share `authenticated`, so a column grant cannot tell a painter from the office. Base tables: staff policy only; customer and painter base reads answer `[]`.
- S1: paint chips group by `products.brand` matched on **product name** (`WOMaterial` has no product id — the Materials rows carry `product` text only). Blank brand → `paint:brand?` / "Paint (brand?)".
- S1: the rubbish answer (ruling 20) is `movement_update(id, {rubbish_how})`: `none` → decision not_needed + chip cancelled; `painter_disposed` → decision painter_supplies, recorded on the painter's last day as done; `painter_warehouse` → placed on the painter's last day (PM); `left_on_site` → stays in the tray as a collection chip; `{skip: {branch_id, in_date, out_date}}` turns it into `rubbish_in` (the out is made at booking as `hire_off:<id>`). An undecided chip refuses placement (`rubbish_undecided`).
- S1: `movements_sync_for_wo` has NO client grant (the trigger and the sweep call it as owner); staff re-sync by hand is `movements_sync_now`. The trigger also fires on INSERT of a work order with a snapshot, so e2e fixtures get chips at creation.
- S1: `movement_send_run_plan` is a logged stub (`run_plan_sent_at` + a `movement_run_plan_sent` event per job); Session 5 sends the text. `painter_alerted_at` / `client_notified_at` stay null until then — `movement_ordered` events carry which alert would fire.
- S1: hire costs → `job_costs` at off-hire (⚑9) and `material_costs.movement_id` are Session 7, not here.

## Defects found and fixed
- S0 (found, not fixed): `docs/gcal-setup.md:67` carries a plain-text contractor test login — to remove.
- S0 (found, not fixed): `20270215000000_wo_after_photos_waiver.sql` and `20270250000000_import_set_scope_real_pay.sql` have no `_prod_migrations` row.
- S0 (found, for S2): the Schedule drag has no pointer capture and no edge auto-scroll; day index is resolved by DOM order, not `data-day`.

## Session 1 — summary (19 Oct 2026)
Schema + RPCs + seeds, no screen. `20270279000000_movements.sql` (converging; applied twice on C1, read-back 19/19 expects, `_prod_migrations` row written by the file). Painters read via the two definer functions; customers nothing; demo wall on the four job-linked tables (`lib/demo/scope.ts` + triggers). Seeds on C1: 68 branches (all with centroids after paging the `visit_suburbs` read past the PostgREST cap — the first run only placed 22), 2 UNVERIFIED Taubmans inactive, 12 template register items (confirmed run; the unconfirmed run refuses). `e2e/movements-rpc.spec.ts`: 7 serial tests through staff / contractor / customer sessions covering every refusal the prompt names — 7/7 green on C1 via `./scripts/c1/run-e2e.sh` (the lock was held once by a sibling run; one retry, as the rule says). Found on the way: the v1 brief is missing (above); `WOMaterial` has no product id (brand by name).

## Session 0 — summary (19 Oct 2026)
Read-only. Bundle committed on `main` (`2ef8a38f`, with a `.gitignore` exception for `docs/briefs/data/*.csv`). File list confirmed complete. Ledger: `20270243`, `20270248`, `20270266` all live. `products.brand`: 7 of 47 blank (Dulux Professional Gloss Enamel among them) and `Cabot's`/`Cabots` split. Suburb centroids: 53/53 seed suburbs covered. Contradictions in report item 9 (12 points); the ones that change a session's work are 9.1 (seed categories), 9.2 (gate items addressed by label), 9.3 (Materials rows are snapshot JSON, no table), 9.9–9.11 (drag engine gaps, DOM-order hit-testing, no `e2e/scheduling/` dir).

## Tom's Session 4 notes → docs/briefs/movements-s4-notes.md
