import "server-only";
/**
 * ScopeStore over the estimates table through the service-role client. The
 * caller (gateway → conversation) is responsible for the ownership check
 * before naming an estimate id — same rule as lib/supabase/service.ts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { SCOPE_VERSION, type Alias, type ScopeRule } from "@/lib/extract/scope";
import type { DefectRate } from "@/lib/capture/commit";
import type { TypicalSizeRow } from "@/lib/wizard/starter";
import type { TreeRefs } from "@/lib/wizard/build-tree";
import { loadPricingContext } from "@/lib/pricing/context";
import { logCrmEvent, type CrmEventInput } from "@/lib/crm/events";
import type { BrainHit, ScopeStore } from "./scope-store";
import type { ScopeDoc } from "./scope-doc";

export class SupabaseScopeStore implements ScopeStore {
  private refsCache: TreeRefs | null = null;
  constructor(private readonly db: SupabaseClient) {}

  async load(estimateId: string): Promise<ScopeDoc | null> {
    const { data, error } = await this.db.from("estimates")
      .select("id, status, requires_site_check, builder_state, account_id, share_token, accounts ( account_type )")
      .eq("id", estimateId).maybeSingle();
    if (error) throw new Error(`scope store load: ${error.message}`);
    if (!data) return null;
    const row = data as { id: string; status: string; requires_site_check: boolean | null; builder_state: Record<string, unknown> | null; share_token?: string | null; accounts?: { account_type?: string } | null };
    const builderState = { ...(row.builder_state ?? {}) };
    const agent = (builderState.agent ?? {}) as { answers?: unknown; facts?: Record<string, unknown> } & Record<string, unknown>;
    const accountType = row.accounts?.account_type === "trade" ? "trade" : row.accounts?.account_type === "residential" ? "residential" : null;
    // Spread FIRST: the pending proposal, its meta and the applied log live
    // beside answers/facts and must survive a reload (S5 — the memory store
    // kept them, this one dropped them, and the panel came back empty).
    const photoCount = await this.photoCount(row.id).catch(() => 0);
    builderState.agent = { ...agent, answers: agent.answers ?? {}, facts: { accountType, ...(agent.facts ?? {}), photoCount } };
    return { estimateId: row.id, status: row.status, requiresSiteCheck: row.requires_site_check === true, builderState, shareToken: row.share_token ?? null };
  }

  async save(doc: ScopeDoc): Promise<void> {
    if (!doc.estimateId) return;
    const { error } = await this.db.from("estimates")
      .update({ builder_state: doc.builderState, requires_site_check: doc.requiresSiteCheck })
      .eq("id", doc.estimateId);
    if (error) throw new Error(`scope store save: ${error.message}`);
  }

  async refs(): Promise<TreeRefs> {
    if (this.refsCache) return this.refsCache;
    const [{ data: rules }, { data: aliases }, { data: defects }, { data: typicals }] = await Promise.all([
      this.db.from("room_type_scope_rules").select("room_type, surface_type, is_option, requires_confirm, notes").eq("version", SCOPE_VERSION),
      this.db.from("room_name_aliases").select("alias, room_type").eq("version", SCOPE_VERSION),
      this.db.from("defect_prep_rates").select("defect_type, unit, hours_sev1, hours_sev2, hours_sev3").eq("version", SCOPE_VERSION),
      this.db.from("room_type_defaults").select("room_type, typical_length_m, typical_width_m").eq("version", 3),
    ]);
    this.refsCache = {
      rules: (rules ?? []) as ScopeRule[], aliases: (aliases ?? []) as Alias[],
      defectRates: (defects ?? []) as DefectRate[], typicals: (typicals ?? []) as TypicalSizeRow[],
    };
    return this.refsCache;
  }

  ctx() { return loadPricingContext(this.db); }
  logCrmEvent(input: CrmEventInput) { return logCrmEvent(this.db, input); }

  /** Condition photos on file for the estimate (the editor's upload path). */
  async photoCount(estimateId: string): Promise<number> {
    const { count, error } = await this.db.from("estimate_sources").select("id", { count: "exact", head: true }).eq("estimate_id", estimateId).eq("kind", "defect_photo");
    if (error) throw new Error(`photoCount: ${error.message}`);
    return count ?? 0;
  }

  /** Postgres full text over topic/question/answer; approved + written only. */
  async searchBrain(query: string, audience: "customer" | "staff"): Promise<BrainHit[]> {
    const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2).slice(0, 8);
    if (terms.length === 0) return [];
    let q = this.db.from("brain_entries").select("id, slug, topic, question, answer_md, audience")
      .eq("status", "approved").eq("needs_content", false);
    if (audience === "customer") q = q.in("audience", ["customer", "both"]);
    const { data, error } = await q.textSearch("search", terms.join(" | "), { config: "english" }).limit(5);
    if (error) throw new Error(`brain search: ${error.message}`);
    return ((data ?? []) as Array<{ id: string; slug: string | null; topic: string; question: string; answer_md: string; audience: BrainHit["audience"] }>)
      .map((r) => ({ id: r.id, slug: r.slug, topic: r.topic, question: r.question, answerMd: r.answer_md, audience: r.audience }));
  }

  /** estimate_events carries the flag (type change_request); the work queue derives the item. */
  async logChangeRequest(input: { estimateId: string; conversationId: string; areaId: number | null; text: string }): Promise<string> {
    const { data, error } = await this.db.from("estimate_events")
      .insert({ estimate_id: input.estimateId, type: "change_request", payload: { text: input.text, areaId: input.areaId, conversationId: input.conversationId, source: "assistant" } })
      .select("id").single();
    if (error || !data) throw new Error(`change request: ${error?.message}`);
    return data.id as string;
  }
}
