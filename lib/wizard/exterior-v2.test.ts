import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { priceEstimateTotals, type BlockInput, type PricingContext } from "@/lib/pricing/estimate";
import { applyExteriorQuickLook, DEFAULT_EXTERIOR_QUICK_LOOK, exteriorQuickLookFromState, exteriorRestatement, type ExteriorQuickLook } from "./exterior-quick-look";
import { applyExteriorAnswers, applyConditionPricing, type MergedBundle } from "./exteriorAnswers";
import { confirmedSidesMap, defaultSides } from "./exterior-model";
import { envelopeFor } from "./envelope";
import { DEFAULT_BANDS } from "./policy";
import { DEFAULT_QUICK_LOOK, quickLookToState } from "./quick-look";
import { defaultWizardState, exteriorV2Schema, wizardStateSchema, type ExteriorV2, type WizardState } from "./state";
import type { TreeRefs } from "./build-tree";

/**
 * Exterior wizard v2, S1 — the round trip and the envelope.
 *
 *  - `applyExteriorQuickLook` with a drawn house writes `exterior.v2` AND the
 *    v1 fields every older reader prices from; `exteriorQuickLookFromState`
 *    reads the house back for resume; the state still parses (older sessions
 *    have no `v2` and parse exactly as before).
 *  - `applyExteriorAnswers` builds the v2 tree in place of the 12 × 14 scaffold
 *    and never lays the v1 extras beside it.
 *  - The envelope narrows side by side: every painted side checked with a size
 *    answer → Detailed (band ≤ the mid band); one "not sure" → wider; nothing
 *    checked → Guide; the condition spread stays open until every side has said.
 */

type Refs = TreeRefs & { rateItems: PricingContext["rateItems"] };
const refsFile = JSON.parse(readFileSync(new URL("../agent/__fixtures__/scope-refs.json", import.meta.url), "utf8")) as Refs;
const golden = JSON.parse(readFileSync(new URL("../pricing/__fixtures__/golden-estimates.json", import.meta.url), "utf8")) as { reference: Pick<PricingContext, "products" | "modifiers" | "settings"> };
const ctx: PricingContext = { rateItems: refsFile.rateItems, products: golden.reference.products, modifiers: golden.reference.modifiers, settings: golden.reference.settings };
const adj = { modSel: {}, materials: {} };

const base = () => quickLookToState({ ...DEFAULT_QUICK_LOOK, jobType: "exterior" }, { ...defaultWizardState(), mode: "customer" as const });

function house(over: Partial<ExteriorV2> = {}): ExteriorV2 {
  const sides = defaultSides({ propertyType: "cal", sizeBand: "md", rowPosition: null });
  return exteriorV2Schema.parse({
    propertyType: "cal", sizeBand: "md", rowPosition: null,
    wall: { down: "weatherboards" }, gableFill: "stucco", windowType: "casement", postKind: "columns",
    parts: ["walls", "gable", "fascias", "gutters", "downpipes", "eaves", "windows", "doors", "verandah", "posts", "ceiling", "handrail"],
    extras: ["paling_fence"], extraSizes: { fence: 20 }, sides,
    ...over,
  });
}
const q = (v2: ExteriorV2, over: Partial<ExteriorQuickLook> = {}): ExteriorQuickLook => ({ ...DEFAULT_EXTERIOR_QUICK_LOOK, colour: "new", access: ["steep"], ...over, v2 });

/** Every painted side checked, sized and with its condition answered. */
function checked(v2: ExteriorV2, size: "yes" | "adj" | "ns" = "yes", cond: "good" | "weathered" | "peeling" | null = "good"): ExteriorV2 {
  const out = exteriorV2Schema.parse(v2);
  for (const k of ["front", "right", "back", "left"] as const) {
    const s = out.sides[k];
    if (s) out.sides[k] = { ...s, checked: true, confirmed: true, size, cond };
  }
  return out;
}

function tree(state: WizardState): MergedBundle {
  const merged: MergedBundle = { areas: [], skipped: [], deferred: [], assumedCount: 0 };
  let n = 1;
  applyExteriorAnswers(merged, state, () => n++, new Set(state.surfaces));
  return merged;
}

describe("the round trip", () => {
  it("writes v2 and derives the v1 fields; reads the same house back; the state parses", () => {
    const v2 = house();
    const s = applyExteriorQuickLook(q(v2), base());
    expect(s.exterior?.v2).toEqual(v2);
    const ext = s.exterior!;
    expect(ext.painting.body).toBe(true);
    expect(ext.elements).toEqual({ windows: true, doors: true, eaves: true, fascias: true, gutters: true, garage: false });
    expect(ext.substrates).toEqual(["weatherboards"]);
    expect(ext.windowType).toBe("casement");
    expect(ext.windowCount).toBe(Object.values(v2.sides).reduce((n, x) => n + (x?.windows ?? 0), 0));
    expect(ext.doorCount).toBe(2);
    expect(ext.storeys).toBe("single");
    expect(ext.sidesAnswered).toBe(true);
    expect(ext.sides).toBeUndefined(); // all four = the full exterior
    expect(ext.condition).toBeNull(); // no side has answered yet
    expect(ext.colour).toBe("new");
    expect(ext.access).toEqual(["steep"]);
    expect(ext.extras.fence).toBe(true);
    expect(ext.extras.fenceMetres).toBe(20);
    expect(ext.targets).toEqual(["house", "fence"]);
    expect(s.surfaces).toEqual(expect.arrayContaining(["weatherboards", "exterior_windows", "exterior_doors", "fascias", "gutters", "eaves", "fence"]));
    expect(() => wizardStateSchema.parse(s)).not.toThrow();
    // Resume: the house, the colour and the access come back; the words still read as outside.
    const back = exteriorQuickLookFromState(s.exterior);
    expect(back.v2).toEqual(v2);
    expect(back.colour).toBe("new");
    expect(back.access).toEqual(["steep"]);
    expect(back.storeys).toBe("single");
    expect(exteriorRestatement(back)).toMatch(/^Based on the walls, windows, doors, fascias, gutters & downpipes, eaves and paling fence \(weatherboard\)/);
  });
  it("a townhouse is double storey with two sides; the worst condition becomes the v1 condition", () => {
    const sides = defaultSides({ propertyType: "th", sizeBand: "md", rowPosition: "mid" });
    const v2 = checked(house({ propertyType: "th", rowPosition: "mid", wall: { down: "render", up: "weatherboards", brickPainted: null, timberPainted: null }, sides }), "yes", "weathered");
    const s = applyExteriorQuickLook(q(v2), base());
    expect(s.exterior?.storeys).toBe("double");
    expect(s.exterior?.sides).toEqual(["front", "back"]);
    expect(s.exterior?.substrates).toEqual(["render", "weatherboards"]);
    expect(s.exterior?.condition).toBe("weathered");
    // The v1 pricing of condition and storeys reads those fields exactly as before.
    const merged = tree(s);
    const modSel = applyConditionPricing(merged, s, () => 900, ctx);
    expect(modSel.Access).toBe("ACC-2STOREY");
  });
  it("an older session with no v2 is untouched: the C8b path still applies and reads back as it did", () => {
    const old = applyExteriorQuickLook({ ...DEFAULT_EXTERIOR_QUICK_LOOK, elements: ["body", "fascias"], materials: ["render"] }, base());
    expect(old.exterior?.v2).toBeUndefined();
    expect(exteriorQuickLookFromState(old.exterior).v2).toBeNull();
    expect(exteriorQuickLookFromState(old.exterior).elements).toEqual(["body", "fascias"]);
    const parsed = wizardStateSchema.parse(JSON.parse(JSON.stringify(old)));
    expect(parsed.exterior?.v2).toBeUndefined();
  });
});

describe("the tree", () => {
  it("a v2 session prices the drawn house, not the 12 × 14 scaffold, and lays no v1 extras beside it", () => {
    const s = applyExteriorQuickLook(q(house()), base());
    const merged = tree(s);
    const sides = merged.areas.filter((a) => /Exterior - (Front|Right|Rear|Left)/.test(a.name));
    expect(sides).toHaveLength(4);
    expect(sides.map((a) => a.L)).toEqual([11, 14.5, 11, 14.5]); // the bungalow at Medium, not 12 / 14
    expect(sides.every((a) => a.H === 3)).toBe(true);
    expect(sides.every((a) => a.assumedFields.includes("L") && a.assumedFields.includes("H"))).toBe(true);
    expect(merged.areas.filter((a) => a.name === "Exterior - Extras")).toHaveLength(1);
    const fence = merged.areas.find((a) => a.name === "Exterior - Extras")!.surfaces.filter((x) => /Fence/.test(x.code));
    expect(fence).toHaveLength(1);
    expect(fence[0].measureL).toBe(20);
    expect(merged.deferred.filter((d) => /fence/i.test(d.what))).toHaveLength(0);
    // Access still prices its allowance line from the quick look's own answer.
    applyConditionPricing(merged, s, () => 900, ctx);
    expect(merged.areas.some((a) => a.surfaces.some((x) => x.code === "Access Allowance"))).toBe(true);
    // And it prices: every side has money on it.
    const totals = priceEstimateTotals(merged.areas as unknown as BlockInput[], ctx, adj);
    expect(totals.totalCents).toBeGreaterThan(0);
  });
  it("a side marked not painting is absent from the tree (8 Sep ruling), not an option on the quote", () => {
    const v2 = house();
    v2.sides.right = { ...v2.sides.right!, paint: false };
    const merged = tree(applyExteriorQuickLook(q(v2), base()));
    expect(merged.areas.map((a) => a.name)).not.toContain("Exterior - Right");
    expect(merged.areas.some((a) => a.isOption)).toBe(false);
  });
});

describe("the envelope narrows side by side (§5.3)", () => {
  const envelope = (v2: ExteriorV2) => {
    const s = applyExteriorQuickLook(q(v2, { access: ["none"] }), base());
    const merged = tree(s);
    const modSel = applyConditionPricing(merged, s, () => 900, ctx);
    return envelopeFor({ blocks: merged.areas as never, state: s, ctx, adj: { ...adj, modSel }, bands: DEFAULT_BANDS, confirmed: confirmedSidesMap(merged.areas, v2) });
  };
  it("at the gate the tier is Guide: the condition spread is open and no side is confirmed", () => {
    const e = envelope(house());
    expect(e.open).toContain("condition");
    expect(e.confirmedShare).toBe(0);
    expect(e.bandPct).toBeGreaterThan(DEFAULT_BANDS.midPct);
  });
  it("every side checked and sized, condition answered on each: Detailed", () => {
    const e = envelope(checked(house(), "yes", "good"));
    expect(e.open).not.toContain("condition");
    expect(e.confirmedShare).toBe(1);
    expect(e.bandPct).toBeLessThanOrEqual(DEFAULT_BANDS.midPct);
  });
  it("one side not sure of its size stays assumed and widens the band; condition unanswered on one side keeps the spread open", () => {
    const all = envelope(checked(house(), "yes", "good"));
    const ns = checked(house(), "yes", "good");
    ns.sides.left = { ...ns.sides.left!, size: "ns" };
    const one = envelope(ns);
    expect(one.confirmedShare).toBe(0.75);
    expect(one.bandPct).toBeGreaterThan(all.bandPct);
    const cond = checked(house(), "yes", "good");
    cond.sides.back = { ...cond.sides.back!, cond: null };
    expect(envelope(cond).open).toContain("condition");
    // Peeling on one side is the whole job's condition (worst wins) and closes the spread at the dear end.
    const peel = checked(house(), "yes", "good");
    peel.sides.back = { ...peel.sides.back!, cond: "peeling" };
    const p = envelope(peel);
    expect(p.open).not.toContain("condition");
    expect(p.loCents).toBeGreaterThan(all.loCents);
  });
});
