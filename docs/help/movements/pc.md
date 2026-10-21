---
feature: movements
role: pc
title: Plan the week's paint, materials, gear and rubbish on the Movements board
summary: How the Movements tab works — the tray of chips built from the jobs, the lanes for the supplier, each painter and each staff member, dragging a chip onto a day (or an hour), the chip sheet for the shop, time, order reference and note, Ordered ✓, Nearby and While-you're-there suggestions, and the Sources view that shows one materials list in its three places.
sources: app/pc/movements, app/pc/movements/DayView.tsx, app/pc/movements/run, app/components/board, lib/movements/evaluate.ts, lib/movements/load.ts, lib/movements/sync.ts, lib/movements/notify.ts, app/pc/movements/actions.ts
verified_at_commit: 48b17db4cd
---

## What this is for
**The tray is everything that has to move** this week — paint per brand, materials per line, gear, rubbish — built from the jobs. Amber = not yet planned. Anything can also be added from scratch. **Drag a chip onto a person's day.** Supplier lane = delivered (you place the order). A painter's lane = they pick it up or move it. Hourly lanes (Felipe's and Tom's, set in Settings → Movements) are in hours. Tick **Ordered** and the painter is told. **Nearby** on a day means there are chips close to where that person already is; tap a **While you're there** suggestion to drop it; open any chip for its shop, time and note.

The project coordinator uses it on a laptop on Thursday or Friday to plan the week ahead, and on a phone to drop one more chip from the van. Open it from **Projects → Movements** (the address is /pc/movements). Until Wednesday it shows this week; from Thursday, next week.

## Before you start
- Chips come from the jobs on their own: a paint chip per brand from the job's Materials card (one line per product), a materials chip per line on the job's materials list, and one **Rubbish — how?** chip per job. Gear chips you add yourself from the register, because the register does not know what a job needs.
- Who gets a staff lane, and whether that lane is in hours or AM/PM, is **Settings → Movements → board people** (Session 6 ships the screen; until then the office sets it). Painters appear as lanes when they have a job booked in the week.
- Paint can be **planned** before the colours are confirmed, but not **ordered** — the chip says so in amber.
- A delivery needs a shop that delivers. The Supplier lane refuses a chip whose shop is counter-only and tells you to pick another shop in the chip or drop it on a painter.

## Steps

### Planning the week
1. Open **Projects → Movements**. The headline says how many chips are still in the tray and how many movements are placed; **Orders to place** counts every placed delivery or pickup whose order you have not yet ticked. **‹ ›** moves a week at a time. The **How this tab works** strip opens on your first visit and folds away after; open it again from its title.
2. The **tray** on the left lists every chip, grouped by job (closed jobs with gear still on site are their own group; **Warehouse** chips last). Filter with **All · Paint · Materials · Gear · Rubbish** (the counts are live) or search by chip, job or suburb. An amber edge means not yet planned; a clay edge means the chip cannot be placed yet and the line under it says why (gear waiting on a return, a rubbish chip you have not answered).
3. The **board** is lanes × days: **Supplier delivers** first, then every painter booked this week, then the staff lanes. A painter's or the supplier's day splits **AM over PM**; an hourly lane shows **ten one-hour rows from 07:30**. What everyone is already doing is drawn in: green **On site** blocks from the schedule, violet calendar entries, cyan quality checks, job check-ins and walkthroughs, grey leave. A lane whose Google Calendar could not be read says so under the name instead of showing an empty day.
4. **Drag a chip** onto a half or an hour row. While you drag, the cells near where that person already is light cyan, the cell under your pointer lights green, and the ghost names the lane and the time; a red ghost says why the drop would be refused. Drop into an hour row and the movement takes that time. Drop a chip before its job ends (a return) or after it starts (a delivery) and the board places it but warns you.
5. The chip becomes a **card** on the day: the kind of movement (Paint delivery, Paint pickup, Gear drop-off, Gear collection, Skip in, Rubbish to warehouse …) in the lane's colour, the shop, the time, the job reference and a state line. A supplier order or a painter's pickup shows amber **Not ordered yet** with an **Ordered ✓** button; a staff-lane drop is booked by placing it. **Done** ticks it; **↩** sends it back to the tray (so does dragging it onto the tray).
6. Tick **Ordered ✓** once you have placed the order with the shop. That is what tells the painter: a pickup texts them the shop, its address, the from-time and the order reference; a delivery texts them what is coming and when. The texts are **drafts** until Tom switches them to automatic in Settings → Automations (Movements — your pickup is ready / a delivery is coming), so until then approve them from the queue. The client is told nothing unless you turned **Client notice** on in the chip. A paint order is refused until the colours are confirmed.

### Nearby and While you're there
1. A staff lane's day shows a cyan **Nearby N — see** pill when tray chips sit within the Settings radius (7 km by default) of somewhere that person already is that day. Tap it for the list, nearest first, and tap a chip to drop it on that day at the time of the appointment it is near.
2. Under a calendar entry or a quality check, one dashed **While you're there** suggestion names the single nearest tray chip. Tap it to drop it.

### The chip sheet
1. Tap any chip, in the tray or on the board. The sheet shows where it is placed and how it moves ("delivered to site", "Josef picks up", "Felipe drops off").
2. **Paint**: the lines are the job's Materials card for that brand — tap a line to change its colour name or litres (that edits the card; the chip re-reads it). Once ordered, the lines are frozen as they were at ordering.
3. **Materials**: the line text is the same row the estimate and the job page show.
4. **Gear**: the items, each with where it is now.
5. **Rubbish — how?**: **Painter disposed** (nothing to move, recorded on the painter's last day), **Painter drops at warehouse** (a drop-off on the painter's lane on their last day), **Left on site** (the chip stays in the tray as a collection — drop it on whoever collects, or make it a **Skip** from the chip with a hire yard and the in and out days).
6. **Shop** (or **Hire yard**) lists the branches of the right kind nearest first, with distance, opening time and whether they deliver. **Time** chips are the hourly rows on an hourly lane, otherwise early-morning times and AM/PM. **Order reference** is printed on the supplier's order and is what the invoice matches itself to. **Client notice** is off unless you turn it on for that delivery. Add a **note** for the shop or the painter.
7. **Ordered ✓** (when the order step is owed), **Copy order text** (paint with confirmed colours — paste into the email or the trade app), **Back to tray**, **Remove** (a chip you added by hand), **Save**.

### + Add a chip — from scratch
1. Tap **+ Add a chip** under the tray (or on the Sources view). Pick **Paint · Materials · Gear · Rubbish**, then the job (or **Warehouse**).
2. **Materials** on a job writes a line on the job's materials list — so it is on the job page and the estimate too — and the chip appears from that line. **Gear** shows the register with each item's current location; anything not at the warehouse cannot be ticked. **Rubbish** is refused for a job that already has its chip. **Paint** from scratch is a chip with your words; the office confirms the Materials card.

### Sources — one list, three doors
1. Switch to **Sources** and pick a job. Three cards show the same job: the **estimate's** crew notes, its internal Materials & sundries list and the Materials card's paint rows; the **job page's pre-start** with the two gate ticks (Materials ordered, Equipment movements booked), the paint chips per brand and the same materials list; and the **tray**, with this job's chips, live.
2. Add a line in any card and it appears in all three and becomes a chip in the tray. Remove it anywhere and it is gone everywhere — unless its chip is already on someone's day, in which case bring the chip back to the tray first.
3. The strip under the cards names the doors: the estimate, the job page, the painter's request (Accept as a line) and the tray.
4. Since Session 7 the doors are wired: the estimate's internal **Materials & sundries** lines become lines on the job when it is issued; **Accept as a line** on a painter's materials request (job page) makes a line and a chip; and the two pre-start ticks on the job page are real gates over the chips (Materials ordered needs every paint chip ordered or a Not needed / Painter supplies answer; Equipment movements booked needs every gear chip booked). The painter's completion-prep yeses (Equipment for collection, Rubbish for collection) confirm the job's return and rubbish chips instead of raising a card. An off-hire ticked Done with an expected cost writes the hire cost to the job; a supplier invoice carrying the order reference links itself to its order.

### Day — run plans
1. Switch to **Day** (or tap **Orders to place** in the header). Pick a day — each chip says how many moves are on it — and a person; the people chips are everyone with a stop that day, in their lane colour.
2. The timeline runs from the **warehouse** out: fixed appointments (a quality check, a calendar entry) are dashed with ◌; movements are numbered, with the kind of movement, what it is, where it goes and the kilometres from the previous stop. The header totals the stops and the km.
3. **▲▼** move a stop earlier or later. The times move with the stops — the same set of times, in the new order — so the Week board shows the same thing. **Ordered ✓** on a stop that still owes its order works here too; the big **✓** ticks a booked stop done.
4. **Send to <name>'s phone** texts the person their run for the day with a link: staff open their own list (Navigate, Ring, Done, Problem on each stop); a painter opens the **Your pickups and drop-offs today** card in the portal. Every press sends again, because the run can change.
5. The **Orders to place** card lists every placed delivery or pickup in the week whose order is not yet in, soonest first, each with its own **Ordered ✓** (or **Booked ✓** for a hire or skip). A paint row whose colours are still TBC is disabled and says so.
6. At 6 pm, a supplier delivery due today that nobody ticked Done texts the job's painter "did it arrive?" (draft-first, like the others).

### Gear — the register
1. Switch to **Gear**. Filter **All · At warehouse · Out on site · With a painter · Flagged**; the legend shows the nine type icons (step ladder, extension ladder 7 m and 10 m, platform ladder, spray gun, Planex sander, Festool vacuum, mobile scaffold, fall protection).
2. Each card is one item: its type icon, name and tag, where it is now and what carries it next, and a pill — **Warehouse** (green), **On site** / **On site · return booked** (cyan), **With painter**, **Repair**, or **On site · job closed** (clay — flagged). Location is never typed: it is the last ticked movement that carried the item.
3. Tap a card for its trail (every movement that carried it, done or planned). A flagged item has **Find it in the tray**, which opens its return chip on the Week board so you can drop it on whoever is passing; **Edit item** goes to Settings → Equipment.

### Settings — Suppliers, Equipment, Movements
1. **Settings → Movements → Suppliers**: every paint shop, hardware store and hire yard by brand. Filter by kind; tick **delivers**, **favourite** (first in the chip sheet) and **active** on the row; **Edit** for the address, suburb (its centroid places the shop), opening time and notes; **Add a branch** for a new one (its brand's vendor is created with it). Type the **trade account reference** in the box and press **Set**: it is saved to its own staff-only table and shown masked (••••1234) from then on — it never appears on a painter's screen or in the repo.
2. **Settings → Movements → Equipment**: the register. **Add item** with a name, type and serial; the tag (E-###) is given on save unless you type one. Change an item's status (active · repair · retired · lost) on the row; an item on a planned movement cannot be retired until that movement is finished.
3. **Settings → Movements → Movements**: the warehouse (label, address, suburb, postcode, optional lat/lng), the **Nearby radius** (7 km by default), the **planning horizon**, the **delivery confirm time**, the default AM / PM times, the hire-cost switch, the strip, and **board people** — who gets a staff lane, **AM / PM or 1-hour slots**, their colour, and whether quality checks and check-ins sit on their lane. The folder also says whether the Google Maps browser key is set: the Map view stays off until it is.

### On a phone
The board scrolls sideways with the lane names pinned on the left. The tray is a drawer at the bottom: tap **Tray** to open it, drag a chip up onto the board, and it closes behind you.

## What the colours and labels mean
- **Amber** — a chip not yet planned; a card whose order has not been placed (**Not ordered yet**); colours TBC on a paint chip.
- **Cyan** — ordered or booked; a Nearby pill; a quality check or job check-in block.
- **Green** — the cell you are about to drop on; an On site block from the schedule.
- **Violet** — a Google Calendar entry (read-only).
- **Clay** — a chip that cannot be placed yet, with the reason; a movement marked as a problem.
- **Grey** — leave; the supplier lane's colour.
- Each lane has its own colour dot; the same colour labels its movements everywhere.

## If something goes wrong
- **A line at the top says something could not be read** (the movements, the schedule, Google Calendar, the branches). The board draws what it could; nothing is silently empty. Reload; if it stays, send the line to Tom.
- **"That branch does not deliver to site"** — open the chip and pick a delivering shop, or drop the chip on a painter who can pick it up.
- **"The supplier lane is for orders. Drop our own gear on a person."** — our ladders and sprayers move with a person, never a supplier.
- **"That gear cannot go out until its return is done"** — the item is still at its last job; the return chip is in the tray, drop it on whoever collects it first.
- **"Say how the rubbish goes first"** — open the rubbish chip and answer the question.
- **"Confirm the colours before ordering the paint"** — finish the colour consult on the job page; the chip can stay placed meanwhile.
- **No staff lanes** — nobody is in Settings → Movements → board people yet.

## Related
- [scheduling/staff](../scheduling/staff.md) — the Schedule board the Movements board shares its engine with.
- [work-orders/pc](../work-orders/pc.md) — the job page and its pre-start gate.
- [portal-gaps/contractor](../portal-gaps/contractor.md) — the painter's materials requests that become lines.
