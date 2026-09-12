import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXTERIOR_QUICK_LOOK, EXTERIOR_PROMISE, EXT_ELEMENTS, EXT_MATERIALS,
  applyExteriorQuickLook, exteriorAssumedList, exteriorQuickLookFromState, exteriorRestatement,
  paintsSomething, toggleAccess, toggleIn, toggleMaterial,
  type ExteriorQuickLook,
} from "./exterior-quick-look";
import { defaultWizardState, exteriorSurfaceKeys, wizardStateSchema } from "./state";
import { exteriorAccessAllowances } from "./exterior-allowances";
import { DEFAULT_QUICK_LOOK, quickLookToState, stepsFor } from "./quick-look";
import { starterExteriorNodes, spreadOverSides } from "./starter";
import { exteriorWhatWeDo } from "./systems-view";
import { applyWizardAnswers } from "./merge";

/**
 * C8b — the exterior quick look rebuilt, elements first.
 *
 * Acceptance from the brief: no exterior path asks bedrooms and no exterior
 * session writes `beds`; storeys asked exactly once; nothing pre-ticked;
 * materials / window type / counts appear only when their element is ticked;
 * a body-unticked job produces no wall line anywhere; the exterior "What
 * we'll do" never renders interior lines; window-type multipliers come from
 * the rate card's own items, not a component.
 */

const q = (over: Partial<ExteriorQuickLook> = {}): ExteriorQuickLook => ({ ...DEFAULT_EXTERIOR_QUICK_LOOK, ...over });
/** The real order: the quick look's first screens, then the outside one. */
const base = () => quickLookToState(
  { ...DEFAULT_QUICK_LOOK, jobType: "exterior" },
  { ...defaultWizardState(), mode: "customer" as const },
);
const typical = () => q({ elements: ["body", "windows", "doors", "fascias"], materials: ["weatherboards"], windowType: "colonial", windowCount: 8, doorCount: 2 });

describe("no bedrooms, and storeys once", () => {
  it("an exterior session never writes basics — bedrooms cannot leak into the words or the tree", () => {
    const s = base();
    expect(s.basics).toBeNull();
    expect(s.noPlan).toBe(false);
    const after = applyExteriorQuickLook(typical(), s);
    expect(after.basics).toBeNull();
    // An inside job still does.
    expect(quickLookToState({ ...DEFAULT_QUICK_LOOK, jobType: "interior" }, defaultWizardState()).basics?.bedrooms).toBe(3);
  });

  it("storeys lives on the outside screen only, and lands in the field the allowance reads", () => {
    expect(stepsFor("exterior")).toEqual(["start", "place", "outside"]);
    const e = applyExteriorQuickLook(q({ elements: ["body"], storeys: "double" }), base()).exterior!;
    expect(e.storeys).toBe("double");
    const out = exteriorAccessAllowances({ storeys: e.storeys, access: e.access, accessEquipment: e.accessEquipment, sidesPainted: 4 });
    expect(out.allowances.map((a) => a.key)).toContain("upper_storey");
  });

  it("the restatement and the assume list never mention bedrooms", () => {
    const words = exteriorRestatement(typical()) + exteriorAssumedList(typical()).map((a) => `${a.what} ${a.why}`).join(" ");
    expect(words).not.toMatch(/bedroom/i);
    expect(exteriorRestatement(typical())).toMatch(/^Based on the walls, windows, doors and fascias \(weatherboard\), 8 colonial windows, 2 doors, new colours, weathered paintwork, single storey\./);
  });
});

describe("nothing pre-ticked; the questions follow the ticks", () => {
  it("starts with no elements and no materials", () => {
    expect(DEFAULT_EXTERIOR_QUICK_LOOK.elements).toEqual([]);
    expect(DEFAULT_EXTERIOR_QUICK_LOOK.standalone).toEqual([]);
    expect(DEFAULT_EXTERIOR_QUICK_LOOK.materials).toEqual([]);
    expect(paintsSomething(DEFAULT_EXTERIOR_QUICK_LOOK)).toBe(false);
    expect(paintsSomething(q({ standalone: ["fence"] }))).toBe(true);
  });

  it("toggles have no floor, and 'not sure' on the materials is exclusive", () => {
    expect(toggleIn(["body"], "body")).toEqual([]);
    expect(toggleMaterial(["brick"], "unsure")).toEqual(["unsure"]);
    expect(toggleMaterial(["unsure"], "render")).toEqual(["render"]);
    expect(toggleAccess(["steep"], "none")).toEqual(["none"]);
  });

  it("materials, window type and counts reach the state only when their element is ticked", () => {
    const withAll = applyExteriorQuickLook(typical(), base()).exterior!;
    expect(withAll.substrates).toEqual(["weatherboards"]);
    expect(withAll.windowType).toBe("colonial");
    expect(withAll.windowCount).toBe(8);
    expect(withAll.doorCount).toBe(2);
    const trimsOnly = applyExteriorQuickLook(q({ elements: ["fascias", "gutters"], materials: ["brick"], windowType: "sash" }), base()).exterior!;
    expect(trimsOnly.windowType).toBeNull();
    expect(trimsOnly.windowCount).toBeNull();
    expect(trimsOnly.doorCount).toBeNull();
    expect(trimsOnly.painting.body).toBe(false);
    expect(trimsOnly.painting.roofline).toBe(true);
    expect(trimsOnly.painting.windowsDoors).toBe(false);
  });

  it("every element and material label is a plain word a homeowner can tick", () => {
    for (const c of [...EXT_ELEMENTS, ...EXT_MATERIALS]) expect(c.label.length).toBeGreaterThan(3);
    expect(EXTERIOR_PROMISE).toMatch(/confirmed by your estimator/);
  });
});

describe("a body-unticked job has no wall line anywhere", () => {
  it("in the surface keys, the seed and What we'll do", () => {
    const s = applyExteriorQuickLook(q({ elements: ["windows", "fascias", "gutters", "eaves"], windowType: "casement", windowCount: 4 }), base());
    const keys = exteriorSurfaceKeys(s.exterior!);
    expect([...s.surfaces].sort()).toEqual([...keys].sort());
    expect(keys).not.toContain("weatherboards");
    expect(keys).toEqual(expect.arrayContaining(["exterior_windows", "fascias", "gutters", "downpipes", "eaves"]));
    let id = 1;
    const seed = starterExteriorNodes(() => id++, new Set(keys), s.exterior!.painting.body, { windowType: "casement", windowCount: 4, doorCount: null });
    for (const a of seed.areas) expect(a.surfaces.map((x) => x.code)).not.toContain("Weatherboards");
    const lines = exteriorWhatWeDo(s);
    expect(lines.map((l) => l.title).join(" ")).not.toMatch(/Walls/);
    expect(lines.map((l) => l.title)).toEqual(["4 casement windows", "Fascias", "Gutters and downpipes", "Eaves", "Not included"]);
  });
});

describe("windows by type and count, doors by count (⚑48 ⚑49 ⚑50)", () => {
  const keys = (s: ReturnType<typeof base>) => new Set(exteriorSurfaceKeys(s.exterior!));

  it("eight colonial windows seed the colonial rate row, spread over the four sides", () => {
    const s = applyExteriorQuickLook(typical(), base());
    let id = 1;
    const seed = starterExteriorNodes(() => id++, keys(s), true, { windowType: "colonial", windowCount: 8, doorCount: 2 });
    const windows = seed.areas.flatMap((a) => a.surfaces.filter((x) => x.code === "Colonial / Bay Window").map((x) => x.count));
    expect(windows).toEqual([2, 2, 2, 2]);
    expect(seed.areas.flatMap((a) => a.surfaces).some((x) => x.code === "Fixed / Picture Window")).toBe(false);
    // Two doors: the front door on the front, one standard door on the rear.
    const front = seed.areas.find((a) => a.name === "Exterior - Front")!.surfaces.map((x) => x.code);
    expect(front).toContain("Front Door");
    const rear = seed.areas.find((a) => a.name === "Exterior - Rear")!.surfaces.find((x) => x.code === "Standard Door (1 Side)");
    expect(rear?.count).toBe(1);
    expect(seed.deferred.filter((d) => d.kind === "exterior_window_style")).toEqual([]);
  });

  it("the seeded window lines SURVIVE the merge's tick filter on an exterior job", () => {
    // The bug the first e2e run found: the shared casement/colonial codes read
    // as INTERIOR windows, which an outside job never ticks, so the merge
    // dropped them and colonial priced exactly like casement.
    const s = applyExteriorQuickLook(typical(), base());
    // The ticks are written by the quick look itself — the interior default
    // never rides an outside job again.
    expect(s.surfaces).toEqual(expect.arrayContaining(["weatherboards", "exterior_windows", "exterior_doors", "fascias"]));
    expect(s.surfaces).not.toContain("walls");
    let id = 1;
    const seed = starterExteriorNodes(() => id++, keys(s), true, { windowType: "colonial", windowCount: 8, doorCount: 2 });
    const merged = applyWizardAnswers({ areas: seed.areas, skipped: [], deferred: seed.deferred, assumedCount: 0 }, s, () => id++);
    const codes = merged.areas.flatMap((a) => a.surfaces.map((x) => x.code));
    expect(codes.filter((c) => c === "Colonial / Bay Window")).toHaveLength(4);
    expect(codes).toContain("Front Door");
  });

  it("the type IS the rate row — no multiplier anywhere in the seed", () => {
    let id = 1;
    const cas = starterExteriorNodes(() => id++, new Set(["exterior_windows"]), false, { windowType: "casement", windowCount: 8 });
    const col = starterExteriorNodes(() => id++, new Set(["exterior_windows"]), false, { windowType: "colonial", windowCount: 8 });
    expect(cas.areas.flatMap((a) => a.surfaces).map((x) => x.code)).toEqual(["Awning / Casement Window", "Awning / Casement Window", "Awning / Casement Window", "Awning / Casement Window"]);
    expect(col.areas.flatMap((a) => a.surfaces).map((x) => x.code)).toEqual(["Colonial / Bay Window", "Colonial / Bay Window", "Colonial / Bay Window", "Colonial / Bay Window"]);
    for (const x of [...cas.areas, ...col.areas].flatMap((a) => a.surfaces)) expect(x.rateOverride).toBeNull();
  });

  it("aluminium prices nothing and carries a note; winder and not-sure price and flag", () => {
    let id = 1;
    const alu = starterExteriorNodes(() => id++, new Set(["exterior_windows"]), false, { windowType: "alu", windowCount: 6 });
    expect(alu.areas.flatMap((a) => a.surfaces)).toEqual([]);
    expect(alu.deferred.find((d) => d.kind === "exterior_windows_alu")?.what).toMatch(/6 aluminium windows/);
    const winder = starterExteriorNodes(() => id++, new Set(["exterior_windows"]), false, { windowType: "winder", windowCount: 3 });
    expect(winder.areas.flatMap((a) => a.surfaces).map((x) => x.code)).toEqual(["Awning / Casement Window", "Awning / Casement Window", "Awning / Casement Window"]);
    expect(winder.deferred.find((d) => d.kind === "exterior_window_style")?.needs).toMatch(/casement rate/);
    const unsure = starterExteriorNodes(() => id++, new Set(["exterior_windows"]), false, { windowType: "unsure", windowCount: 1 });
    expect(unsure.areas.flatMap((a) => a.surfaces).map((x) => x.code)).toEqual(["Fixed / Picture Window"]);
    expect(unsure.deferred.some((d) => d.kind === "exterior_window_style")).toBe(true);
  });

  it("an older session with no counts keeps the one-per-side seed exactly", () => {
    let id = 1;
    const old = starterExteriorNodes(() => id++, new Set(["weatherboards", "exterior_windows", "exterior_doors"]), true);
    expect(old.areas.flatMap((a) => a.surfaces).filter((x) => x.code === "Fixed / Picture Window")).toHaveLength(4);
    expect(old.areas.flatMap((a) => a.surfaces).filter((x) => x.code === "Front Door")).toHaveLength(1);
    expect(old.deferred.some((d) => d.kind === "exterior_window_style")).toBe(false);
  });

  it("spreads a count front, rear, left, right in turn", () => {
    expect(spreadOverSides(5)).toEqual({ Front: 2, Rear: 1, Left: 1, Right: 1 });
    expect(spreadOverSides(0)).toEqual({ Front: 0, Rear: 0, Left: 0, Right: 0 });
  });

  it("a body with no material told is priced at a placeholder and flagged", () => {
    const s = applyExteriorQuickLook(q({ elements: ["body"] }), base());
    expect(s.exterior!.substrates).toEqual([]);
    let id = 1;
    const seed = starterExteriorNodes(() => id++, keys(s), true, {});
    expect(seed.deferred.some((d) => d.kind === "exterior_material")).toBe(true);
    expect(exteriorAssumedList(q({ elements: ["body"] })).map((a) => a.key)).toContain("material");
  });
});

describe("colour feeds the same derivation (⚑51), and What we'll do is exterior-only", () => {
  it("writes the tier on an exterior job and derives the exterior rule from it", () => {
    const same = applyExteriorQuickLook(q({ elements: ["body"], materials: ["render"], colour: "same" }), base());
    expect(same.condition.tier).toBe("fresh");
    expect(exteriorWhatWeDo(same)[0]).toMatchObject({ title: "Walls — render", coats: 1 });
    const bold = applyExteriorQuickLook(q({ elements: ["body"], materials: ["render"], colour: "bold" }), base());
    expect(bold.condition.tier).toBe("dark_to_light");
    expect(exteriorWhatWeDo(bold)[0].coats).toBe(2);
  });

  it("the colonial line says why it takes longer; the last line is what is not included", () => {
    const s = applyExteriorQuickLook(typical(), base());
    const lines = exteriorWhatWeDo(s);
    expect(lines.find((l) => /colonial windows/.test(l.title))?.sentence).toMatch(/cut in by hand, bar by bar/);
    expect(lines.at(-1)?.title).toBe("Not included");
    expect(lines.at(-1)?.sentence).toMatch(/Equipment hire.*rotten timber.*not visible from the ground/);
    for (const l of lines) expect(l.group).toBe("exterior");
  });
});

describe("a both job keeps its interior ticks", () => {
  it("swaps in the exterior ticks beside the interior ones", () => {
    const both = quickLookToState({ ...DEFAULT_QUICK_LOOK, jobType: "both" }, { ...defaultWizardState(), mode: "customer" as const });
    const s = applyExteriorQuickLook(q({ elements: ["body", "fascias"], materials: ["render"] }), both);
    expect(s.surfaces).toEqual(expect.arrayContaining(["walls", "ceilings", "render", "fascias"]));
    expect(s.surfaces).not.toContain("weatherboards");
    // The interior colour answer keeps the tier on a both job.
    expect(s.condition.tier).toBe(both.condition.tier);
  });
});

describe("the state round-trips for resume", () => {
  it("reads back exactly what was tapped", () => {
    const before = q({ elements: ["body", "windows"], standalone: ["fence", "wall"], materials: ["brick", "render"], windowType: "sash", windowCount: 5, doorCount: 0, colour: "same", condition: "peeling", storeys: "double", access: ["steep", "lift"] });
    const s = applyExteriorQuickLook(before, base());
    const back = exteriorQuickLookFromState(s.exterior);
    expect(back).toEqual({ ...before, doorCount: DEFAULT_EXTERIOR_QUICK_LOOK.doorCount });
    expect(exteriorQuickLookFromState(null)).toEqual(DEFAULT_EXTERIOR_QUICK_LOOK);
  });

  it("still produces a state the submit schema accepts", () => {
    const s = applyExteriorQuickLook(typical(), base());
    const parsed = wizardStateSchema.safeParse({
      ...s,
      customer: { ...s.customer!, suburb: "Murrumbeena", postcode: "3163" },
      contact: { ...s.contact, name: "A", email: "a@example.com", phone: "0400000000" },
    });
    expect(parsed.success, JSON.stringify(parsed.success ? {} : parsed.error.issues)).toBe(true);
    expect(s.exterior?.noPhotos).toBe(true);
  });

  it("turns 'needs a lift or scaffold' into an EXCLUSION, never hours", () => {
    const e = applyExteriorQuickLook(q({ elements: ["body"], access: ["lift"] }), base()).exterior!;
    expect(e.accessEquipment).toEqual(["scaffold"]);
    expect(e.access).toEqual([]);
    const out = exteriorAccessAllowances({ storeys: e.storeys, access: e.access, accessEquipment: e.accessEquipment, sidesPainted: 4 });
    expect(out.allowances).toEqual([]);
    expect(out.exclusions.length).toBe(1);
  });
});
