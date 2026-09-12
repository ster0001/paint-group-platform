import { describe, expect, it } from "vitest";
import { COMMERCIAL_SEGMENTS, SEGMENT_LABEL, canonicalSegment, gateMessage, routeCommercial } from "./commercial";
import { DEFAULT_SEGMENTS } from "./segments";
import { guardrailWhy } from "./policy";

/**
 * C12: the segment row decides the door. The seven gates are gone as a wall —
 * this pins what replaced them.
 */

describe("the two doors", () => {
  it("range segments price online; brief segments never do", () => {
    for (const s of DEFAULT_SEGMENTS) {
      const r = routeCommercial(s.key);
      expect(r.route, s.key).toBe(s.route);
      expect(r.canPriceOnline, s.key).toBe(s.route === "range");
      expect(r.briefKey, s.key).toBe(s.route === "brief" ? s.key : null);
    }
    expect(routeCommercial("office").canPriceOnline).toBe(true);
    expect(routeCommercial("strata").canPriceOnline).toBe(false);
    expect(routeCommercial("shopfront").canPriceOnline).toBe(false);
    expect(routeCommercial("other").canPriceOnline).toBe(false);
  });

  it("⚑19 health: aged care and clinics price online, a hospital leaves for the hospital brief", () => {
    expect(routeCommercial("health", { kind: "aged" }).canPriceOnline).toBe(true);
    expect(routeCommercial("health", { kind: "clinic" }).canPriceOnline).toBe(true);
    const h = routeCommercial("health", { kind: "hospital" });
    expect(h.route).toBe("brief");
    expect(h.briefKey).toBe("hospital");
    expect(h.reasons[0]).toMatch(/priced on site/);
  });

  it("outside → the exterior brief, both → one visit; whatever the tile says", () => {
    for (const key of ["office", "retail", "school", "warehouse", "health"]) {
      expect(routeCommercial(key, { jobType: "exterior" }).briefKey, key).toBe("exterior");
      expect(routeCommercial(key, { jobType: "both" }).briefKey, key).toBe("exterior");
      expect(routeCommercial(key, { jobType: "both" }).reasons[0], key).toMatch(/one visit/);
      expect(routeCommercial(key, { jobType: "interior" }).canPriceOnline, key).toBe(true);
    }
  });

  it("prices nothing before the segment is known, and says why", () => {
    const r = routeCommercial(null);
    expect(r.route).toBeNull();
    expect(r.canPriceOnline).toBe(false);
    expect(r.reasons[0]).toMatch(/what sort of site/);
    expect(gateMessage(r)).toMatch(/Pick the closest/);
    expect(gateMessage(routeCommercial("office"))).toBe("");
    expect(gateMessage(routeCommercial("strata"))).toMatch(/priced on site/);
  });

  it("reads a loaded table over the mirror", () => {
    const flipped = DEFAULT_SEGMENTS.map((s) => (s.key === "office" ? { ...s, route: "brief" as const } : s));
    expect(routeCommercial("office", { segments: flipped }).route).toBe("brief");
    expect(routeCommercial("office").route).toBe("range");
  });
});

describe("phase 7a's keys still resolve", () => {
  it("maps healthcare → health and industrial → warehouse", () => {
    expect(canonicalSegment("healthcare")).toBe("health");
    expect(canonicalSegment("industrial")).toBe("warehouse");
    expect(canonicalSegment("office")).toBe("office");
    expect(canonicalSegment(null)).toBeNull();
    expect(routeCommercial("healthcare").segment?.key).toBe("health");
    expect(routeCommercial("industrial").canPriceOnline).toBe(true);
  });

  it("names every tile for a person, in table order", () => {
    expect(COMMERCIAL_SEGMENTS).toEqual(["office", "warehouse", "retail", "health", "school", "strata", "shopfront", "other"]);
    for (const k of COMMERCIAL_SEGMENTS) expect(SEGMENT_LABEL[k].length).toBeGreaterThan(4);
  });
});

describe("every door has a customer-facing why", () => {
  it("has a guardrailWhy line for the range and brief reasons", () => {
    expect(guardrailWhy(["commercial_range"])).toMatch(/person confirms/i);
    expect(guardrailWhy(["commercial_brief"])).toMatch(/priced on site/i);
  });

  it("carries no dollar figure in any customer-facing string", () => {
    const shown = [
      ...Object.values(SEGMENT_LABEL),
      ...DEFAULT_SEGMENTS.flatMap((s) => [s.tile_hint, s.config.sub ?? "", s.config.openCopy ?? "", s.brief?.sub ?? ""]),
      gateMessage(routeCommercial(null)),
      gateMessage(routeCommercial("strata")),
    ].join(" ");
    expect(shown).not.toMatch(/\$\d/);
  });
});
