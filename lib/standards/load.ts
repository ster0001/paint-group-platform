import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import { reportError } from "@/lib/monitoring/report";
import { createClient } from "@/lib/supabase/server";
import { readStandards, type StandardsLoad } from "./read";
import { DEFAULT_SMALL_JOB_HOURS } from "./model";

export type { StandardsLoad };

/** The current standards under the session's own client, once per request. */
export const loadStandards = cache(async (): Promise<StandardsLoad> => readStandards(await createClient()));

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
