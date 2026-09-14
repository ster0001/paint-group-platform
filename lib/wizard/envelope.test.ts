/**
 * 14 Sep — the range envelope: best case to worst case over the open
 * questions; answering one can only narrow it (the ends nest), and the size
 * residual is a slope from wide to tight as rooms are confirmed, never a step.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { envelopeFor, openQuestions, dearestTree, sizeResidualPct } from "./envelope";
import { defaultWizardState, type WizardState } from "./state";
import { DEFAULT_BANDS } from "./policy";
import type { PricingContext } from "@/lib/pricing/estimate";
import type { TreeRefs } from "./build-tree";

type Refs = TreeRefs & { rateItems: PricingContext["rateItems"] };
const refsFile = JSON.parse(readFileSync(new URL("../agent/__fixtures__/scope-refs.json", import.meta.url), "utf8")) as Refs;
const golden = JSON.parse(readFileSync(new URL("../pricing/__fixtures__/golden-estimates.json", import.meta.url), "utf8")) as { reference: Pick<PricingContext, "products" | "modifiers" | "settings"> };
const ctx: PricingContext = { rateItems: refsFile.rateItems, products: golden.reference.products, modifiers: golden.reference.modifiers, settings: golden.reference.settings };
const adj = { modSel: {}, materials: {} };

const surf = (id: number, code: string, count = 1) => ({ id, code, internalLabel: code, clientLabel: code, count, coats: 2, prepHr: 0, crewNote: "", origin: "ai_assumed", confidence: 0.5, assumedFields: [] });
const room = (id: number, name: string, roomType: string, surfaces: ReturnType<typeof surf>[]) => ({
  id, kind: "area", name, type: "Interior", areaType: "room", roomType, L: 4, W: 3.5, H: 2.4, isOption: false,
  origin: "ai_assumed", confidence: 0.4, assumedFields: ["L", "W", "H"], surfaces, customer: { size: null, cup: null, confirmed: false },
});
const tree = () => [
  room(1, "Bed 1", "bedroom", [surf(10, "Walls"), surf(11, "Ceilings"), surf(12, "Skirting Boards"), surf(13, "Flat Door and Frame (1 Side)"), surf(14, "Awning / Casement Window")]),
  room(2, "Kitchen", "kitchen", [surf(20, "Walls"), surf(21, "Ceilings"), surf(23, "Flat Door and Frame (1 Side)")]),
];
const state = (over: Partial<WizardState["details"]> = {}): WizardState => {
  const s = defaultWizardState();
  s.details = { ...s.details, ...over };
  return s;
};

describe("open questions", () => {
  it("names what the quick look did not ask, and drops each one as it is answered", () => {
    const codes = new Set(ctx.rateItems.map((r) => r.code));
    expect(openQuestions(state(), tree(), codes)).toEqual(expect.arrayContaining(["doors", "height"]));
    expect(openQuestions(state({ doorStyle: "panel" }), tree(), codes)).not.toContain("doors");
    expect(openQuestions(state({ ceilingHeight: "2.7" }), tree(), codes)).not.toContain("height");
    const answeredCup = tree().map((b) => ({ ...b, customer: { ...b.customer, cup: false } }));
    expect(openQuestions(state(), answeredCup, codes)).not.toContain("cupboards");
  });
  it("the dearest tree swaps flat doors for panel and lifts assumed ceilings, and never touches the cheap tree", () => {
    const codes = new Set(ctx.rateItems.map((r) => r.code));
    const t = tree();
    const dear = dearestTree(state(), t, ["doors", "height"], codes) as Array<{ H: number; surfaces: Array<{ code: string }> }>;
    expect(dear[0].H).toBe(3);
    expect(dear[0].surfaces.some((s) => /panel/i.test(String(s.code)))).toBe(true);
    expect(t[0].H).toBe(2.4); // untouched
  });
});

describe("the envelope", () => {
  it("is wider than the cheap tree's band, and the ends NEST as questions are answered", () => {
    const e0 = envelopeFor({ blocks: tree(), state: state(), ctx, adj, bands: DEFAULT_BANDS, confirmed: null });
    expect(e0.open.length).toBeGreaterThan(0);
    expect(e0.hiCents).toBeGreaterThan(e0.loCents);
    // Answer "panel doors" — the dear answer: the low end may rise, the high end may not.
    const e1 = envelopeFor({ blocks: tree(), state: state({ doorStyle: "panel" }), ctx, adj, bands: DEFAULT_BANDS, confirmed: null });
    expect(e1.loCents).toBeGreaterThanOrEqual(e0.loCents);
    expect(e1.hiCents).toBeLessThanOrEqual(e0.hiCents);
    expect(e1.open).not.toContain("doors");
    // Answer "flat doors" — the cheap answer: the high end drops, the low end holds.
    const e2 = envelopeFor({ blocks: tree(), state: state({ doorStyle: "flat" }), ctx, adj, bands: DEFAULT_BANDS, confirmed: null });
    expect(e2.hiCents).toBeLessThanOrEqual(e0.hiCents);
    expect(e2.loCents).toBeGreaterThanOrEqual(e0.loCents);
    // Everything answered: the envelope is the residual alone.
    const all = state({ doorStyle: "flat", windowStyle: "casement", ceilingHeight: "2.4" });
    const answeredCup = tree().map((b) => ({ ...b, customer: { ...b.customer, cup: false } }));
    const e3 = envelopeFor({ blocks: answeredCup, state: all, ctx, adj, bands: DEFAULT_BANDS, confirmed: null });
    expect(e3.open).toEqual([]);
    expect(e3.bandPct).toBe(DEFAULT_BANDS.widePct); // nothing confirmed → the wide residual
  });
  it("confirming rooms shrinks the size residual on a slope, never a step", () => {
    const all = state({ doorStyle: "flat", windowStyle: "casement", ceilingHeight: "2.4" });
    const answeredCup = tree().map((b) => ({ ...b, customer: { ...b.customer, cup: false } }));
    const none = envelopeFor({ blocks: answeredCup, state: all, ctx, adj, bands: DEFAULT_BANDS, confirmed: new Map() });
    const half = envelopeFor({ blocks: answeredCup, state: all, ctx, adj, bands: DEFAULT_BANDS, confirmed: new Map([[1, "confirmed"]]) });
    const full = envelopeFor({ blocks: answeredCup, state: all, ctx, adj, bands: DEFAULT_BANDS, confirmed: new Map([[1, "confirmed"], [2, "confirmed"]]) });
    expect(sizeResidualPct(0, DEFAULT_BANDS)).toBe(DEFAULT_BANDS.widePct);
    expect(sizeResidualPct(1, DEFAULT_BANDS)).toBe(DEFAULT_BANDS.tightPct);
    expect(sizeResidualPct(0.5, DEFAULT_BANDS)).toBeCloseTo((DEFAULT_BANDS.widePct + DEFAULT_BANDS.tightPct) / 2);
    expect(half.loCents).toBeGreaterThanOrEqual(none.loCents);
    expect(half.hiCents).toBeLessThanOrEqual(none.hiCents);
    expect(full.loCents).toBeGreaterThanOrEqual(half.loCents);
    expect(full.hiCents).toBeLessThanOrEqual(half.hiCents);
    expect(full.bandPct).toBe(DEFAULT_BANDS.tightPct);
  });
  it("the commercial widening lands on both ends", () => {
    const e = envelopeFor({ blocks: tree(), state: state(), ctx, adj, bands: DEFAULT_BANDS, confirmed: null });
    const w = envelopeFor({ blocks: tree(), state: state(), ctx, adj, bands: DEFAULT_BANDS, widenPct: 8, confirmed: null });
    expect(w.loCents).toBeLessThanOrEqual(e.loCents);
    expect(w.hiCents).toBeGreaterThanOrEqual(e.hiCents);
  });
});
