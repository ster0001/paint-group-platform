# Manual test — revision INVOICE → PDF with pending variations (2 Nov 2026)

1. Open an accepted job's **Revise scope** (job page → Revise scope, or Payments → job → Revise scope).
2. Add a room, **Save working scope**, then **Save & draft variations for signature**. Don't sign it.
3. On the job's PC Command page, quick-price a raised variation (hours path) so it reads PRICED. Don't sign it.
4. Back in Revise scope, press **View invoice**.
   - The console variation is its own line under *Variations — during the job, approved or awaiting your approval*, tagged **Awaiting your approval** in amber.
   - The amber note reads *Costs to date, for your information — not a request for payment. It includes 2 changes still awaiting your approval…* and names the room you added, with "(in the prices above)".
   - Total (inc GST) = the working scope's total + the console variation's price.
5. Press **Download PDF**. A file `invoice-<street>.pdf` downloads. Open it: same sheet, same total, no "Live from the working scope" staff line.
6. Change something in the builder **without saving**, go to INVOICE, press **Download PDF**. Expect "Save the working scope first — the PDF is made from what's saved."
7. Sign one variation as the customer, reload. Its line now reads "✓ Approved <date>" and the pending count drops by one.
