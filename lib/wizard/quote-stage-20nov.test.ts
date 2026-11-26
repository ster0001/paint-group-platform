import { describe, expect, it } from "vitest";
import { GENERIC_CUPBOARD, applyCupboard, applyRoomSameAs, roomLoopViews, type LooseBlock } from "./rooms-loop";
import { FALLBACK_TYPICALS, starterRoomList, typicalSize } from "./starter";

/**
 * Tom, 20 Nov 2026 — seven quote-stage items. The cards (robe card in bedrooms only, "Same as Bed 1" on a later bedroom)
 * are `lib/quote/cards.test.ts`; this file is the model underneath: the copy, cupboard doors in any room, the two sizes.
 */
const ids = () => { let n = 100; return () => n++; };
const bed = (id: number, name: string, over: Partial<LooseBlock> = {}): LooseBlock => ({
  id, kind: "area", name, type: "Interior", roomType: "bedroom", L: 3.5, W: 3.25, H: 2.4,
  surfaces: [], customer: { size: null, cup: null, confirmed: false }, ...over,
});
const codes = new Set(["Robe Door", "Robe Interior", "Vanity Door", "Kitchen Cupboard Front"]);

describe("quote stage — Tom's seven, 20 Nov 2026", () => {
  it("item 3: Same as Bed 1 copies what is painted and the robe answers; the size, the name and the repairs stay the room's own", () => {
    const one = bed(1, "Bed 1", {
      surfaces: [
        { id: 10, code: "Walls", count: 1, sharePct: 50 },
        { id: 11, code: "Robe Door", count: 4 },
        { id: 12, code: "Repair", count: 1, assumedFields: ["prep"] },
      ],
      customer: { size: "adjusted", cup: true, cupInterior: true, confirmed: true },
      customerCustom: ["picture rail"],
    });
    const two = bed(2, "Bed 2", {
      L: 4.2, W: 3, H: 2.7,
      surfaces: [{ id: 20, code: "Ceiling", count: 1 }, { id: 21, code: "Repair", count: 1, assumedFields: ["prep"] }],
      customer: { size: "adjusted", cup: false, confirmed: false },
    });
    const r = applyRoomSameAs([one, two], 2, 1, ids());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const out = r.blocks.find((b) => b.id === 2)!;
    expect([out.L, out.W, out.H, out.name]).toEqual([4.2, 3, 2.7, "Bed 2"]);
    expect(out.surfaces!.map((s) => [s.code, s.count, s.sharePct ?? null])).toEqual([["Walls", 1, 50], ["Robe Door", 4, null], ["Repair", 1, null]]);
    // new ids for the copies (never Bed 1's own), its own repair line kept as it was
    expect(out.surfaces!.map((s) => s.id)).toEqual([100, 101, 21]);
    expect(out.customer).toMatchObject({ size: "adjusted", cup: true, cupInterior: true });
    expect(out.customerCustom).toEqual(["picture rail"]);
    // Bed 1 is untouched
    expect(r.blocks.find((b) => b.id === 1)).toBe(one);
  });

  it("item 3: refused across room types, and from a room onto itself", () => {
    const blocks = [bed(1, "Bed 1"), bed(2, "Bathroom", { roomType: "bathroom" })];
    expect(applyRoomSameAs(blocks, 2, 1, ids()).ok).toBe(false);
    expect(applyRoomSameAs(blocks, 1, 1, ids()).ok).toBe(false);
    expect(applyRoomSameAs(blocks, 1, 9, ids()).ok).toBe(false);
  });

  it("item 5: cupboard doors are a countable surface in ANY room — a living room prices them on the plain cupboard-door row", () => {
    const living = bed(3, "Living room", { roomType: "living" });
    const on = applyCupboard([living], 3, true, 6, ids());
    expect(on.ok).toBe(true);
    if (!on.ok) return;
    expect(on.blocks[0].surfaces).toMatchObject([{ code: GENERIC_CUPBOARD.code, count: 6 }]);
    const view = roomLoopViews(on.blocks, codes)[0];
    expect(view.cupboardDoors).toEqual({ unit: "cupboard doors", count: 6, defaultCount: 2 });
    // no cupboard QUESTION is invented for a living room
    expect(view.cupboard).toBeNull();
    const off = applyCupboard(on.blocks, 3, false, null, ids());
    expect(off.ok && off.blocks[0].surfaces).toEqual([]);
    expect(off.ok && roomLoopViews(off.blocks, codes)[0].cupboardDoors?.count).toBe(0);
    // a card with no cupboard-door row offers nothing (never a silent $0)
    expect(roomLoopViews([living], new Set(["Robe Door"]))[0].cupboardDoors).toBeNull();
  });

  it("items 1, 2: a bedroom's view carries the robe-door count and the room type; the walls inside stand without the doors", () => {
    const b = bed(1, "Bed 1", { surfaces: [{ id: 5, code: "Robe Door", count: 3 }, { id: 6, code: "Robe Interior", count: 2 }], customer: { size: null, cup: false, cupInterior: true, confirmed: false } });
    const v = roomLoopViews([b], codes)[0];
    expect(v.roomType).toBe("bedroom");
    expect(v.cupboard).toMatchObject({ on: false, count: 3 });
    expect(v.cupboardInterior).toMatchObject({ on: true, count: 2 });
  });

  it("items 6, 7: a hallway is 5 × 1.25 m and an ensuite 2 × 1.5 m, the ensuite from its own row", () => {
    expect(FALLBACK_TYPICALS.hallway).toEqual({ L: 5, W: 1.25 });
    expect(FALLBACK_TYPICALS.ensuite).toEqual({ L: 2, W: 1.5 });
    const rooms = starterRoomList({ bedrooms: 3, storeys: "single", bathrooms: 2, openPlanKitchenLiving: true } as Parameters<typeof starterRoomList>[0]);
    const ensuite = rooms.find((r) => r.name === "Ensuite")!;
    expect([ensuite.roomType, ensuite.sizeType]).toEqual(["bathroom", "ensuite"]);
    // a bathroom row edited in Settings never moves the ensuite; an ensuite row does
    const bathroomOnly = [{ room_type: "bathroom", typical_length_m: 3, typical_width_m: 2.5 }];
    expect(typicalSize("ensuite", bathroomOnly)).toEqual({ L: 2, W: 1.5 });
    expect(typicalSize("ensuite", [...bathroomOnly, { room_type: "ensuite", typical_length_m: 2.2, typical_width_m: 1.6 }])).toEqual({ L: 2.2, W: 1.6 });
  });
});
