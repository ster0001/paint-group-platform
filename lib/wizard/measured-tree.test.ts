/**
 * C15 — the measured tree (§8.3): both stored shapes read, the seed
 * renumbers and drops the facade (⚑53), staleness follows the Settings row (⚑56).
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEASURED_TREE_MAX_AGE_DAYS, makeMeasuredTree, measuredTreeAgeDays, measuredTreeIsStale,
  measuredTreeMaxAgeDays, parseMeasuredTree, seedFromMeasuredTree, lastPaintedLabel,
} from "./measured-tree";
import type { DraftArea } from "@/lib/extract/draft";

const area = (id: number, name: string, type = "Interior"): DraftArea => ({
  id, kind: "area", name, type, areaType: "room", roomType: "bedroom", L: 4, W: 3, H: 2.4,
  isOption: false, description: "", open: false, media: [], origin: "human_confirmed", confidence: 1, assumedFields: [],
  extractionSourceId: null,
  surfaces: [{ id: id * 10, code: "Walls", internalLabel: "Walls", clientLabel: "Walls", count: 1, coats: 2, prepHr: 0, crewNote: "", origin: "human_confirmed", confidence: 1, assumedFields: [] }],
} as unknown as DraftArea);

describe("parseMeasuredTree", () => {
  it("reads C6's bare blocks array, taking the date from the column", () => {
    const t = parseMeasuredTree([area(1, "Bed 1")], "2026-03-01T00:00:00Z");
    expect(t?.version).toBe(1);
    expect(t?.blocks).toHaveLength(1);
    expect(t?.measuredAt).toBe("2026-03-01T00:00:00Z");
    expect(t?.measuredBy).toBeNull();
  });
  it("reads the versioned object and prefers its own date", () => {
    const stored = makeMeasuredTree([area(1, "Bed 1")], "staff-1", "est-1", new Date("2026-09-01T00:00:00Z"));
    const t = parseMeasuredTree(stored, "2020-01-01T00:00:00Z");
    expect(t?.measuredAt).toBe("2026-09-01T00:00:00.000Z");
    expect(t?.measuredBy).toBe("staff-1");
    expect(t?.estimateId).toBe("est-1");
  });
  it("is null for an empty array, null, or junk", () => {
    expect(parseMeasuredTree([], "2026-01-01")).toBeNull();
    expect(parseMeasuredTree(null)).toBeNull();
    expect(parseMeasuredTree({ blocks: [] })).toBeNull();
    expect(parseMeasuredTree("nope")).toBeNull();
  });
});

describe("seedFromMeasuredTree", () => {
  it("renumbers every area and surface from the caller's counter and keeps provenance", () => {
    const tree = makeMeasuredTree([area(7, "Bed 1"), area(9, "Living")], null, "e");
    let n = 100;
    const out = seedFromMeasuredTree(tree, () => n++);
    expect(out.map((a) => a.id)).toEqual([100, 102]);
    expect(out[0].surfaces[0].id).toBe(101);
    expect(out[0].origin).toBe("human_confirmed");
    expect(out.every((a) => a.isOption === false)).toBe(true);
  });
  it("never seeds the facade — outside is measured again or briefed (⚑53)", () => {
    const tree = makeMeasuredTree([area(1, "Bed 1"), area(2, "Front", "Exterior")], null, "e");
    let n = 1;
    expect(seedFromMeasuredTree(tree, () => n++).map((a) => a.name)).toEqual(["Bed 1"]);
  });
});

describe("staleness (⚑56)", () => {
  it("defaults to a year and reads the Settings row in either shape", () => {
    expect(DEFAULT_MEASURED_TREE_MAX_AGE_DAYS).toBe(365);
    expect(measuredTreeMaxAgeDays(undefined)).toBe(365);
    expect(measuredTreeMaxAgeDays({ days: 180 })).toBe(180);
    expect(measuredTreeMaxAgeDays(90)).toBe(90);
    expect(measuredTreeMaxAgeDays({ days: -3 })).toBe(365);
  });
  it("is stale past the limit, fresh inside it, and stale when the date is unusable", () => {
    const now = new Date("2026-09-13T00:00:00Z");
    expect(measuredTreeAgeDays({ measuredAt: "2026-09-01T00:00:00Z" }, now)).toBe(12);
    expect(measuredTreeIsStale({ measuredAt: "2026-09-01T00:00:00Z" }, 365, now)).toBe(false);
    expect(measuredTreeIsStale({ measuredAt: "2025-03-01T00:00:00Z" }, 365, now)).toBe(true);
    expect(measuredTreeIsStale({ measuredAt: "" }, 365, now)).toBe(true);
  });
  it("words the last-painted line as a month and year (⚑54)", () => {
    expect(lastPaintedLabel({ measuredAt: "2026-03-05T00:00:00Z" })).toBe("Mar 2026");
    expect(lastPaintedLabel({ measuredAt: "" })).toBe("date unknown");
  });
});
