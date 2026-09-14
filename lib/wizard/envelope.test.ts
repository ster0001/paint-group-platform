/**
 * 14 Sep — the range envelope: best case to worst case over the open
 * questions; answering one can only narrow it (the ends nest), and the size
 * residual is a slope from wide to tight as rooms are confirmed, never a step.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { envelopeFor, openQuestions, dearestTree, assumedHeightTree, sizeResidualPct, sumEnvelopes } from "./envelope";
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
    // Height is answered by the TREE (confirm_height strips "H"), not the quick-look state.
    const confirmedH = tree().map((b) => ({ ...b, H: 2.7, assumedFields: ["L", "W"] }));
    expect(openQuestions(state(), confirmedH, codes)).not.toContain("height");
    // Cupboards are never an open question (Tom, 14 Sep: assumed not painted).
    expect(openQuestions(state(), tree(), codes)).not.toContain("cupboards");
  });
  it("an unanswered height is priced at 3 m on BOTH ends; the dearest tree swaps flat doors for panel; the cheap tree is untouched", () => {
    const codes = new Set(ctx.rateItems.map((r) => r.code));
    const t = tree();
    const base = assumedHeightTree(t, ["height"]) as Array<{ H: number }>;
    expect(base[0].H).toBe(3);
    expect(assumedHeightTree(t, ["doors"])[0].H).toBe(2.4); // only when open
    const dear = dearestTree(state(), t, ["doors"], codes) as Array<{ surfaces: Array<{ code: string }> }>;
    expect(dear[0].surfaces.some((s) => /panel/i.test(String(s.code)))).toBe(true);
    expect(dear[0].surfaces.some((s) => /cupboard|robe|vanity/i.test(String(s.code)))).toBe(false);
    expect(t[0].H).toBe(2.4); // untouched
  });
  it("Tom, 14 Sep: the three-coat trims case is in the range until the paint questions close it", () => {
    const codes = new Set(ctx.rateItems.map((r) => r.code));
    expect(openQuestions(state(), tree(), codes)).toContain("trims");
    const dear = dearestTree(state(), tree(), ["trims"], codes) as Array<{ surfaces: Array<{ code: string; coats: number }> }>;
    expect(dear[0].surfaces.find((s) => s.code === "Skirting Boards")!.coats).toBe(3);
    expect(dear[0].surfaces.find((s) => /Door/.test(s.code))!.coats).toBe(3);
    expect(dear[0].surfaces.find((s) => s.code === "Walls")!.coats).toBe(2);
    const withPaint = (paint: Partial<WizardState["paint"]>) => ({ ...state(), paint: { ...state().paint, ...paint } });
    // Oil-based new paint closes it (oil over oil included); saying what is underneath closes it.
    expect(openQuestions(withPaint({ base: "oil" }), tree(), codes)).not.toContain("trims");
    expect(openQuestions(withPaint({ base: "water", trimsOilBased: "no" }), tree(), codes)).not.toContain("trims");
    expect(openQuestions(withPaint({ base: "water", trimsOilBased: "yes" }), tree(), codes)).not.toContain("trims");
    // "Not sure what is underneath" keeps the top end honest.
    expect(openQuestions(withPaint({ base: "water", trimsOilBased: "unsure" }), tree(), codes)).toContain("trims");
    const open = envelopeFor({ blocks: tree(), state: state(), ctx, adj, bands: DEFAULT_BANDS, confirmed: null });
    const closed = envelopeFor({ blocks: tree(), state: withPaint({ base: "oil" }), ctx, adj, bands: DEFAULT_BANDS, confirmed: null });
    expect(closed.hiCents).toBeLessThan(open.hiCents);
    expect(closed.loCents).toBe(open.loCents);
    expect(open.closesCents.trims).toBeGreaterThan(0);
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
    // Answering the height DOWN (2.4 confirmed on the tree) lowers both ends: the range was priced at 3 m.
    const confirmedH = tree().map((b) => ({ ...b, assumedFields: ["L", "W"] }));
    const eH = envelopeFor({ blocks: confirmedH, state: state(), ctx, adj, bands: DEFAULT_BANDS, confirmed: null });
    expect(eH.open).not.toContain("height");
    expect(eH.hiCents).toBeLessThan(e0.hiCents);
    expect(eH.loCents).toBeLessThan(e0.loCents);
    // Everything answered: the envelope is the residual alone. (14 Sep: the
    // trims question closes when the customer says what is underneath.)
    const allDetails = state({ doorStyle: "flat", windowStyle: "casement", ceilingHeight: "2.4" });
    const all = { ...allDetails, paint: { ...allDetails.paint, trimsOilBased: "no" as const } };
    const answeredCup = confirmedH;
    const e3 = envelopeFor({ blocks: answeredCup, state: all, ctx, adj, bands: DEFAULT_BANDS, confirmed: null });
    expect(e3.open).toEqual([]);
    expect(e3.bandPct).toBe(DEFAULT_BANDS.widePct); // nothing confirmed → the wide residual
  });
  it("says what each open question closes, and the closes add up to the spread the questions carry", () => {
    const e = envelopeFor({ blocks: tree(), state: state(), ctx, adj, bands: DEFAULT_BANDS, confirmed: null });
    expect(Object.keys(e.closesCents)).toEqual(expect.arrayContaining(e.open));
    for (const v of Object.values(e.closesCents)) expect(v).toBeGreaterThan(0);
    const answered = envelopeFor({ blocks: tree(), state: state({ doorStyle: "panel" }), ctx, adj, bands: DEFAULT_BANDS, confirmed: null });
    expect(answered.closesCents.doors).toBeUndefined();
  });
  it("a both job's headline is the sum of its parts", () => {
    const a = envelopeFor({ blocks: tree(), state: state(), ctx, adj, bands: DEFAULT_BANDS, confirmed: null });
    const b = { ...a, loCents: 100_000, hiCents: 150_000, closesCents: {} };
    const sum = sumEnvelopes([a, b]);
    expect(sum.loCents).toBe(a.loCents + 100_000);
    expect(sum.hiCents).toBe(a.hiCents + 150_000);
  });
  it("confirming rooms shrinks the size residual on a slope, never a step", () => {
    const allDetails = state({ doorStyle: "flat", windowStyle: "casement", ceilingHeight: "2.4" });
    const all = { ...allDetails, paint: { ...allDetails.paint, base: "oil" as const } };
    const answeredCup = tree().map((b) => ({ ...b, assumedFields: ["L", "W"] }));
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
  it("Tom, 14 Sep (items 25/30): whole-job blocks the loop never counts do not hold the residual open", () => {
    const allDetails = state({ doorStyle: "flat", windowStyle: "casement", ceilingHeight: "2.4" });
    const all = { ...allDetails, paint: { ...allDetails.paint, base: "oil" as const } };
    const rooms = tree().map((b) => ({ ...b, assumedFields: ["L", "W"] }));
    // "Site access" and "Interior - extras" are priced areas, but never loop rooms.
    const pseudo = [
      { ...room(90, "Site access", "surface", []), areaType: "surface", surfaces: [] },
      { ...room(91, "Interior - extras", "surface", []), areaType: "surface", surfaces: [] },
    ];
    const both = envelopeFor({ blocks: [...rooms, ...pseudo], state: all, ctx, adj, bands: DEFAULT_BANDS, confirmed: new Map([[1, "confirmed"], [2, "confirmed"]]) });
    expect(both.confirmedShare).toBe(1);
    expect(both.bandPct).toBe(DEFAULT_BANDS.tightPct);
  });
  it("the commercial widening lands on both ends", () => {
    const e = envelopeFor({ blocks: tree(), state: state(), ctx, adj, bands: DEFAULT_BANDS, confirmed: null });
    const w = envelopeFor({ blocks: tree(), state: state(), ctx, adj, bands: DEFAULT_BANDS, widenPct: 8, confirmed: null });
    expect(w.loCents).toBeLessThanOrEqual(e.loCents);
    expect(w.hiCents).toBeGreaterThanOrEqual(e.hiCents);
  });
});
