import { describe, expect, it } from "vitest";
import { CUPBOARD_INTERIOR_BY_ROOM_TYPE, applyCupboard, applyCupboardDoorInside, applyCupboardInterior, applyCupboardsEverywhere, confirmRoom, roomLoopViews, type LooseBlock } from "./rooms-loop";

const kitchen = (): LooseBlock => ({ id: 1, kind: "area", type: "Interior", roomType: "kitchen", name: "Kitchen", L: 4, W: 3, surfaces: [] });
const bedroom = (id = 2): LooseBlock => ({ id, kind: "area", type: "Interior", roomType: "bedroom", name: `Bed ${id}`, L: 3.5, W: 3.2, surfaces: [] });
const allCodes = new Set(["Kitchen Cupboard Front", "Kitchen Cupboard Interior", "Robe Door", "Robe Interior", "Flat Door (1 Side)"]);
const codes = (b: LooseBlock) => (b.surfaces ?? []).map((s) => String(s.code));

describe("cupboard interiors — the insides follow the doors (Tom, 7 Sep 2026; supersedes D19's independent answers)", () => {
  it("every room type with a question names a code the migration creates", () => {
    const set = new Set(Object.values(CUPBOARD_INTERIOR_BY_ROOM_TYPE).map((c) => c.code));
    expect([...set].sort()).toEqual(["Kitchen Cupboard Interior", "Linen / Broom Cupboard Interior", "Robe Interior", "Vanity Interior"]);
  });

  it("with the doors a Yes, yes adds the interior line at the room's default count, customer_stated", () => {
    let id = 10;
    const doors = applyCupboard([kitchen()], 1, true, null, () => id++);
    const r = doors.ok ? applyCupboardInterior(doors.blocks, 1, true, null, () => id++) : doors;
    expect(r.ok).toBe(true);
    const line = r.ok ? r.blocks[0].surfaces?.[1] : undefined;
    expect(line).toMatchObject({ code: "Kitchen Cupboard Interior", count: 8, origin: "customer_stated" });
    expect(r.ok && r.blocks[0].customer?.cupInterior).toBe(true);
  });

  it("no removes the line and RECORDS the answer", () => {
    let id = 10;
    const doors = applyCupboard([kitchen()], 1, true, null, () => id++);
    const yes = doors.ok ? applyCupboardInterior(doors.blocks, 1, true, 6, () => id++) : doors;
    const no = yes.ok ? applyCupboardInterior(yes.blocks, 1, false, null, () => id++) : yes;
    expect(no.ok && codes(no.blocks[0])).toEqual(["Kitchen Cupboard Front"]);
    expect(no.ok && no.blocks[0].customer?.cupInterior).toBe(false);
  });

  it("the insides are refused until the doors are a Yes", () => {
    const unasked = applyCupboardInterior([kitchen()], 1, true, null, () => 99);
    expect(unasked).toEqual({ ok: false, error: "Tick the cupboard doors first — the insides follow that answer." });
    const doorsNo = applyCupboard([bedroom()], 2, false, null, () => 99);
    const inside = doorsNo.ok ? applyCupboardDoorInside(doorsNo.blocks, 2, true, null, () => 99) : doorsNo;
    expect(inside).toEqual({ ok: false, error: "Tick the robe doors first — the inside faces follow that answer." });
  });

  it("a No on the doors drops the inside lines and un-asks both follow-ups; a later Yes asks them fresh", () => {
    let id = 10;
    const a = applyCupboard([bedroom()], 2, true, null, () => id++);
    const b = a.ok ? applyCupboardInterior(a.blocks, 2, true, null, () => id++) : a;
    const c = b.ok ? applyCupboardDoorInside(b.blocks, 2, true, null, () => id++) : b;
    expect(c.ok && codes(c.blocks[0])).toEqual(["Robe Door", "Robe Interior", "Flat Door (1 Side)"]);
    const d = c.ok ? applyCupboard(c.blocks, 2, false, null, () => id++) : c;
    expect(d.ok && codes(d.blocks[0])).toEqual([]);
    expect(d.ok && d.blocks[0].customer).toMatchObject({ cup: false, cupInterior: null, cupDoorInside: null });
    const e = d.ok ? applyCupboard(d.blocks, 2, true, null, () => id++) : d;
    const view = e.ok ? roomLoopViews(e.blocks, allCodes)[0] : null;
    expect(view?.cupboardInterior?.on).toBeNull();
    expect(view?.cupboardDoorInside?.on).toBeNull();
  });

  it("a room type without an interior question refuses by name", () => {
    const r = applyCupboardInterior([{ ...kitchen(), roomType: "living" }], 1, true, null, () => 99);
    expect(r).toEqual({ ok: false, error: "This room has no cupboard-interior question." });
  });

  it("the loop view asks about the insides only once the doors are a Yes, and only when the code is on the card", () => {
    const unasked = roomLoopViews([kitchen()], allCodes)[0];
    expect(unasked.cupboard).not.toBeNull();
    expect(unasked.cupboardInterior).toBeNull();
    const doorsNo = applyCupboard([kitchen()], 1, false, null, () => 50);
    expect(doorsNo.ok && roomLoopViews(doorsNo.blocks, allCodes)[0].cupboardInterior).toBeNull();
    const doorsYes = applyCupboard([kitchen()], 1, true, null, () => 50);
    const withRow = doorsYes.ok ? roomLoopViews(doorsYes.blocks, allCodes)[0] : null;
    expect(withRow?.cupboardInterior).toMatchObject({ question: "Paint inside the kitchen cupboards too?", on: null, count: 8 });
    const withoutRow = doorsYes.ok ? roomLoopViews(doorsYes.blocks, new Set(["Kitchen Cupboard Front"]))[0] : null;
    expect(withoutRow?.cupboardInterior).toBeNull();
    const bed = applyCupboard([bedroom()], 2, true, null, () => 50);
    const bedView = bed.ok ? roomLoopViews(bed.blocks, allCodes)[0] : null;
    expect(bedView?.cupboardDoorInside).toMatchObject({ question: "Paint the inside of the robe doors too?", on: null, count: 2 });
  });

  it("the sweep chips reach only the rooms whose doors are a Yes", () => {
    let id = 10;
    const yes = applyCupboard([bedroom(2), bedroom(3), kitchen()], 2, true, null, () => id++);
    const r = yes.ok ? applyCupboardsEverywhere(yes.blocks, "door_inside", allCodes, () => id++) : { blocks: [], rooms: -1 };
    expect(r.rooms).toBe(1);
    expect(codes(r.blocks[0])).toEqual(["Robe Door", "Flat Door (1 Side)"]);
    expect(codes(r.blocks[1])).toEqual([]);
    const none = applyCupboardsEverywhere([bedroom(2), bedroom(3)], "interior", allCodes, () => id++);
    expect(none.rooms).toBe(0);
  });

  it("a room confirms without the interior answer — it is a tightening question, not a gate", () => {
    const sized = { ...kitchen(), customer: { size: "yes" as const, cup: true, confirmed: false } };
    expect(confirmRoom([sized], 1, true).ok).toBe(true);
  });
});
