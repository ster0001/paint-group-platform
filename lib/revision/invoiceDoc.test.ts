import { describe, expect, it } from "vitest";
import { revisionInvoiceDoc, type InvoiceVariationRow } from "./invoiceDoc";
import type { SheetLine } from "@/app/i/[token]/InvoiceSheet";

const header = { billed_to: "Sam Example", job_address: "1 Test St, Melbourne", job_title: "1 Test St" };
const contract: SheetLine[] = [
  { description: "Lounge — walls", amount_ex_cents: 100_000, source: "estimate_snapshot", qty: null, approved_on: null },
];
const v = (o: Partial<InvoiceVariationRow>): InvoiceVariationRow => ({
  id: "v", status: "priced", price_cents: 11_000, credit: false, comment: "Extra door",
  revision_block_ref: null, signed_at: null, ...o,
});

describe("revisionInvoiceDoc", () => {
  it("contract only: GST is one rule on the net subtotal", () => {
    const { doc, pendingCount } = revisionInvoiceDoc({ header, contractLines: contract, contractSubtotalExCents: 100_000, variations: [] });
    expect(doc.subtotal_ex_cents).toBe(100_000);
    expect(doc.gst_cents).toBe(10_000);
    expect(doc.total_inc_cents).toBe(110_000);
    expect(pendingCount).toBe(0);
  });

  it("a PENDING quick-priced variation is a line, flagged, and in the total at its approved figure", () => {
    const { doc, pendingCount } = revisionInvoiceDoc({
      header, contractLines: contract, contractSubtotalExCents: 100_000, variations: [v({})],
    });
    const line = doc.lines.find((l) => l.source === "variation")!;
    expect(line.pending).toBe(true);
    expect(line.approved_on).toBeNull();
    expect(line.amount_ex_cents).toBe(10_000);
    expect(doc.total_inc_cents).toBe(110_000 + 11_000);
    expect(pendingCount).toBe(1);
  });

  it("a signed variation carries its Melbourne approval day; a credit subtracts", () => {
    const { doc } = revisionInvoiceDoc({
      header, contractLines: contract, contractSubtotalExCents: 100_000,
      variations: [
        // 1 Nov 2026 22:30 UTC = 2 Nov 9:30am Melbourne (AEDT)
        v({ id: "a", status: "customer_approved", signed_at: "2026-11-01T22:30:00Z" }),
        v({ id: "b", status: "contractor_accepted", credit: true, price_cents: 5_500, comment: "No skirting" }),
      ],
    });
    const [add, credit] = doc.lines.filter((l) => l.source === "variation");
    expect(add.approved_on).toBe("2026-11-02");
    expect(add.pending).toBe(false);
    expect(credit.amount_ex_cents).toBe(-5_000);
    expect(credit.description.startsWith("Credit — ")).toBe(true);
    expect(doc.total_inc_cents).toBe(110_000 + 11_000 - 5_500);
  });

  it("a builder-drafted variation is already in the working scope — named when pending, never added twice", () => {
    const { doc, pendingInScope, pendingCount } = revisionInvoiceDoc({
      header, contractLines: contract, contractSubtotalExCents: 100_000,
      variations: [
        v({ id: "r1", revision_block_ref: "block:x", comment: "Hallway ceiling" }),
        v({ id: "r2", revision_block_ref: "block:y", status: "customer_approved" }),
      ],
    });
    expect(doc.lines.filter((l) => l.source === "variation")).toHaveLength(0);
    expect(doc.total_inc_cents).toBe(110_000);
    expect(pendingInScope).toEqual([{ title: "Hallway ceiling", incCents: 11_000, credit: false }]);
    expect(pendingCount).toBe(1);
  });

  it("raised, declined, cancelled and unpriced rows never appear", () => {
    const { doc, pendingCount } = revisionInvoiceDoc({
      header, contractLines: contract, contractSubtotalExCents: 100_000,
      variations: [
        v({ status: "raised" }), v({ status: "declined" }), v({ status: "cancelled" }), v({ price_cents: null }),
      ],
    });
    expect(doc.lines).toHaveLength(1);
    expect(doc.total_inc_cents).toBe(110_000);
    expect(pendingCount).toBe(0);
  });
});
