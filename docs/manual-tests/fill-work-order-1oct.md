# Fill two handover jobs from their PaintScout work orders (1 Oct 2026)

Quotes **3096** (92.75 h, 20 areas, interior offices) and **3666** (29 h, 7 areas, ceilings + plastering). Both pages parse cleanly (`parse` run 1 Oct: lines add to the banner on each). The production `check`/`run` is Tom's (needs the service key + `IMPORT_ALLOW_PRODUCTION=1`, which this session cannot run).

```bash
set -a; source .env.local; set +a
IMPORT_ALLOW_PRODUCTION=1 npx tsx scripts/import/fill-work-order.ts check 'https://app.paintscout.com/view/?view=work-order&u=va3r5bjhqmritrbqux' 'https://app.paintscout.com/view/?view=work-order&u=6mpdcuka5cs9buur6r' --save-dir /tmp/wo
```
Read the mapping lines (every WO area names the quote price it took; a ⚠ is an area with no twin) and "proves: $… inc GST" against the signed total. Then, from the saved text:
```bash
IMPORT_ALLOW_PRODUCTION=1 npx tsx scripts/import/fill-work-order.ts run /tmp/wo/3096.txt /tmp/wo/3666.txt
```
Expect `ok` ×2. Afterwards each job sits in the Unscheduled tray at Offer with its lines, hours and products on the **Work order** tab. `REFUSED … no imported estimate` means that quote was never handed over into the platform — import it first.

## 1 Oct, after the first check: what came back and what changed
- **3666 (74 Champion St)** joined and proved ($3,618.31 inc GST, 29 h, every area matched) but its job is at stage **in_progress**, which the fill refused (`skip:in_progress`). Tom: nothing on it is ticked, fill it. Migration **`20270208000000_import_set_scope_in_progress.sql`** admits an in_progress job whose tick list is untouched (the worked-rows guard is unchanged: any tick or rectification still refuses).
  1. Paste `supabase/migrations/20270208000000_import_set_scope_in_progress.sql` in the production SQL editor. The read-back row must be `true,true,true,true,false`; the `_prod_migrations` row is the proof.
  2. `zsh /tmp/wo/fill.sh run` → expect `ok` for 3666 (29 h, 7 areas). Run it again: `skip:filled`.
  3. On the test project, the same file via `node scripts/c1/reapply-one.mjs 20270208000000_import_set_scope_in_progress.sql` (the session could not run it).
- **3096** has no estimate on the platform (`no imported estimate … bk_3096`): the Airtable handover Zap never delivered it. Replay that record's Zap run (or move the record out of and back into *Future Booked Jobs*), then `zsh /tmp/wo/fill.sh check` and `run` again. The run refuses the whole batch while 3096 is missing, so fill 3666 on its own first if the Zap takes time:
  ```bash
  cd /Users/tomroman/Documents/paint-group-platform && export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" && set -a && source .env.local && set +a && IMPORT_ALLOW_PRODUCTION=1 npx tsx scripts/import/fill-work-order.ts run /tmp/wo/3666.txt
  ```

**Result 1 Oct:** 20270208 pasted on prod (read-back true,true,true,true,false); `run3666` → `ok 3666 74 Champion Street 29 h · 5 tick-list rows`. 3096 still waits on the Zap.

**Lonsdale St (1 Oct, later):** the platform job at 9/552 Lonsdale St was handed over as quote **3083** (PS-3083, 71.5 h); the work order Tom sent is quote **3096** (92.75 h, two coats). Tom: the job is right and 3096 is its work order. `fill-work-order.ts --for 3096=3083` fills the 3083 job from the 3096 page; the money proof runs against the job's own prices; `external_ref.work_order_quote_no = "3096"` records where the scope came from. Wrapper: `zsh /tmp/wo/fill.sh check3096` then `run3096`.
