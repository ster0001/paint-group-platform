import { describe, expect, it } from "vitest";
import type { DraftResult } from "@/lib/extract/draft";
import { makeDraftSurface } from "@/lib/extract/draft";
import { applyWizardAnswers, surfaceKeyForRateCode } from "./merge";
import { defaultWizardState, type WizardState } from "./state";

const state = (over: Partial<WizardState> = {}): WizardState => ({
  ...defaultWizardState(),
  noPlan: true,
  basics: { bedrooms: 3, storeys: "single", sizeBand: "s120_200", openPlanKitchenLiving: true },
  ...over,
});

let idCounter = 1000;
const nextId = () => idCounter++;

const draft = (): DraftResult => ({
  areas: [
    {
      id: 1, kind: "area", name: "Living", type: "Interior", areaType: "room", roomType: "living",
      L: 4, W: 4, H: 2.4, storey: "ground", isOption: false, description: "", open: false, media: [],
      surfaces: [
        makeDraftSurface(2, "Walls", "Walls", 1, "ai_derived", 0.9, []),
        makeDraftSurface(3, "Ceilings", "Ceiling", 1, "ai_derived", 0.9, []),
        makeDraftSurface(4, "Skirting Boards", "Skirting Boards", 1, "ai_derived", 0.9, []),
      ],
      origin: "ai_extracted", confidence: 0.9, assumedFields: [], extractionSourceId: null,
    },
    {
      id: 5, kind: "area", name: "Bed 1", type: "Interior", areaType: "room", roomType: "bedroom",
      L: 3.5, W: 3.25, H: 2.4, storey: "ground", isOption: false, description: "", open: false, media: [],
      surfaces: [makeDraftSurface(6, "Walls", "Walls", 1, "ai_derived", 0.9, [])],
      origin: "ai_extracted", confidence: 0.9, assumedFields: [], extractionSourceId: null,
    },
  ],
  skipped: [],
  assumedCount: 0,
  deferred: [
    { room: "Bed 1", areaId: 5, what: "1 door", count: 1, needs: "flat or panel?" },
    { room: "Bed 1", areaId: 5, what: "1 window", count: 1, needs: "what type?" },
    { room: "Living", areaId: 1, what: "cornice", count: 1, needs: "does this room have one?" },
  ],
});

describe("surfaceKeyForRateCode", () => {
  it("classifies every governed rate code and leaves the rest alone", () => {
    expect(surfaceKeyForRateCode("Walls")).toBe("walls");
    expect(surfaceKeyForRateCode("Standard Cornices")).toBe("cornices");
    expect(surfaceKeyForRateCode("4-6 Panel Door and Frame (1 Side)")).toBe("doors");
    expect(surfaceKeyForRateCode("Double Hung Sash")).toBe("windows");
    expect(surfaceKeyForRateCode("Wet Area Ceilings")).toBeNull();
  });
});

describe("applyWizardAnswers", () => {
  it("unticked surfaces are filtered out", () => {
    const out = applyWizardAnswers(draft(), state({ surfaces: ["walls", "skirting"] }), nextId);
    const living = out.areas.find((a) => a.name === "Living");
    expect(living?.surfaces.map((s) => s.code)).toEqual(["Walls", "Skirting Boards"]);
  });

  it("a room with nothing left is skipped, not priced at zero surfaces", () => {
    const d = draft();
    d.areas[1].surfaces = [makeDraftSurface(6, "Ceilings", "Ceiling", 1, "ai_derived", 0.9, [])];
    const out = applyWizardAnswers(d, state({ surfaces: ["walls"] }), nextId);
    expect(out.areas.map((a) => a.name)).toEqual(["Living"]);
    expect(out.skipped.some((s) => s.name === "Bed 1")).toBe(true);
  });

  it("the 'mostly' door answer resolves deferred doors into priced lines", () => {
    const s = state({ details: { ...state().details, doorStyle: "panel" } });
    const out = applyWizardAnswers(draft(), s, nextId);
    const bed = out.areas.find((a) => a.name === "Bed 1");
    const door = bed?.surfaces.find((x) => x.code === "4-6 Panel Door and Frame (1 Side)");
    expect(door?.count).toBe(1);
    expect(door?.origin).toBe("ai_derived");
    expect(door?.assumedFields).toContain("style");
    expect(out.deferred.some((d) => /door/.test(d.what))).toBe(false);
  });

  it("an unsure style still PRICES at the default rate — question kept open (R1.2)", () => {
    // Windows aren't in the page-2 defaults, so tick them for this check.
    const out = applyWizardAnswers(
      draft(),
      state({ surfaces: ["walls", "ceilings", "cornices", "doors", "architraves", "skirting", "windows"] }),
      nextId,
    );
    const bed = out.areas.find((a) => a.name === "Bed 1");
    // The door and window EXIST on the estimate — never a silent $0.
    const door = bed?.surfaces.find((x) => x.code === "Flat Door and Frame (1 Side)");
    expect(door?.count).toBe(1);
    expect(door?.origin).toBe("ai_assumed");
    expect(door?.assumedFields).toContain("style");
    const win = bed?.surfaces.find((x) => x.code === "Awning / Casement Window");
    expect(win?.origin).toBe("ai_assumed");
    // And the open question survives, reworded as a confirm — visible to the
    // review gate and the accuracy score alike.
    expect(out.deferred.some((d) => d.what === "door style to confirm")).toBe(true);
    expect(out.deferred.some((d) => d.what === "window style to confirm")).toBe(true);
  });

  it("two rooms sharing a name each keep their own deferred doors", () => {
    const d = draft();
    d.areas[1].name = "Living"; // both areas now called "Living"
    d.deferred = [
      { room: "Living", areaId: 1, what: "1 door", count: 1, needs: "flat or panel?" },
      { room: "Living", areaId: 5, what: "2 doors", count: 2, needs: "flat or panel?" },
    ];
    const s = state({ details: { ...state().details, doorStyle: "panel" } });
    const out = applyWizardAnswers(d, s, nextId);
    const first = out.areas.find((a) => a.id === 1);
    const second = out.areas.find((a) => a.id === 5);
    const doorsIn = (a?: typeof first) =>
      a?.surfaces.filter((x) => x.code === "4-6 Panel Door and Frame (1 Side)") ?? [];
    expect(doorsIn(first)).toHaveLength(1);
    expect(doorsIn(first)[0]?.count).toBe(1);
    expect(doorsIn(second)).toHaveLength(1);
    expect(doorsIn(second)[0]?.count).toBe(2);
    expect(out.deferred.some((x) => /door/.test(x.what))).toBe(false);
  });

  it("ticking cornices settles the cornice question; unticking closes it", () => {
    const ticked = applyWizardAnswers(draft(), state(), nextId);
    const living = ticked.areas.find((a) => a.name === "Living");
    expect(living?.surfaces.some((s) => s.code === "Standard Cornices")).toBe(true);
    expect(ticked.deferred.some((d) => /cornice/.test(d.what))).toBe(false);

    const unticked = applyWizardAnswers(
      draft(),
      state({ surfaces: ["walls", "ceilings", "skirting"] }),
      nextId,
    );
    expect(unticked.deferred.some((d) => /cornice/.test(d.what))).toBe(false);
    expect(unticked.areas.every((a) => !a.surfaces.some((s) => s.code === "Standard Cornices"))).toBe(true);
  });

  it("coats follow the tier, with dark-to-light only on its surfaces", () => {
    const s = state({
      condition: { tier: "dark_to_light", darkToLightSurfaces: ["walls"] },
    });
    const out = applyWizardAnswers(draft(), s, nextId);
    const living = out.areas.find((a) => a.name === "Living");
    expect(living?.surfaces.find((x) => x.code === "Walls")?.coats).toBe(3);
    expect(living?.surfaces.find((x) => x.code === "Ceilings")?.coats).toBe(2);

    const fresh = applyWizardAnswers(draft(), state({ condition: { tier: "fresh", darkToLightSurfaces: [] } }), nextId);
    expect(fresh.areas[0].surfaces.every((x) => x.coats === 1)).toBe(true);
  });

  it("oil trims: crew note on trim lines plus one whole-job deferred item", () => {
    const s = state({
      details: { ...state().details, doorStyle: "panel" },
      paint: { brands: [], colourHelp: null, waterBasedOnly: true, trimsOilBased: "yes" },
    });
    const out = applyWizardAnswers(draft(), s, nextId);
    const skirting = out.areas[0].surfaces.find((x) => x.code === "Skirting Boards");
    expect(skirting?.crewNote).toMatch(/adhesion prep/);
    const walls = out.areas[0].surfaces.find((x) => x.code === "Walls");
    expect(walls?.crewNote).toBe("");
    expect(out.deferred.some((d) => d.what === "oil-to-water trim conversion")).toBe(true);
  });

  it("staircase, unphotographed damage and exterior all land in deferred", () => {
    const s = state({
      jobType: "both",
      listingUrl: "https://www.realestate.com.au/x",
      surfaces: [...state().surfaces, "staircase"],
      details: { ...state().details, damageTier: 2, damageNote: "hall ceiling cracks" },
    });
    const out = applyWizardAnswers(draft(), s, nextId);
    expect(out.deferred.some((d) => d.what === "staircase")).toBe(true);
    expect(out.deferred.some((d) => d.what === "damage to price" && /hall ceiling cracks/.test(d.needs))).toBe(true);
    expect(out.deferred.some((d) => d.what === "exterior envelope")).toBe(true);
  });
});
