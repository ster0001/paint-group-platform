import { describe, expect, it } from "vitest";
import { BAND_EDGES, DEFAULT_SITE_ALLOWANCES, bandFor, bandLabel, siteAllowances, siteAllowancesFrom } from "./allowances";

/** Go-live brief §3 (18 Nov 2026) — the scale, its edges, a "both" job, and the Settings parse. */
describe("site allowances by job size", () => {
  it("every band edge, both sides: 11.99 is the band below, 12 is the band above, and so on to 180", () => {
    const edges = [12, 35, 60, 100, 180];
    for (const side of ["interior", "exterior"] as const) {
      const bands = DEFAULT_SITE_ALLOWANCES[side];
      expect(BAND_EDGES).toEqual(bands.map((b) => b.upToHours));
      edges.forEach((edge, i) => {
        expect(bandFor(bands, edge - 0.01), `${side} ${edge - 0.01}`).toBe(bands[i]);
        expect(bandFor(bands, edge), `${side} ${edge}`).toBe(bands[i + 1]);
      });
      expect(bandFor(bands, 0)).toBe(bands[0]);
      expect(bandFor(bands, 1000)).toBe(bands[5]);
    }
  });

  it("§3.1 values: the audit's 3-bed (65.55 h interior) gets 8 h prep, 4 h cleaning, $245 sundries", () => {
    expect(siteAllowances({ interiorHours: 65.55, exteriorHours: null })).toMatchObject({ prepHours: 8, cleaningHours: 4, sundriesCents: 24500 });
    // the three held cells (⚑): a bigger job never gets less
    expect(siteAllowances({ interiorHours: 200, exteriorHours: null })).toMatchObject({ prepHours: 10, cleaningHours: 6, sundriesCents: 33500 });
    expect(siteAllowances({ interiorHours: null, exteriorHours: 5 })).toMatchObject({ prepHours: 2, cleaningHours: 0, sundriesCents: 14000 });
    expect(siteAllowances({ interiorHours: null, exteriorHours: 400 })).toMatchObject({ prepHours: 8, cleaningHours: 0, sundriesCents: 27000 });
  });

  it("a both job adds the interior row for its inside hours and the exterior row for its outside hours; no exterior cleaning (D11)", () => {
    const r = siteAllowances({ interiorHours: 40, exteriorHours: 150 });
    expect(r).toMatchObject({ prepHours: 4.5 + 8, cleaningHours: 3.5 + 0, sundriesCents: 18000 + 17500 });
    expect(r.interior?.upToHours).toBe(60);
    expect(r.exterior?.upToHours).toBe(180);
  });

  it("a side with no block adds nothing; no blocks at all is zero", () => {
    expect(siteAllowances({ interiorHours: null, exteriorHours: null })).toMatchObject({ prepHours: 0, cleaningHours: 0, sundriesCents: 0, interior: null, exterior: null });
    expect(siteAllowances({ interiorHours: 0, exteriorHours: null }).interior?.upToHours).toBe(12);
  });

  it("Settings: the edges are fixed, each figure is the office's when usable, §3.1 otherwise; the cleaning rate is $65 to start (D9)", () => {
    expect(siteAllowancesFrom(null)).toEqual(DEFAULT_SITE_ALLOWANCES);
    const s = siteAllowancesFrom({ interior: [{ prepHours: 3, cleaningHours: -1, sundriesCents: 12000 }], exterior: "nope", cleaningRateCents: 7000 });
    expect(s.interior[0]).toEqual({ upToHours: 12, prepHours: 3, cleaningHours: 1.5, sundriesCents: 12000 });
    expect(s.interior[1]).toEqual(DEFAULT_SITE_ALLOWANCES.interior[1]);
    expect(s.exterior).toEqual(DEFAULT_SITE_ALLOWANCES.exterior);
    expect(s.cleaningRateCents).toBe(7000);
    expect(DEFAULT_SITE_ALLOWANCES.cleaningRateCents).toBe(6500);
    expect(["Under 12 h", "12–35 h", "35–60 h", "60–100 h", "100–180 h", "Over 180 h"]).toEqual(DEFAULT_SITE_ALLOWANCES.interior.map((_, i) => bandLabel(DEFAULT_SITE_ALLOWANCES.interior, i)));
  });
});
