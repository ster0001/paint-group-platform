import { describe, expect, it } from "vitest";
import { houseOfShape } from "@/app/wizard/ExteriorHome";
import { EXTERIOR_SHAPE_KEYS, typicalFor } from "./exterior-typicals";
import { exteriorV2Answered, togglePart, usualParts } from "./exterior-model";
import { detailsWhy, mobileScreensFor } from "./mobileScreens";
import { DEFAULT_QUICK_LOOK, stepsFor } from "./quick-look";
import { DEFAULT_EXTERIOR_QUICK_LOOK, exteriorRestatement } from "./exterior-quick-look";

/** Go-live fixes, Session 4 (18 Nov 2026): the outside path's dead ends — H2, M2, M5, M7. */
describe("H2 — a fresh house pre-ticks the usual parts, as the inside pre-ticks its surfaces", () => {
  it("walls (where usually painted), fascias, gutters, eaves, windows and doors; the first Painting screen is answered", () => {
    for (const k of EXTERIOR_SHAPE_KEYS) {
      const t = typicalFor(k);
      const v2 = houseOfShape(k, null, []);
      expect(v2.parts).toEqual(usualParts(t));
      expect(exteriorV2Answered(v2)).toBe(true);
    }
    expect(usualParts({ wallsPainted: true })).toEqual(["walls", "fascias", "gutters", "eaves", "windows", "doors"]);
    expect(usualParts({ wallsPainted: false })).toEqual(["fascias", "gutters", "eaves", "windows", "doors"]);
  });
  it("a bare-brick shape leaves the walls unticked; unticking everything is still allowed (the Continue reason is the shell's)", () => {
    const brick = houseOfShape("brick", null, []);
    expect(brick.parts).not.toContain("walls");
    const none = brick.parts.reduce((acc, p) => togglePart(acc, p), brick);
    expect(none.parts).toEqual([]);
    expect(exteriorV2Answered(none)).toBe(false);
  });
});

describe("M5 — the outside path asks the kind of place once, and the wall material is pre-selected from the home type", () => {
  it("no property screen on an outside house; still asked for a commercial building or a both job", () => {
    const ids = (q: Partial<typeof DEFAULT_QUICK_LOOK>) => {
      const quick = { ...DEFAULT_QUICK_LOOK, ...q };
      return mobileScreensFor(stepsFor(quick.jobType, quick.propertyKind, "areas", "range", quick.scope, true), quick).map((s) => s.id);
    };
    expect(ids({ jobType: "exterior" })).not.toContain("property");
    expect(ids({ jobType: "exterior" })[1]).toBe("shape");
    expect(ids({ jobType: "exterior", propertyKind: "commercial" })).toContain("property");
    expect(ids({ jobType: "both" })).toContain("property");
    expect(ids({ jobType: "interior" })).toContain("property");
  });
  it("the shape's usual wall material is the walls answer until changed", () => {
    expect(houseOfShape("wb", null, []).wall.down).toBe("weatherboards");
    expect(houseOfShape("ds", null, []).wall.down).toBe("render");
    expect(houseOfShape("brick", null, []).wall.down).toBe("brick");
  });
});

describe("M7 — the basis line lists the ticked parts only", () => {
  it("a part ticked is named, a part unticked is not, the house's words", () => {
    const v2 = { ...houseOfShape("cal", null, []), sizeBand: "md" as const };
    const words = exteriorRestatement({ ...DEFAULT_EXTERIOR_QUICK_LOOK, v2 });
    expect(words).toMatch(/^Based on the walls, fascias, gutters, eaves, windows and doors \(weatherboard\)/);
    const noWindows = togglePart(togglePart(v2, "windows"), "gable");
    const w2 = exteriorRestatement({ ...DEFAULT_EXTERIOR_QUICK_LOOK, v2: noWindows });
    expect(w2).toMatch(/gable ends/);
    expect(w2).not.toMatch(/windows/);
  });
});

describe("M2 — the details screen says what is wrong", () => {
  const c = (o: Partial<{ name: string; email: string; phone: string }>) => ({ name: "", email: "", phone: "", ...o });
  it("says nothing on an empty form, and nothing once everything is right", () => {
    expect(detailsWhy(c({}))).toBeNull();
    expect(detailsWhy(c({ name: "Sam Lee", phone: "0412 345 678", email: "sam@example.com" }))).toBeNull();
  });
  it("a landline is named — the code is texted", () => {
    expect(detailsWhy(c({ name: "Sam Lee", phone: "03 9123 4567", email: "sam@example.com" }))).toBe("That looks like a landline — we need a mobile to text your code.");
    expect(detailsWhy(c({ name: "Sam Lee", phone: "+61 3 9123 4567", email: "sam@example.com" }))).toMatch(/landline/);
    expect(detailsWhy(c({ name: "Sam Lee", phone: "+61 412 345 678", email: "sam@example.com" }))).toBeNull();
  });
  it("a first name alone, a short mobile and a bad email each get their own line", () => {
    expect(detailsWhy(c({ name: "Sam" }))).toBe("We need your first and last name.");
    expect(detailsWhy(c({ name: "Sam Lee", phone: "0412 345" }))).toMatch(/mobile/);
    expect(detailsWhy(c({ name: "Sam Lee", phone: "0412 345 678", email: "sam@" }))).toMatch(/email/);
    expect(detailsWhy(c({ name: "Sam Lee", phone: "0412 345 678" }))).toMatch(/email/);
  });
});
