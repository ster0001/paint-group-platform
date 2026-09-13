/**
 * C16 (a) — "describe it" fills quick-look fields with attribution, and the
 * route that reads the paragraph writes NOTHING (the versioned draft is the
 * only write path, and it is the wizard's own autosave).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { heuristicExtract } from "@/lib/agent/brief-extract";
import { DEFAULT_QUICK_LOOK } from "./quick-look";
import { confirmAssistantFields, confirmAssistantStep, describeReply, quickLookFromBrief, STEP_FIELDS } from "./describe";
import { wizardStateShapeSchema, defaultWizardState } from "./state";

const TOM = "3 bedroom 1 bathroom house requires painting with a colour match throughout. The walls are in good condition with a few minor cracks to the kitchen area, all trims including windows, doors, frames and skirtings to be painted.";

describe("quickLookFromBrief", () => {
  it("fills what the text says, names every field it wrote, and leaves the rest alone", () => {
    const { quick, wrote } = quickLookFromBrief(heuristicExtract(TOM), { ...DEFAULT_QUICK_LOOK, occupied: "no" });
    expect(quick.jobType).toBe("interior");
    expect(quick.propertyKind).toBe("house");
    expect(quick.bedrooms).toBe(3);
    expect(quick.scope).toBe("whole");          // walls AND the woodwork
    expect(quick.condition).toBe("wear");       // minor cracks → some wear
    expect(quick.occupied).toBe("no");          // not said → untouched
    expect(wrote).toEqual(expect.arrayContaining(["jobType", "propertyKind", "bedrooms", "scope", "condition"]));
    expect(wrote).not.toContain("occupied");
    expect(wrote).not.toContain("storeys");
  });
  it("derives the colour tiles from the coats answer and rebuilds `colour` like a tap would", () => {
    const x = heuristicExtract("Two storey house, walls and ceilings, going much lighter throughout, vacant");
    const { quick, wrote } = quickLookFromBrief(x, DEFAULT_QUICK_LOOK);
    expect(quick.storeys).toBe("double");
    expect(quick.scope).toBe("walls_ceilings");
    if (x.coats === "dark_to_light") { expect(quick.bold).toBe(true); expect(quick.colour).toBe("bold"); expect(wrote).toContain("bold"); }
    if (x.occupied != null) expect(quick.occupied).toBe(x.occupied ? "yes" : "no");
  });
  it("an empty read writes nothing and says so", () => {
    const { quick, wrote } = quickLookFromBrief(heuristicExtract("hello there"), DEFAULT_QUICK_LOOK);
    expect(quick).toEqual(DEFAULT_QUICK_LOOK);
    expect(wrote).toEqual([]);
    expect(describeReply(wrote, { unmapped: [], injected: [] })).toMatch(/couldn't pick out/);
  });
});

describe("attribution stays until confirmed", () => {
  const att = { wrote: ["jobType", "bedrooms", "scope"], at: "2026-09-14T00:00:00Z", source: "describe" as const };
  it("a tap on a field confirms that field; Continue on a screen confirms its fields", () => {
    expect(confirmAssistantFields(att, ["bedrooms"])?.wrote).toEqual(["jobType", "scope"]);
    expect(confirmAssistantStep(att, "start")?.wrote).toEqual(["bedrooms", "scope"]);
    expect(confirmAssistantStep(att, "place")?.wrote).toEqual(["jobType", "scope"]);
    expect(confirmAssistantStep(confirmAssistantStep(confirmAssistantStep(att, "start"), "place"), "job")).toBeNull();
    expect(STEP_FIELDS.condition).toEqual(["condition", "occupied"]);
  });
  it("rides the wizard state (so the versioned draft keeps it) and parses back", () => {
    const st = { ...defaultWizardState(), assistant: att };
    const p = wizardStateShapeSchema.safeParse(st);
    expect(p.success).toBe(true);
    if (p.success) expect(p.data.assistant?.wrote).toEqual(att.wrote);
    expect(wizardStateShapeSchema.parse(defaultWizardState()).assistant).toBeNull();
  });
});

describe("the describe route never writes", () => {
  it("has no table write and no draft or estimate touch — the wizard's autosave is the only write path", () => {
    const src = readFileSync(new URL("../../app/api/wizard/describe/route.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    expect(src).not.toMatch(/from\("(wizard_drafts|estimates)"\)/);
    expect(src).not.toMatch(/api\/wizard\/draft|scope-store|SupabaseScopeStore/);
  });
});
