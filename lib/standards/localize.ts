import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/monitoring/report";
import type { LanguageCode } from "@/lib/induction/languages";
import type { Standards } from "./model";
import { localizeStandards } from "./strings";

/**
 * The finish standards in a painter's language (induction brief §5: the six
 * sign-off sections are read in the chosen language). The English model is
 * the structure; `standards_strings` rows for the version and language are
 * laid over it; any key without a row stays English and is reported ONCE per
 * read with the keys (Step 4 acceptance: fallback to English, logged).
 * No `server-only`: the seed script's read-back uses it.
 */
export async function localizedStandards(supabase: SupabaseClient, en: Standards, versionId: string, language: LanguageCode): Promise<{ standards: Standards; missing: string[]; error: string | null }> {
  if (language === "en") return { standards: en, missing: [], error: null };
  const { data, error } = await supabase.from("standards_strings").select("key, text").eq("version_id", versionId).eq("language", language).limit(2000);
  if (error) {
    // A rejected read is NOT "no translation": say so and show English.
    reportError(error, { where: "standards.localize.read", bestEffort: true, extra: { language } });
    return { standards: en, missing: [], error: error.message };
  }
  const map: Record<string, string> = {};
  for (const r of (data ?? []) as { key: string; text: string }[]) map[r.key] = r.text;
  const { standards, missing } = localizeStandards(en, map);
  if (missing.length) {
    reportError(new Error(`standards: ${missing.length} string(s) missing in ${language}, English shown`), {
      where: "standards.i18n.fallback", bestEffort: true, extra: { language, count: missing.length, keys: missing.slice(0, 20) },
    });
  }
  return { standards, missing, error: null };
}
