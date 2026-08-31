import { test, expect } from "vitest";
import { buildTradeMoney, tradeMoneyCsv } from "./tradeMoney";
import type { MoneyInvoice, MoneyPayment } from "./money";

const TODAY = "2026-08-31";
const inv = (over: Partial<MoneyInvoice>): MoneyInvoice => ({
  id: "i1", estimate_id: "e1", kind: "final", status: "issued", number: "PG-1",
  token: "t1", issued_on: "2026-08-10", due_on: "2026-09-10",
  total_inc_cents: 231000, gst_cents: 21000,
  ...over,
} as MoneyInvoice);

const base = () => ({
  properties: [
    { id: "p1", address: "9 Mitford St", suburb: "St Kilda" },
    { id: "p2", address: "3 Tennyson St", suburb: "Elwood" },
  ],
  references: [{ property_id: "p1", label: "Owner", value: "K. Adebayo", sort: 0 }],
  estimates: [{ id: "e1", property_id: "p1" }, { id: "e2", property_id: "p2" }],
  invoices: [] as MoneyInvoice[],
  payments: [] as MoneyPayment[],
  todayYmd: TODAY,
});

test("tiles sum outstanding balances and overdue balances to the cent; drafts never appear", () => {
  const view = buildTradeMoney({
    ...base(),
    invoices: [
      inv({ id: "i1", estimate_id: "e1", number: "PG-3172", due_on: "2026-08-22" }), // overdue $2,310.00
      inv({ id: "i2", estimate_id: "e2", number: "PG-3169", total_inc_cents: 594000, gst_cents: 54000 }), // outstanding
      inv({ id: "i3", estimate_id: "e2", number: "PG-DRAFT", status: "draft" }), // never visible
      inv({ id: "i4", estimate_id: "e2", number: "PG-PAID", status: "paid", total_inc_cents: 69300, gst_cents: 6300 }),
    ],
    payments: [{ id: "pay1", invoice_id: "i4", amount_cents: 69300, status: "succeeded", paid_on: "2026-08-20", receipt_number: "R-1" }],
  });
  expect(view.outstandingCents).toBe(231000 + 594000);
  expect(view.outstandingCount).toBe(2);
  expect(view.overdueCents).toBe(231000);
  expect(view.overdueCount).toBe(1);
  // Groups: the overdue property leads; the paid invoice shows zero balance.
  expect(view.groups[0].address).toBe("9 Mitford St, St Kilda");
  expect(view.groups[0].refLine).toBe("Owner · K. Adebayo");
  const paidRow = view.groups.flatMap((g) => g.rows).find((r) => r.number === "PG-PAID")!;
  expect(paidRow.paidCents).toBe(69300);
  expect(paidRow.balanceCents).toBe(0);
  expect(view.groups.flatMap((g) => g.rows).some((r) => r.number === "PG-DRAFT")).toBe(false);
});

test("a partial payment reduces the balance, not the total — the ledger to the cent", () => {
  const view = buildTradeMoney({
    ...base(),
    invoices: [inv({ id: "i1", status: "partially_paid" })],
    payments: [{ id: "pay1", invoice_id: "i1", amount_cents: 100000, status: "succeeded", paid_on: "2026-08-15", receipt_number: "R-2" }],
  });
  const r = view.groups[0].rows[0];
  expect(r.totalIncCents).toBe(231000);
  expect(r.paidCents).toBe(100000);
  expect(r.balanceCents).toBe(131000);
  expect(view.outstandingCents).toBe(131000);
});

test("CSV: §5.6 columns, references on every line, sums equal the view to the cent", () => {
  const view = buildTradeMoney({
    ...base(),
    invoices: [
      inv({ id: "i1", estimate_id: "e1", number: "PG-3172", due_on: "2026-08-22" }),
      inv({ id: "i2", estimate_id: "e2", number: "PG-3169", total_inc_cents: 594000, gst_cents: 54000 }),
    ],
  });
  const csv = tradeMoneyCsv(view);
  const [header, ...rows] = csv.trim().split("\n");
  expect(header).toBe("Property,References,Invoice no.,Issued,Due,Amount inc GST,GST,Paid,Status");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toContain("Owner · K. Adebayo");
  expect(rows[0]).toContain("overdue");
  // The last four cells (amount, GST, paid, status) never carry commas —
  // addresses do, and are quoted, so index from the end.
  const tail = (r: string, fromEnd: number) => { const c = r.split(","); return c[c.length - fromEnd]; };
  const amountTotal = rows.reduce((n, r) => n + Math.round(Number(tail(r, 4)) * 100), 0);
  expect(amountTotal).toBe(231000 + 594000);
  const gstTotal = rows.reduce((n, r) => n + Math.round(Number(tail(r, 3)) * 100), 0);
  expect(gstTotal).toBe(21000 + 54000);
});

test("an invoice on an estimate with no property lands in the Other group, never dropped", () => {
  const view = buildTradeMoney({
    ...base(),
    estimates: [{ id: "e9", property_id: null }],
    invoices: [inv({ id: "i9", estimate_id: "e9", number: "PG-OTHER" })],
  });
  expect(view.groups[0].address).toBe("Other work");
  expect(view.outstandingCents).toBe(231000);
});
