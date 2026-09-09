import { describe, expect, it } from "vitest";
import {
  MAX_SPECS, applySpec, flagsWithSpec, flagsWithoutSpec, specFromState,
  specSummary, specsFromFlags, type SavedSpec,
} from "./saved-specs";
import { defaultWizardState, type WizardState } from "./state";

const now = new Date("2026-09-09T00:00:00.000Z");

function stateWith(over: Partial<WizardState> = {}): WizardState {
  const s = { ...defaultWizardState(), ...over };
  s.surfaces = ["walls", "ceilings", "skirting"];
  s.condition = { ...s.condition, tier: "fresh", ceilingsMarked: true, darkToLightSurfaces: ["walls"] };
  s.details = { ...s.details, damageTier: 2, siteAccess: { cleared: "no", floors: "hard" } };
  s.paint = { ...s.paint, trimsOilBased: "yes" };
  return s;
}

const spec = (over: Partial<SavedSpec> = {}): SavedSpec =>
  ({ ...specFromState(stateWith(), "End-of-lease repaint", { id: "s1", now }), ...over });

describe("a spec holds ANSWERS, never a tree or a price", () => {
  /**
   * The rooms come from the address — a two-bed unit and a four-bed house
   * both take "end-of-lease repaint" and produce different trees. Storing a
   * tree would make the spec a copy of one job rather than a way of working.
   */
  it("captures only the answers that repeat", () => {
    const s = spec();
    const keys = Object.keys(s).sort();
    expect(keys).toEqual([
      "ceilingsChangingColour", "ceilingsMarked", "colourPolicy", "createdAt",
      "damageTier", "id", "name", "siteAccess", "surfaces", "tier", "trimsOilBased",
    ]);
    // Nothing job-shaped, and nothing money-shaped.
    const json = JSON.stringify(s);
    expect(json).not.toMatch(/blocks|areas|rooms|cents|price|address|postcode/i);
  });

  it("carries the answers across", () => {
    const s = spec();
    expect(s.surfaces).toEqual(["walls", "ceilings", "skirting"]);
    expect(s.tier).toBe("fresh");
    expect(s.damageTier).toBe(2);
    expect(s.trimsOilBased).toBe("yes");
    expect(s.ceilingsMarked).toBe(true);
    expect(s.siteAccess).toEqual({ cleared: "no", floors: "hard" });
  });
});

describe("applying a spec", () => {
  it("sets the answers it names", () => {
    const out = applySpec(defaultWizardState(), spec());
    expect(out.surfaces).toEqual(["walls", "ceilings", "skirting"]);
    expect(out.condition.tier).toBe("fresh");
    expect(out.details.damageTier).toBe(2);
    expect(out.paint.trimsOilBased).toBe("yes");
    expect(out.details.siteAccess).toEqual({ cleared: "no", floors: "hard" });
  });

  /** An agent who has already typed the address must not lose it. */
  it("leaves everything the spec does not name alone", () => {
    const base = defaultWizardState();
    base.title = "14 Acacia Street";
    base.contact = { name: "Ana", email: "a@b.com", phone: "0400000000" };
    const out = applySpec(base, spec());
    expect(out.title).toBe("14 Acacia Street");
    expect(out.contact.name).toBe("Ana");
    expect(out.jobType).toBe(base.jobType);
  });

  /** "Walls and ceilings only" has to be able to take the doors OFF. */
  it("replaces the surface list rather than merging it", () => {
    const base = defaultWizardState();
    base.surfaces = ["walls", "ceilings", "doors", "windows", "architraves"];
    expect(applySpec(base, spec()).surfaces).toEqual(["walls", "ceilings", "skirting"]);
  });

  /** That list belongs to one job's walls, never to a way of working. */
  it("clears the per-surface dark-to-light list", () => {
    const base = defaultWizardState();
    base.condition.darkToLightSurfaces = ["walls", "ceilings"];
    expect(applySpec(base, spec()).condition.darkToLightSurfaces).toEqual([]);
  });

  it("does not mutate the state it was given", () => {
    const base = defaultWizardState();
    const before = JSON.stringify(base);
    applySpec(base, spec());
    expect(JSON.stringify(base)).toBe(before);
  });
});

describe("storage on accounts.flags", () => {
  it("reads none from an empty, missing or junk flags column", () => {
    for (const junk of [null, undefined, {}, [], "nope", { savedSpecs: "no" }]) {
      expect(specsFromFlags(junk)).toEqual([]);
    }
  });

  it("keeps the other flags when a spec is written", () => {
    const out = flagsWithSpec({ unlimited: true }, spec());
    expect(out.unlimited).toBe(true);
    expect(specsFromFlags(out)).toHaveLength(1);
  });

  it("replaces a spec of the same id rather than duplicating it", () => {
    const one = flagsWithSpec({}, spec({ name: "First" }));
    const two = flagsWithSpec(one, spec({ name: "Renamed" }));
    const list = specsFromFlags(two);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Renamed");
  });

  it("removes one by id and leaves the rest", () => {
    let flags: unknown = {};
    flags = flagsWithSpec(flags, spec({ id: "a", name: "A" }));
    flags = flagsWithSpec(flags, spec({ id: "b", name: "B" }));
    expect(specsFromFlags(flagsWithoutSpec(flags, "a")).map((s) => s.id)).toEqual(["b"]);
  });

  /** A spec list is somebody's way of working; losing it silently is worse. */
  it("drops one bad row without losing the good ones", () => {
    const flags = { savedSpecs: [spec({ id: "ok" }), { id: "broken" }] };
    expect(specsFromFlags(flags).map((s) => s.id)).toEqual(["ok"]);
  });

  it("caps the list rather than growing for ever", () => {
    let flags: unknown = {};
    for (let i = 0; i < MAX_SPECS + 5; i++) flags = flagsWithSpec(flags, spec({ id: `s${i}` }));
    expect(specsFromFlags(flags)).toHaveLength(MAX_SPECS);
  });
});

describe("the colour policy is a note, not an answer", () => {
  /**
   * The per-property colour register (colour_records, trade portal v2) is the
   * machine-readable answer. A second source for the same question is how two
   * of them come to disagree — so this is free text and applies to nothing.
   */
  it("is carried but never applied", () => {
    const s = spec({ colourPolicy: "Vacate white throughout" });
    const out = applySpec(defaultWizardState(), s);
    expect(JSON.stringify(out)).not.toContain("Vacate white throughout");
  });
});

describe("the list line", () => {
  it("says what the spec does in one line", () => {
    expect(specSummary(spec())).toBe("3 surfaces · same colours · needs work");
  });
});
