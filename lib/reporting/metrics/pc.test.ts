/**
 * Session 2 — PC Command reads the console's OWN input and cards, so the
 * home tile and the /pc console cannot disagree (acceptance 2). This is the
 * tripwire: the same ConsoleInput through `buildQueue` and through the
 * metrics, compared card for card and job for job.
 */
import { describe, expect, it } from "vitest";
import { buildQueue, pulseTiles, type ConsoleInput } from "@/lib/workorder/console";
import { runMetric, type MetricInput } from "../core";
import { melbourneInstant } from "@/lib/time/businessHours";
import {
  awaitingSignoff, bookedWorkAhead, customersAwaitingReply, jobsInProgress, jobsToSchedule, materialsActual, materialsEstimated, offersPastSla, qualityCheck, startingThisWeek, variationsOpen,
} from "./pc";

const now = melbourneInstant(2026, 9, 19, 14);
const day = (n: number) => { const d = new Date(Date.UTC(2026, 8, 19) + n * 86_400_000); return d.toISOString().slice(0, 10); };
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

const wo = (over: Partial<ConsoleInput["workOrders"][number]>): ConsoleInput["workOrders"][number] => ({
  id: "w", woRef: "WO-1", stage: "in_progress", title: "1 Test St", contractorName: "Dean", contractValueCents: 1_000_000, startDate: day(1),
  endDate: day(4), coloursConfirmed: true, blockedReason: null, acceptedAt: hoursAgo(72), issued: true, estimateId: "e", ticksDone: 0, ticksTotal: 10, ...over,
});

const input: ConsoleInput = {
  now,
  workOrders: [
    wo({ id: "w1", woRef: "WO-1", stage: "offered", acceptedAt: hoursAgo(24 * 11), startDate: null, endDate: null, contractorName: "Felipe" }),      // to schedule, 11 days
    wo({ id: "w2", woRef: "WO-2", stage: "offered", acceptedAt: hoursAgo(24 * 2), startDate: day(2), coloursConfirmed: false }),   // to schedule + starting this week, colours TBC
    wo({ id: "w3", woRef: "WO-3", stage: "in_progress", ticksDone: 9, ticksTotal: 10 }),                       // in progress, wrapping up
    wo({ id: "w4", woRef: "WO-4", stage: "in_progress", ticksDone: 2 }),                                       // in progress
    wo({ id: "w5", woRef: "WO-5", stage: "qa" }),
    wo({ id: "w6", woRef: "WO-6", stage: "walkthrough" }),
    wo({ id: "w7", woRef: "WO-7", stage: "pre_start", startDate: day(5), endDate: day(9), contractValueCents: 2_500_000 }),   // starting this week + booked ahead
    wo({ id: "w8", woRef: "WO-8", stage: "closed" }),
  ],
  offers: [{ id: "o1", workOrderId: "w1", state: "offered", expiresAt: hoursAgo(5), contractorName: "Felipe" }],   // past SLA
  variations: [
    { id: "v1", workOrderId: "w3", status: "raised", createdAt: hoursAgo(30), pricedAt: null },
    { id: "v2", workOrderId: "w4", status: "priced", createdAt: hoursAgo(50), pricedAt: hoursAgo(26) },
    { id: "v3", workOrderId: "w4", status: "customer_approved", createdAt: hoursAgo(50), pricedAt: hoursAgo(40) },
  ],
  updates: [], signoffs: [], quietSites: [],
  qaChecks: [{ workOrderId: "w5", kind: "final", scheduledFor: null, createdAt: hoursAgo(3) }],
  walkthroughBooked: ["w6"],
  settings: { coloursWarnDays: 5, variationCustomerSilentHours: 24 },
};

const cards = buildQueue(input);
const mi: MetricInput = {
  now, estimates: [],
  console: {
    input, cards,
    awaitingReply: [
      { account_id: "a1", name: "Mark Ellis", last_inbound_at: hoursAgo(3.2), last_staff_reply_at: hoursAgo(10) },
      { account_id: "a2", name: "Priya Nair", last_inbound_at: hoursAgo(1), last_staff_reply_at: null },
    ],
    materials: [
      { work_order_id: "w8", wo_ref: "WO-8", title: "8 Done St", closed_on: day(-2), budget_cents: 100_000, invoiced_ex_cents: 120_000 },
      { work_order_id: "w9", wo_ref: "WO-9", title: "9 Old St", closed_on: day(-40), budget_cents: 50_000, invoiced_ex_cents: 40_000 },   // 10 Aug: outside the range, inside the comparison
      { work_order_id: "w10", wo_ref: "WO-10", title: "10 Unpriced", closed_on: day(-1), budget_cents: null, invoiced_ex_cents: 5_000 },   // no priced scope: left out
    ],
  },
};
const range = { from: day(-18), to: day(0) };
const pc = ["pc"] as const;

describe("PC Command tiles equal the console (acceptance 2)", () => {
  it("offers past SLA lists exactly the console's offer-sla cards", () => {
    const r = runMetric(offersPastSla, mi, range, pc);
    const consoleCards = cards.filter((c) => c.key.startsWith("offer-sla:"));
    expect(consoleCards.length).toBe(1);
    expect(r.value).toBe(consoleCards.length);
    expect(r.rows.map((x) => x.wo_ref)).toEqual(consoleCards.map((c) => c.ref));
    expect(r.note).toContain("Felipe");
  });
  it("quality check counts the qa stage and notes the console's qa-due cards", () => {
    const r = runMetric(qualityCheck, mi, range, pc);
    expect(r.value).toBe(1);
    expect(r.note).toBe(`${cards.filter((c) => c.key.startsWith("qa-due:")).length} check due`);
  });
  it("the stage tiles partition the console's open jobs the way pulseTiles counts them", () => {
    const toSchedule = runMetric(jobsToSchedule, mi, range, pc);
    const inProgress = runMetric(jobsInProgress, mi, range, pc);
    const qa = runMetric(qualityCheck, mi, range, pc);
    const signoff = runMetric(awaitingSignoff, mi, range, pc);
    const preStart = input.workOrders.filter((w) => w.stage === "pre_start").length;
    expect(toSchedule.value + inProgress.value + qa.value + signoff.value + preStart).toBe(pulseTiles(input, cards, 0).openJobs);
    expect(toSchedule.rows.map((r) => r.wo_ref)).toEqual(["WO-1", "WO-2"]);   // oldest first
    expect(toSchedule.note).toBe("$20,000 · oldest 11 days");
    expect(inProgress.note).toBe("1 wrapping up");
    expect(signoff.note).toBe("1 walkthrough booked");
  });
  it("variations open are the console's raised + priced, split to price / with customer", () => {
    const r = runMetric(variationsOpen, mi, range, pc);
    expect(r.value).toBe(2);
    expect(r.rows.map((x) => x.state)).toEqual(["to price", "with customer"]);
    expect(r.note).toBe("1 to price · 1 with customer");
  });
  it("customers awaiting reply: longest wait first, from the 0b facts", () => {
    const r = runMetric(customersAwaitingReply, mi, range, pc);
    expect(r.value).toBe(2);
    expect(r.rows[0].name).toBe("Mark Ellis");
    expect(r.note).toBe("longest 3h 12m");
  });
  it("starting this week: booked starts in the next seven days, not started, colours TBC counted", () => {
    const r = runMetric(startingThisWeek, mi, range, pc);
    expect(r.rows.map((x) => x.wo_ref)).toEqual(["WO-2", "WO-7"]);
    expect(r.note).toBe("1 colours TBC · 1 painters");
  });
  it("booked work ahead is contract value from today on, with weeks out", () => {
    const r = runMetric(bookedWorkAhead, mi, range, pc);
    expect(r.rows.map((x) => x.wo_ref)).toEqual(["WO-2", "WO-7"]);
    expect(r.value).toBe(3_500_000);
    expect(r.note).toBe("2 jobs · 1.3 weeks out");
  });
  it("materials est vs actual share their rows: signed-off in range, priced scope only", () => {
    const est = runMetric(materialsEstimated, mi, range, pc);
    const act = runMetric(materialsActual, mi, range, pc);
    expect(est.rows.map((r) => r.wo_ref)).toEqual(["WO-8"]);
    expect(est.value).toBe(100_000);
    expect(act.value).toBe(120_000);
    expect(act.note).toBe("over estimate by $200 · 120% of budget");
    expect(est.compare).toBe(50_000);   // WO-9, 10 Aug, is in the comparison period (1–19 Aug)
  });
  it("a sales login cannot run a PC tile", () => {
    expect(() => runMetric(jobsInProgress, mi, range, ["sales"])).toThrow();
  });
  it("no console loaded → empty, never a fabricated zero on the note", () => {
    const r = runMetric(jobsInProgress, { now, estimates: [] }, range, pc);
    expect(r.value).toBe(0);
    expect(r.rows).toEqual([]);
    expect(r.note).toBeNull();
  });
});
