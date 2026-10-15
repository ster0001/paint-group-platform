import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { standardsFromFile, type StandardsFile } from "./source";
import { localizeStandards, standardsMapFrom, standardsStrings } from "./strings";

const file = JSON.parse(readFileSync(resolve(__dirname, "../../docs/standards/finish-standards-v1.json"), "utf8")) as StandardsFile;
const en = standardsFromFile(file);

describe("standards strings — flat map and back", () => {
  it("lists every sentence once, under a stable key", () => {
    const map = standardsStrings(en);
    expect(map["levels.intro"]).toBe(en.levels.intro);
    expect(map["surfaces.walls.checks.1.l3"]).toBe(en.surfaces.find((s) => s.key === "walls")!.checks[0].text[3]);
    // 17 surfaces × (name + every_level) + 53 checks × (label + 3 levels) at least.
    expect(Object.keys(map).length).toBeGreaterThan(17 * 2 + 53 * 4);
    for (const v of Object.values(map)) expect(v).toMatch(/\S/);
  });

  it("laying the English map over the English model changes nothing and misses nothing", () => {
    const { standards, missing } = localizeStandards(en, standardsStrings(en));
    expect(missing).toEqual([]);
    expect(standards).toEqual(en);
  });

  it("a partial map translates what it has, keeps English for the rest and names every miss", () => {
    const { standards, missing } = localizeStandards(en, { "levels.intro": "Hola", "surfaces.walls.name": "Paredes" });
    expect(standards.levels.intro).toBe("Hola");
    expect(standards.surfaces.find((s) => s.key === "walls")!.name).toBe("Paredes");
    expect(standards.rules.intro).toBe(en.rules.intro);
    expect(missing).toContain("rules.intro");
    expect(missing).not.toContain("levels.intro");
    expect(missing.length).toBe(Object.keys(standardsStrings(en)).length - 2);
    // Structure untouched: keys, sorts and codes are the English model's.
    expect(standards.surfaces.map((s) => s.key)).toEqual(en.surfaces.map((s) => s.key));
    expect(standards.surfaces[0].codes).toEqual(en.surfaces[0].codes);
  });

  it("an empty string is a miss, never a blank on screen", () => {
    const { standards, missing } = localizeStandards(en, { "levels.intro": "   " });
    expect(standards.levels.intro).toBe(en.levels.intro);
    expect(missing).toContain("levels.intro");
  });

  it("standardsMapFrom keeps only the prefixed keys", () => {
    expect(standardsMapFrom({ "standards.levels.intro": "x", "m01.s1": "y" })).toEqual({ "levels.intro": "x" });
  });
});
