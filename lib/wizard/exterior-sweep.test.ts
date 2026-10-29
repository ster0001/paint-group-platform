import { describe, expect, it } from "vitest";
import { elevationMarkup } from "../../app/wizard/pictures/Elevation";
import { exteriorV2Schema, EXTERIOR_PARTS } from "./state";

/**
 * Exterior on mobile v5, session 2 (plan §3; v5 brief §3.3): the drawn house's
 * SWEEP MODE — every part is a grey base plus a painted copy clipped by a
 * `rect.cprect` the roller drives, laid in place of the single-layer group,
 * and the markup carries no on/off state (a tick never rebuilds it).
 */
const house = (parts: string[] = []) => exteriorV2Schema.parse({ propertyType: "cal", sizeBand: "md", parts, sides: {} });

describe("the drawn house in sweep mode", () => {
  it("lays a base and a clipped painted copy per part, with a roller, and leaves no sentinel behind", () => {
    const m = elevationMarkup(house(), "front", { sweep: "t" });
    expect(m).not.toContain("<!--p:");
    const groups = m.match(/<g class="e e-[a-z]+" data-e="[a-z]+" data-surf="[a-z]+">/g) ?? [];
    expect(groups.length).toBeGreaterThan(8);
    expect((m.match(/<g class="base">/g) ?? []).length).toBe(groups.length);
    expect((m.match(/<rect class="cprect" x="0" y="0" height="240"\/>/g) ?? []).length).toBe(groups.length);
    expect((m.match(/<g class="paint" clip-path="url\(#cp-t-[a-z]+-\d+\)">/g) ?? []).length).toBe(groups.length);
    expect((m.match(/<g class="roller">/g) ?? []).length).toBe(groups.length);
    // no state in the markup: no data-on, no "on" class
    expect(m).not.toContain("data-on=");
    expect(m).not.toMatch(/class="e e-[a-z]+ on/);
    // the clip ids are unique
    const ids = m.match(/id="cp-t-[a-z]+-\d+"/g) ?? [];
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("the painted copy is the part drawn ON and the base the same part drawn OFF — the same shapes, different colours", () => {
    const m = elevationMarkup(house(), "front", { sweep: "t" });
    const walls = m.match(/<g class="e e-walls" data-e="walls" data-surf="walls"><g class="base">([\s\S]*?)<\/g><clipPath[\s\S]*?<g class="paint"[^>]*>([\s\S]*?)<\/g><g class="roller">/);
    expect(walls).not.toBeNull();
    const [, base, paint] = walls!;
    expect(base).not.toBe(paint);
    expect(base.replace(/#[0-9A-Fa-f]{6}/g, "#")).toBe(paint.replace(/#[0-9A-Fa-f]{6}/g, "#"));
    expect(paint).toContain("#8EE4F0"); // the walls' painted cyan
    expect(base).toContain("#E3E8EC"); // the walls' grey
  });
  it("the structure follows which parts EXIST, not which are ticked — the plain mode is untouched", () => {
    const off = elevationMarkup(house(), "front", { sweep: "t" });
    const on = elevationMarkup(house(["walls", "gable", "fascias"]), "front", { sweep: "t" });
    expect(on).toBe(off); // the same house: ticks change nothing in sweep mode
    const plain = elevationMarkup(house(["walls"]), "front");
    expect(plain).toContain('data-e="walls" data-on="1"');
    expect(plain).not.toContain("cprect");
    expect(EXTERIOR_PARTS).toContain("walls");
  });
});
