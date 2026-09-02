/**
 * Where a scope document lives, behind an interface: memory for tests and
 * the parity suite, Supabase (scope-store-supabase.ts, server-only) in
 * production. The tools never see a database.
 */

import type { TreeRefs } from "@/lib/wizard/build-tree";
import type { PricingContext } from "@/lib/pricing/estimate";
import type { CrmEventInput } from "@/lib/crm/events";
import type { ScopeDoc } from "./scope-doc";

export interface ScopeStore {
  load(estimateId: string): Promise<ScopeDoc | null>;
  save(doc: ScopeDoc): Promise<void>;
  refs(): Promise<TreeRefs>;
  ctx(): Promise<PricingContext>;
  logCrmEvent(input: CrmEventInput): Promise<string | null>;
}

export class MemoryScopeStore implements ScopeStore {
  docs = new Map<string, ScopeDoc>();
  events: CrmEventInput[] = [];
  constructor(private readonly reference: { refs: TreeRefs; ctx: PricingContext }) {}

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
