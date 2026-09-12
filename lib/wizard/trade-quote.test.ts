/**
 * C15 (A2) — the state the sheet opens with must pass the SUBMIT schema
 * (the full one, refinements included): customer mode with the customer
 * block, no plan and no basics because the property is measured, the
 * spec's answers over the defaults, and the property's address.
 */
import { describe, expect, it } from "vitest";
import { wizardStateSchema } from "./state";
import { makeMeasuredTree } from "./measured-tree";
import { blocksForSpec, fileFacts, tradeQuoteState } from "./trade-quote";
import type { DraftArea } from "@/lib/extract/draft";
import type { SavedSpec } from "./saved-specs";

const property = { id: "1d1e9c1e-0000-4000-8000-000000000001", address: "4/22 Elm Grove", suburb: "Thornbury", state: "VIC", postcode: "3071" };
const spec: SavedSpec = {
  id: "s1", name: "End-of-lease repaint", surfaces: ["walls", "ceilings"], tier: "fresh", damageTier: 0,
  trimsOilBased: null, ceilingsMarked: false, ceilingsChangingColour: false, siteAccess: { cleared: "yes" }, colourPolicy: "", createdAt: "",
};
const area = (id: number, name: string, codes: string[]): DraftArea => ({
  id, kind: "area", name, type: "Interior", areaType: "room", roomType: "bedroom", L: 4, W: 3, H: 2.4, isOption: false,
  description: "", open: false, media: [], origin: "human_confirmed", confidence: 1, assumedFields: [], extractionSourceId: null,
  surfaces: codes.map((code, i) => ({ id: id * 10 + i, code, internalLabel: code, clientLabel: code, count: 1, coats: 2, prepHr: 0, crewNote: "", origin: "human_confirmed", confidence: 1, assumedFields: [] })),
} as unknown as DraftArea);

describe("tradeQuoteState", () => {
  it("passes the full submit schema without a plan or the quick basics, with the spec applied", () => {
    const state = tradeQuoteState(property, spec, { name: "Sam", email: "sam@example.com", phone: "" });
    const parsed = wizardStateSchema.safeParse(state);
    expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues[0])).toBe(true);
    expect(state.mode).toBe("customer");
    expect(state.propertyId).toBe(property.id);
    expect(state.noPlan).toBe(true);
    expect(state.basics).toBeNull();
    expect(state.surfaces).toEqual(["walls", "ceilings"]);
    expect(state.condition.tier).toBe("fresh");
    expect(state.customer?.suburb).toBe("Thornbury");
    expect(state.customer?.postcode).toBe("3071");
    expect(state.address?.street).toBe("4/22 Elm Grove");
  });
  it("a blank sheet (no spec) still passes", () => {
    expect(wizardStateSchema.safeParse(tradeQuoteState(property, null, { name: "", email: "a@b.co", phone: "" })).success).toBe(true);
  });
});

describe("blocksForSpec / fileFacts", () => {
  it("keeps only the spec's surfaces on the file's rooms, renumbered from 1, and counts inside areas", () => {
    const tree = makeMeasuredTree([area(7, "Bed 1", ["Walls", "Ceilings", "Skirting Boards"]), area(9, "Front", ["Weatherboards"])], null, "e", new Date("2026-03-05T00:00:00Z"));
    (tree.blocks[1] as { type: string }).type = "Exterior";
    const blocks = blocksForSpec(tree, spec);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe(1);
    expect(blocks[0].surfaces.map((s) => s.code)).toEqual(["Walls", "Ceilings"]);
    expect(blocksForSpec(tree, null)[0].surfaces).toHaveLength(3);
    expect(fileFacts(tree)).toEqual({ areas: 1, measuredLabel: "March 2026" });
    expect(fileFacts(null)).toEqual({ areas: 0, measuredLabel: null });
  });
});
