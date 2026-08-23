/**
 * Golden tests for THE adjusted-contract rule (§3) — snapshot + approved +
 * credited variations — plus the derived-overdue rule. The SQL twin
 * (`public.invoice_ledger`) is pinned to the same arithmetic by
 * schema.contract.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  adjustedContractCents,
  invoicedCents,
  isOverdue,
  ledger,
  paidCents,
  variationsCents,
  type LedgerVariation,
} from "./ledger";

// The mockup job: $18,540 accepted, gate/fence +$883, south-wall rot +$360.
const ACCEPTED = 1_854_000;
const APPROVED: LedgerVariation[] = [
  { status: "customer_approved", priceCents: 88_300 },
  { status: "contractor_accepted", priceCents: 36_000 },
];

describe("adjusted contract — the single computation", () => {
  it("snapshot only: no variations means the accepted total, untouched", () => {
    expect(adjustedContractCents(ACCEPTED, [])).toBe(ACCEPTED);
  });

  it("approved variations are append-only deltas (the mockup's $19,783.00)", () => {
    expect(adjustedContractCents(ACCEPTED, APPROVED)).toBe(1_978_300);
  });

  it("credit/descope variations subtract", () => {
    expect(
      adjustedContractCents(ACCEPTED, [
        ...APPROVED,
        { status: "customer_approved", priceCents: 50_000, credit: true },
      ]),
    ).toBe(1_978_300 - 50_000);
  });

  it("declined, cancelled, raised and merely-priced variations never touch the ledger", () => {
    expect(
      variationsCents([
        { status: "declined", priceCents: 99_900 },
        { status: "cancelled", priceCents: 99_900 },
        { status: "raised", priceCents: null },
        { status: "priced", priceCents: 99_900 },
      ]),
    ).toBe(0);
  });

  it("an approved variation with no price yet contributes nothing (not NaN)", () => {
    expect(variationsCents([{ status: "customer_approved", priceCents: null }])).toBe(0);
  });
});

describe("invoiced — issued+ only, net of credit notes", () => {
  it("drafts and voids never count", () => {
    expect(
      invoicedCents([
        { status: "draft", totalIncCents: 197_830 },
        { status: "issued", totalIncCents: 197_830 },
        { status: "void", totalIncCents: 593_500 },
        { status: "sent", totalIncCents: 593_500 },
      ]),
    ).toBe(197_830 + 593_500);
  });

  it("written_off stays invoiced (the document exists; the debt is forgone, not erased)", () => {
    expect(invoicedCents([{ status: "written_off", totalIncCents: 100_000 }])).toBe(100_000);
  });

  it("credit notes net off", () => {
    expect(invoicedCents([{ status: "paid", totalIncCents: 500_000 }], [120_000])).toBe(380_000);
  });
});

describe("paid — succeeded only, surcharge never included", () => {
  it("pending, failed and refunded payments don't count", () => {
    expect(
      paidCents([
        { status: "succeeded", amountCents: 197_830 },
        { status: "pending", amountCents: 99_999 },
        { status: "failed", amountCents: 99_999 },
        { status: "refunded", amountCents: 99_999 },
      ]),
    ).toBe(197_830);
    // Surcharge lives in its own column and is simply never passed here —
    // amountCents is the invoice money alone (§3: not job revenue).
  });
});

describe("the whole ledger — the mockup money strip", () => {
  it("contract 18,540 · variations +1,243 · invoiced 7,913 · paid 1,978 · balance 17,805", () => {
    const l = ledger({
      acceptedTotalCents: ACCEPTED,
      variations: APPROVED,
      invoices: [
        { status: "paid", totalIncCents: 197_830 }, // INV-0142 deposit
        { status: "sent", totalIncCents: 593_500 }, // INV-0151 progress
        { status: "draft", totalIncCents: 1_187_000 }, // final draft — not invoiced
      ],
      payments: [{ status: "succeeded", amountCents: 197_830 }],
    });
    expect(l.adjustedContractCents).toBe(1_978_300);
    expect(l.variationsCents).toBe(124_300);
    expect(l.invoicedCents).toBe(791_330);
    expect(l.paidCents).toBe(197_830);
    expect(l.balanceCents).toBe(1_780_470);
  });
});

describe("overdue is derived, never stored", () => {
  const base = { status: "sent" as const, dueOn: "2026-08-20", totalIncCents: 100_000, paidCents: 0 };

  it("due date passed + balance owing = overdue", () => {
    expect(isOverdue(base, "2026-08-24")).toBe(true);
  });
  it("not before the due date, and not ON the due date", () => {
    expect(isOverdue(base, "2026-08-19")).toBe(false);
    expect(isOverdue(base, "2026-08-20")).toBe(false);
  });
  it("a paid-off invoice can't be overdue whatever the date says", () => {
    expect(isOverdue({ ...base, paidCents: 100_000 }, "2026-08-24")).toBe(false);
  });
  it("draft, paid, void and written_off are never overdue", () => {
    for (const status of ["draft", "paid", "void", "written_off"] as const) {
      expect(isOverdue({ ...base, status }, "2026-08-24")).toBe(false);
    }
  });
  it("no due date, no overdue", () => {
    expect(isOverdue({ ...base, dueOn: null }, "2026-08-24")).toBe(false);
  });
});
