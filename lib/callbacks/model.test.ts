import { describe, expect, test } from "vitest";
import { callbackLine, callbackScored, isOpenStatus, type Callback } from "./model";

const base: Callback = {
  id: "c", workOrderId: "w", painterId: "p", fixedByPainterId: null, source: "customer_call", reason: "workmanship",
  reportedOn: "2026-10-12", description: "Paint on the lounge window glass", status: "booked", appointmentId: "a",
  qaCheckId: null, fixedAt: null, fixedNote: "", closedAt: null, closedNote: "", voidedAt: null, voidReason: "",
  createdAt: "2026-10-12T00:00:00Z", visit: { start: "2026-10-15", end: "2026-10-15", contractorId: "p" },
};

describe("callbackScored — brief §4.3, rulings C5/C6", () => {
  test("workmanship inside 7 days of sign-off scores; day 8 is logged but not scored", () => {
    expect(callbackScored({ ...base, reportedOn: "2026-10-12" }, "2026-10-05")).toBe(true);   // day 7
    expect(callbackScored({ ...base, reportedOn: "2026-10-13" }, "2026-10-05")).toBe(false);  // day 8
    expect(callbackScored({ ...base, reportedOn: "2026-10-01" }, "2026-10-05")).toBe(true);   // before sign-off
  });
  test("not workmanship never scores; neither does a voided one", () => {
    expect(callbackScored({ ...base, reason: "not_workmanship" }, "2026-10-05")).toBe(false);
    expect(callbackScored({ ...base, status: "void" }, "2026-10-05")).toBe(false);
  });
  test("a call back on a job never signed off scores on reason alone", () => {
    expect(callbackScored(base, null)).toBe(true);
  });
  test("the window is a setting", () => {
    expect(callbackScored({ ...base, reportedOn: "2026-10-13" }, "2026-10-05", 10)).toBe(true);
  });
});

describe("words", () => {
  test("open states and the card line", () => {
    expect(isOpenStatus("fixed")).toBe(true);
    expect(isOpenStatus("done")).toBe(false);
    expect(callbackLine(base)).toBe("Customer called back · reported Mon, 12 Oct · Return visit Thu, 15 Oct");
    expect(callbackLine({ ...base, visit: null })).toMatch(/No return visit booked yet$/);
  });
});
