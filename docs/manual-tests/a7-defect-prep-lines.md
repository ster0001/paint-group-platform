# Manual test — A7: damage photos → prep lines

What changed: damage photos now actually produce prep. The defect reader is
asked the damage question directly (it used to be asked about doors and
windows, so it dutifully reported no defects), each priced defect becomes its
own "Prep — …" line with hours, an unpriceable defect shows an amber "needs
pricing" item instead of vanishing, and photo failures come back as words.

## Before testing — one seed check (2 minutes)

The prep rates table may be empty in the live database, which was one of the
silent failure paths. In Supabase SQL editor run:

```sql
select count(*) from defect_prep_rates where version = 3;
```

If it returns 0, run the seed from the project folder:

```bash
npm run seed:extraction
```

(needs SEED_STAFF_EMAIL / SEED_STAFF_PASSWORD set, same as before).

## Steps (10 minutes, phone for the photos)

1. Run **/wizard** with a floorplan, and on the damage page pick
   **"In real need of repair"** (tier 3). Add 2–3 real photos of damaged
   paint — peeling, cracks, water stains. iPhone HEIC straight from the
   camera is a good test on purpose.
2. Submit. On the processing screen:
   - ✅ You see "ANALYSING THE DAMAGE PHOTOS…" as a step.
3. When the editor opens:
   - ✅ Rooms matching the photos carry a line like
     **"Prep — Peeling (sev 2)"**, and the review list asks you to confirm
     the photo-detected prep.
   - ✅ Open the estimate in the builder: the prep line is there with hours
     and a cost, and the totals moved compared to a no-photos run.
4. **Amber check**: in Supabase, temporarily delete one defect type's row
   (e.g. `delete from defect_prep_rates where defect_type = 'peeling' and
   version = 3;` — re-seed afterwards), and run a wizard with a peeling
   photo.
   - ✅ The review list shows "peeling sev2 — needs pricing" in amber-land
     ("STILL TO SETTLE"), not nothing.
5. **Failure check**: put the phone in flight mode after page 4 (photos
   added) and submit.
   - ✅ The editor still opens (answers intact after reconnect) and the
     warnings include a readable message that the photos couldn't be
     analysed — the damage is flagged for review instead of silently
     unpriced.
6. Accept-path check: turn the estimate into a work order — the prep line
   rides through with its hours.
