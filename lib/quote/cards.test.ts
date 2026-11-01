import { describe, expect, it } from "vitest";
import { generalCards, measureCards, quoteCards, quoteProgress, typicalRoomNames, type QuoteInput } from "./cards";

const base: QuoteInput = {
  jobKind: "interior", general: {}, heightUnconfirmed: true, access: {}, asksLift: false,
  rooms: [
    { areaId: 1, name: "Bed 1", lengthM: 3.5, widthM: 3.2, heightM: 2.4, size: null, confirmed: false },
    { areaId: 2, name: "Living room", lengthM: 5, widthM: 4, heightM: 2.4, size: "adjusted", confirmed: true },
    { areaId: 3, name: "Kitchen", lengthM: 4, widthM: 3, heightM: 2.4, size: "yes", confirmed: true },
  ],
};

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
    expect(all).toHaveLength(9 + 3 + 1);
    expect(quoteProgress(0, all.length)).toBe(55);
    expect(quoteProgress(all.length - 1, all.length)).toBe(100);
    expect(quoteProgress(6, 13)).toBe(78);
  });
});
