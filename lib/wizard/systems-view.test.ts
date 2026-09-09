import { describe, expect, it } from "vitest";
import {
  applyPaintSystems, applySystemPatch, groupsInTree, paintSystemsView, systemAnswersFromState,
} from "./systems-view";
import { defaultWizardState, type WizardState } from "./state";
import { paintSystemsFrom } from "@/lib/pricing/systems";

const state = (over: Partial<WizardState> = {}): WizardState => ({ ...defaultWizardState(), ...over });

const surface = (code: string, count = 1, crewNote = "") => ({
  id: Math.floor(Math.random() * 1e6), code, count, coats: 2, crewNote,
});

const tree = () => ([
  {
    id: 1, kind: "area", name: "Living", type: "Interior",
    surfaces: [surface("Walls"), surface("Ceilings"), surface("Skirting Boards"), surface("Flat Door and Frame (1 Side)", 2)],
  },
  {
    id: 2, kind: "area", name: "Front", type: "Exterior",
    surfaces: [surface("Weatherboards"), surface("Fascias")],
  },
]);

describe("which lines the screen shows", () => {
  it("reads the groups from the TREE, not the wizard's tick list", () => {
    // The state still ticks windows; the tree has none, so no windows line.
    const s = state({ surfaces: ["walls", "ceilings", "skirting", "doors", "windows"] });
    const lines = paintSystemsView(s, tree());
    expect(lines.map((l) => l.group)).toEqual(["walls", "ceilings", "trims", "doors"]);
  });

  it("drops a line when its last surface is removed from the tree", () => {
    const stripped = tree().map((b) => ({ ...b, surfaces: b.surfaces.filter((x) => x.code !== "Ceilings") }));
    expect(paintSystemsView(state(), stripped).map((l) => l.group)).not.toContain("ceilings");
  });

  it("shows nothing at all on an exterior-only job (plan §4.4)", () => {
    const ext = tree().filter((b) => b.type === "Exterior");
    expect(paintSystemsView(state(), ext)).toEqual([]);
    expect(groupsInTree(ext).size).toBe(0);
  });

  it("counts the surfaces each line governs, so doors can say how many", () => {
    expect(groupsInTree(tree()).get("doors")).toBe(2);
    expect(paintSystemsView(state(), tree()).find((l) => l.group === "doors")?.surfaceCount).toBe(2);
  });

  it("gives every line a sentence about what the painter does, not a coat count", () => {
    for (const line of paintSystemsView(state(), tree())) {
      expect(line.sentence.length).toBeGreaterThan(20);
      expect(line.title.length).toBeGreaterThan(3);
    }
  });
});

describe("the corrections offered", () => {
  it("marks the chip that matches what we assumed", () => {
    const lines = paintSystemsView(state(), tree());
    const walls = lines.find((l) => l.group === "walls")!;
    expect(walls.chips.find((c) => c.on)?.label).toBe("That's right");

    const same = paintSystemsView(state({ condition: { ...defaultWizardState().condition, tier: "fresh" } }), tree());
    expect(same.find((l) => l.group === "walls")!.chips.find((c) => c.on)?.label).toBe("Same colour actually");
  });

  it("offers the gloss question on trims and doors, and nowhere else (⚑5)", () => {
    const lines = paintSystemsView(state(), tree());
    for (const g of ["trims", "doors"] as const) {
      expect(lines.find((l) => l.group === g)!.chips.map((c) => c.label)).toEqual(["Yes, shiny", "No", "Not sure"]);
    }
    expect(lines.find((l) => l.group === "walls")!.chips.some((c) => c.label === "Not sure")).toBe(false);
  });

  it("defaults the gloss answer to 'not sure' and says the line needs a check", () => {
    const trims = paintSystemsView(state(), tree()).find((l) => l.group === "trims")!;
    expect(trims.chips.find((c) => c.on)?.label).toBe("Not sure");
    expect(trims.review).toBe(true);
  });

  it("offers the two ceiling taps (⚑3)", () => {
    const marked = state();
    marked.condition.ceilingsMarked = true;
    const line = paintSystemsView(marked, tree()).find((l) => l.group === "ceilings")!;
    expect(line.coats).toBe(2);
    expect(line.reason).toContain("marked");
    expect(line.chips.find((c) => c.on)?.label).toBe("They're marked — two coats");
  });
});

describe("applying a correction to the answers", () => {
  it("maps colour intent back onto the stored tier", () => {
    expect(applySystemPatch(state(), { field: "colourIntent", value: "same" }).condition.tier).toBe("fresh");
    expect(applySystemPatch(state(), { field: "colourIntent", value: "new" }).condition.tier).toBe("change");
    expect(applySystemPatch(state(), { field: "colourIntent", value: "bold" }).condition.tier).toBe("dark_to_light");
  });

  it("clears the old per-surface dark-to-light list when the job stops being bold", () => {
    const s = state();
    s.condition.tier = "dark_to_light";
    s.condition.darkToLightSurfaces = ["walls"];
    expect(applySystemPatch(s, { field: "colourIntent", value: "same" }).condition.darkToLightSurfaces).toEqual([]);
    // …and keeps it when it stays bold.
    expect(applySystemPatch(s, { field: "colourIntent", value: "bold" }).condition.darkToLightSurfaces).toEqual(["walls"]);
  });

  it("keeps the two ceiling flags from contradicting each other", () => {
    const s = state();
    s.condition.ceilingsChangingColour = true;
    const cleared = applySystemPatch(s, { field: "ceilingsMarked", value: false }).condition;
    expect(cleared.ceilingsMarked).toBe(false);
    expect(cleared.ceilingsChangingColour).toBe(false);

    const coloured = applySystemPatch(state(), { field: "ceilingsChangingColour", value: true }).condition;
    expect(coloured.ceilingsChangingColour).toBe(true);
    expect(coloured.ceilingsMarked).toBe(false);
  });

  it("writes the gloss answer to the one field that already holds it", () => {
    expect(applySystemPatch(state(), { field: "glossTrims", value: "yes" }).paint.trimsOilBased).toBe("yes");
  });
});

describe("re-deriving the tree after a correction", () => {
  it("re-coats every interior surface, per group", () => {
    const s = state({ condition: { ...defaultWizardState().condition, tier: "fresh" } });
    const out = applyPaintSystems(tree(), s);
    const living = out.find((b) => b.name === "Living")!;
    const coats = (code: string) => living.surfaces!.find((x) => x.code === code)!.coats;
    expect(coats("Walls")).toBe(1);
    expect(coats("Ceilings")).toBe(1);
    expect(coats("Skirting Boards")).toBe(2);
  });

  it("leaves exterior surfaces exactly as they were (plan §4.4)", () => {
    const before = tree();
    const after = applyPaintSystems(before, state({ condition: { ...defaultWizardState().condition, tier: "fresh" } }));
    const ext = after.find((b) => b.type === "Exterior")!;
    expect(ext.surfaces).toEqual(before.find((b) => b.type === "Exterior")!.surfaces);
  });

  it("replaces its own crew note instead of stacking it on a second tap", () => {
    const s = state();
    s.paint.trimsOilBased = "yes";
    const once = applyPaintSystems(tree(), s);
    const twice = applyPaintSystems(once, s);
    const note = (blocks: ReturnType<typeof applyPaintSystems>) =>
      blocks.find((b) => b.name === "Living")!.surfaces!.find((x) => x.code === "Skirting Boards")!.crewNote as string;
    expect(note(once)).toContain("bonding primer");
    expect(note(twice)).toBe(note(once));
  });

  it("keeps a note somebody else wrote", () => {
    const withNote = tree().map((b) => ({
      ...b,
      surfaces: b.surfaces.map((x) => (x.code === "Skirting Boards" ? { ...x, crewNote: "customer asked for satin" } : x)),
    }));
    const s = state();
    s.paint.trimsOilBased = "yes";
    const out = applyPaintSystems(withNote, s);
    const note = out.find((b) => b.name === "Living")!.surfaces!.find((x) => x.code === "Skirting Boards")!.crewNote as string;
    expect(note).toContain("customer asked for satin");
    expect(note).toContain("bonding primer");
  });

  it("follows Tom's Settings table, not the file's defaults", () => {
    const table = paintSystemsFrom({ walls: { new: { coats: 4, undercoat: true, sentence: "Four coats." } } });
    const out = applyPaintSystems(tree(), state(), table);
    expect(out.find((b) => b.name === "Living")!.surfaces!.find((x) => x.code === "Walls")!.coats).toBe(4);
  });
});

describe("the shared answers reader", () => {
  it("reads a null gloss answer as 'not sure', never as 'no'", () => {
    expect(systemAnswersFromState(state()).glossTrims).toBe("unsure");
  });

  it("survives a partial state without throwing", () => {
    const partial = { condition: undefined, details: undefined, paint: undefined } as never;
    const a = systemAnswersFromState(partial);
    expect(a.colourIntent).toBe("new");
    expect(a.condition).toBe("wear");
    expect(a.glossTrims).toBe("unsure");
  });
});

describe("per-surface flags on the card (Tom, 9 Sep)", () => {
  it("offers each group only the flags that apply to it", () => {
    const lines = paintSystemsView(state(), tree());
    const labels = (g: string) => lines.find((l) => l.group === g)!.flagChips.map((c) => c.label);
    expect(labels("doors")).toContain("They're stained");
    expect(labels("doors")).toContain("Bare or raw timber");
    expect(labels("walls")).toContain("New plaster");
    expect(labels("walls")).not.toContain("Bare or raw timber");
  });

  it("never offers the marked-ceiling flag twice", () => {
    const ceilings = paintSystemsView(state(), tree()).find((l) => l.group === "ceilings")!;
    // It lives in `chips` (⚑3's own stored field); the flag list must not repeat it.
    expect(ceilings.chips.some((c) => c.label === "They're marked — two coats")).toBe(true);
    expect(ceilings.flagChips.some((c) => c.label === "They're marked")).toBe(false);
  });

  it("shows a flag as on once it is set, and offers to take it off", () => {
    const s = state();
    s.condition.surfaceFlags = { doors: ["stained"] };
    const doors = paintSystemsView(s, tree()).find((l) => l.group === "doors")!;
    const chip = doors.flagChips.find((c) => c.label === "They're stained")!;
    expect(chip.on).toBe(true);
    expect(chip.patch).toEqual({ field: "surfaceFlag", group: "doors", flag: "stained", value: false });
    expect(doors.coats).toBe(3);
  });

  it("adds and removes a flag, and forgets the group when its last one goes", () => {
    const added = applySystemPatch(state(), { field: "surfaceFlag", group: "doors", flag: "stained", value: true });
    expect(added.condition.surfaceFlags).toEqual({ doors: ["stained"] });

    const s = state();
    s.condition.surfaceFlags = { doors: ["stained"] };
    const removed = applySystemPatch(s, { field: "surfaceFlag", group: "doors", flag: "stained", value: false });
    // Absent, not an empty array: absence reads as "not asked", [] as "none".
    expect(removed.condition.surfaceFlags).toEqual({});
  });

  it("keeps other groups' flags when one group changes", () => {
    const s = state();
    s.condition.surfaceFlags = { walls: ["new_plaster"] };
    const out = applySystemPatch(s, { field: "surfaceFlag", group: "doors", flag: "stained", value: true });
    expect(out.condition.surfaceFlags).toEqual({ walls: ["new_plaster"], doors: ["stained"] });
  });

  it("re-derives only the flagged group in the tree", () => {
    const s = state({ condition: { ...defaultWizardState().condition, tier: "fresh" } });
    s.condition.surfaceFlags = { doors: ["stained"] };
    const out = applyPaintSystems(tree(), s);
    const living = out.find((b) => b.name === "Living")!;
    const coats = (code: string) => living.surfaces!.find((x) => x.code === code)!.coats;
    expect(coats("Flat Door and Frame (1 Side)")).toBe(3);
    expect(coats("Walls")).toBe(1);
    expect(coats("Skirting Boards")).toBe(2);
    expect(living.surfaces!.find((x) => x.code === "Flat Door and Frame (1 Side)")!.crewNote)
      .toContain("stain-blocking primer");
  });
});
