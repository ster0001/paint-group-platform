import { describe, expect, it } from "vitest";
import { generalCards, houseCounts, measureCards, quoteCards, quoteProgress, quoteRoomsFrom, roomCards, typicalRoomNames, type QuoteInput, type QuoteRoom } from "./cards";

const base: QuoteInput = {
  jobKind: "interior", general: {}, heightUnconfirmed: true, access: {}, asksLift: false,
  rooms: [
    room({ areaId: 1, name: "Bed 1", lengthM: 3.5, widthM: 3.2, size: null, confirmed: false, cupboard: { question: "Paint the built-in robe doors?", on: null }, tiles: [tile("doors", 2), tile("windows", 1)] }),
    room({ areaId: 2, name: "Living room", lengthM: 5, widthM: 4, size: "adjusted", confirmed: true, tiles: [tile("doors", 1), tile("windows", 3)] }),
    room({ areaId: 3, name: "Kitchen", lengthM: 4, widthM: 3, size: "yes", confirmed: true, cupboard: { question: "Are we painting the kitchen cupboards?", on: false } }),
  ],
};
function tile(key: string, count: number): QuoteRoom["tiles"][number] { return { key, label: key, on: true, count, countable: true, longTail: false }; }
function room(r: Partial<QuoteRoom> & Pick<QuoteRoom, "areaId" | "name">): QuoteRoom {
  return { lengthM: 3, widthM: 3, heightM: 2.4, size: null, confirmed: false, tiles: [], windows: [], cupboard: null, cupboardInterior: null, spots: [], extras: { featureWalls: 0, wallpaper: false, other: "" }, garagePending: false, ...r };
}

describe("quote stage v10 — the cards as data (brief §3)", () => {
  it("an interior job: the whole-house cards in order, every one writing an existing wizard-edit action", () => {
    const g = generalCards(base);
    expect(g.map((c) => c.key)).toEqual(["cornices", "height", "doors", "windows", "paintBase", "glossTrims", "cleared", "stairwell", "parking"]);
    expect(g.every((c) => c.options.every((o) => typeof o.action.action === "string"))).toBe(true);
    expect(g.find((c) => c.key === "cornices")!.options.map((o) => o.value)).toEqual(["none", "standard", "decorative"]);
    expect(g.find((c) => c.key === "windows")!.options.every((o) => o.drawing?.startsWith("win-"))).toBe(true);
    expect(g.find((c) => c.key === "doors")!.options.map((o) => o.drawing)).toEqual(["door-panel", "door-flat"]);
  });
  it("the lift card only where the building asks for it; doors & trims skips the cornices and the height; outside has none", () => {
    expect(generalCards({ ...base, asksLift: true }).map((c) => c.key)).toContain("lift");
    expect(generalCards({ ...base, jobKind: "trims" }).map((c) => c.key)).toEqual(["doors", "windows", "paintBase", "glossTrims", "cleared", "stairwell", "parking"]);
    expect(generalCards({ ...base, jobKind: "exterior" })).toEqual([]);
  });
  it("answers so far are pre-selected", () => {
    const g = generalCards({ ...base, general: { cornices: "standard", doors: "flat" }, access: { cleared: "no" } });
    expect(g.find((c) => c.key === "cornices")!.value).toBe("standard");
    expect(g.find((c) => c.key === "doors")!.value).toBe("flat");
    expect(g.find((c) => c.key === "cleared")!.value).toBe("no");
    expect(g.find((c) => c.key === "parking")!.value).toBeNull();
  });
  it("one measure card per room, in order, measured only when the size was typed (R2)", () => {
    const m = measureCards(base);
    expect(m.map((c) => c.id)).toEqual(["measure:1", "measure:2", "measure:3"]);
    expect(m.map((c) => c.measured)).toEqual([false, true, false]);
    expect(m.map((c) => c.typical)).toEqual([true, false, true]);
    expect(m[0].stage).toBe("Bed 1 · 1 of 3");
    expect(typicalRoomNames(base.rooms)).toEqual(["Bed 1", "Kitchen"]);
  });
  it("the full list ends on the done card; the bar runs 55 → 100 across it", () => {
    const all = quoteCards(base);
    expect(all[all.length - 1].kind).toBe("done");
    expect(all).toHaveLength(9 + 11 + 2 + 1);
    expect(quoteProgress(0, all.length)).toBe(55);
    expect(quoteProgress(all.length - 1, all.length)).toBe(100);
    expect(quoteProgress(6, 13)).toBe(78);
  });

  it("session 3: four cards per room (the robe card only where the loop offers a cupboard row), then E1, E2, done", () => {
    const ids = roomCards(base).map((c) => c.id);
    expect(ids).toEqual(["measure:1", "surfaces:1", "robe:1", "attention:1", "measure:2", "surfaces:2", "attention:2", "measure:3", "surfaces:3", "robe:3", "attention:3"]);
    const all = quoteCards(base).map((c) => c.id);
    expect(all.slice(-3)).toEqual(["rooms", "extras", "done"]);
    expect(all.indexOf("measure:1")).toBeGreaterThan(all.indexOf("g:parking"));
  });
  it("E1's house counts add up the rooms' door and window tiles", () => {
    expect(houseCounts(base.rooms)).toEqual({ doors: 3, windows: 4 });
    const rooms = quoteCards(base).find((c) => c.kind === "rooms");
    expect(rooms && rooms.kind === "rooms" ? [rooms.doors, rooms.windows] : null).toEqual([3, 4]);
  });
  it("quoteRoomsFrom joins the three server views by areaId and tolerates a missing loop row", () => {
    const rs = quoteRoomsFrom(
      [{ areaId: 7, name: "Hall", m2: null, tiles: [tile("walls", 1)], spots: [], condition: "same", garagePending: true }],
      [{ areaId: 7, sizeLabel: "", lengthM: 6, widthM: 1.2, heightM: 2.7, heightAdjusted: false, size: "yes", confirmed: true, cupboard: null, cupboardInterior: { question: "Inside?", unit: "", on: true, count: 1, note: "" }, cupboardDoorInside: null, windows: [{ id: 3, label: "Windows", count: 2, sizeBand: "M" }], customs: [] }],
      { "7": { featureWalls: 1, wallpaper: false, other: "" } },
    );
    expect(rs[0]).toMatchObject({ areaId: 7, name: "Hall", lengthM: 6, widthM: 1.2, heightM: 2.7, size: "yes", cupboard: null, cupboardInterior: { on: true }, extras: { featureWalls: 1 }, garagePending: true });
    expect(rs[0].windows[0].count).toBe(2);
    const bare = quoteRoomsFrom([{ areaId: 8, name: "Study", m2: null, tiles: [], spots: [], condition: "same" }], [], {});
    expect(bare[0]).toMatchObject({ size: null, heightM: 2.4, extras: { featureWalls: 0 }, garagePending: false });
  });
});
