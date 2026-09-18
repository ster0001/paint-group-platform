# Manual test · SWMS attached to an estimate (18 Sep 2026)

Branch `feat/colour-strip-pdf-bank` (second commit). No migration. Automated: `e2e/estimate-swms.spec.ts`.

1. Open any draft in the builder → Job settings → under Presentation, **SWMS for this job · None attached** → **Attach SWMS (PDF)** → pick a PDF → the file name appears with a 📄 link (opens the PDF). A non-PDF or an oversize file is refused with a reason.
2. **Save** → open the customer link → under "Why Melburnians choose us", a **SWMS** card sits right after the public liability card with **⤓ Download SWMS** → the PDF downloads.
3. Print / Download estimate (PDF) → a "Safe Work Method Statement" note says it is attached to the online estimate.
4. Back in the builder → **Replace PDF** swaps it; **Remove** then Save → the card is gone from the customer link.
5. **Follow-up.** With the "Built for commercial" presentation on the estimate, the **Download SWMS** button appears on its **SWMS & site inductions** card (beside "$20M public liability") near the top — and the separate SWMS card under "Why Melburnians choose us" is not shown. Note a DRAFT estimate's customer link is a 404 until it is sent: preview it on the builder's Estimate tab.
