import { describe, expect, it } from "vitest";
import { computeEnvelope, envelopeToAreaNodes, type ElevationRead } from "./exterior";

const seg = (over: Partial<ElevationRead["cladding"][0]> = {}): ElevationRead["cladding"][0] => ({
  material: "weatherboard", widthM: 12, widthBasis: "site_plan_edge",
  heightM: 2.6, heightBasis: "board_count", confidence: 0.85, ...over,
});
const read = (over: Partial<ElevationRead> = {}): ElevationRead => ({
  elevation: "front", cladding: [seg()], trims: [{ kind: "fascia", linealM: 12 }], confidence: 0.85, ...over,
});

describe("computeEnvelope", () => {
  it("prices a segment only when width AND height carry a real basis", () => {
    const env = computeEnvelope([read()]);
    expect(env.elevations[0].surfaces.find((s) => s.rateCode === "Weatherboards")?.m2).toBeCloseTo(31.2);
    const noHeight = computeEnvelope([read({ cladding: [seg({ heightBasis: "none", heightM: null })] })]);
    expect(noHeight.elevations[0].surfaces.some((s) => s.m2)).toBe(false);
    expect(noHeight.elevations[0].deferred[0].needs).toMatch(/measure on site/);
    expect(noHeight.requiresSiteCheck.some((r) => /front: weatherboard unmeasured/.test(r))).toBe(true);
  });

  it("painted brick now prices via the Brick rate (a Render duplicate, 20 Aug)", () => {
    const env = computeEnvelope([read({ cladding: [seg({ material: "brick" })] })]);
    const surf = env.elevations[0].surfaces.find((s) => s.m2);
    expect(surf?.rateCode).toBe("Brick");
    // An UNKNOWN material still defers to a human.
    const unknownEnv = computeEnvelope([read({ cladding: [seg({ material: "unknown" })] })]);
    expect(unknownEnv.requiresSiteCheck.some((r) => /needs a human price/.test(r))).toBe(true);
  });

  it("fewer than three measured elevations flags a whole-house site check", () => {
    const env = computeEnvelope([read(), read({ elevation: "rear" })]);
    expect(env.requiresSiteCheck.some((r) => /only 2 elevation/.test(r))).toBe(true);
    const full = computeEnvelope([read(), read({ elevation: "rear" }), read({ elevation: "left" })]);
    expect(full.requiresSiteCheck.some((r) => /only \d elevation/.test(r))).toBe(false);
  });

  it("duplicate elevations keep the most confident read", () => {
    const env = computeEnvelope([
      read({ confidence: 0.6, cladding: [seg({ widthM: 8 })] }),
      read({ confidence: 0.9, cladding: [seg({ widthM: 12 })] }),
    ]);
    expect(env.elevations).toHaveLength(1);
    expect(env.elevations[0].surfaces[0].m2).toBeCloseTo(31.2);
  });

  it("drafts builder Exterior surface-nodes with explicit measurements only", () => {
    const env = computeEnvelope([read()]);
    let id = 1;
    const nodes = envelopeToAreaNodes(env, () => id++);
    expect(nodes).toHaveLength(1);
    const cladding = nodes[0].surfaces.find((s) => s.code === "Weatherboards")!;
    expect(cladding.qtyOverride).toBeCloseTo(31.2); // never derived from L/W/H room maths
    const fascia = nodes[0].surfaces.find((s) => s.code === "Fascias")!;
    expect(fascia.measureL).toBe(12);
    expect(nodes[0].type).toBe("Exterior");
    expect(nodes[0].assumedFields).toContain("exterior_envelope");
  });
});
