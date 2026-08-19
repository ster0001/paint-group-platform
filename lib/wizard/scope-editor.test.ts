/**
 * Part B server boundary: the ONLY customer mutations are substrate on/off,
 * countable quantity and rename — expressed here as pure functions the route
 * applies. Nothing in this module can touch an hour, a rate or an allowance.
 */
import { describe, expect, it } from "vitest";
import { applyCount, applyRename, applyToggle, customerScopeRooms } from "./scope-editor";
import type { ScopeRule } from "@/lib/extract/scope";

const rules: ScopeRule[] = [
  { room_type: "bedroom", surface_type: "Walls", is_option: false, requires_confirm: false, notes: null },
  { room_type: "bedroom", surface_type: "Ceiling", is_option: false, requires_confirm: false, notes: null },
  { room_type: "bedroom", surface_type: "Skirting Boards", is_option: false, requires_confirm: false, notes: null },
  { room_type: "bedroom", surface_type: "Door & Frame", is_option: false, requires_confirm: false, notes: null },
  { room_type: "bedroom", surface_type: "Windows", is_option: false, requires_confirm: false, notes: null },
  { room_type: "bedroom", surface_type: "Cornices", is_option: true, requires_confirm: false, notes: null },
];

const surface = (id: number, code: string, count = 1, over: Record<string, unknown> = {}) => ({
  id, code, internalLabel: code, clientLabel: code, coats: 2, count,
  prepHr: 0, hidden: false, media: [], qtyOverride: null, rateOverride: null,
  paintingHrOverride: null, priceOverride: null, crewNote: "",
  origin: "ai_assumed", confidence: 0.5, assumedFields: [], ...over,
});

const room = () => ({
  id: 5, kind: "area", name: "Bed 1", type: "Interior", areaType: "room",
  roomType: "bedroom", storey: "ground", L: 3.5, W: 3.25, H: 2.4,
  surfaces: [
    surface(6, "Walls"),
    surface(7, "Ceilings"),
    surface(8, "Skirting Boards"),
    surface(9, "Flat Door and Frame (1 Side)", 2),
  ],
});

describe("customerScopeRooms", () => {
  it("derives tiles from scope rules with tick state from the tree", () => {
    const [r] = customerScopeRooms([room()], rules);
    expect(r.name).toBe("Bed 1");
    expect(r.m2).toBeCloseTo(11.4, 1);
    const by = Object.fromEntries(r.tiles.map((t) => [t.key, t]));
    expect(by.walls.on).toBe(true);
    expect(by.skirting.on).toBe(true);
    expect(by.doors).toMatchObject({ on: true, count: 2, countable: true });
    expect(by.windows).toMatchObject({ on: false, countable: true });
    // Optional + off → long tail ("More surfaces…").
    expect(by.cornices).toMatchObject({ on: false, longTail: true });
  });

  it("never exposes an hour, rate or cent", () => {
    const json = JSON.stringify(customerScopeRooms([room()], rules));
    for (const leak of ["prepHr", "rateOverride", "Cents", "paintingHr", "hours"]) {
      expect(json).not.toContain(leak);
    }
  });
});

describe("applyToggle", () => {
  it("OFF removes every line of the substrate family", () => {
    let id = 100;
    const r = applyToggle([room()], 5, "skirting", false, null, () => id++);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.blocks[0].surfaces as Array<{ code: string }>).some((s) => s.code === "Skirting Boards")).toBe(false);
  });

  it("ON adds one line at the wizard-answered style, customer_stated", () => {
    let id = 100;
    const snapshot = { details: { doorStyle: "panel", windowStyle: "sash" } } as never;
    const r = applyToggle([room()], 5, "windows", true, snapshot, () => id++);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const added = (r.blocks[0].surfaces as Array<Record<string, unknown>>).find((s) => s.code === "Double Hung Sash");
      expect(added).toMatchObject({ origin: "customer_stated", assumedFields: ["style"] });
    }
  });

  it("refuses toggling what isn't there / already on", () => {
    let id = 100;
    expect(applyToggle([room()], 5, "windows", false, null, () => id++).ok).toBe(false);
    expect(applyToggle([room()], 5, "walls", true, null, () => id++).ok).toBe(false);
  });
});

describe("applyCount", () => {
  it("sets the family count within 1–12", () => {
    const r = applyCount([room()], 5, "doors", 3);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const doors = (r.blocks[0].surfaces as Array<{ code: string; count: number }>)
        .filter((s) => s.code.includes("Door"));
      expect(doors.reduce((n, d) => n + d.count, 0)).toBe(3);
    }
    expect(applyCount([room()], 5, "doors", 0).ok).toBe(false);
    expect(applyCount([room()], 5, "doors", 13).ok).toBe(false);
    expect(applyCount([room()], 5, "walls", 2).ok).toBe(false); // not countable
  });
});

describe("applyRename", () => {
  it("renames, trims, refuses empties", () => {
    const r = applyRename([room()], 5, "  Master bedroom  ");
    expect(r.ok && String(r.blocks[0].name)).toBe("Master bedroom");
    expect(applyRename([room()], 5, "   ").ok).toBe(false);
  });
});

// ---- B2: exterior ----------------------------------------------------------
import { applyExtent, applyExteriorToggle, applyFenceLength, customerExteriorView } from "./scope-editor";

const extArea = (id: number, name: string, codes: string[], isOption = false) => ({
  id, kind: "area", name: `Exterior - ${name}`, type: "Exterior", areaType: "surface",
  roomType: "exterior", storey: "ground", L: 0, W: 0, H: 0, isOption,
  surfaces: codes.map((code, i) => surface(id * 100 + i, code)),
});

const extBlocks = () => [
  room(),
  extArea(20, "Front", ["Weatherboards", "Fascias", "Gutters", "Eaves", "Front Door"]),
  extArea(21, "Left", ["Weatherboards", "Fascias", "Gutters", "Eaves"]),
  extArea(22, "Right", ["Weatherboards", "Fascias", "Gutters", "Eaves"]),
  extArea(23, "Rear", ["Weatherboards", "Fascias", "Gutters", "Eaves"]),
];

describe("customerExteriorView (B2)", () => {
  it("groups element-first with extent read from options", () => {
    const v = customerExteriorView(extBlocks())!;
    expect(v.extent).toBe("whole");
    const body = v.groups.find((g) => g.group === "body")!;
    expect(body.tiles.map((t) => t.key)).toEqual(["weatherboards"]);
    const roof = v.groups.find((g) => g.group === "roofline")!;
    expect(roof.tiles.find((t) => t.key === "gutters")?.on).toBe(true);
    expect(roof.tiles.find((t) => t.key === "downpipes")?.on).toBe(false);
    expect(v.groups.find((g) => g.group === "extras")!.tiles.every((t) => !t.on)).toBe(true);
  });
  it("returns null when the job has no exterior", () => {
    expect(customerExteriorView([room()])).toBeNull();
  });
});

describe("applyExteriorToggle / applyExtent / applyFenceLength (B2)", () => {
  it("gutters off means off on every elevation", () => {
    let id = 900;
    const r = applyExteriorToggle(extBlocks(), "gutters", false, () => id++);
    expect(r.ok).toBe(true);
    if (r.ok) for (const b of r.blocks.filter((b) => b.type === "Exterior")) {
      expect((b.surfaces as Array<{ code: string }>).some((s) => s.code === "Gutters")).toBe(false);
    }
  });
  it("front-only parks the other elevations as options, reversibly", () => {
    const r = applyExtent(extBlocks(), "front");
    expect(r.ok).toBe(true);
    if (r.ok) {
      const opts = r.blocks.filter((b) => b.type === "Exterior" && b.isOption === true).map((b) => String(b.name));
      expect(opts.sort()).toEqual(["Exterior - Left", "Exterior - Rear", "Exterior - Right"]);
      const back = applyExtent(r.blocks, "whole");
      if (back.ok) expect(back.blocks.every((b) => b.isOption !== true)).toBe(true);
    }
  });
  it("fence takes metres once it's on, bounded", () => {
    let id = 900;
    const withFence = applyExteriorToggle(extBlocks(), "fence", true, () => id++);
    expect(withFence.ok).toBe(true);
    if (withFence.ok) {
      const set = applyFenceLength(withFence.blocks, 24);
      expect(set.ok).toBe(true);
      expect(applyFenceLength(withFence.blocks, 0).ok).toBe(false);
    }
    expect(applyFenceLength(extBlocks(), 24).ok).toBe(false); // not on yet
  });
});
