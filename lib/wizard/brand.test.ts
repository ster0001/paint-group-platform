import { describe, expect, it } from "vitest";
import { allowedForBrand, isWizardBrand, jobTypesFor, paintHomeEstimatorIntro, paintHomeTier, propertyKindsFor, PAINT_HOME_WORDS } from "./brand";
import { stepsFor } from "./quick-look";
import { parseEstimateIntent } from "@/lib/marketing/prefill";

describe("Paint Home wizard brand branch (paint-home brief §5)", () => {
  it("two doors shut: no commercial property kind, no 'both'; Paint Group keeps every option", () => {
    expect(propertyKindsFor("painthome").map((k) => k.value)).toEqual(["house", "townhouse", "unit_apartment"]);
    expect(jobTypesFor("painthome").map((j) => j.value)).toEqual(["interior", "exterior"]);
    expect(propertyKindsFor("paintgroup").map((k) => k.value)).toContain("commercial");
    expect(jobTypesFor(null).map((j) => j.value)).toContain("both");
  });
  it("the route test: no commercial screen is reachable from any Paint Home answer, however it arrived", () => {
    for (const kind of propertyKindsFor("painthome")) for (const job of jobTypesFor("painthome")) {
      const steps = stepsFor(job.value, kind.value);
      expect(steps.some((s) => s.startsWith("com_") || s === "segment" || s === "both"), `${kind.value}/${job.value}`).toBe(false);
    }
    expect(allowedForBrand("painthome", { propertyKind: "commercial" })).toEqual({ propertyKind: "house" });
    expect(allowedForBrand("painthome", { jobType: "both" })).toEqual({ jobType: "interior" });
    expect(allowedForBrand("paintgroup", { propertyKind: "commercial", jobType: "both" })).toEqual({ propertyKind: "commercial", jobType: "both" });
  });
  it("the hand-off: brand=painthome is read, business mode is refused, the scope is pre-answered", () => {
    const i = parseEstimateIntent({ address: "7/40 Wattletree Road", mode: "business", scope: "exterior", brand: "painthome", src: "painthome_home_hero" });
    expect(i.brand).toBe("painthome");
    expect(i.mode).toBe("home");
    expect(i.propertyKind).toBeNull();
    expect(i.scope).toBe("exterior");
    expect(i.entrySource).toBe("painthome_home_hero");
    expect(parseEstimateIntent({ brand: "nope" }).brand).toBeNull();
    expect(parseEstimateIntent({ mode: "business" }).propertyKind).toBe("commercial");
    expect(isWizardBrand("painthome")).toBe(true);
    expect(isWizardBrand("other")).toBe(false);
  });
  it("the phone-close tier: call under the ceiling with nothing to see; a visit over it, on a must-see guardrail, or when the job needs a person on site", () => {
    const cap = 1_200_000;
    expect(paintHomeTier({ hiCents: 390_000, capCents: cap, reasons: [], requiresSiteCheck: false })).toEqual({ tier: "call", why: null });
    expect(paintHomeTier({ hiCents: cap, capCents: cap, reasons: [], requiresSiteCheck: false }).tier).toBe("call");
    expect(paintHomeTier({ hiCents: cap + 100, capCents: cap, reasons: [], requiresSiteCheck: false })).toEqual({ tier: "visit", why: "over the phone-close ceiling" });
    expect(paintHomeTier({ hiCents: 500_000, capCents: cap, reasons: ["over_self_serve_cap"], requiresSiteCheck: false }).tier).toBe("visit");
    expect(paintHomeTier({ hiCents: 500_000, capCents: cap, reasons: ["asbestos_unsure"], requiresSiteCheck: false }).tier).toBe("visit");
    expect(paintHomeTier({ hiCents: 500_000, capCents: cap, reasons: [], requiresSiteCheck: true })).toEqual({ tier: "visit", why: "needs a person on site" });
    expect(paintHomeTier({ hiCents: null, capCents: cap, reasons: [], requiresSiteCheck: false }).tier).toBe("visit");
  });
  it("Sarah is introduced plainly; the hand-off is the first and only place the wizard names Paint Group", () => {
    expect(paintHomeEstimatorIntro("Sarah Reid")).toBe("Sarah, who'll be checking your price.");
    expect(paintHomeEstimatorIntro("")).toBeNull();
    expect(PAINT_HOME_WORDS.confirmDoor.title).not.toMatch(/Paint Group/);
    expect(PAINT_HOME_WORDS.thenCall).not.toMatch(/Paint Group/);
    expect(PAINT_HOME_WORDS.handoff.team).toMatch(/Paint Group team/);
    for (const v of Object.values({ ...PAINT_HOME_WORDS.confirmDoor, ...PAINT_HOME_WORDS.handoff, thenCall: PAINT_HOME_WORDS.thenCall })) expect(v).not.toMatch(/—|!/);
  });
});
