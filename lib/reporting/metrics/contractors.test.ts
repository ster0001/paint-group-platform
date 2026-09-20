/**
 * Session 2 — the Contractors tiles on hand-built 0c rows: on time against
 * the booking's CURRENT end (extensions included), silent from the console's
 * quiet-site flags at the Settings threshold, QA on attempt 1, offers inside
 * 24 hours, and the hours blend with its coverage line — never a silent average.
 */
import { describe, expect, it } from "vitest";
import { melbourneInstant } from "@/lib/time/businessHours";
import type { ConsoleInput } from "@/lib/workorder/console";
import { runMetric, type MetricInput } from "../core";
import { daysOnSite, expensesPending, finishedOnTime, hoursVsEstimate, offersWithin24h, qaPassedFirstTime, silentContractors, variationsRaised } from "./contractors";

const now = melbourneInstant(2026, 9, 19, 14);
const day = (n: number) => { const d = new Date(Date.UTC(2026, 8, 19) + n * 86_400_000); return d.toISOString().slice(0, 10); };
const at = (n: number, h = 11) => { const [y, m, d] = day(n).split("-").map(Number); return melbourneInstant(y, m, d, h).toISOString(); };

const consoleInput: ConsoleInput = {
  now,
  workOrders: [
    { id: "w1", woRef: "WO-1", stage: "in_progress", title: "1 Quiet St", contractorName: "Dean", contractValueCents: 1, startDate: day(-5), coloursConfirmed: true, blockedReason: null, acceptedAt: null, issued: true, estimateId: "e1", ticksDone: 0, ticksTotal: 5 },
    { id: "w2", woRef: "WO-2", stage: "in_progress", title: "2 Quiet St", contractorName: "Anh", contractValueCents: 1, startDate: day(-5), coloursConfirmed: true, blockedReason: null, acceptedAt: null, issued: true, estimateId: "e2", ticksDone: 0, ticksTotal: 5 },
  ],
  offers: [], variations: [], updates: [], signoffs: [],
  quietSites: [{ workOrderId: "w1", at: at(-4), days: 4 }, { workOrderId: "w2", at: at(-2), days: 2 }],
  settings: { coloursWarnDays: 5, variationCustomerSilentHours: 24 },
};

const mi: MetricInput = {
  now, estimates: [],
  console: { input: consoleInput, cards: [], awaitingReply: [], materials: [] },
  contractors: {
    contractors: [
      { id: "c1", name: "Dean", works_saturday: false, works_sunday: false },
      { id: "c2", name: "Anh", works_saturday: true, works_sunday: false },
    ],
    done: [
      // Mon 7 – Fri 11 Sep booked (5 days), done Thursday 10th, opted in: entered 4 days / 30 h, allowance 40.
      { work_order_id: "d1", wo_ref: "WO-11", title: "11 Done St", contractor_id: "c1", done_at: at(-9), end_date: day(-8), start_date: day(-12), hours_allowance: 40, entered: { days: 4, hours: 30 } },
      // Booked to Mon 14th, done Wed 16th: late by 2. No entry → the schedule counts the BOOKED days only (Mon 7 … Mon 14, Saturday on for Anh = 7 days × 8 = 56 h); the overrun is not a fact the schedule holds. Allowance 48.
      { work_order_id: "d2", wo_ref: "WO-12", title: "12 Late St", contractor_id: "c2", done_at: at(-3), end_date: day(-5), start_date: day(-12), hours_allowance: 48, entered: null },
      // No booked end: listed, not counted either way; allowance null → left out of hours.
      { work_order_id: "d3", wo_ref: "WO-13", title: "13 Nobook St", contractor_id: "c1", done_at: at(-1), end_date: null, start_date: null, hours_allowance: null, entered: null },
      // Last month: outside the range.
      { work_order_id: "d4", wo_ref: "WO-14", title: "14 Old St", contractor_id: "c1", done_at: at(-31), end_date: day(-31), start_date: day(-34), hours_allowance: 24, entered: null },
    ],
    qaChecks: [
      { work_order_id: "d1", wo_ref: "WO-11", contractor_id: "c1", attempt_no: 1, result: "pass", checked_at: at(-8) },
      { work_order_id: "d2", wo_ref: "WO-12", contractor_id: "c2", attempt_no: 1, result: "fail", checked_at: at(-4) },
      { work_order_id: "d2", wo_ref: "WO-12", contractor_id: "c2", attempt_no: 2, result: "pass", checked_at: at(-2) },
    ],
    offers: [
      { work_order_id: "d1", wo_ref: "WO-11", contractor_id: "c1", offered_at: at(-15, 9), accepted_at: at(-15, 17) },     // 8 h
      { work_order_id: "d2", wo_ref: "WO-12", contractor_id: "c2", offered_at: at(-16, 9), accepted_at: at(-14, 9) },      // 48 h
    ],
    variations: [{ work_order_id: "d1", wo_ref: "WO-11", contractor_id: "c1", created_at: at(-10), status: "customer_approved" }],
    pendingExpenses: [{ id: "x1", work_order_id: "d2", wo_ref: "WO-12", contractor_id: "c2", amount_cents: 12_500, created_at: at(-1), category: "materials" }],
    silentDays: 3,
    dayHours: 8,
  },
};
const range = { from: day(-18), to: day(0) };
const pc = ["pc"] as const;

describe("Contractors tiles", () => {
  it("finished on time: done on or before the booking's end; no booked end is listed, not counted", () => {
    const r = runMetric(finishedOnTime, mi, range, pc);
    expect(r.rows.map((x) => [x.wo_ref, x.on_time, x.days_late])).toEqual([["WO-11", true, 0], ["WO-12", false, 2], ["WO-13", false, 0]]);
    expect(r.value).toBe(1);
    expect(r.note).toBe("of 2 · 50%");
    expect(r.compare).toBe(1);   // WO-14, last month, on time
  });
  it("silent: the console's quiet-site flags at or over the Settings threshold", () => {
    const r = runMetric(silentContractors, mi, range, pc);
    expect(r.rows.map((x) => x.painter)).toEqual(["Dean"]);   // Anh at 2 days is under 3
    expect(r.note).toBe("Dean");
  });
  it("QA passed first time counts attempt-1 passes, and says the share and the rectifications", () => {
    const r = runMetric(qaPassedFirstTime, mi, range, pc);
    expect(r.value).toBe(1);
    expect(r.rows).toHaveLength(3);
    expect(r.note).toBe("of 3 · 33% · 1 rectifications logged");
  });
  it("offers accepted within 24h", () => {
    const r = runMetric(offersWithin24h, mi, range, pc);
    expect(r.value).toBe(1);
    expect(r.rows.map((x) => [x.painter, x.within_24h])).toEqual([["Dean", true], ["Anh", false]]);
    expect(r.note).toBe("of 2 · 50%");
  });
  it("variations raised, per finished job", () => {
    const r = runMetric(variationsRaised, mi, range, pc);
    expect(r.value).toBe(1);
    expect(r.note).toBe("0.3 per finished job");
  });
  it("expense claims awaiting approval, right now, with the money", () => {
    const r = runMetric(expensesPending, mi, range, pc);
    expect(r.value).toBe(1);
    expect(r.note).toBe("$125");
  });
  it("hours vs estimate blends entered and schedule, names the source on every row and the coverage on the tile", () => {
    const r = runMetric(hoursVsEstimate, mi, range, pc);
    // WO-11 entered 30 h vs 40; WO-12 schedule: the booked Mon 7 – Mon 14 Sep with Saturday on for Anh = 7 days × 8 = 56 h vs 48; WO-13 no allowance → out.
    expect(r.rows.map((x) => [x.wo_ref, x.source, x.hours, x.estimate_hours])).toEqual([
      ["WO-11", "Entered by the painter", 30, 40],
      ["WO-12", "From the schedule", 56, 48],
    ]);
    expect(r.value).toBe(Math.round(((30 + 56 - 88) / 88) * 1000) / 10);   // −2.3%
    expect(r.note).toBe("actual on 1 of 2 jobs, schedule on 1");
    const d = runMetric(daysOnSite, mi, range, pc);
    expect(d.value).toBe(4 + 7);
    expect(d.note).toBe("actual on 1 of 2 jobs, schedule on 1");
  });
  it("a finance login cannot run a contractor tile", () => {
    expect(() => runMetric(finishedOnTime, mi, range, ["finance"])).toThrow();
  });
});
