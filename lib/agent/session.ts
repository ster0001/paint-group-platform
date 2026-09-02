import "server-only";
/**
 * What the assistant's routes and page share: who is asking, which
 * conversation/estimate they may touch, the draft estimate a guided chat
 * starts on, and the UI state (next gap, price, thresholds) computed with
 * the same pure functions the tools use — never a second opinion.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getWizardActor } from "@/lib/supabase/guards";
import type { EstimateRow } from "@/lib/wizard/customer-scope";
import { checkThresholds, priceScope, assumptionSwings } from "./scope-tools";
import { graphInput, isBuilt, type ScopeDeps } from "./scope-doc";
import { nextGap } from "./question-graph";
import type { SupabaseScopeStore } from "./scope-store-supabase";
import type { ConversationRow } from "./store";
import type { SupabaseAgentStore } from "./store-supabase";
import type { Gap, PriceScopeResult } from "./schemas";
import { parseAnswerMarker } from "./model-stub";
import { createGateway } from "./gateway";
import { loadCustomerScope, type CustomerScopeBundle } from "@/lib/wizard/customer-scope";

export type AgentActor = { kind: "customer" | "staff"; userId: string; verifiedEmail: string | null };

export async function agentActor(): Promise<AgentActor | null> {
  const supabase = await createClient();
  const actor = await getWizardActor(supabase);
  if (actor.kind === "none") return null;
  return { kind: actor.kind, userId: actor.user.id, verifiedEmail: actor.kind === "customer" ? actor.verifiedEmail : (actor.user.email?.toLowerCase() ?? null) };
}

/** The agent tables have no client write policies: every route uses the
 *  service client with an explicit ownership check (lib/supabase/service.ts). */
export function agentDb(): SupabaseClient | null { return createServiceClient(); }

export async function loadOwnConversation(store: SupabaseAgentStore, id: string, actor: AgentActor): Promise<ConversationRow | null> {
  const conv = await store.getConversation(id);
  if (!conv) return null;
  if (actor.kind === "staff") return conv;
  return conv.createdBy === actor.userId ? conv : null;
}

export async function loadOwnEstimate(db: SupabaseClient, id: string, actor: AgentActor): Promise<EstimateRow | null> {
  const { data } = await db.from("estimates")
    .select("id, status, source, created_by, requires_site_check, builder_state, account_id")
    .eq("id", id).maybeSingle();
  const row = data as EstimateRow | null;
  if (!row) return null;
  if (actor.kind === "staff") return row;
  const own = row.created_by === actor.userId && row.source === "customer_intake" && row.status === "draft";
  return own ? row : null;
}

/** The blank draft a guided conversation builds into. Same shape the wizard
 *  submit writes (title/status/source/created_by), empty builder state. */
export async function createDraftEstimate(db: SupabaseClient, actor: AgentActor, accountType: "residential" | "trade" | null, accountId: string | null): Promise<string> {
  const { data, error } = await db.from("estimates").insert({
    title: "Estimate in progress", status: "draft", source: "customer_intake", created_by: actor.userId,
    ...(accountId ? { account_id: accountId } : {}),
    builder_state: { blocks: [], agent: { answers: {}, facts: { accountType, email: actor.verifiedEmail } } },
  }).select("id").single();
  if (error || !data) throw new Error(`agent: couldn't create the draft estimate: ${error?.message}`);
  return data.id as string;
}

export type UiState = {
  built: boolean;
  nextGap: Gap | null;
  price: PriceScopeResult | null;
  thresholds: ReturnType<typeof checkThresholds> | null;
};

export async function uiState(scope: SupabaseScopeStore, estimateId: string, view: "customer" | "staff"): Promise<UiState> {
  const doc = await scope.load(estimateId);
  if (!doc) return { built: false, nextGap: null, price: null, thresholds: null };
  const deps: ScopeDeps = { refs: await scope.refs(), ctx: await scope.ctx(), actor: view };
  const built = isBuilt(doc);
  const swings = built ? assumptionSwings(doc, deps) : undefined;
  return {
    built,
    nextGap: nextGap(graphInput(doc, deps, "guided", swings)),
    price: built ? priceScope(doc, deps) : null,
    thresholds: built ? checkThresholds(doc, deps) : null,
  };
}

/** What the person reads: the marker a tap appended is not prose. */
export function displayText(content: string): string {
  const parsed = parseAnswerMarker(content);
  return parsed ? parsed.text : content;
}

export function accountTypeOf(row: { account_type?: string } | null | undefined): "residential" | "trade" | null {
  return row?.account_type === "trade" ? "trade" : row?.account_type === "residential" ? "residential" : null;
}

export type AssistSession =
  | { kind: "holding"; line: string }
  | {
      kind: "ok"; conversationId: string; estimateId: string; disclosure: string; assistantName: string;
      transcript: Array<{ id: string; role: "user" | "assistant" | "staff" | "system"; text: string; createdAt: string }>;
      ui: UiState; bundle: CustomerScopeBundle | null;
    };

/** Everything /estimate/assist renders, resolved server-side: ownership,
 *  resume-or-open on an adopted draft, transcript, UI state, editor bundle. */
export async function openAssistSession(params: { c?: string; estimate?: string }): Promise<AssistSession> {
  const actor = await agentActor();
  if (!actor) return { kind: "holding", line: "Start your estimate first — the assistant picks up from there." };
  const db = agentDb();
  if (!db) return { kind: "holding", line: "The assistant isn't available just now — please try again shortly." };
  let gateway;
  try { gateway = await createGateway(); } catch { return { kind: "holding", line: "The assistant isn't available just now — please try again shortly." }; }

  let conversationId = params.c ?? null;
  if (!conversationId && params.estimate) {
    const est = await loadOwnEstimate(db, params.estimate, actor);
    if (!est) return { kind: "holding", line: "We couldn't find that estimate." };
    const { data: existing } = await db.from("agent_conversations").select("id")
      .eq("estimate_id", est.id).eq("created_by", actor.userId).eq("status", "open")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (existing?.id) conversationId = existing.id as string;
    else {
      const conv = await gateway.startConversation({ accountId: est.account_id ?? null, propertyId: null, estimateId: est.id, channel: "portal", mode: "guided", view: "customer", createdBy: actor.userId, anonToken: null, externalThreadId: null });
      await gateway.store.appendMessage({ conversationId: conv.id, role: "assistant", content: `${gateway.settings.disclosureText} I can pick up from what you've built — what would you like to change or add?`, modelId: null, tokensIn: 0, tokensOut: 0 });
      conversationId = conv.id;
    }
  }
  if (!conversationId) return { kind: "holding", line: "That link is missing its conversation." };

  const conv = await loadOwnConversation(gateway.store, conversationId, actor);
  if (!conv || !conv.estimateId) return { kind: "holding", line: "We couldn't find that conversation." };
  const est = await loadOwnEstimate(db, conv.estimateId, actor);
  if (!est) return { kind: "holding", line: "We couldn't find that estimate." };

  const [ui, messages] = await Promise.all([uiState(gateway.scope, conv.estimateId, "customer"), gateway.store.listMessages(conv.id)]);
  const bundle = ui.built ? await loadCustomerScope(db, est) : null;
  return {
    kind: "ok", conversationId: conv.id, estimateId: conv.estimateId,
    disclosure: gateway.settings.disclosureText, assistantName: gateway.settings.assistantName,
    transcript: messages.filter((m) => m.role !== "system").map((m) => ({ id: m.id, role: m.role, text: displayText(m.content), createdAt: m.createdAt })),
    ui, bundle,
  };
}
