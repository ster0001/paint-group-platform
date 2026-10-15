/**
 * The translation file format (induction brief Step 4): one JSON file per
 * language in docs/induction/translations/, the SAME keys as en.json, the
 * values translated. The induction keys come from lib/induction/source.ts
 * (`m03.s4`, `m03.tick`, `m02.w1`, `m01.title`); the standards keys from
 * lib/standards/strings.ts under `standards.` (`standards.levels.intro`).
 *
 * Pure: no fs. The seed script reads the files; translations.test.ts checks
 * every committed file against en.json (no missing key, no stray key, no
 * blank value) so a language can never be served with a hole in it that the
 * English fallback did not know about.
 */
import { isLanguageCode, LANGUAGES, type LanguageCode } from "./languages";

export type TranslationFile = {
  language: LanguageCode;
  /** Who produced it: "machine first pass" until Tom's team has tested it (⚑3). */
  status: "machine first pass" | "tested";
  /** The induction version and the standards version the strings belong to. */
  inductionVersion: number;
  standardsVersion: number;
  strings: Record<string, string>;
};

export function translationFile(language: LanguageCode, inductionVersion: number, standardsVersion: number, strings: Record<string, string>): TranslationFile {
  return { language, status: language === "en" ? "tested" : "machine first pass", inductionVersion, standardsVersion, strings };
}

/** Problems with a translation file against the English one. Empty = fine. */
export function checkTranslation(file: unknown, en: TranslationFile): string[] {
  const out: string[] = [];
  if (!file || typeof file !== "object") return ["not an object"];
  const f = file as Partial<TranslationFile>;
  if (!isLanguageCode(f.language)) out.push(`language "${String(f.language)}" is not one of ${LANGUAGES.map((l) => l.code).join(", ")}`);
  if (f.inductionVersion !== en.inductionVersion) out.push(`inductionVersion ${String(f.inductionVersion)} ≠ ${en.inductionVersion}`);
  if (f.standardsVersion !== en.standardsVersion) out.push(`standardsVersion ${String(f.standardsVersion)} ≠ ${en.standardsVersion}`);
  const strings = (f.strings && typeof f.strings === "object" ? f.strings : {}) as Record<string, unknown>;
  for (const k of Object.keys(en.strings)) {
    const v = strings[k];
    if (typeof v !== "string") out.push(`missing: ${k}`);
    else if (!v.trim()) out.push(`blank: ${k}`);
  }
  for (const k of Object.keys(strings)) if (!(k in en.strings)) out.push(`stray: ${k}`);
  return out;
}

/** Keys of the induction part only (not `standards.`). */
export function inductionKeys(strings: Record<string, string>): string[] {
  return Object.keys(strings).filter((k) => !k.startsWith("standards."));
}
