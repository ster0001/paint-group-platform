# Manual test · SWMS attached to an estimate (18 Sep 2026)

Branch `feat/colour-strip-pdf-bank` (second commit). No migration. Automated: `e2e/estimate-swms.spec.ts`.

1. Open any draft in the builder → Job settings → under Presentation, **SWMS for this job · None attached** → **Attach SWMS (PDF)** → pick a PDF → the file name appears with a 📄 link (opens the PDF). A non-PDF or an oversize file is refused with a reason.
2. **Save** → open the customer link → under "Why Melburnians choose us", a **SWMS** card sits right after the public liability card with **⤓ Download SWMS** → the PDF downloads.
3. Print / Download estimate (PDF) → a "Safe Work Method Statement" note says it is attached to the online estimate.
4. Back in the builder → **Replace PDF** swaps it; **Remove** then Save → the card is gone from the customer link.
