# Manual test — line items with hours on the work order (11 Nov 2026)

Before you start: `20270309000000_wo_line_item_hours.sql` is pasted and `public._prod_migrations` has its row.

## 5 Milton Street Carnegie (job 170)
1. PC Command → open job 170 (WO-PDYEFKES) → **Edit job sheet** or open the job sheet link.
   - **Estimated hours** reads **37.1 h** (was 27.1 h).
   - Under the rooms, an area **Deck around Pool** lists the pressure wash / oxalic / sand / Cutek lines and **10 h**.
2. Schedule board: job 170 in the tray sizes to the 37.1 h (5 days at one painter).
3. Send the offer as usual. The painter's offer card says **37.1 H** calculated labour hours; the pay is unchanged at **$2,300.32**.

## The other open jobs the repair touched
4. On any of jobs 123, 137, 159, 160, 161, 162, 164, 168, 169, 171, 173: the job sheet has an area per line item with hours (Cleaning, scaffolding, plaster repair…), and the tick list (Painter's view) has one row for it.
5. The job's activity shows **line_hours_added** with the lines and the hours before → after. Pay and booking dates are unchanged.
6. For a job already booked (pre-start), check the booking still covers the new hours; extend it on the board if not.

## New estimates
7. Build an estimate with a room and an **Hourly** line item (e.g. Cleaning, 3 h) and a **Custom** line with no work-order hours (e.g. Parking $50). Save.
8. Open the work-order preview: **Cleaning** is its own area with 3 h; **Parking** is not on it. Estimated hours = rooms + 3.
9. Customer accepts; the issued job sheet and the offer carry the same hours.
