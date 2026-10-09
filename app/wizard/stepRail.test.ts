import { describe, expect, it } from "vitest";
import { stepsFor, QUICK_LOOK_STEPS, type QuickLook } from "@/lib/wizard/quick-look";
import { DEFAULT_SEGMENTS, isWarehouse } from "@/lib/wizard/segments";
import { routeCommercial } from "@/lib/wizard/commercial";
import { railFor, STEP_LABELS, RAIL_FULL_MAX } from "./stepRail";

/**
 * Brief §10 "Every job type": the step list on screen equals `stepsFor()` for
 * inside, outside, both, each ranged segment, the warehouse, each visit-only
 * segment, hospital, and a commercial outside or both answer. The rail is
 * built from `stepsFor()` and never from a list of its own — this walks every
 * one of those paths and checks the rail says the same thing, in the same
 * order, with a name for every step.
 */
type Path = { name: string; steps: ReturnType<typeof stepsFor> };

function homePaths(): Path[] {
  const out: Path[] = [];
  for (const gate of [true, false]) {
    for (const jobType of ["interior", "exterior", "both"] as QuickLook["jobType"][]) {
      out.push({ name: `home ${jobType}${gate ? "" : " (range first)"}`, steps: stepsFor(jobType, "house", "areas", "range", "whole", gate) });
    }
  }
  return out;
}

function commercialPaths(): Path[] {
  const out: Path[] = [];
  for (const seg of DEFAULT_SEGMENTS) {
    const pattern = isWarehouse(seg) ? "warehouse" as const : "areas" as const;
    for (const jobType of ["interior", "exterior", "both"] as QuickLook["jobType"][]) {
      const r = routeCommercial(seg.key, { segments: DEFAULT_SEGMENTS, jobType });
      const door = r.canPriceOnline ? "range" as const : "brief" as const;
      out.push({ name: `${seg.key} ${jobType}`, steps: stepsFor(jobType, "commercial", pattern, door, "whole", true) });
    }
  }
  // Healthcare → hospital: the kind on the areas screen leaves for a brief.
  out.push({ name: "health → hospital", steps: stepsFor("interior", "commercial", "areas", "brief_after_areas", "whole", true) });
  return out;
}

const paths = [...homePaths(), ...commercialPaths()];

describe("the step rail follows stepsFor() on every path", () => {
  it("names every step the wizard can show", () => {
    for (const s of QUICK_LOOK_STEPS) {
      expect(STEP_LABELS[s].rail.length, s).toBeGreaterThan(0);
      expect(STEP_LABELS[s].long.length, s).toBeGreaterThan(0);
    }
  });

  it.each(paths)("$name", ({ steps }) => {
    const counted = steps.filter((s) => s !== "both");
    for (const at of steps) {
      const rail = railFor(steps, at);
      // Same steps, same order — the rail never invents or drops one.
      expect(rail.steps).toEqual(counted);
      expect(rail.compact).toBe(counted.length > RAIL_FULL_MAX);
      expect(rail.phoneLine).toMatch(new RegExp(`^Step \\d+ of ${counted.length} · `));
      // A visit-only path books; everything else reveals a range.
      expect(rail.end).toBe(counted.includes("com_book") ? "Booked" : "Your range");
      expect(rail.progress).toBeGreaterThan(0);
      expect(rail.progress).toBeLessThan(1);
    }
    const last = railFor(steps, counted[counted.length - 1]);
    expect(last.remaining).toBe("Last step");
  });

  it("matches the brief's §7.7 table on the representative paths", () => {
    const labels = (s: ReturnType<typeof stepsFor>) => railFor(s, s[0]).steps.map((k) => STEP_LABELS[k].rail);
    expect(labels(stepsFor("interior", "house", "areas", "range", "whole", true))).toEqual(["Address", "Place", "Job", "Rooms", "Condition", "Details"]);
    expect(labels(stepsFor("exterior", "house", "areas", "range", "whole", true))).toEqual(["Address", "Place", "Outside", "Sides", "Details"]);
    expect(labels(stepsFor("both", "house", "areas", "range", "whole", true))).toEqual(["Address", "Place", "Job", "Rooms", "Condition", "Outside", "Sides", "Details"]);
    expect(labels(stepsFor("interior", "commercial", "areas", "range", "whole", true))).toEqual(["Address", "Place", "Space", "Areas", "Job", "Details"]);
    expect(labels(stepsFor("interior", "commercial", "warehouse", "range", "whole", true))).toEqual(["Address", "Place", "Space", "Building", "Job", "Details"]);
    expect(labels(stepsFor("interior", "commercial", "areas", "brief", "whole", true))).toEqual(["Address", "Place", "Space", "Questions", "Book"]);
    expect(labels(stepsFor("interior", "commercial", "areas", "brief_after_areas", "whole", true))).toEqual(["Address", "Place", "Space", "Areas", "Questions", "Book"]);
  });

  it("the both choice screen is not counted and reads as the first step", () => {
    const steps = stepsFor("both", "house", "areas", "range", "whole", true);
    const r = railFor(steps, "both");
    expect(r.steps).not.toContain("both");
    expect(r.current).toBe(0);
    expect(r.compact).toBe(true);
  });

  it("a visit-only path counts down to the visit", () => {
    const steps = stepsFor("interior", "commercial", "areas", "brief", "whole", true);
    expect(railFor(steps, "place").remaining).toBe("3 steps to your visit");
  });
});
