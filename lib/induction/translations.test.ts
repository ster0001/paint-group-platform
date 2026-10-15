import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { inductionStrings, parseInduction } from "./source";
import { checkTranslation, translationFile, type TranslationFile } from "./translations";
import { isLanguageCode, LANGUAGES } from "./languages";
import { standardsFromFile, type StandardsFile } from "../standards/source";
import { standardsStrings, STANDARDS_PREFIX } from "../standards/strings";

const ROOT = resolve(__dirname, "../..");
const DIR = resolve(ROOT, "docs/induction/translations");
const en = JSON.parse(readFileSync(resolve(DIR, "en.json"), "utf8")) as TranslationFile;

describe("translation files — same keys as en.json, no blanks", () => {
  it("en.json equals the induction markdown and the standards file (regenerate with scripts/induction-strings.ts)", () => {
    const file = parseInduction(readFileSync(resolve(ROOT, "docs/induction/induction-v1.md"), "utf8"));
    const standards = standardsFromFile(JSON.parse(readFileSync(resolve(ROOT, "docs/standards/finish-standards-v1.json"), "utf8")) as StandardsFile);
    const expected: Record<string, string> = { ...inductionStrings(file) };
    for (const [k, v] of Object.entries(standardsStrings(standards))) expected[`${STANDARDS_PREFIX}${k}`] = v;
    expect(en).toEqual(translationFile("en", file.version, standards.version.no, expected));
  });

  const files = readdirSync(DIR).filter((n) => n.endsWith(".json") && n !== "en.json").sort();

  it("every file is one of the ruled languages, named by its code", () => {
    for (const name of files) {
      const t = JSON.parse(readFileSync(resolve(DIR, name), "utf8")) as TranslationFile;
      expect(isLanguageCode(t.language), name).toBe(true);
      expect(name).toBe(`${t.language}.json`);
    }
  });

  it("the six ruled languages all have a file (ruling I8)", () => {
    const codes = files.map((n) => n.replace(/\.json$/, ""));
    for (const l of LANGUAGES) if (l.code !== "en") expect(codes, `${l.name} (${l.code})`).toContain(l.code);
  });

  for (const name of files) {
    it(`${name} carries every key of en.json, nothing extra, nothing blank`, () => {
      const t = JSON.parse(readFileSync(resolve(DIR, name), "utf8"));
      const problems = checkTranslation(t, en);
      expect(problems, problems.slice(0, 10).join("\n")).toEqual([]);
    });

    it(`${name} is a translation, not a copy of the English (at least 95% of lines differ)`, () => {
      const t = JSON.parse(readFileSync(resolve(DIR, name), "utf8")) as TranslationFile;
      const keys = Object.keys(en.strings);
      // Short labels like "3 m" or "1.5 m" are legitimately the same.
      const same = keys.filter((k) => t.strings[k] === en.strings[k] && en.strings[k].length > 8).length;
      expect(same / keys.length, `${same} of ${keys.length} lines are identical to English`).toBeLessThan(0.05);
    });
  }

  it("checkTranslation names a missing, a blank and a stray key", () => {
    const bad = { language: "es", status: "machine first pass", inductionVersion: en.inductionVersion, standardsVersion: en.standardsVersion, strings: { ...en.strings, "m01.s1": "", extra: "x" } };
    delete (bad.strings as Record<string, string>)["m01.s2"];
    const p = checkTranslation(bad, en);
    expect(p).toContain("missing: m01.s2");
    expect(p).toContain("blank: m01.s1");
    expect(p).toContain("stray: extra");
  });
});
