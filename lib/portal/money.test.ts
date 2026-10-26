import { describe, expect, it } from "vitest";
import { melbourneInstant } from "@/lib/time/businessHours";
import { buildMoneyView, fmtDay, type MoneyEstimate, type MoneyInvoice, type MoneyPayment } from "./money";

const TODAY = "2026-08-27";
/** 1pm Melbourne on TODAY — past the midday overdue line, so day-level expectations hold. */
const NOW = melbourneInstant(2026, 8, 27, 13);

const est = (over: Partial<MoneyEstimate> = {}): MoneyEstimate => ({
  id: "e1", title: "12 Acacia Street", status: "accepted", accepted_total_cents: 845_000, ...over,
});
const inv = (over: Partial<MoneyInvoice> = {}): MoneyInvoice => ({
  id: over.id ?? "i1", estimate_id: "e1", kind: "deposit", status: "issued",
  number: "INV-2041", token: "tok1", issued_on: "2026-08-13", due_on: "2026-08-29",
  total_inc_cents: 253_500, gst_cents: 23_045, ...over,
});
const pay = (over: Partial<MoneyPayment> = {}): MoneyPayment => ({
  id: over.id ?? "p1", invoice_id: "i1", amount_cents: 253_500, status: "succeeded",
  paid_on: "2026-08-13", receipt_number: "RCT-0001", ...over,
});

describe("buildMoneyView — the customer's money, read-only and honest", () => {
  it("customers see issued invoices only — drafts, voids and write-offs never render", () => {
    const [job] = buildMoneyView(
      [est()],
      [
        inv(),
        inv({ id: "i2", status: "draft", number: null, token: null }),
        inv({ id: "i3", status: "void" }),
        inv({ id: "i4", status: "written_off" }),
      ],
      [],
      TODAY, NOW,
    );
    expect(job.rows.map((r) => r.id)).toEqual(["i1"]);
  });

  it("the project total is the accepted contract with its GST itemised", () => {
    const [job] = buildMoneyView([est()], [inv()], [], TODAY, NOW);
    expect(job.projectTotalIncCents).toBe(845_000);
    expect(job.projectGstCents).toBe(76_818); // 845000 / 11, the inc-anchored rule
  });

  it("due, paid and overdue chips derive from the same rules as the staff dashboard", () => {
    const jobs = buildMoneyView(
      [est()],
      [
        inv(), // due 29 Aug, today 27 Aug → Due
        inv({ id: "i2", status: "paid", number: "INV-2042" }),
        inv({ id: "i3", due_on: "2026-08-20", number: "INV-2043" }), // past due → Overdue
      ],
      [pay({ invoice_id: "i2" })],
      TODAY, NOW,
    );
    const chips = Object.fromEntries(jobs[0].rows.map((r) => [r.number, r.chip]));
    expect(chips["INV-2041"]).toEqual({ cls: "amber", label: "Due 29 Aug" });
    expect(chips["INV-2042"]).toEqual({ cls: "emerald", label: "Paid 13 Aug" });
    expect(chips["INV-2043"]).toEqual({ cls: "clay", label: "Overdue" });
    expect(jobs[0].chip).toEqual({ cls: "clay", label: "Overdue" }); // job chip follows
  });

  it("F2: every project carries Total / Paid / Remaining, and the chip answers \"do I owe anything?\"", () => {
    // A paid deposit and a progress claim still due.
    const [owing] = buildMoneyView(
      [est()],
      [inv({ id: "i1", status: "paid" }), inv({ id: "i2", kind: "progress", number: "INV-2042", total_inc_cents: 100_000, gst_cents: 9_091, due_on: "2026-09-10" })],
      [pay()],
      TODAY, NOW,
    );
    expect(owing.totalIncCents).toBe(845_000);
    expect(owing.paidCents).toBe(253_500);
    expect(owing.remainingCents).toBe(591_500);
    expect(owing.chip).toEqual({ cls: "amber", label: "Due 10 Sep" });

    // Everything issued is paid: nothing owing, whatever the contract still has to invoice.
    const [clear] = buildMoneyView([est()], [inv({ status: "paid" })], [pay()], TODAY, NOW);
    expect(clear.paidCents).toBe(253_500);
    expect(clear.remainingCents).toBe(591_500);
    expect(clear.chip).toEqual({ cls: "emerald", label: "Nothing owing" });

    // No accepted contract: the total is what was issued.
    const [issuedOnly] = buildMoneyView([est({ status: "sent", accepted_total_cents: null })], [inv({ status: "paid" })], [pay()], TODAY, NOW);
    expect(issuedOnly.totalIncCents).toBe(253_500);
    expect(issuedOnly.remainingCents).toBe(0);
    expect(issuedOnly.chip?.label).toBe("Nothing owing");
  });

  it("a partly-paid invoice shows its remaining balance", () => {
    const [job] = buildMoneyView(
      [est()],
      [inv({ status: "partially_paid" })],
      [pay({ amount_cents: 100_000 })],
      TODAY, NOW,
    );
    expect(job.rows[0].chip.label).toBe("Partly paid");
    expect(job.rows[0].balanceCents).toBe(153_500);
  });

  it("the not-yet-invoiced remainder reads as balance on completion", () => {
    const [job] = buildMoneyView([est()], [inv()], [], TODAY, NOW);
    expect(job.remainderCents).toBe(845_000 - 253_500);
  });

  it("receipts ride their invoice with number and date", () => {
    const [job] = buildMoneyView([est()], [inv({ status: "paid" })], [pay()], TODAY, NOW);
    expect(job.rows[0].receipts).toEqual([
      { paymentId: "p1", number: "RCT-0001", paidOn: "2026-08-13", amountCents: 253_500 },
    ]);
  });

  it("a job with no accepted contract and no visible invoices does not appear", () => {
    expect(buildMoneyView([est({ status: "draft", accepted_total_cents: null })], [], [], TODAY, NOW)).toEqual([]);
  });

  it("failed or pending payments never count as receipts or paid amounts", () => {
    const [job] = buildMoneyView(
      [est()],
      [inv()],
      [pay({ status: "failed" }), pay({ id: "p2", status: "pending", receipt_number: "RCT-0002" })],
      TODAY, NOW,
    );
    expect(job.rows[0].receipts).toEqual([]);
    expect(job.rows[0].balanceCents).toBe(253_500);
  });
});

describe("fmtDay — plain-words dates", () => {
  it("29 Aug from 2026-08-29", () => expect(fmtDay("2026-08-29")).toBe("29 Aug"));
  it("null stays null", () => expect(fmtDay(null)).toBeNull());
});
