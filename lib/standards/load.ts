import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import { reportError } from "@/lib/monitoring/report";
import { createClient } from "@/lib/supabase/server";
import { readStandards, type StandardsLoad } from "./read";
import { DEFAULT_SMALL_JOB_HOURS } from "./model";
import { localizedStandards } from "./localize";
import { myLanguage } from "@/lib/induction/language";

export type { StandardsLoad };

/** The current standards, in English, under the session's own client, once per request. */
export const loadStandardsEnglish = cache(async (): Promise<StandardsLoad> => readStandards(await createClient()));

/**
 * The current standards as THIS session reads them, once per request: the
 * English model with the painter's chosen language laid over it (induction
 * brief §5, ruling I8). A staff session, a customer, or a painter who has not
 * chosen read English. The structure — keys, levels, codes — is always the
 * English model's, so every link and lookup is unchanged whatever the words.
 */
export const loadStandards = cache(async (): Promise<StandardsLoad> => {
  const en = await loadStandardsEnglish();
  if (!en.standards) return en;
  const language = await myLanguage();
  if (!language || language === "en") return en;
  const supabase = await createClient();
  const versionId = await currentStandardsVersionId(supabase);
  if (!versionId) return en;
  const { standards } = await localizedStandards(supabase, en.standards, versionId, language);
  return { standards, error: null };
});

/** The id of the newest published standards version (the one the model came from). */
export async function currentStandardsVersionId(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase.from("standards_versions").select("id").not("published_at", "is", null).order("version_no", { ascending: false }).limit(1);
  if (error) { reportError(error, { where: "standards.versionId", bestEffort: true }); return null; }
  return ((data ?? []) as { id: string }[])[0]?.id ?? null;
}

/**
 * The small-job threshold (ruling S9) through the definer RPC, so a painter's
 * session can read it although `settings` is staff-only. Default 16 on any
 * refusal, reported.
 */
export async function smallJobHours(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase.rpc("small_job_hours");
  if (error) {
    reportError(error, { where: "standards.smallJobHours", bestEffort: true });
    return DEFAULT_SMALL_JOB_HOURS;
  }
  const n = Number(data);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SMALL_JOB_HOURS;
}
