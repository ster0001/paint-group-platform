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
