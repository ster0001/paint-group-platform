/**
 * The approved standards file → rows → model. Pins the Step 1 acceptance
 * counts (17 surfaces, 53 checks, 159 level rows) and that nothing on the way
 * changes a word.
 */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { standardsFromFile, standardsRows, type StandardsFile } from "./source";
import { SURFACE_CODES, UNMAPPED_RATE_CODES } from "./codes";
import { LEVELS, SIGN_OFF_SECTIONS } from "./model";
import { FINISH_LEVELS, FINISH_ORDER } from "@/lib/workorder/finish";

const file = JSON.parse(
  readFileSync(new URL("../../docs/standards/finish-standards-v1.json", import.meta.url), "utf8"),
) as StandardsFile;

describe("finish-standards-v1.json → rows", () => {
  const rows = standardsRows(file, "docs/standards/finish-standards-v1.json");

  test("the counts the brief accepts on", () => {
    expect(rows.surfaces).toHaveLength(17);
    expect(rows.surfaces.filter((s) => s.side === "interior")).toHaveLength(7);
    expect(rows.surfaces.filter((s) => s.side === "exterior")).toHaveLength(10);
    const checks = rows.surfaces.reduce((n, s) => n + s.checks.length, 0);
    expect(checks).toBe(159); // one row per surface, per level, per check (S2)
    expect(checks / LEVELS.length).toBe(53);
  });

  test("every level row carries the file's exact text", () => {
    for (const s of rows.surfaces) {
      const src = file.surfaces.find((f) => f.key === s.key)!;
      for (const c of s.checks) {
        const srcCheck = src.checks.find((x) => x.sort === c.sort)!;
        expect(c.label).toBe(srcCheck.label);
        expect(c.text).toBe(srcCheck[`level_${c.level}` as const]);
      }
      expect(s.every_level).toBe(src.every_level);
      expect(s.intro).toBe(src.intro);
      expect(s.note).toBe(src.note);
      expect(s.name).toBe(src.name);
    }
  });

  test("the version row says what it is", () => {
    expect(rows.version).toMatchObject({ version_no: 1, published_at: "2026-10-06", is_material: true, small_job_hours: 16 });
    expect(rows.version.title).toBe(file.title);
  });

  test("eight blocks, the six sign-off sections among them", () => {
    expect(rows.blocks.map((b) => b.section_key)).toEqual(["levels", "rules", "time", "interior", "exterior", "defect", "checklist", "words"]);
    expect(file.sign_off_sections).toEqual([...SIGN_OFF_SECTIONS]);
    expect(rows.blocks.find((b) => b.section_key === "exterior")!.body).toEqual({ intro: file.exterior_intro, rules: file.exterior_rules });
    expect(rows.blocks.find((b) => b.section_key === "words")!.body).toEqual({ items: file.words });
  });

  test("a malformed file stops the loader rather than seeding half a version", () => {
    const bad = JSON.parse(JSON.stringify(file)) as StandardsFile;
    bad.surfaces[0].checks[0].level_3 = "";
    expect(() => standardsRows(bad, "x")).toThrow(/level 3 text/);
    const dup = JSON.parse(JSON.stringify(file)) as StandardsFile;
    dup.surfaces[1].key = dup.surfaces[0].key;
    expect(() => standardsRows(dup, "x")).toThrow(/twice/);
  });
});

describe("the in-app model", () => {
  const standards = standardsFromFile(file, SURFACE_CODES);

  test("checks are regrouped per label with all three levels", () => {
    const walls = standards.surfaces.find((s) => s.key === "walls")!;
    expect(walls.checks.map((c) => c.label)).toEqual(["Fill", "Sand", "Old surface", "Lines"]);
    expect(walls.checks[3].text).toEqual({ 2: "Straight and tidy from 3 m.", 3: "Sharp and straight from 1.5 m.", 4: "Sharp and straight from 0.5 m." });
    expect(walls.codes).toEqual(["Walls"]);
  });

  test("interior surfaces come first, each side in the file's order", () => {
    expect(standards.surfaces.map((s) => s.key)).toEqual([
      "walls", "ceilings", "cornices", "skirting", "architraves", "windowframes", "doors",
      "weatherboards", "brick", "render", "picket", "extwindows", "extdoors", "fascias", "eaves", "strapping", "fretwork",
    ]);
  });
});

describe("the rate-card code map", () => {
  test("names every surface in the file and nothing else", () => {
    expect(Object.keys(SURFACE_CODES).sort()).toEqual(file.surfaces.map((s) => s.key).sort());
    for (const s of file.surfaces) expect(SURFACE_CODES[s.key].side).toBe(s.side);
  });

  test("a code appears once per side, and never also in the unmapped list", () => {
    const seen = new Set<string>();
    for (const [key, { side, codes }] of Object.entries(SURFACE_CODES)) {
      for (const c of codes) {
        const k = `${side}:${c}`;
        expect(seen.has(k), `${c} mapped twice on the ${side} (${key})`).toBe(false);
        seen.add(k);
        expect(UNMAPPED_RATE_CODES, `${c} is both mapped and listed unmapped`).not.toContain(c);
      }
    }
  });

  test("only fretwork has no rate code", () => {
    expect(Object.entries(SURFACE_CODES).filter(([, v]) => v.codes.length === 0).map(([k]) => k)).toEqual(["fretwork"]);
  });
});

describe("the job sheet's level summary is the approved one", () => {
  // FinishChip (lib/workorder/finish.ts) keeps a copy of the three level
  // summaries so a client component needs no fetch. This pins that copy to
  // the file — change the file, this fails until the copy follows.
  test("FINISH_LEVELS mirrors the file's levels block word for word", () => {
    expect(FINISH_ORDER).toEqual(["PG-2", "PG-3", "PG-4"]);
    for (const item of file.levels.items) {
      const level = FINISH_LEVELS[`PG-${item.level}` as keyof typeof FINISH_LEVELS];
      expect(level.name).toBe(item.name);
      expect(level.lookTest).toBe(item.look_test_distance);
      expect(level.rows).toEqual(item.summary);
    }
  });
});
