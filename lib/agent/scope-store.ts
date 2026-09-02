/**
 * Where a scope document lives, behind an interface: memory for tests and
 * the parity suite, Supabase (scope-store-supabase.ts, server-only) in
 * production. The tools never see a database.
 */

import type { TreeRefs } from "@/lib/wizard/build-tree";
import type { PricingContext } from "@/lib/pricing/estimate";
import type { CrmEventInput } from "@/lib/crm/events";
import type { ScopeDoc } from "./scope-doc";

export type BrainHit = { id: string; slug: string | null; topic: string; question: string; answerMd: string; audience: "customer" | "staff" | "both" };

export interface ScopeStore {
  load(estimateId: string): Promise<ScopeDoc | null>;
  save(doc: ScopeDoc): Promise<void>;
  refs(): Promise<TreeRefs>;
  ctx(): Promise<PricingContext>;
  logCrmEvent(input: CrmEventInput): Promise<string | null>;
  /** Approved, written entries only (needs_content never surfaces), for the audience. */
  searchBrain(query: string, audience: "customer" | "staff"): Promise<BrainHit[]>;
  /** A change request on a sent estimate — the flag staff act on. Returns its id. */
  logChangeRequest(input: { estimateId: string; conversationId: string; areaId: number | null; text: string }): Promise<string>;
}

export class MemoryScopeStore implements ScopeStore {
  docs = new Map<string, ScopeDoc>();
  events: CrmEventInput[] = [];
  brain: Array<BrainHit & { status: "draft" | "approved"; needsContent: boolean }> = [];
  changeRequests: Array<{ id: string; estimateId: string; conversationId: string; areaId: number | null; text: string }> = [];
  constructor(private readonly reference: { refs: TreeRefs; ctx: PricingContext }) {}

  async searchBrain(query: string, audience: "customer" | "staff") {
    const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    return this.brain
      .filter((e) => e.status === "approved" && !e.needsContent && (audience === "staff" || e.audience !== "staff"))
      .map((e) => ({ e, score: words.filter((w) => `${e.topic} ${e.question} ${e.answerMd}`.toLowerCase().includes(w)).length }))
      .filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 5)
      .map(({ e }) => ({ id: e.id, slug: e.slug, topic: e.topic, question: e.question, answerMd: e.answerMd, audience: e.audience }));
  }
  async logChangeRequest(input: { estimateId: string; conversationId: string; areaId: number | null; text: string }) {
    const id = `cr-${this.changeRequests.length + 1}`;
    this.changeRequests.push({ id, ...input });
    return id;
  }

  seed(doc: ScopeDoc) { if (doc.estimateId) this.docs.set(doc.estimateId, doc); return doc; }
  async load(estimateId: string) { return this.docs.get(estimateId) ?? null; }
  async save(doc: ScopeDoc) { if (doc.estimateId) this.docs.set(doc.estimateId, doc); }
  async refs() { return this.reference.refs; }
  async ctx() { return this.reference.ctx; }
  async logCrmEvent(input: CrmEventInput) { this.events.push(input); return `evt-${this.events.length}`; }
}

export function emptyDoc(estimateId: string, accountType: "residential" | "trade" | null = null): ScopeDoc {
  return { estimateId, status: "draft", requiresSiteCheck: false, builderState: { agent: { answers: {}, facts: { accountType } } } };
}
