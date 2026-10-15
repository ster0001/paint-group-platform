import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import { reportError } from "@/lib/monitoring/report";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_LANGUAGE, isLanguageCode, LANGUAGES, type LanguageCode } from "./languages";

/**
 * The signed-in painter's language (ruling I8), once per request. Null when
 * they have not chosen yet — the screens then read English and Home asks.
 * A refused read (no migration, no session) is reported and reads as "not
 * chosen": the app never breaks over a language.
 */
export const myLanguage = cache(async (): Promise<LanguageCode | null> => {
  const supabase = await createClient();
  return myLanguageWith(supabase);
});

export async function myLanguageWith(supabase: SupabaseClient): Promise<LanguageCode | null> {
  const { data, error } = await supabase.rpc("induction_my_language");
  if (error) { reportError(error, { where: "induction.myLanguage", bestEffort: true }); return null; }
  return isLanguageCode(data) ? data : null;
}

/** The language the screens render in: the choice, or English. */
export async function readingLanguage(): Promise<LanguageCode> {
  return (await myLanguage()) ?? DEFAULT_LANGUAGE;
}

export type OfferedLanguage = (typeof LANGUAGES)[number];

/** The languages a painter may pick right now: English plus the live ones (⚑3). Works with no session (the join page). */
export async function offeredLanguagesWith(supabase: SupabaseClient): Promise<{ languages: OfferedLanguage[]; error: string | null }> {
  const { data, error } = await supabase.rpc("induction_languages_offered");
  if (error) {
    reportError(error, { where: "induction.offered", bestEffort: true });
    return { languages: [LANGUAGES[0]], error: error.message };
  }
  const codes = new Set(((data ?? []) as { code: string }[]).map((r) => r.code));
  return { languages: LANGUAGES.filter((l) => l.code === "en" || codes.has(l.code)), error: null };
}
