import { describe, expect, it } from "vitest";
import { holdIsResolved, openHolds } from "./holds";

/**
 * Tom, 1 Oct 2026: a hold is the office reserving a painter's days while the
 * client decides. It is answered by the BOOKING, not by a tick: the moment the
 * job it waits on is booked — to this painter or anyone — the hold is done.
 * A hold with no job stays until somebody releases it.
 */
const hold = (over: Partial<{ work_order_id: string | null; released_at: string | null }> = {}) => ({
  id: "h-1", contractor_id: "c-1", start_date: "2026-10-12", end_date: "2026-10-14",
  work_order_id: "wo-1", note: "", created_at: "2026-10-01T00:00:00Z", released_at: null, ...over,
});

describe("holdIsResolved", () => {
  it("stands while its job is unbooked and nobody has released it", () => {
    expect(holdIsResolved(hold(), new Set())).toBe(false);
  });
  it("is answered the moment its job is booked — to anyone", () => {
    expect(holdIsResolved(hold(), new Set(["wo-1"]))).toBe(true);
  });
  it("a booking of some OTHER job changes nothing", () => {
    expect(holdIsResolved(hold(), new Set(["wo-2"]))).toBe(false);
  });
  it("a hold with no job is never resolved by a booking — only by release", () => {
    expect(holdIsResolved(hold({ work_order_id: null }), new Set(["wo-1", "wo-2"]))).toBe(false);
    expect(holdIsResolved(hold({ work_order_id: null, released_at: "2026-10-02T00:00:00Z" }), new Set())).toBe(true);
  });
  it("a released hold is history whatever its job is doing", () => {
    expect(holdIsResolved(hold({ released_at: "2026-10-02T00:00:00Z" }), new Set())).toBe(true);
  });
});

describe("openHolds", () => {
  it("keeps only the holds still standing, in their original order", () => {
    const rows = [
      { ...hold(), id: "a" },
      { ...hold({ work_order_id: "wo-9" }), id: "b" },
      { ...hold({ released_at: "2026-10-02T00:00:00Z" }), id: "c" },
      { ...hold({ work_order_id: null }), id: "d" },
    ];
    expect(openHolds(rows, new Set(["wo-9"])).map((h) => h.id)).toEqual(["a", "d"]);
  });
});
