import { describe, expect, it } from "vitest";
import { CUPBOARD_INTERIOR_BY_ROOM_TYPE, applyCupboard, applyCupboardInterior, confirmRoom, roomLoopViews, type LooseBlock } from "./rooms-loop";

const kitchen = (): LooseBlock => ({ id: 1, kind: "area", type: "Interior", roomType: "kitchen", name: "Kitchen", L: 4, W: 3, surfaces: [] });
const allCodes = new Set(["Kitchen Cupboard Front", "Kitchen Cupboard Interior", "Robe Door"]);

describe("D19 cupboard interiors (ruled 2 Sep 2026)", () => {
  it("every room type with a question names a code the migration creates", () => {
    const codes = new Set(Object.values(CUPBOARD_INTERIOR_BY_ROOM_TYPE).map((c) => c.code));
    expect([...codes].sort()).toEqual(["Kitchen Cupboard Interior", "Linen / Broom Cupboard Interior", "Robe Interior", "Vanity Interior"]);
  });

  it("yes adds the interior line at the room's default count, customer_stated", () => {
    let id = 10;
    const r = applyCupboardInterior([kitchen()], 1, true, null, () => id++);
    expect(r.ok).toBe(true);
    const line = r.ok ? r.blocks[0].surfaces?.[0] : undefined;
    expect(line).toMatchObject({ code: "Kitchen Cupboard Interior", count: 8, origin: "customer_stated" });
    expect(r.ok && r.blocks[0].customer?.cupInterior).toBe(true);
  });

  it("no removes the line and RECORDS the answer", () => {
    let id = 10;
    const yes = applyCupboardInterior([kitchen()], 1, true, 6, () => id++);
    const no = yes.ok ? applyCupboardInterior(yes.blocks, 1, false, null, () => id++) : yes;
    expect(no.ok && no.blocks[0].surfaces).toEqual([]);
    expect(no.ok && no.blocks[0].customer?.cupInterior).toBe(false);
  });

  it("fronts and interiors are independent answers", () => {
    let id = 10;
    const a = applyCupboard([kitchen()], 1, true, null, () => id++);
    const b = a.ok ? applyCupboardInterior(a.blocks, 1, true, null, () => id++) : a;
    expect(b.ok && b.blocks[0].surfaces?.map((s) => s.code)).toEqual(["Kitchen Cupboard Front", "Kitchen Cupboard Interior"]);
    const c = b.ok ? applyCupboard(b.blocks, 1, false, null, () => id++) : b;
    expect(c.ok && c.blocks[0].surfaces?.map((s) => s.code)).toEqual(["Kitchen Cupboard Interior"]);
    expect(c.ok && c.blocks[0].customer).toMatchObject({ cup: false, cupInterior: true });
  });

  it("a room type without an interior question refuses by name", () => {
    const r = applyCupboardInterior([{ ...kitchen(), roomType: "living" }], 1, true, null, () => 99);
    expect(r).toEqual({ ok: false, error: "This room has no cupboard-interior question." });
  });

  it("the loop view exposes the interior question only when the code is on the card", () => {
    const withRow = roomLoopViews([kitchen()], allCodes)[0];
    expect(withRow.cupboardInterior).toMatchObject({ question: "Paint inside the kitchen cupboards too?", on: null, count: 8 });
    const withoutRow = roomLoopViews([kitchen()], new Set(["Kitchen Cupboard Front"]))[0];
    expect(withoutRow.cupboardInterior).toBeNull();
    expect(withoutRow.cupboard).not.toBeNull();
  });

  it("a room confirms without the interior answer — it is a tightening question, not a gate", () => {
    let id = 10;
    const sized = { ...kitchen(), customer: { size: "yes" as const, cup: true, confirmed: false } };
    const r = confirmRoom([sized], 1, true);
    expect(r.ok).toBe(true);
    void id; void applyCupboardInterior; id++;
  });
});
