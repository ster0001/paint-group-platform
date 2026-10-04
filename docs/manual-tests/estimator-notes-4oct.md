# Estimator notes — manual test (4 Oct 2026)

Branch `feat/estimator-notes`. Migration **20270211000000_estimator_notes.sql** — paste it (starts with
`set lock_timeout`), compare the read-back row to `_expect_` (1 / 3 / true / true), confirm the `_prod_migrations` row.
Supabase → Storage: a private bucket **estimator-notes** now exists.

1. Open any saved estimate in the builder. The first thing on the page, above the estimate header, is a bar
   **Estimator notes · internal · PC command sees these on the project page …** with a count chip. Click it to open.
2. Type "Gate code is 4471, dog in the yard" → **Add note**. It appears below, dated, with your name. The chip reads **1 note**.
3. **● Record voice note** → allow the microphone → say a sentence → **■ Stop & save**. A **🎙 Voice** entry appears with
   a player and its length (e.g. 0:06). Play it.
4. Type a caption before recording: it is saved under the voice note.
5. Projects → open the job for that estimate. Under the header, before the tick list, the same **Estimator notes** card
   shows both entries; the player works. Add a note here; back in the builder it is there too.
6. **Delete** the text note on the PC page; the builder's list agrees after a reload.
7. Open the painter's link (/w/…), the customer's estimate link (/e/…) and the portal as a contractor: no trace of the
   note anywhere. As a contractor in the portal, the console card is simply not there (the console is staff only).
8. A new estimate (never saved): the bar says "Save the estimate once and the notes live here".
9. In Safari on an iPhone: Record works (saves as mp4) and plays back.
