# Booking confirmed lane — manual test (1 Oct 2026)

Branch `feat/booking-confirmed-lane-1oct`. No migration.

1. Projects → **Project progress**. The lanes read **01 Offer · 02 Booking confirmed · 03 Pre-start · 04 In progress · 05 Quality check · 06 Walkthrough · 07 Closed — final invoice sent**.
2. Find a job a painter has accepted whose start date is more than a week away. It sits in **02 Booking confirmed**, not Pre-start.
3. Find one due to start within the next 7 days (today counts). It sits in **03 Pre-start**.
4. Open the far-out job. The stage rail lights **02 Booking confirmed**; the **Next step** card is headed **02 Booking confirmed**; the Pre-start list card is still there and can be worked.
5. On the job sheet, move that job's start date to 7 days from today. Back on Project progress the card is now in **03 Pre-start** — nothing was pressed.
6. A booked job with no start date sits in **02 Booking confirmed**.
7. A booked job whose start date has passed but which has not been started sits in **03 Pre-start**.
8. Start a job. It moves to **04 In progress**; the note under the lanes says failure paths pour back into 04.
