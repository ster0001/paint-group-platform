import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { standardsFromFile, type StandardsFile } from "./source";
import { SURFACE_CODES } from "./codes";
import {
  expectationsFor,
  groupExpectations,
  levelFromParam, levelOf, resolveSurface, sectionHref, standardsLinksFor, surfaceHref, tapeCheckRequired,
} from "./model";

const file = JSON.parse(
  readFileSync(new URL("../../docs/standards/finish-standards-v1.json", import.meta.url), "utf8"),
) as StandardsFile;
const standards = standardsFromFile(file, SURFACE_CODES);

describe("levelOf", () => {
  test("PG-n → n; FIN-1 jobs and blanks have no level", () => {
    expect(levelOf("PG-2")).toBe(2);
    expect(levelOf(" pg-4 ")).toBe(4);
    expect(levelOf(null)).toBeNull();
    expect(levelOf("")).toBeNull();
    expect(levelOf("PG-1")).toBeNull();
    expect(levelOf("FIN-3")).toBeNull();
  });
  test("a query string level falls back to 3", () => {
    expect(levelFromParam("4")).toBe(4);
    expect(levelFromParam("9")).toBe(3);
    expect(levelFromParam(undefined)).toBe(3);
  });
});

describe("resolveSurface — which standard a work-order line is about", () => {
  test("by the line's own code when a new snapshot carries one", () => {
    expect(resolveSurface(standards, { code: "Skirting Boards MDF", label: "Skirting (hall)" })?.key).toBe("skirting");
    expect(resolveSurface(standards, { code: "Patterned Cornices", label: "Cornice" })?.key).toBe("cornices");
  });

  test("by the label as a rate code — issued jobs with no client label", () => {
    expect(resolveSurface(standards, { label: "Walls" })?.key).toBe("walls");
    expect(resolveSurface(standards, { label: "4-6 Panel Door and Frame (1 Side)" })?.key).toBe("doors");
    expect(resolveSurface(standards, { label: "weatherboards" })?.key).toBe("weatherboards");
  });

  test("by the standards surface's own name as a last resort", () => {
    expect(resolveSurface(standards, { label: "Skirting boards" })?.key).toBe("skirting");
    expect(resolveSurface(standards, { label: "Picket fence" })?.key).toBe("picket");
  });

  test("a line that matches nothing gets no link — never a guess", () => {
    expect(resolveSurface(standards, { label: "Gutters" })).toBeNull();
    expect(resolveSurface(standards, { label: "Fuel allowance" })).toBeNull();
    expect(resolveSurface(standards, { label: "" })).toBeNull();
    expect(resolveSurface(standards, { code: "Pergola", label: "Pergola" })).toBeNull();
  });

  test("a code on both sides: the area's side decides", () => {
    expect(resolveSurface(standards, { label: "Double Hung Sash" }, { side: "exterior" })?.key).toBe("extwindows");
    expect(resolveSurface(standards, { label: "Double Hung Sash" }, { side: "interior" })?.key).toBe("windowframes");
    expect(resolveSurface(standards, { label: "Doors" }, { side: "exterior" })?.key).toBe("extdoors");
  });

  test("no side on the record: the other lines in the area tell it", () => {
    const outside = [{ label: "Weatherboards" }, { label: "Awning / Casement Window" }, { label: "Fascias" }];
    expect(resolveSurface(standards, outside[1], { lines: outside })?.key).toBe("extwindows");
    const inside = [{ label: "Walls" }, { label: "Awning / Casement Window" }];
    expect(resolveSurface(standards, inside[1], { lines: inside })?.key).toBe("windowframes");
  });

  test("nothing to go on: interior", () => {
    expect(resolveSurface(standards, { label: "Colonial / Bay Window" })?.key).toBe("windowframes");
  });
});

describe("standardsLinksFor — the job sheet's What-we-expect links", () => {
  const doc = {
    areas: [
      { finishCode: "PG-3", surfaces: [{ key: "a:1", label: "Walls" }, { key: "a:2", label: "Gutters" }, { key: "a:3", label: "Double Hung Sash" }] },
      { finishCode: "PG-4", side: "exterior" as const, surfaces: [{ key: "b:1", label: "Double Hung Sash" }] },
      { finishCode: null, surfaces: [{ key: "c:1", label: "Walls" }] },
    ],
  };
  const links = standardsLinksFor(standards, doc, "portal", "wo-1");

  test("each mapped line links to its surface at the AREA's level", () => {
    expect(links["a:1"]).toBe("/portal/help/standards/walls?level=3&job=wo-1");
    expect(links["b:1"]).toBe("/portal/help/standards/extwindows?level=4&job=wo-1");
  });
  test("an unmapped line, and any line in an area with no PG level, has no link", () => {
    expect(links["a:2"]).toBeUndefined();
    expect(links["c:1"]).toBeUndefined();
  });
  test("a window in an area of interior lines is the interior window", () => {
    expect(links["a:3"]).toBe("/portal/help/standards/windowframes?level=3&job=wo-1");
  });
  test("the PC shell gets its own route to the same record", () => {
    expect(standardsLinksFor(standards, doc, "pc", "wo-1")["a:1"]).toBe("/pc/standards/walls?level=3&job=wo-1");
    expect(surfaceHref("pc", "walls")).toBe("/pc/standards/walls");
    expect(sectionHref("portal", "defect")).toBe("/portal/help/standards/s/defect");
  });
});

describe("tapeCheckRequired (ruling S9)", () => {
  test("not required under the small-job hours, required at or above", () => {
    expect(tapeCheckRequired(15.9, 16)).toBe(false);
    expect(tapeCheckRequired(16, 16)).toBe(true);
    expect(tapeCheckRequired(52, 16)).toBe(true);
    expect(tapeCheckRequired(0, 16)).toBe(false);
  });
});

describe("expectationsFor — one list for the top of the work order (Tom, 9 Oct 2026)", () => {
  const doc = {
    areas: [
      { title: "Lounge", finishCode: "PG-3", surfaces: [{ key: "a0:0", label: "Walls" }, { key: "a0:1", label: "Gutters" }] },
      { title: "Outside", side: "exterior" as const, finishCode: "PG-4", surfaces: [{ key: "a1:0", label: "Double Hung Sash", code: "EXT-WIN" }] },
      { title: "No level", finishCode: null, surfaces: [{ key: "a2:0", label: "Walls" }] },
    ],
  };
  test("every mapped line, at its area's level, with that level's checks; unmapped lines and areas with no level are absent", () => {
    const items = expectationsFor(standards, doc, "portal", "job1");
    expect(items.map((i) => `${i.area} · ${i.label} L${i.level}`)).toEqual(["Lounge · Walls L3", "Outside · Double Hung Sash L4"]);
    const walls = items[0];
    expect(walls.href).toBe("/portal/help/standards/walls?level=3&job=job1");
    expect(walls.checks.length).toBeGreaterThan(0);
    expect(walls.checks.every((c) => typeof c.text === "string" && c.text.length > 0)).toBe(true);
    expect(walls.everyLevel.length).toBeGreaterThan(0);
    expect(items[1].href).toBe("/portal/help/standards/extwindows?level=4&job=job1");
  });
});

describe("groupExpectations — one document, each standard once (Tom, 9 Oct 2026)", () => {
  const doc = {
    areas: [
      { title: "Hallway", finishCode: "PG-3", surfaces: [{ key: "a0:0", label: "Walls" }, { key: "a0:1", label: "Gutters" }] },
      { title: "Bedroom", finishCode: "PG-3", surfaces: [{ key: "a1:0", label: "Walls" }] },
      { title: "Lounge", finishCode: "PG-4", surfaces: [{ key: "a2:0", label: "Walls" }] },
    ],
  };
  test("walls in two Level 3 rooms is one section naming both rooms; the Level 4 room is its own section; unmapped lines are absent", () => {
    const sections = groupExpectations(expectationsFor(standards, doc, "pc", "job1"));
    expect(sections.map((s) => `${s.surfaceKey} L${s.level}: ${s.lines.map((l) => l.area).join(", ")}`))
      .toEqual(["walls L3: Hallway, Bedroom", "walls L4: Lounge"]);
    expect(sections[0].key).toBe("walls-3");
    expect(sections[0].href).toBe("/pc/standards/walls?level=3&job=job1");
    expect(sections[0].checks.length).toBeGreaterThan(0);
  });
});
