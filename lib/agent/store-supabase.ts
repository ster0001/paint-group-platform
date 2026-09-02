import "server-only";
/**
 * AgentStore over the seven agent tables, through the SERVICE-ROLE client.
 * The gateway is the only writer of the transcript tables — there are no
 * client insert policies, by design (migration 20261228). Every read that
 * serves a customer is scoped by the gateway's own ownership check, the same
 * rule as lib/supabase/service.ts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentStore, CallbackRecord, ConversationRow, ConversationStatus, HandoffRecord, MessageRow, NewConversation, NewMessage, NewToolCall, ToolCallRow } from "./store";
import type { AgentChannel, AgentMode, AgentView } from "./schemas";
import { settingsFromRow, type AgentSettings } from "./settings";

type ConvDb = {
  id: string; account_id: string | null; property_id: string | null; estimate_id: string | null;
  channel: string; mode: string; view: string; status: string; token_spend: number;
  created_by: string | null; anon_token: string | null; external_thread_id: string | null;
};
type MsgDb = { id: string; conversation_id: string; role: string; content: string; model_id: string | null; tokens_in: number; tokens_out: number; created_at: string };
type CallDb = { id: string; conversation_id: string; message_id: string | null; tool: string; input: unknown; result: unknown; rpc_name: string | null; status: string; created_at: string };

const conv = (r: ConvDb): ConversationRow => ({
  id: r.id, accountId: r.account_id, propertyId: r.property_id, estimateId: r.estimate_id,
  channel: r.channel as AgentChannel, mode: r.mode as AgentMode, view: r.view as AgentView,
  status: r.status as ConversationStatus, tokenSpend: r.token_spend, createdBy: r.created_by,
  anonToken: r.anon_token, externalThreadId: r.external_thread_id,
});
const msg = (r: MsgDb): MessageRow => ({
  id: r.id, conversationId: r.conversation_id, role: r.role as MessageRow["role"], content: r.content,
  modelId: r.model_id, tokensIn: r.tokens_in, tokensOut: r.tokens_out, createdAt: r.created_at,
});
const call = (r: CallDb): ToolCallRow => ({
  id: r.id, conversationId: r.conversation_id, messageId: r.message_id, tool: r.tool, input: r.input,
  result: (r.result ?? {}) as ToolCallRow["result"], rpcName: r.rpc_name, status: r.status as ToolCallRow["status"], createdAt: r.created_at,
});

function fail(where: string, error: { message: string } | null): never {
  throw new Error(`agent store ${where}: ${error?.message ?? "unknown error"}`);
}

export class SupabaseAgentStore implements AgentStore {
  private readonly handoffs: SupabaseHandoffs;
  constructor(private readonly db: SupabaseClient) { this.handoffs = new SupabaseHandoffs(db); }
  requestHandoff(conversationId: string, reason: string) { return this.handoffs.requestHandoff(conversationId, reason); }
  openHandoff(conversationId: string) { return this.handoffs.openHandoff(conversationId); }
  claimHandoff(handoffId: string, staffId: string, summary: string) { return this.handoffs.claimHandoff(handoffId, staffId, summary); }
  resolveHandoff(handoffId: string) { return this.handoffs.resolveHandoff(handoffId); }
  markEscalated(handoffId: string, at: Date) { return this.handoffs.markEscalated(handoffId, at); }
  listHandoffs(status: HandoffRecord["status"][]) { return this.handoffs.listHandoffs(status); }
  createCallback(input: Omit<CallbackRecord, "id" | "status">) { return this.handoffs.createCallback(input); }

  async getConversation(id: string) {
    const { data, error } = await this.db.from("agent_conversations").select("*").eq("id", id).maybeSingle();
    if (error) fail("getConversation", error);
    return data ? conv(data as ConvDb) : null;
  }

  async createConversation(input: NewConversation) {
    const { data, error } = await this.db.from("agent_conversations").insert({
      account_id: input.accountId, property_id: input.propertyId, estimate_id: input.estimateId,
      channel: input.channel, mode: input.mode, view: input.view, status: input.status ?? "open",
      created_by: input.createdBy, anon_token: input.anonToken, external_thread_id: input.externalThreadId,
    }).select("*").single();
    if (error || !data) fail("createConversation", error);
    return conv(data as ConvDb);
  }

  async setStatus(conversationId: string, status: ConversationStatus) {
    const { error } = await this.db.from("agent_conversations").update({ status }).eq("id", conversationId);
    if (error) fail("setStatus", error);
  }

  async listMessages(conversationId: string) {
    const { data, error } = await this.db.from("agent_messages").select("*").eq("conversation_id", conversationId).order("created_at", { ascending: true }).limit(500);
    if (error) fail("listMessages", error);
    return ((data ?? []) as MsgDb[]).map(msg);
  }

  async appendMessage(m: NewMessage) {
    const { data, error } = await this.db.from("agent_messages").insert({
      conversation_id: m.conversationId, role: m.role, content: m.content, model_id: m.modelId, tokens_in: m.tokensIn, tokens_out: m.tokensOut,
    }).select("*").single();
    if (error || !data) fail("appendMessage", error);
    return msg(data as MsgDb);
  }

  async logToolCall(c: NewToolCall) {
    const { data, error } = await this.db.from("agent_tool_calls").insert({
      conversation_id: c.conversationId, message_id: c.messageId, tool: c.tool, input: c.input ?? {}, result: c.result ?? {}, rpc_name: c.rpcName, status: c.status,
    }).select("*").single();
    if (error || !data) fail("logToolCall", error);
    return call(data as CallDb);
  }

  async linkToolCalls(callIds: string[], messageId: string) {
    if (callIds.length === 0) return;
    const { error } = await this.db.from("agent_tool_calls").update({ message_id: messageId }).in("id", callIds);
    if (error) fail("linkToolCalls", error);
  }

  async listToolCalls(conversationId: string) {
    const { data, error } = await this.db.from("agent_tool_calls").select("*").eq("conversation_id", conversationId).order("created_at", { ascending: true }).limit(2000);
    if (error) fail("listToolCalls", error);
    return ((data ?? []) as CallDb[]).map(call);
  }

  async addTokenSpend(conversationId: string, tokens: number) {
    const { data, error } = await this.db.from("agent_conversations").select("token_spend").eq("id", conversationId).single();
    if (error || !data) fail("addTokenSpend", error);
    const { error: e2 } = await this.db.from("agent_conversations").update({ token_spend: Number((data as { token_spend: number }).token_spend) + tokens }).eq("id", conversationId);
    if (e2) fail("addTokenSpend", e2);
  }

  async accountTokensToday(accountId: string, now: Date) {
    // Melbourne day start, measured from the zone (never a hardcoded offset).
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(now);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const localMidnightAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"));
    const nowAsLocalUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
    const offsetMs = now.getTime() - nowAsLocalUtc;
    const dayStart = new Date(localMidnightAsUtc + offsetMs).toISOString();

    const { data: convs, error } = await this.db.from("agent_conversations").select("id").eq("account_id", accountId);
    if (error) fail("accountTokensToday", error);
    const ids = ((convs ?? []) as Array<{ id: string }>).map((c) => c.id);
    if (ids.length === 0) return 0;
    const { data, error: e2 } = await this.db.from("agent_messages").select("tokens_in, tokens_out").in("conversation_id", ids).gte("created_at", dayStart);
    if (e2) fail("accountTokensToday", e2);
    return ((data ?? []) as Array<{ tokens_in: number; tokens_out: number }>).reduce((n, m) => n + m.tokens_in + m.tokens_out, 0);
  }
}

type HandoffDb = { id: string; conversation_id: string; reason: string; status: HandoffRecord["status"]; requested_at: string; claimed_by: string | null; claimed_at: string | null; resolved_at: string | null; escalated_at: string | null; summary: string | null };
const handoff = (r: HandoffDb): HandoffRecord => ({ id: r.id, conversationId: r.conversation_id, reason: r.reason, status: r.status, requestedAt: r.requested_at, claimedBy: r.claimed_by, claimedAt: r.claimed_at, resolvedAt: r.resolved_at, escalatedAt: r.escalated_at, summary: r.summary });

export class SupabaseHandoffs {
  constructor(private readonly db: SupabaseClient) {}
  async requestHandoff(conversationId: string, reason: string): Promise<HandoffRecord> {
    const open = await this.openHandoff(conversationId);
    if (open) return open;
    const { data, error } = await this.db.from("agent_handoffs").insert({ conversation_id: conversationId, reason }).select("*").single();
    if (error || !data) fail("requestHandoff", error);
    const { error: e2 } = await this.db.from("agent_conversations").update({ status: "handed_off" }).eq("id", conversationId);
    if (e2) fail("requestHandoff.status", e2);
    return handoff(data as HandoffDb);
  }
  async openHandoff(conversationId: string): Promise<HandoffRecord | null> {
    const { data, error } = await this.db.from("agent_handoffs").select("*").eq("conversation_id", conversationId).in("status", ["requested", "claimed", "active"]).order("requested_at", { ascending: false }).limit(1).maybeSingle();
    if (error) fail("openHandoff", error);
    return data ? handoff(data as HandoffDb) : null;
  }
  async claimHandoff(handoffId: string, staffId: string, summary: string): Promise<HandoffRecord | null> {
    const { data, error } = await this.db.from("agent_handoffs").update({ status: "active", claimed_by: staffId, claimed_at: new Date().toISOString(), summary }).eq("id", handoffId).in("status", ["requested", "claimed"]).select("*").maybeSingle();
    if (error) fail("claimHandoff", error);
    return data ? handoff(data as HandoffDb) : null;
  }
  async resolveHandoff(handoffId: string): Promise<HandoffRecord | null> {
    const { data, error } = await this.db.from("agent_handoffs").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("id", handoffId).neq("status", "resolved").select("*").maybeSingle();
    if (error) fail("resolveHandoff", error);
    if (!data) return null;
    const h = handoff(data as HandoffDb);
    const { error: e2 } = await this.db.from("agent_conversations").update({ status: "open" }).eq("id", h.conversationId);
    if (e2) fail("resolveHandoff.status", e2);
    return h;
  }
  async markEscalated(handoffId: string, at: Date): Promise<void> {
    const { error } = await this.db.from("agent_handoffs").update({ escalated_at: at.toISOString() }).eq("id", handoffId);
    if (error) fail("markEscalated", error);
  }
  async listHandoffs(status: HandoffRecord["status"][]): Promise<HandoffRecord[]> {
    const { data, error } = await this.db.from("agent_handoffs").select("*").in("status", status).order("requested_at", { ascending: true }).limit(200);
    if (error) fail("listHandoffs", error);
    return ((data ?? []) as HandoffDb[]).map(handoff);
  }
  async createCallback(input: Omit<CallbackRecord, "id" | "status">): Promise<CallbackRecord> {
    const { data, error } = await this.db.from("callback_requests").insert({ conversation_id: input.conversationId, account_id: input.accountId, phone_e164: input.phoneE164, window: input.window, created_for_date: input.createdForDate }).select("*").single();
    if (error || !data) fail("createCallback", error);
    const r = data as { id: string; conversation_id: string; account_id: string | null; phone_e164: string; window: CallbackRecord["window"]; status: CallbackRecord["status"]; created_for_date: string };
    return { id: r.id, conversationId: r.conversation_id, accountId: r.account_id, phoneE164: r.phone_e164, window: r.window, status: r.status, createdForDate: r.created_for_date };
  }
}

export async function loadAgentSettings(db: SupabaseClient, tenantKey = "paint-group"): Promise<AgentSettings> {
  const { data, error } = await db.from("agent_settings").select("*").eq("tenant_key", tenantKey).maybeSingle();
  if (error) fail("loadAgentSettings", error);
  return settingsFromRow(data);
}
