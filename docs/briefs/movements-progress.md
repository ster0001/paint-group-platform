# Movements — progress ledger

| Session | Branch | PR | Migration | _prod_migrations row | Status | Date |
|---|---|---|---|---|---|---|
| 0 recon | — (on `main`: bundle `2ef8a38f`, report) | — | — | — | ✅ report written: `docs/briefs/movements-session-0-report.md` | 19 Oct 2026 |
| 1 schema + seed | feat/movements-s1-schema | | 2027NNNN0000_movements.sql | | | |
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

## Defects found and fixed
- S0 (found, not fixed): `docs/gcal-setup.md:67` carries a plain-text contractor test login — to remove.
- S0 (found, not fixed): `20270215000000_wo_after_photos_waiver.sql` and `20270250000000_import_set_scope_real_pay.sql` have no `_prod_migrations` row.
- S0 (found, for S2): the Schedule drag has no pointer capture and no edge auto-scroll; day index is resolved by DOM order, not `data-day`.

## Session 0 — summary (19 Oct 2026)
Read-only. Bundle committed on `main` (`2ef8a38f`, with a `.gitignore` exception for `docs/briefs/data/*.csv`). File list confirmed complete. Ledger: `20270243`, `20270248`, `20270266` all live. `products.brand`: 7 of 47 blank (Dulux Professional Gloss Enamel among them) and `Cabot's`/`Cabots` split. Suburb centroids: 53/53 seed suburbs covered. Contradictions in report item 9 (12 points); the ones that change a session's work are 9.1 (seed categories), 9.2 (gate items addressed by label), 9.3 (Materials rows are snapshot JSON, no table), 9.9–9.11 (drag engine gaps, DOM-order hit-testing, no `e2e/scheduling/` dir).

## Tom's Session 4 notes → docs/briefs/movements-s4-notes.md
