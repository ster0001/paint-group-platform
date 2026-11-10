import { describe, expect, it } from "vitest";
import { priceLine, type LineInput } from "../pricing/estimate";
import { estimatedHours } from "./hours";
import { lineAreaId, lineScopeText, lineSurfaceKey, lineWorkOrderArea } from "./lineArea";

// 5 Milton St (10 Nov 2026): the "Deck around Pool" line, as saved.
const deck: LineInput & { id: number; name: string; description: string } = {
  kind: "line", id: 807, name: "Deck around Pool ", type: "Interior", mode: "hourly",
  hours: 10, rate: 85, qty: 1, unitPrice: 0, custom: 0, cost: 0, woHours: 0,
  description: "Pressure wash deck&nbsp;<div>Apply oxilic acid using stiff bristle broom and thoroughly clean deck</div><div>Sand back any old stain as required in preparation for recoat</div>",
};

describe("lineWorkOrderArea", () => {
  it("puts an hourly line's hours on the sheet as its own area", () => {
    const area = lineWorkOrderArea(deck, priceLine(deck).hours);
    expect(area).toMatchObject({
      id: "line-807", title: "Deck around Pool", side: "interior", photos: [], finishCode: null,
      surfaces: [{ key: "line-807:work", label: "Deck around Pool", hours: 10, coats: 0, product: "", status: "not_started" }],
    });
  });

  it("adds the line to the sheet's hours — 27.1 h of rooms + the deck = 37.1 h", () => {
    const rooms = { areas: [{ id: "a", title: "Bed 1", surfaces: [{ key: "a:1", label: "Walls", coats: 2, product: "", prep: "", hours: 27.1, status: "not_started" as const }], photos: [], finishCode: null, finishOverridden: false }] };
    const area = lineWorkOrderArea(deck, priceLine(deck).hours)!;
    expect(estimatedHours({ areas: [...rooms.areas, area] })).toBe(37.1);
  });

  it("uses the line's work-order hours for quantity and custom lines — the hours the pay counts", () => {
    const custom = { ...deck, id: 808, mode: "custom" as const, custom: 300, hours: 0, woHours: 3 };
    const qty = { ...deck, id: 809, mode: "quantity" as const, qty: 2, unitPrice: 50, hours: 0, woHours: 1.5 };
    expect(lineWorkOrderArea(custom, priceLine(custom).hours)?.surfaces[0].hours).toBe(3);
    expect(lineWorkOrderArea(qty, priceLine(qty).hours)?.surfaces[0].hours).toBe(1.5);
  });

  it("leaves a line with no hours off the sheet, as before", () => {
    const priceOnly = { ...deck, mode: "custom" as const, custom: 400, hours: 0, woHours: 0 };
    expect(lineWorkOrderArea(priceOnly, priceLine(priceOnly).hours)).toBeNull();
  });

  it("takes a staff hours override keyed by the line's surface", () => {
    expect(lineSurfaceKey(807)).toBe(`${lineAreaId(807)}:work`);
    expect(lineWorkOrderArea(deck, 10, 12)?.surfaces[0].hours).toBe(12);
  });

  it("is contractor-safe: the wording, never the line's price", () => {
    const json = JSON.stringify(lineWorkOrderArea({ ...deck, rate: 85 } as typeof deck, 10));
    expect(json).not.toContain("850");
    expect(json).not.toContain("rate");
    expect(json).not.toContain("<div>");
  });

  it("an Exterior line is an exterior area", () => {
    expect(lineWorkOrderArea({ ...deck, type: "Exterior" }, 10)?.side).toBe("exterior");
  });
});

describe("lineScopeText", () => {
  it("turns the builder's rich text into one line per paragraph", () => {
    expect(lineScopeText(deck.description)).toBe(
      "Pressure wash deck\nApply oxilic acid using stiff bristle broom and thoroughly clean deck\nSand back any old stain as required in preparation for recoat",
    );
  });
  it("handles breaks, entities and nothing at all", () => {
    expect(lineScopeText("a<br>b &amp; c<p>d</p>")).toBe("a\nb & c\nd");
    expect(lineScopeText("")).toBe("");
    expect(lineScopeText(null)).toBe("");
  });
});
