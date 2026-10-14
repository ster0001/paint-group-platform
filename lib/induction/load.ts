import "server-only";
import { cache } from "react";
import { reportError } from "@/lib/monitoring/report";
import { createClient } from "@/lib/supabase/server";
import { readInduction, type InductionLoad } from "./read";
import { readingLanguage } from "./language";

/**
 * The induction in the signed-in painter's language, once per request. A
 * translation the tables lack falls back to English and is LOGGED here, once
 * per request with the keys, so a hole in a language file is a line in the
 * monitor rather than a blank on a phone (Step 4 acceptance).
 */
export const loadInduction = cache(async (): Promise<InductionLoad> => {
  const [supabase, language] = await Promise.all([createClient(), readingLanguage()]);
  const load = await readInduction(supabase, language);
  if (load.induction && load.induction.missing.length) {
    reportError(new Error(`induction: ${load.induction.missing.length} line(s) missing in ${language}, English shown`), {
      where: "induction.i18n.fallback", bestEffort: true,
      extra: { language, count: load.induction.missing.length, keys: load.induction.missing.slice(0, 20) },
    });
  }
  return load;
});
