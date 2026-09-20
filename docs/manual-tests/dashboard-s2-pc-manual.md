# Manual test — Home dashboard v2 · session 2 (PC Command + Contractors)

No migration this session.

1. **As a PC login** (or the master): Home now shows **PC Command** and **Contractors** with real tiles;
   the "switches on" boxes are gone from those two sections.
2. **PC Command vs the console.** Open /pc in another tab. Offers past SLA on Home = the console's
   "Offer past SLA" cards, one per job; Silent 3+ days = its quiet-site cards; the Quality check tile's
   line ("N checks due") = its QA cards. Jobs to schedule + In progress + Quality check + Awaiting
   sign-off + pre-start jobs = the console's open-jobs pulse tile.
3. **Every tile opens its list.** Press each: the row count in the drill header equals the number on
   the tile (for "8 of 11" tiles the rows are the 11). **i** shows what it counts; **Export CSV**
   downloads the same rows.
4. **Materials est vs actual** (period): only jobs signed off in the range with a priced scope; the
   actual line says over/under and % of budget; a job with no supplier invoices matched reads $0 actual.
5. **Hours vs estimate / Days on site**: opt a painter in (Contractors → Asks for hours), have them
   finish a job with hours entered; the row reads "Entered by the painter"; a painter not opted in reads
   "From the schedule"; the tile line reads "actual on N of M jobs, schedule on K".
6. **Sales login**: neither section appears; /api/reporting/export?metric=pc.in_progress returns 403.
