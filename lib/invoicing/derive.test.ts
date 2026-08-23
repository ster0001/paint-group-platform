/**
 * The §7 screen derivations — tiles, aged buckets, stage rail — pinned on the
 * dashboard mockup's own numbers so "matches the reference mockup" is a test,
 * not a hope.
 */
import { describe, expect, it } from "vitest";
import {
  agedBucketsCents,
  ageInfo,
  dashboardTiles,
  daysBetween,
  invoiceBalanceCents,
  paymentStages,
  requestPreviewCents,
  stageDots,
  type DeriveInvoice,
  type DerivePayment,
} from "./derive";

const TODAY = "2026-08-24";

const inv = (o: Partial<DeriveInvoice> & { id: string }): DeriveInvoice => ({
  estimateId: "job-" + o.id,
  kind: "final",
  status: "sent",
  totalIncCents: 100_000,
  dueOn: null,
  issuedOn: null,
  ...o,
});

describe("balances and ages", () => {
  it("balance = total − succeeded payments (pending/refunded ignored)", () => {
    const i = inv({ id: "a", totalIncCents: 593_500 });
    const pays: DerivePayment[] = [
      { invoiceId: "a", amountCents: 100_000, status: "succeeded", paidOn: TODAY },
      { invoiceId: "a", amountCents: 50_000, status: "pending", paidOn: TODAY },
      { invoiceId: "b", amountCents: 99_999, status: "succeeded", paidOn: TODAY },
    ];
    expect(invoiceBalanceCents(i, pays)).toBe(493_500);
  });

  it("daysBetween is calendar-exact", () => {
    expect(daysBetween("2026-08-18", TODAY)).toBe(6);
    expect(daysBetween(TODAY, "2026-08-28")).toBe(4);
  });

  it("ageInfo: 6 days overdue / due in 4 days / nothing for drafts", () => {
    expect(ageInfo(inv({ id: "a", dueOn: "2026-08-18" }), [], TODAY)).toEqual({ overdueDays: 6 });
    expect(ageInfo(inv({ id: "b", dueOn: "2026-08-28" }), [], TODAY)).toEqual({ dueInDays: 4 });
    expect(ageInfo(inv({ id: "c", status: "draft", dueOn: "2026-08-18" }), [], TODAY)).toBeNull();
  });
});

describe("the mockup dashboard, in cents", () => {
  // Six rows of the §7.2 mockup: 2 overdue, 2 awaiting, 1 draft, 1 paid.
  const rows: DeriveInvoice[] = [
    inv({ id: "barkly", totalIncCents: 626_200, dueOn: "2026-08-18" }),               // 6 d overdue
    inv({ id: "elwood", kind: "deposit", totalIncCents: 197_800, dueOn: "2026-08-22" }), // 2 d overdue
    inv({ id: "ellerslie", kind: "progress", totalIncCents: 593_500, dueOn: "2026-08-28", status: "viewed" }),
    inv({ id: "mercer", totalIncCents: 697_500, dueOn: "2026-08-30" }),
    inv({ id: "pine", kind: "deposit", status: "draft", totalIncCents: 212_000 }),
    inv({ id: "malvern", status: "paid", totalIncCents: 489_000 }),
  ];
  const pays: DerivePayment[] = [
    { invoiceId: "malvern", amountCents: 489_000, status: "succeeded", paidOn: "2026-08-19" },
    { invoiceId: "x-old", amountCents: 197_800, status: "succeeded", paidOn: "2026-08-12" },
  ];

  it("tiles: outstanding / overdue / due-this-week / collected", () => {
    const t = dashboardTiles(rows, pays, TODAY);
    expect(t.outstandingCents).toBe(626_200 + 197_800 + 593_500 + 697_500); // $21,150
    expect(t.outstandingCount).toBe(4);
    expect(t.outstandingJobs).toBe(4);
    expect(t.overdueCents).toBe(626_200 + 197_800); // $8,240
    expect(t.overdueCount).toBe(2);
    expect(t.overdueOldestDays).toBe(6);
    expect(t.dueThisWeekCents).toBe(593_500 + 697_500); // $12,910
    expect(t.dueThisWeekCount).toBe(2);
    expect(t.collectedFortnightCents).toBe(489_000 + 197_800);
    expect(t.collectedSpark).toHaveLength(14);
    expect(t.collectedSpark.reduce((a, b) => a + b, 0)).toBe(t.collectedFortnightCents);
  });

  it("aged buckets: current $12,910 · 1–7d $8,240 · rest zero", () => {
    expect(agedBucketsCents(rows, pays, TODAY)).toEqual([1_291_000, 824_000, 0, 0, 0]);
  });

  it("a paid invoice contributes nothing anywhere", () => {
    const t = dashboardTiles([inv({ id: "malvern", status: "paid" })], pays, TODAY);
    expect(t.outstandingCents).toBe(0);
  });
});

describe("the §7.1 stage rail", () => {
  const deposit = inv({ id: "d", kind: "deposit", status: "paid", totalIncCents: 197_800 });
  const progress = inv({ id: "p", kind: "progress", status: "sent", totalIncCents: 593_500, dueOn: "2026-08-26" });
  const pays: DerivePayment[] = [
    { invoiceId: "d", amountCents: 197_800, status: "succeeded", paidOn: "2026-08-08" },
  ];

  it("the mockup: deposit paid · progress awaiting · final upcoming · not paid in full", () => {
    const s = paymentStages([deposit, progress], pays, 1_780_470, TODAY);
    expect(s.map((x) => x.state)).toEqual(["paid", "awaiting", "upcoming", "upcoming"]);
    expect(s[0].amountCents).toBe(197_800);
    expect(s[1].amountCents).toBe(593_500);
  });

  it("balance at zero lights Paid in full; a void invoice never counts", () => {
    const paidFinal = inv({ id: "f", kind: "final", status: "paid", totalIncCents: 100 });
    const voided = inv({ id: "v", kind: "progress", status: "void" });
    const s = paymentStages([deposit, paidFinal, voided], pays, 0, TODAY);
    expect(s[3].state).toBe("paid");
    expect(s[1].state).toBe("upcoming"); // the void progress claim is invisible
  });

  it("an unissued draft deposit reads amber (draft), and dots mirror it", () => {
    const draft = inv({ id: "pine", kind: "deposit", status: "draft", totalIncCents: 212_000 });
    const s = paymentStages([draft], [], 212_000, TODAY);
    expect(s[0].state).toBe("draft");
    expect(stageDots([draft], [], TODAY)).toEqual(["open", "none", "none"]);
  });

  it("an overdue stage reads clay", () => {
    const late = inv({ id: "late", kind: "deposit", totalIncCents: 197_800, dueOn: "2026-08-22" });
    expect(paymentStages([late], [], 197_800, TODAY)[0].state).toBe("overdue");
  });
});

describe("request-payment preview mirrors the SQL", () => {
  it("25% of the mockup's adjusted contract = $4,945.75", () => {
    expect(requestPreviewCents(1_978_300, 25)).toBe(494_575);
  });
});
