import { describe, expect, it } from "vitest";
import { buildReceiptHtml } from "./receiptHtml";
import { buildContractorInvoiceHtml } from "./contractorInvoiceHtml";

/**
 * F3-01 · The money documents had NO tests.
 *
 * `receiptHtml`, `contractorInvoiceHtml`, `remittanceHtml` and `reportHtml`
 * render the documents the business actually sends — receipts, contractor
 * invoices/RCTIs, remittance advices, completion reports. Every figure on them
 * is money and nothing asserted any of it, so `npm test` went green whatever
 * they produced.
 *
 * That gap is why A2-03 mattered: 36 divergent money formatters lived in the
 * layer between correct arithmetic and the reader's eye, and the arithmetic is
 * the only part that was tested.
 *
 * These are pure functions of their input — no database, no clock — so there
 * was never a good reason not to test them.
 *
 * The assertions deliberately pin the RENDERED figures, not the markup. A
 * document is allowed to be restyled; it is not allowed to change what a
 * number says.
 */

const ENTITY = {
  tradingName: "Paint Group",
  abn: "00 000 000 000",
  address: "1 Fixture Lane, Nowhere VIC 3000",
};

describe("receipt", () => {
  const html = () =>
    buildReceiptHtml({
      receiptNumber: "RCT-0001",
      invoiceNumber: "INV-0042",
      amountCents: 123_456,   // $1,234.56
      surchargeCents: 150,    // $1.50
      method: "bank_transfer",
      paidOn: "2026-08-28",
      billedTo: "A Customer",
      jobAddress: "2 Test St",
      entity: ENTITY,
    });

  it("shows the amount to the cent, with two decimals", () => {
    expect(html()).toContain("$1,234.56");
  });

  it("shows the surcharge as its own figure", () => {
    expect(html()).toContain("$1.50");
  });

  it("carries the receipt and invoice numbers", () => {
    const h = html();
    expect(h).toContain("RCT-0001");
    expect(h).toContain("INV-0042");
  });

  it("renders the paid date as a Melbourne calendar day, not a UTC shift", () => {
    // A bare yyyy-mm-dd is already a calendar day. Formatting it in local time
    // is what CLAUDE.md's date rule exists to prevent — 28 Aug must not print
    // as 27 Aug.
    expect(html()).toContain("28 August 2026");
  });
});

describe("contractor invoice", () => {
  const build = (over: Partial<Parameters<typeof buildContractorInvoiceHtml>[0]> = {}) =>
    buildContractorInvoiceHtml({
      heading: "TAX INVOICE",
      number: "CI-0007",
      submittedOn: "2026-08-28",
      dueOn: "2026-09-04",
      contractor: { company_name: "Test Painting Pty Ltd", abn: "11 111 111 111" },
      billTo: ENTITY,
      woRef: "WO-TEST01",
      jobTitle: "A job",
      source: "signoff",
      claimPct: null,
      offerCents: 500_000,
      additionsCents: 50_000,
      deductionLines: [{ label: "Rubbish", cents: 20_000 }],
      previouslyInvoicedCents: 0,
      subtotalExCents: 481_818,
      gstCents: 48_182,
      totalIncCents: 530_000,
      ...over,
    });

  it("shows the total to the cent", () => {
    expect(build()).toContain("$5,300.00");
  });

  it("shows the ex-GST subtotal and the GST as separate figures", () => {
    const h = build();
    expect(h).toContain("$4,818.18"); // subtotal ex
    expect(h).toContain("$481.82");   // GST
  });

  it("renders a deduction as −$X — minus outside the dollar sign", () => {
    // The document prepends the minus itself (`−${money(...)}`) and never
    // passes a negative to the formatter: additions are guarded > 0 and
    // deductions are filtered > 0. So the contract to pin is the RENDERED
    // string, not the formatter's sign handling.
    //
    // The first version of this test asserted `not.toContain("$-")` on a
    // fixture with no negative in it, which could only ever pass. A test that
    // cannot fail is not a test.
    const h = build();
    expect(h).toContain("−$200.00");
    expect(h).not.toMatch(/\$-\d/);
  });

  it("pins the heading — it is a legal statement, not a label", () => {
    expect(build({ heading: "TAX INVOICE" })).toContain("TAX INVOICE");
    expect(build({ heading: "INVOICE" })).toContain("INVOICE");
  });

  it("zero deductions render no deduction figure at all", () => {
    const h = build({ deductionLines: [{ label: "Nothing", cents: 0 }] });
    expect(h).not.toContain("$0.00");
  });
});
