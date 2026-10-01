import { describe, expect, it } from "vitest";
import { buildHoldItems, GROUP_OF_KIND, HOLD_NUDGE_DAYS, isCustomerVisible, KIND_WEIGHT, type HoldQueueRow } from "./work-queue";

/**
 * Tom, 1 Oct 2026: a pink hold on the board is the reminder; this is the nudge
 * when the held days are a week out and the client still hasn't said yes.
 * Derived from the hold row plus "is the job booked" — never stored.
 */
const now = new Date("2026-10-05T09:00:00+10:00"); // Monday
const names = new Map([["c-1", "Marco Rossi"]]);
const row = (over: Partial<HoldQueueRow> = {}): HoldQueueRow => ({
  id: "h-1", contractor_id: "c-1", start_date: "2026-10-08", end_date: "2026-10-09",
  work_order_id: "wo-1", note: "", created_at: "2026-10-01T02:00:00Z", released_at: null,
  work_orders: { wo_ref: "WO-1042", wo_snapshot: { jobTitle: "12 Elm Grove" } }, ...over,
});

describe("hold_pending", () => {
  it("is an internal follow-up, below the painter-may-not-know items", () => {
    expect(GROUP_OF_KIND.hold_pending).toBe("followups");
    expect(isCustomerVisible("hold_pending")).toBe(false);
    expect(KIND_WEIGHT.hold_pending).toBeLessThan(KIND_WEIGHT.employee_unaccepted);
    expect(KIND_WEIGHT.hold_pending).toBeGreaterThan(KIND_WEIGHT.leave_request);
  });

  it("one open hold within the week → one item naming the painter, the job and the days, opening the board on them", () => {
    const items = buildHoldItems([row()], new Set(), names, now);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Marco Rossi's days are held for 12 Elm Grove — 08/10–09/10");
    expect(items[0].detail).toContain("pink block");
    expect(items[0].action).toEqual({ label: "Open the board", href: "/pc/schedule?from=2026-10-08&days=14" });
    expect(items[0].subjectRef).toEqual({ type: "work_order", id: "wo-1" });
    expect(items[0].key).toContain("h-1");
  });

  it("the note, when there is one, is the detail", () => {
    const [item] = buildHoldItems([row({ note: "Sarah confirming Friday" })], new Set(), names, now);
    expect(item.detail).toBe("\"Sarah confirming Friday\" — book it or release the days.");
  });

  it("a hold with no job still nags, keyed on itself", () => {
    const [item] = buildHoldItems([row({ work_order_id: null, work_orders: null })], new Set(), names, now);
    expect(item.title).toBe("Marco Rossi's days are held — 08/10–09/10");
    expect(item.subjectRef).toEqual({ type: "event", id: "h-1" });
  });

  it("is due two days before the first held day, so it goes overdue with time to re-offer the week", () => {
    const [item] = buildHoldItems([row()], new Set(), names, now);
    // Due at Melbourne midnight going into 6 Oct. Daylight saving began on
    // 4 Oct, so Melbourne is +11 and that midnight is 13:00 UTC on the 5th —
    // measured from the zone, never a written-down offset.
    expect(item.dueAt).toBe("2026-10-05T13:00:00.000Z");
    expect(item.bucket).toBe("waiting");
    const [later] = buildHoldItems([row()], new Set(), names, new Date("2026-10-07T09:00:00+10:00"));
    expect(later.bucket).toBe("overdue");
  });

  it("raises nothing for a hold more than a week out, one already past, a released one, or one whose job got booked", () => {
    const farOff = row({ start_date: "2026-10-20", end_date: "2026-10-21" });
    expect(Date.parse(farOff.start_date) - now.getTime()).toBeGreaterThan(HOLD_NUDGE_DAYS * 86_400_000);
    expect(buildHoldItems([farOff], new Set(), names, now)).toHaveLength(0);
    expect(buildHoldItems([row({ start_date: "2026-09-28", end_date: "2026-09-30" })], new Set(), names, now)).toHaveLength(0);
    expect(buildHoldItems([row({ released_at: "2026-10-02T00:00:00Z" })], new Set(), names, now)).toHaveLength(0);
    expect(buildHoldItems([row()], new Set(["wo-1"]), names, now)).toHaveLength(0);
  });

  it("a hold already under way (started yesterday, ends tomorrow) still shows — the painter is sitting on reserved days", () => {
    expect(buildHoldItems([row({ start_date: "2026-10-04", end_date: "2026-10-06" })], new Set(), names, now)).toHaveLength(1);
  });
});
