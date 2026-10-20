# Manual test — invoice date and due date on invoices (20 Oct 2026)

No migration. Deploy, then:

1. **Payments → any job panel** (`/invoicing?job=…`). Every sent or paid invoice card shows a line under its number: `Invoice date Thu 15 Oct · Due Thu 22 Oct`. A draft card shows no line (a draft with a due date chosen shows `Due …` only).
2. **Open invoice** from a card (`/invoicing/inv/<id>`). The document meta has **Issued** beside **Due**. On a draft, Issued reads `— at issue`.
3. **The customer's link** (`/i/<token>`) on a PAID invoice. Top right under the number: `Issued 15 October 2026` and `Due 22 October 2026`. Before this change a paid invoice showed Issued only.
4. **The PDF** (Download on the card) of a NEW invoice issued after deploy carries both dates — the PDF is a print of the customer page. PDFs locked before deploy are unchanged (immutable by design).
