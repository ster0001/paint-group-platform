import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXTERIOR_QUICK_LOOK, EXTERIOR_PROMISE,
  applyExteriorQuickLook, toggleAccess, toggleKeeping,
  type ExteriorQuickLook,
} from "./exterior-quick-look";
import { defaultWizardState, wizardStateSchema } from "./state";
import { exteriorAccessAllowances } from "./exterior-allowances";
import { DEFAULT_QUICK_LOOK, quickLookToState } from "./quick-look";

const q = (over: Partial<ExteriorQuickLook> = {}): ExteriorQuickLook => ({ ...DEFAULT_EXTERIOR_QUICK_LOOK, ...over });
/** The real order: the quick look's first screens, then the outside one. */
const base = () => quickLookToState(
  { ...DEFAULT_QUICK_LOOK, jobType: "exterior" },
  { ...defaultWizardState(), mode: "customer" as const },
);

describe("the five answers reach the engine's own fields", () => {
  it("produces a state the submit schema accepts", () => {
    const s = applyExteriorQuickLook(q(), base());
    const parsed = wizardStateSchema.safeParse({
      ...s,
      customer: { ...s.customer!, suburb: "Murrumbeena", postcode: "3163" },
      contact: { ...s.contact, name: "A", email: "a@example.com", phone: "0400000000" },
    });
    expect(parsed.success, JSON.stringify(parsed.success ? {} : parsed.error.issues)).toBe(true);
  });

  it("sizes the elevations from the answers — no listing, no photos", () => {
    expect(applyExteriorQuickLook(q(), base()).exterior?.noPhotos).toBe(true);
  });

  it("carries storeys, materials, targets and condition through", () => {
    const e = applyExteriorQuickLook(q({
      storeys: "double", substrates: ["render", "brick"], targets: ["house", "fence"], condition: "peeling",
    }), base()).exterior!;
    expect(e.storeys).toBe("double");
    expect(e.substrates).toEqual(["render", "brick"]);
    expect(e.targets).toEqual(["house", "fence"]);
    expect(e.condition).toBe("peeling");
    expect(e.extras.fence).toBe(true);
    expect(e.extras.deck).toBe(false);
  });

  it("treats a fence-only job as one with no house body to paint", () => {
    const e = applyExteriorQuickLook(q({ targets: ["fence"] }), base()).exterior!;
    expect(e.painting.body).toBe(false);
  });
});

/**
 * The access answers are the whole reason this screen could not be built until
 * the per-elevation allowances existed. Each one has to land in the field the
 * allowance module reads, and the equipment answer must NOT become an hours
 * allowance — it is an exclusion.
 */
describe("access feeds the allowances, and equipment never prices", () => {
  it("sends steep, tight and double-height to the hours allowance", () => {
    const e = applyExteriorQuickLook(q({ access: ["steep", "high"] }), base()).exterior!;
    expect(e.access).toEqual(["steep", "high"]);
    const out = exteriorAccessAllowances({
      storeys: e.storeys, access: e.access, accessEquipment: e.accessEquipment, sidesPainted: 4,
    });
    expect(out.allowances.map((a) => a.key)).toContain("difficult_ground");
    expect(out.allowances.map((a) => a.key)).toContain("upper_storey");
  });

  it("turns 'needs a lift or scaffold' into an EXCLUSION, never hours", () => {
    const e = applyExteriorQuickLook(q({ access: ["lift"] }), base()).exterior!;
    expect(e.accessEquipment).toEqual(["scaffold"]);
    expect(e.access).toEqual([]);
    const out = exteriorAccessAllowances({
      storeys: e.storeys, access: e.access, accessEquipment: e.accessEquipment, sidesPainted: 4,
    });
    expect(out.allowances).toEqual([]);
    expect(out.exclusions.length).toBe(1);
  });

  it("clears the equipment when they take the answer back", () => {
    const on = applyExteriorQuickLook(q({ access: ["lift"] }), base());
    const off = applyExteriorQuickLook(q({ access: [] }), on);
    expect(off.exterior?.accessEquipment).toEqual([]);
  });
});

describe("the multi-selects cannot be left saying two things at once", () => {
  it("makes 'nothing tricky' exclusive both ways", () => {
    expect(toggleAccess(["steep", "tight"], "none")).toEqual(["none"]);
    expect(toggleAccess(["none"], "steep")).toEqual(["steep"]);
    // And tapping it twice is how you take it back.
    expect(toggleAccess(["none"], "none")).toEqual([]);
  });

  it("adds and removes the others independently", () => {
    expect(toggleAccess([], "steep")).toEqual(["steep"]);
    expect(toggleAccess(["steep", "tight"], "steep")).toEqual(["tight"]);
  });

  it("never empties a list past its floor", () => {
    // An exterior job with no material and no target is not an answer — it is
    // a tap that would silently price nothing.
    expect(toggleKeeping(["weatherboards"], "weatherboards", "weatherboards")).toEqual(["weatherboards"]);
    expect(toggleKeeping(["house"], "house", "house")).toEqual(["house"]);
    expect(toggleKeeping(["house", "fence"], "house", "house")).toEqual(["fence"]);
  });
});

describe("what the customer is promised", () => {
  it("says a person confirms every outside price", () => {
    expect(EXTERIOR_PROMISE).toMatch(/confirmed by your estimator/i);
    expect(EXTERIOR_PROMISE).toMatch(/guide range/i);
  });
});
