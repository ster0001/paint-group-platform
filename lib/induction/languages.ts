/**
 * The induction languages (ruling I8): English plus the six Tom named. The
 * list of CODES is fixed here and in `induction_languages`; whether a language
 * is OFFERED is the `live` flag staff set in Settings after Tom's team has
 * tested it (⚑3). English is always live.
 *
 * Shared by server and client code: no fs, no Supabase.
 */
export const LANGUAGES = [
  { code: "en", name: "English", nativeName: "English", dir: "ltr" },
  { code: "fa-AF", name: "Dari (Afghan)", nativeName: "دری", dir: "rtl" },
  { code: "fa", name: "Farsi", nativeName: "فارسی", dir: "rtl" },
  { code: "ar", name: "Arabic (Lebanese)", nativeName: "العربية", dir: "rtl" },
  { code: "es", name: "Spanish", nativeName: "Español", dir: "ltr" },
  { code: "pt-BR", name: "Portuguese (Brazil)", nativeName: "Português", dir: "ltr" },
  { code: "it", name: "Italian", nativeName: "Italiano", dir: "ltr" },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];
export type Dir = "ltr" | "rtl";

export const DEFAULT_LANGUAGE: LanguageCode = "en";

export function isLanguageCode(v: unknown): v is LanguageCode {
  return typeof v === "string" && LANGUAGES.some((l) => l.code === v);
}

export function languageOf(code: string | null | undefined): (typeof LANGUAGES)[number] {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}

/** The `lang` attribute for an HTML element holding this language's text. */
export function htmlLang(code: LanguageCode): string {
  return code === "fa-AF" ? "fa-AF" : code;
}

/** A live-flag row as the table holds it. */
export type LanguageRow = { code: LanguageCode; name: string; native_name: string; dir: Dir; live: boolean; sort: number };

/** The languages a painter may pick: English always, the rest only when live. */
export function offeredLanguages(rows: readonly { code: string; live: boolean }[]): (typeof LANGUAGES)[number][] {
  const live = new Set(rows.filter((r) => r.live).map((r) => r.code));
  return LANGUAGES.filter((l) => l.code === "en" || live.has(l.code));
}
