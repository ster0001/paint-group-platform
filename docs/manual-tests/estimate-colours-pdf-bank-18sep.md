# Manual test · colour callout + PDF payment details (18 Sep 2026)

Branch `feat/colour-strip-pdf-bank`. No migration. Automated: `e2e/estimate-colours-pdf-bank.spec.ts`, `lib/customer/snapshot.test.ts`.

1. Open a sent estimate's customer link where a wall colour is still TBC → the amber **Colour consultation included** box sits under the price. Set every colour in the builder (Materials card), save → reload the customer link → the box is gone.
2. On any customer link press **Download estimate (PDF)** → in the print preview, under the deposit line, a **Payment details** box shows Paint Group + ABN, Account name, Bank, BSB, Account number (from Settings → Invoicing → bank details) and the reference EST-… · customer name.
3. Settings → Invoicing: change the BSB → the next PDF shows the new BSB (no redeploy needed).
