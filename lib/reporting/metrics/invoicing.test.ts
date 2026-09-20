/**
 * Session 4 — the tripwire (acceptance 2): the same invoice and payment rows
 * through /invoicing's own `dashboardTiles` / `payablesTiles` and through the
 * home metrics, compared cent for cent; then the period tiles and the
 * ageing note on hand-built rows.
 */
import { describe, expect, it } from "vitest";
import { melbourneInstant } from "@/lib/time/businessHours";
import { dashboardTiles, payablesTiles, type DeriveInvoice, type DerivePayment } from "@/lib/invoicing/derive";
import { runMetric, type MetricInput } from "../core";
import { contractorsToPay, daysToPayFinal, depositsUnpaidSoon, outstanding, overdue, received, unsentInvoices } from "./invoicing";

const now = melbourneInstant(2026, 9, 19, 14);
const today = "2026-09-19";
const day = (n: number) => { const d = new Date(Date.UTC(2026, 8, 19) + n * 86_400_000); return d.toISOString().slice(0, 10); };

const inv = (over: Partial<DeriveInvoice> & { id: string }): DeriveInvoice => ({ estimateId: `est-${over.id}`, kind: "final", status: "sent", totalIncCents: 100_000, dueOn: day(-3), issuedOn: day(-17), ...over });
const invoices: DeriveInvoice[] = [
  inv({ id: "i1", kind: "deposit", status: "sent", totalIncCents: 50_000, dueOn: day(2), issuedOn: day(-5) }),                 // open, not overdue; deposit, job starts in 3 days
  inv({ id: "i2", kind: "progress", status: "partially_paid", totalIncCents: 200_000, dueOn: day(-10), issuedOn: day(-24) }),   // overdue 10 days, 80,000 paid
  inv({ id: "i3", kind: "final", status: "viewed", totalIncCents: 300_000, dueOn: day(-40), issuedOn: day(-54) }),             // overdue 40 days
  inv({ id: "i4", kind: "final", status: "paid", totalIncCents: 150_000, dueOn: day(-20), issuedOn: day(-30) }),               // paid: last payment 12 days after issue, in range
  inv({ id: "i5", kind: "deposit", status: "draft", totalIncCents: 40_000, dueOn: null, issuedOn: null }),                      // unsent
  inv({ id: "i6", kind: "final", status: "draft", totalIncCents: 90_000, dueOn: null, issuedOn: null }),                        // unsent
  inv({ id: "i7", kind: "final", status: "void", totalIncCents: 999, dueOn: day(-1), issuedOn: day(-15) }),                     // void: never counted
];
const payments: DerivePayment[] = [
  { invoiceId: "i2", amountCents: 80_000, status: "succeeded", paidOn: day(-8) },
  { invoiceId: "i4", amountCents: 100_000, status: "succeeded", paidOn: day(-22) },
  { invoiceId: "i4", amountCents: 50_000, status: "succeeded", paidOn: day(-18) },
  { invoiceId: "i1", amountCents: 50_000, status: "failed", paidOn: day(-1) },
];
const cis = [
  { id: "c1", number: "CI-1", status: "approved", totalIncCents: 120_000, dueOn: day(3), contractor: "Dean", wo_ref: "WO-1", submitted_at: day(-6) },
  { id: "c2", number: "CI-2", status: "submitted", totalIncCents: 80_000, dueOn: null, contractor: "Anh", wo_ref: "WO-2", submitted_at: day(-1) },
  { id: "c3", number: "CI-3", status: "paid", totalIncCents: 70_000, dueOn: day(-10), contractor: "Dean", wo_ref: "WO-3", submitted_at: day(-20) },
];
const mi: MetricInput = {
  now, estimates: [],
  invoicing: {
    invoices, payments, contractorInvoices: cis,
    invoiceInfo: Object.fromEntries(invoices.map((i, n) => [i.id, { number: `INV-${n + 1}`, customer: `Customer ${n + 1}`, address: `${n + 1} Test St`, start_date: i.id === "i1" ? day(3) : null }])),
    paymentsInWindow: [
      { paid_on: day(-8), amount_cents: 80_000, method: "bank_transfer", invoice_id: "i2", number: "INV-2", customer: "Customer 2", kind: "progress", issued_on: day(-24) },
      { paid_on: day(-18), amount_cents: 50_000, method: "stripe_card", invoice_id: "i4", number: "INV-4", customer: "Customer 4", kind: "final", issued_on: day(-30) },
      { paid_on: day(-2), amount_cents: 12_000, method: "cash", invoice_id: "i9", number: "INV-9", customer: "Cash Customer", kind: "final", issued_on: day(-9) },
      { paid_on: day(-35), amount_cents: 999_999, method: "bank_transfer", invoice_id: "i8", number: "INV-8", customer: "Last month", kind: "final", issued_on: day(-40) },
    ],
    ageingEdges: [7, 30],
    today,
  },
};
const range = { from: "2026-09-01", to: today };
const finance = ["finance"] as const;

describe("Invoicing tiles equal /invoicing (acceptance 2)", () => {
  const tiles = dashboardTiles(invoices, payments, today);
  const pay = payablesTiles(cis, today);
  it("outstanding: the same cents, count and rows as the dashboard tile", () => {
    const r = runMetric(outstanding, mi, range, finance);
    expect(r.value).toBe(tiles.outstandingCents);
    expect(r.rows).toHaveLength(tiles.outstandingCount);
    expect(r.value).toBe(50_000 + 120_000 + 300_000);
    expect(r.note).toBe("3 invoices · 3 customers");
  });
  it("overdue: the same cents and count, oldest first, aged by the Settings edges", () => {
    const r = runMetric(overdue, mi, range, finance);
    expect(r.value).toBe(tiles.overdueCents);
    expect(r.rows).toHaveLength(tiles.overdueCount);
    expect(r.rows.map((x) => [x.number, x.days_overdue])).toEqual([["INV-3", 40], ["INV-2", 10]]);
    expect(r.note).toBe(`1–7 $0 · 8–30 $1,200 · 31+ $3,000 · oldest ${tiles.overdueOldestDays} days`);
  });
  it("contractor invoices to pay = the payables approved total, with to-approve on the line", () => {
    const r = runMetric(contractorsToPay, mi, range, finance);
    expect(r.value).toBe(pay.approvedCents);
    expect(r.rows).toHaveLength(pay.approvedCount);
    expect(r.note).toBe(`${pay.toApproveCount} to approve · $800 · ${pay.toPayWeekCount} due this week`);
  });
  it("unsent invoices by stage; void invoices never count anywhere", () => {
    const r = runMetric(unsentInvoices, mi, range, finance);
    expect(r.value).toBe(40_000 + 90_000);
    expect(r.note).toBe("1 deposits · 0 progress · 1 finals");
    expect(runMetric(outstanding, mi, range, finance).rows.some((x) => x.number === "INV-7")).toBe(false);
  });
  it("deposits unpaid inside 7 days of the job's start", () => {
    const r = runMetric(depositsUnpaidSoon, mi, range, finance);
    expect(r.value).toBe(1);
    expect(r.rows[0]).toMatchObject({ number: "INV-1", start_date: day(3), days_to_start: 3 });
    expect(r.note).toBe("$500 · nearest start in 3 days");
  });
});

describe("Invoicing period tiles", () => {
  it("received: succeeded payments landed in the range, split by method — cash included (⚑B3)", () => {
    const r = runMetric(received, mi, range, finance);
    expect(r.value).toBe(80_000 + 50_000 + 12_000);
    expect(r.rows.map((x) => x.number)).toEqual(["INV-9", "INV-2", "INV-4"]);
    expect(r.note).toBe("bank $800 · card $500 · cash $120");
    expect(r.compare).toBe(999_999);
  });
  it("average days to pay a final: issue date to the last payment, finals paid in full in the range only", () => {
    const r = runMetric(daysToPayFinal, mi, range, finance);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ number: "INV-4", issued_on: day(-30), paid_on: day(-18), days: 12 });
    expect(r.value).toBe(12);
    expect(r.unit).toBe("days");
  });
  it("a sales login cannot run an invoicing tile; a PC login cannot either", () => {
    expect(() => runMetric(outstanding, mi, range, ["sales"])).toThrow();
    expect(() => runMetric(received, mi, range, ["pc"])).toThrow();
  });
});
