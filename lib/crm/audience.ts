/**
 * CRM v2 P5 — asking the database who an audience is. SERVER ONLY.
 *
 * Thin on purpose: compile the tree, hand the primitives to crm_audience_*
 * (migration 20270126), return what comes back. No customer is ever loaded
 * into memory to be filtered here — that was the 2,000-row cap the deep dive
 * found, and the reason a preview could disagree with a send.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { compileAudience, ruleCount, type Audience, type CompiledRules } from "./segments";

const compiled = (a: Audience): CompiledRules | null => (ruleCount(a) === 0 ? null : compileAudience(a));

export async function countAudience(db: SupabaseClient, a: Audience): Promise<number> {
  const rules = compiled(a);
  if (!rules) return 0;
  const { data, error } = await db.rpc("crm_audience_count", { p_rules: rules });
  if (error) throw new Error(`audience count failed: ${error.message}`);
  return Number(data ?? 0);
}

export type AudienceSampleRow = {
  account_id: string; name: string | null; email: string | null; suburb: string | null;
  stage: string; won_cents: number | null; last_job_completed_at: string | null;
};

export async function sampleAudience(db: SupabaseClient, a: Audience, limit = 20): Promise<AudienceSampleRow[]> {
  const rules = compiled(a);
  if (!rules) return [];
  const { data, error } = await db.rpc("crm_audience_sample", { p_rules: rules, p_limit: limit });
  if (error) throw new Error(`audience sample failed: ${error.message}`);
  return (data ?? []) as AudienceSampleRow[];
}

/** Every matching account id, in pages, in id order. The sweep walks this. */
export async function* audienceIds(db: SupabaseClient, a: Audience, page = 2000): AsyncGenerator<string[]> {
  const rules = compiled(a);
  if (!rules) return;
  let after: string | null = null;
  for (;;) {
    const res: { data: unknown; error: { message: string } | null } = await db.rpc("crm_audience_ids", { p_rules: rules, p_limit: page, p_after: after });
    if (res.error) throw new Error(`audience ids failed: ${res.error.message}`);
    const rows = (Array.isArray(res.data) ? res.data : []) as Array<string | { crm_audience_ids: string }>;
    const ids: string[] = rows.map((r) => (typeof r === "string" ? r : r.crm_audience_ids));
    if (ids.length === 0) return;
    yield ids;
    if (ids.length < page) return;
    after = ids[ids.length - 1];
  }
}

/** Is this one customer on the list right now? The guard asks at send time. */
export async function matchesAudience(db: SupabaseClient, a: Audience, accountId: string): Promise<boolean> {
  const rules = compiled(a);
  if (!rules) return false;
  const { data, error } = await db.rpc("crm_audience_match", { p_rules: rules, p_account: accountId });
  if (error) throw new Error(`audience match failed: ${error.message}`);
  return data === true;
}
