import { describe, expect, it } from "vitest";
import { CUPBOARD_INTERIOR_BY_ROOM_TYPE, applyCupboard, applyCupboardDoorInside, applyCupboardInterior, applyCupboardsEverywhere, confirmRoom, roomLoopViews, type LooseBlock } from "./rooms-loop";

const kitchen = (): LooseBlock => ({ id: 1, kind: "area", type: "Interior", roomType: "kitchen", name: "Kitchen", L: 4, W: 3, surfaces: [] });
const bedroom = (id = 2): LooseBlock => ({ id, kind: "area", type: "Interior", roomType: "bedroom", name: `Bed ${id}`, L: 3.5, W: 3.2, surfaces: [] });
const allCodes = new Set(["Kitchen Cupboard Front", "Kitchen Cupboard Interior", "Robe Door", "Robe Interior", "Flat Door (1 Side)"]);
const codes = (b: LooseBlock) => (b.surfaces ?? []).map((s) => String(s.code));

describe("cupboard interiors — their own question (Tom, 25 Oct 2026, item 6: a mirrored robe keeps its doors and still wants the inside painted); the inside FACE of the doors still follows the doors", () => {
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

  it("the insides are answered with the doors unasked or a No; only the door FACES wait for the doors", () => {
    let id = 10;
    const unasked = applyCupboardInterior([kitchen()], 1, true, null, () => id++);
    expect(unasked.ok && codes(unasked.blocks[0])).toEqual(["Kitchen Cupboard Interior"]);
    expect(unasked.ok && unasked.blocks[0].customer).toMatchObject({ cup: null, cupInterior: true });
    const doorsNo = applyCupboard([bedroom()], 2, false, null, () => 99);
    const insideNo = doorsNo.ok ? applyCupboardInterior(doorsNo.blocks, 2, true, null, () => id++) : doorsNo;
    expect(insideNo.ok && codes(insideNo.blocks[0])).toEqual(["Robe Interior"]);
    const inside = doorsNo.ok ? applyCupboardDoorInside(doorsNo.blocks, 2, true, null, () => 99) : doorsNo;
    expect(inside).toEqual({ ok: false, error: "Tick the robe doors first — the inside faces follow that answer." });
  });

  it("a No on the doors drops the door-face line and un-asks it; the walls inside keep their answer and their line", () => {
    let id = 10;
    const a = applyCupboard([bedroom()], 2, true, null, () => id++);
    const b = a.ok ? applyCupboardInterior(a.blocks, 2, true, null, () => id++) : a;
    const c = b.ok ? applyCupboardDoorInside(b.blocks, 2, true, null, () => id++) : b;
    expect(c.ok && codes(c.blocks[0])).toEqual(["Robe Door", "Robe Interior", "Flat Door (1 Side)"]);
    const d = c.ok ? applyCupboard(c.blocks, 2, false, null, () => id++) : c;
    expect(d.ok && codes(d.blocks[0])).toEqual(["Robe Interior"]);
    expect(d.ok && d.blocks[0].customer).toMatchObject({ cup: false, cupInterior: true, cupDoorInside: null });
    const e = d.ok ? applyCupboard(d.blocks, 2, true, null, () => id++) : d;
    const view = e.ok ? roomLoopViews(e.blocks, allCodes)[0] : null;
    expect(view?.cupboardInterior?.on).toBe(true);
    expect(view?.cupboardDoorInside?.on).toBeNull();
  });

  it("a room type without an interior question refuses by name", () => {
    const r = applyCupboardInterior([{ ...kitchen(), roomType: "living" }], 1, true, null, () => 99);
    expect(r).toEqual({ ok: false, error: "This room has no cupboard-interior question." });
  });

  it("the loop view asks about the insides whatever the doors say, but only when the code is on the card; the door faces still wait for the doors", () => {
    const unasked = roomLoopViews([kitchen()], allCodes)[0];
    expect(unasked.cupboard).not.toBeNull();
    expect(unasked.cupboardInterior).toMatchObject({ question: "Paint inside the kitchen cupboards too?", on: null, count: 8 });
    const doorsNo = applyCupboard([kitchen()], 1, false, null, () => 50);
    expect(doorsNo.ok && roomLoopViews(doorsNo.blocks, allCodes)[0].cupboardInterior).toMatchObject({ on: null });
    const bedNo = applyCupboard([bedroom()], 2, false, null, () => 50);
    expect(bedNo.ok && roomLoopViews(bedNo.blocks, allCodes)[0].cupboardDoorInside).toBeNull();
    const doorsYes = applyCupboard([kitchen()], 1, true, null, () => 50);
    const withRow = doorsYes.ok ? roomLoopViews(doorsYes.blocks, allCodes)[0] : null;
    expect(withRow?.cupboardInterior).toMatchObject({ question: "Paint inside the kitchen cupboards too?", on: null, count: 8 });
    const withoutRow = doorsYes.ok ? roomLoopViews(doorsYes.blocks, new Set(["Kitchen Cupboard Front"]))[0] : null;
    expect(withoutRow?.cupboardInterior).toBeNull();
    const bed = applyCupboard([bedroom()], 2, true, null, () => 50);
    const bedView = bed.ok ? roomLoopViews(bed.blocks, allCodes)[0] : null;
    expect(bedView?.cupboardDoorInside).toMatchObject({ question: "Paint the inside of the robe doors too?", on: null, count: 2 });
  });

  it("the door-face sweep reaches only the rooms whose doors are a Yes; the insides sweep reaches every room with the question", () => {
    let id = 10;
    const yes = applyCupboard([bedroom(2), bedroom(3), kitchen()], 2, true, null, () => id++);
    const r = yes.ok ? applyCupboardsEverywhere(yes.blocks, "door_inside", allCodes, () => id++) : { blocks: [], rooms: -1 };
    expect(r.rooms).toBe(1);
    expect(codes(r.blocks[0])).toEqual(["Robe Door", "Flat Door (1 Side)"]);
    expect(codes(r.blocks[1])).toEqual([]);
    const all = applyCupboardsEverywhere([bedroom(2), bedroom(3), kitchen()], "interior", allCodes, () => id++);
    expect(all.rooms).toBe(3);
    expect(codes(all.blocks[2])).toEqual(["Kitchen Cupboard Interior"]);
    const none = applyCupboardsEverywhere([{ ...kitchen(), roomType: "living" }], "interior", allCodes, () => id++);
    expect(none.rooms).toBe(0);
  });

  it("a room confirms without the interior answer — it is a tightening question, not a gate", () => {
    const sized = { ...kitchen(), customer: { size: "yes" as const, cup: true, confirmed: false } };
    expect(confirmRoom([sized], 1, true).ok).toBe(true);
  });
});

describe("Tom, 27 Oct 2026: the walls inside a built-in robe read as No until the customer says otherwise", () => {
  it("a bedroom's robe interior is pre-answered No; a kitchen's stays unasked; a Yes still wins", () => {
    const bedView = roomLoopViews([bedroom()], allCodes)[0];
    expect(bedView.cupboardInterior).toMatchObject({ question: "Paint the walls inside the built-in robe?", on: false });
    expect(roomLoopViews([kitchen()], allCodes)[0].cupboardInterior).toMatchObject({ on: null });
    let id = 10;
    const yes = applyCupboardInterior([bedroom()], 2, true, null, () => id++);
    expect(yes.ok && roomLoopViews(yes.blocks, allCodes)[0].cupboardInterior?.on).toBe(true);
  });
});
