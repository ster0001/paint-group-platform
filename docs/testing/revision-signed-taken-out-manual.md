# Manual test — a signed change taken back out is credited (20 Nov 2026)

1. Pick an accepted job with a revision variation the customer has already signed (e.g. an added surface).
2. Projects → the job → **Revise scope**. In **Changes vs the accepted estimate**, press **Undo change** on that section (or delete the added surface) and save.
3. Expect the row to stay, reading "<Section> — signed change taken back out · back to the accepted estimate" with **− $<signed figure>** in red, and no Undo button on it.
4. Press **Save & draft variations for signature**. Expect one credit in the offer for the signed figure. Send / copy the link.
5. Open the link in a private window (no login) and sign it.
6. Invoicing → the job → final invoice → **Redraft**. Expect the original variation line and a matching negative line; the total drops by the signed figure.
