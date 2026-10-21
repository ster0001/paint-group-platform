import { describe, expect, it } from "vitest";
import { jobLogistics, painterDay, painterLine, todayStops, type PainterBranch, type PainterMovementRow } from "./painterView";

const branch: PainterBranch = { id: "b1", brand: "Paint Spot", branch: "Carnegie", address: "1066 Dandenong Rd", suburb: "Carnegie", phone: "(03) 9563 5666", opens_weekday: "06:30", map_place_id: null };

function row(over: Partial<PainterMovementRow>): PainterMovementRow {
  return {
    id: "m1", work_order_id: "wo1", kind: "paint", source_key: "paint:Dulux", title: "Dulux · 2 lines · 3 cans", detail: null, status: "booked",
    due_date: "2026-10-20", half: "AM", time: null, sequence: null, from_kind: "branch", from_branch_id: "b1", from_text: "Paint Spot Carnegie, 1066 Dandenong Rd",
    to_kind: "site", to_branch_id: null, to_text: "12 Demo St", order_ref: "PG-0093", note: "", lines: null, ordered_at: "2026-10-19T00:00:00Z",
    painter_confirmed_at: null, run_plan_sent_at: null, mine: true, ...over,
  };
}

describe("painterView — what the painter reads", () => {
  it("a pickup on my lane, ordered: shop, address, from-time, day, order ref, Navigate + Call + Picked up", () => {
    const l = painterLine(row({}), [branch])!;
    expect(l.text).toBe("Pick up at Paint Spot Carnegie, 1066 Dandenong Rd, Carnegie, from 6:30 am Tue 20 Oct — order PG-0093 under Paint Group.");
    expect(l.tick).toBe("Picked up");
    expect(l.shop?.phone).toBe("(03) 9563 5666");
    expect(l.shop?.mapsUrl).toContain("google.com/maps");
  });
  it("a pickup not yet ordered says the office will text, with no tick", () => {
    const l = painterLine(row({ ordered_at: null, status: "planned" }), [branch])!;
    expect(l.text).toMatch(/the office will text you when it is ready/);
    expect(l.tick).toBeNull();
  });
  it("a supplier delivery (not mine): delivered to site, day and half, no shop and no tick", () => {
    const l = painterLine(row({ mine: false, half: "PM" }), [branch])!;
    expect(l.text).toBe("Delivered to site Tue 20 Oct, afternoon — order PG-0093 under Paint Group.");
    expect(l.shop).toBeNull();
    expect(l.tick).toBeNull();
  });
  it("a chip still in the tray reads as not arranged yet", () => {
    expect(painterLine(row({ status: "tray", due_date: null, ordered_at: null }), [branch])!.text).toMatch(/Not arranged yet/);
  });
  it("gear: a return on my lane is Returned; a hire collection is the hire company's", () => {
    expect(painterLine(row({ kind: "equipment_return", from_kind: "site", title: "Sprayer E-001" }), [branch])!.tick).toBe("Returned");
    expect(painterLine(row({ kind: "hire_off", mine: false, from_kind: "site" }), [branch])!.text).toMatch(/by the hire company/);
  });
  it("rubbish: skip in/out, to the tip with the expenses line, to the warehouse, left on site, disposed", () => {
    expect(painterLine(row({ kind: "rubbish_in", source_key: "rubbish", mine: false }), [])!.text).toMatch(/^Skip arrives/);
    expect(painterLine(row({ kind: "rubbish_out", source_key: "hire_off:x", mine: false }), [])!.text).toMatch(/^Skip goes/);
    expect(painterLine(row({ kind: "rubbish_out", source_key: "rubbish", to_kind: "tip", from_kind: "site" }), [])!.text).toMatch(/claim the fee under Expenses/);
    expect(painterLine(row({ kind: "rubbish_out", source_key: "rubbish", to_kind: "warehouse", from_kind: "site" }), [])!.tick).toBe("Dropped off");
    expect(painterLine(row({ kind: "rubbish_out", source_key: "rubbish", to_kind: "tip", from_kind: "site", mine: false }), [])!.text).toMatch(/^Leave the rubbish on site/);
    expect(painterLine(row({ kind: "rubbish_out", source_key: "rubbish", detail: "painter disposes of it", mine: true }), [])!.text).toMatch(/You dispose/);
  });
  it("done carries the painter's tick mark and no button; cancelled is dropped", () => {
    const l = painterLine(row({ status: "done", painter_confirmed_at: "2026-10-20T01:00:00Z" }), [branch])!;
    expect(l.done).toBe(true); expect(l.tick).toBeNull(); expect(l.text).toMatch(/✓$/);
    expect(painterLine(row({ status: "cancelled" }), [branch])).toBeNull();
  });
  it("jobLogistics groups one job's rows into the four sections; todayStops is my open stops that day in run order", () => {
    const rows = [
      row({ id: "a", sequence: 2, time: "09:00" }),
      row({ id: "b", kind: "materials", source_key: "matline:1", sequence: 1, time: "07:30", title: "caulk × 6" }),
      row({ id: "c", work_order_id: "wo2", kind: "equipment_out", from_kind: "warehouse" }),
      row({ id: "d", mine: false }),
    ];
    const lg = jobLogistics(rows, [branch], "wo1");
    expect(lg.paint.map((l) => l.id)).toEqual(["a", "d"]);
    expect(lg.materials.map((l) => l.id)).toEqual(["b"]);
    expect(lg.gear).toEqual([]);
    expect(lg.any).toBe(true);
    expect(todayStops(rows, [branch], "2026-10-20").map((l) => l.id)).toEqual(["b", "a", "c"]);
  });
  it("painterDay is the Melbourne calendar day", () => {
    expect(painterDay("2026-10-20")).toBe("Tue 20 Oct");
    expect(painterDay(null)).toBe("");
  });
});
