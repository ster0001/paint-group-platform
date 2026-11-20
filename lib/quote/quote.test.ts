import { describe, expect, it } from "vitest";
import { lineState, quoteDocument, quoteLines, quoteNumber, quoteSummary } from "./quote";
import { quoteBreakdown } from "@/lib/pricing/quoteBreakdown";
import type { QuoteRoom } from "./cards";

const bare = { tiles: [], windows: [], cupboard: null, cupboardInterior: null, roomType: "", cupboardDoors: null, spots: [], extras: { featureWalls: 0, wallpaper: false, other: "" }, garagePending: false };
const rooms: QuoteRoom[] = [
  { areaId: 1, name: "Bed 1", lengthM: 3.5, widthM: 3.2, heightM: 2.4, size: "adjusted", confirmed: true, ...bare },
  { areaId: 2, name: "Living room", lengthM: 5, widthM: 4, heightM: 2.7, size: "yes", confirmed: true, ...bare },
  { areaId: 3, name: "Kitchen", lengthM: 4, widthM: 3, heightM: 2.4, size: null, confirmed: false, ...bare },
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
    const draft = quoteDocument({ payload, rooms, preparedFor: { name: "Tom", address: "15 Westgarth St", mobile: "0400", email: "t@x.com" }, number: "PH-ABC123", date: "2 Nov 2026", generalToGo: 2, validDays: 30 });
    expect(draft.title).toBe("Draft quote");
    expect(draft.totalLabel).toBe("Your range");
    expect(draft.total).toBe("$4,100 – $5,050");
    expect(draft.subtotal).toBe("$3,727 – $4,591");
    expect(draft.gst).toBe("$373 – $459");
    expect(draft.validity).toBe("Valid 30 days · Includes GST");
    const settledRooms = rooms.map((r) => ({ ...r, size: r.size ?? "yes" }));
    const done = quoteDocument({ payload, rooms: settledRooms, preparedFor: draft.preparedFor, number: "PH-ABC123", date: "2 Nov 2026", generalToGo: 0, validDays: 30 });
    expect(done.title).toBe("Quote");
    expect(done.totalLabel).toBe("Your price");
    expect(done.total).toBe("$4,100 – $5,050"); // still a range (R1)
  });
  it("go-live D5: the validity line reads the Settings number, never a typed 30", () => {
    const d = quoteDocument({ payload, rooms, preparedFor: { name: null, address: null, mobile: null, email: null }, number: "PG-1", date: "18 Nov 2026", generalToGo: 0, validDays: 60 });
    expect(d.validity).toBe("Valid 60 days · Includes GST");
  });

  it("go-live H1: with the breakdown, every room line is its share of the Subtotal, the extras have lines, and the lines add to the Subtotal (low and high, to the dollar)", () => {
    const breakdown = quoteBreakdown(
      [{ key: "room:1", cents: 120_000 }, { key: "room:2", cents: 200_000 }, { key: "room:3", cents: 90_000 }, { key: "prep", cents: 38_250 }, { key: "cleaning", cents: 19_500 }, { key: "specialist", cents: 0 }, { key: "size", cents: 0 }, { key: "discount", cents: 0 }],
      410_000, 505_000,
    );
    const settledRooms = rooms.map((r) => ({ ...r, size: r.size ?? "yes" }));
    const d = quoteDocument({ payload: { ...payload, quoteBreakdown: breakdown }, rooms: settledRooms, preparedFor: { name: null, address: null, mobile: null, email: null }, number: "PG-1", date: "18 Nov 2026", generalToGo: 0, validDays: 60 });
    expect(d.extras.map((x) => x.label)).toEqual(["Set-up and preparation", "Cleaning"]); // the zero parts have no line
    expect(d.extras[0].detail).toMatch(/repairs allowed for/i);
    expect(d.subtotalLabel).toBe("Subtotal · ex GST");
    const money = (s: string) => s.replace(/[^\d–]/g, "").split("–").map(Number);
    const lines = [...d.lines.map((l) => l.amount), ...d.extras.map((x) => x.amount)].map(money);
    const [subLo, subHi] = money(d.subtotal!);
    expect(lines.reduce((a, [lo]) => a + lo, 0)).toBe(subLo);
    expect(lines.reduce((a, [, hi]) => a + hi, 0)).toBe(subHi);
    const [gstLo, gstHi] = money(d.gst!);
    const [totLo, totHi] = money(d.total);
    expect(subLo + gstLo).toBe(totLo);
    expect(subHi + gstHi).toBe(totHi);
    expect(d.total).toBe("$4,100 – $5,050");
    // an open line still shows no amount, and a payload from before the breakdown keeps the room's own range
    const open = quoteDocument({ payload: { ...payload, quoteBreakdown: breakdown }, rooms, preparedFor: d.preparedFor, number: "PG-1", date: "18 Nov 2026", generalToGo: 0, validDays: 60 });
    expect(open.lines[2].amount).toBe("—");
    const legacy = quoteDocument({ payload, rooms: settledRooms, preparedFor: d.preparedFor, number: "PG-1", date: "18 Nov 2026", generalToGo: 0, validDays: 60 });
    expect(legacy.extras).toEqual([]);
    expect(legacy.lines[0].amount).toBe("$1,200 – $1,480");
  });

  it("the quote number is the shopfront's prefix and the estimate's first six hex", () => {
    expect(quoteNumber("3fa85f64-5717-4562-b3fc-2c963f66afa6", "painthome")).toBe("PH-3FA85F");
    expect(quoteNumber("3fa85f64-5717-4562-b3fc-2c963f66afa6", "paintgroup")).toBe("PG-3FA85F");
  });
});
