import { describe, expect, it } from "vitest";
import { lineState, quoteDocument, quoteLines, quoteNumber, quoteSummary } from "./quote";
import type { QuoteRoom } from "./cards";

const rooms: QuoteRoom[] = [
  { areaId: 1, name: "Bed 1", lengthM: 3.5, widthM: 3.2, heightM: 2.4, size: "adjusted", confirmed: true },
  { areaId: 2, name: "Living room", lengthM: 5, widthM: 4, heightM: 2.7, size: "yes", confirmed: true },
  { areaId: 3, name: "Kitchen", lengthM: 4, widthM: 3, heightM: 2.4, size: null, confirmed: false },
];
const views = [
  { areaId: 1, name: "Bed 1", summary: "walls, ceiling, 2 × doors", confidencePct: 90, status: "stated" as const, rangeLoCents: 120_000, rangeHiCents: 148_000 },
  { areaId: 2, name: "Living room", summary: "walls, ceiling", confidencePct: 70, status: "typical" as const, rangeLoCents: 200_000, rangeHiCents: 246_000 },
  { areaId: 3, name: "Kitchen", summary: "walls", confidencePct: 60, status: "typical" as const, rangeLoCents: 90_000, rangeHiCents: 111_000 },
];
const payload = { rooms: views, rangeLoCents: 410_000, rangeHiCents: 505_000, quoteTotals: { subtotalLoCents: 372_727, subtotalHiCents: 459_091, gstLoCents: 37_273, gstHiCents: 45_909 } };

describe("quote stage v10 — the quote document as data (§5)", () => {
  it("a line's state follows the size answer: typed = measured, the typical taken = typical, nothing yet = todo", () => {
    expect(rooms.map(lineState)).toEqual(["measured", "typical", "todo"]);
  });
  it("one line per room with its size, (typical) while the typical stands, what is included, and the amount once settled — never before", () => {
    const l = quoteLines(rooms, views);
    expect(l[0]).toMatchObject({ name: "Bed 1", size: "3.2 × 3.5 × 2.4 m", typical: false, included: "walls, ceiling, 2 × doors", amount: "$1,200 – $1,480", state: "measured" });
    expect(l[1].size).toBe("4 × 5 × 2.7 m (typical)");
    expect(l[1].amount).toBe("$2,000 – $2,460");
    expect(l[2]).toMatchObject({ size: "3 × 4 × 2.4 m (typical)", amount: "—", state: "todo" });
  });
  it("the summary: lines to go, the minutes, the settled share, and the document's title and total label follow it", () => {
    expect(quoteSummary(rooms, 2)).toEqual({ toGo: 3, minutes: 1, settledShare: 2 / 3, allSettled: false });
    const draft = quoteDocument({ payload, rooms, preparedFor: { name: "Tom", address: "15 Westgarth St", mobile: "0400", email: "t@x.com" }, number: "PH-ABC123", date: "2 Nov 2026", generalToGo: 2 });
    expect(draft.title).toBe("Draft quote");
    expect(draft.totalLabel).toBe("Your range");
    expect(draft.total).toBe("$4,100 – $5,050");
    expect(draft.subtotal).toBe("$3,727 – $4,591");
    expect(draft.gst).toBe("$373 – $459");
    expect(draft.validity).toBe("Valid 30 days · Includes GST");
    const settledRooms = rooms.map((r) => ({ ...r, size: r.size ?? "yes" }));
    const done = quoteDocument({ payload, rooms: settledRooms, preparedFor: draft.preparedFor, number: "PH-ABC123", date: "2 Nov 2026", generalToGo: 0 });
    expect(done.title).toBe("Quote");
    expect(done.totalLabel).toBe("Your price");
    expect(done.total).toBe("$4,100 – $5,050"); // still a range (R1)
  });
  it("the quote number is the shopfront's prefix and the estimate's first six hex", () => {
    expect(quoteNumber("3fa85f64-5717-4562-b3fc-2c963f66afa6", "painthome")).toBe("PH-3FA85F");
    expect(quoteNumber("3fa85f64-5717-4562-b3fc-2c963f66afa6", "paintgroup")).toBe("PG-3FA85F");
  });
});
