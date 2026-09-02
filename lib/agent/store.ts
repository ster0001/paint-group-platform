/**
 * The persistence the gateway needs, as an interface — so the loop is
 * testable against memory and runs against Supabase (store-supabase.ts,
 * server-only) unchanged. Rule from §5: messages are persisted FIRST, the
 * reply is generated second.
 */

import type { AgentChannel, AgentMode, AgentView, ToolResult } from "./schemas";

export type ConversationStatus = "open" | "handed_off" | "closed";

export type ConversationRow = {
  id: string;
  accountId: string | null;
  propertyId: string | null;
  estimateId: string | null;
  channel: AgentChannel;
  mode: AgentMode;
  view: AgentView;
  status: ConversationStatus;
  tokenSpend: number;
  createdBy: string | null;
  anonToken: string | null;
  externalThreadId: string | null;
};

export type MessageRole = "user" | "assistant" | "staff" | "system";

export type MessageRow = {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  modelId: string | null;
  tokensIn: number;
  tokensOut: number;
  createdAt: string;
};

export type ToolCallRow = {
  id: string;
  conversationId: string;
  messageId: string | null;
  tool: string;
  input: unknown;
  result: ToolResult | Record<string, unknown>;
  rpcName: string | null;
  status: "ok" | "refused" | "error";
  createdAt: string;
};

export type NewConversation = Omit<ConversationRow, "id" | "tokenSpend" | "status"> & { status?: ConversationStatus };
export type NewMessage = Omit<MessageRow, "id" | "createdAt">;
export type NewToolCall = Omit<ToolCallRow, "id" | "createdAt">;

export interface AgentStore {
  getConversation(id: string): Promise<ConversationRow | null>;
  createConversation(input: NewConversation): Promise<ConversationRow>;
  setStatus(conversationId: string, status: ConversationStatus): Promise<void>;
  listMessages(conversationId: string): Promise<MessageRow[]>;
  appendMessage(msg: NewMessage): Promise<MessageRow>;
  logToolCall(call: NewToolCall): Promise<ToolCallRow>;
  /** Tool calls are logged as they happen, before the assistant message
   *  exists; once it does, they are stitched to it. */
  linkToolCalls(callIds: string[], messageId: string): Promise<void>;
  listToolCalls(conversationId: string): Promise<ToolCallRow[]>;
  addTokenSpend(conversationId: string, tokens: number): Promise<void>;
  /** Tokens this account has spent today (Melbourne calendar day). */
  accountTokensToday(accountId: string, now: Date): Promise<number>;
}

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

/** Melbourne calendar-day key — never toISOString().slice(0,10) (CLAUDE.md). */
export function melbourneDayKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export class MemoryAgentStore implements AgentStore {
  conversations = new Map<string, ConversationRow>();
  messages: MessageRow[] = [];
  toolCalls: ToolCallRow[] = [];
  /** Test hook: the clock the store timestamps with. */
  now: () => Date = () => new Date();

  async getConversation(id: string) { return this.conversations.get(id) ?? null; }
  async createConversation(input: NewConversation) {
    const row: ConversationRow = { ...input, id: nextId("conv"), tokenSpend: 0, status: input.status ?? "open" };
    this.conversations.set(row.id, row);
    return row;
  }
  async setStatus(conversationId: string, status: ConversationStatus) {
    const c = this.conversations.get(conversationId);
    if (c) c.status = status;
  }
  async listMessages(conversationId: string) {
    return this.messages.filter((m) => m.conversationId === conversationId);
  }
  async appendMessage(msg: NewMessage) {
    const row: MessageRow = { ...msg, id: nextId("msg"), createdAt: this.now().toISOString() };
    this.messages.push(row);
    return row;
  }
  async logToolCall(call: NewToolCall) {
    const row: ToolCallRow = { ...call, id: nextId("call"), createdAt: this.now().toISOString() };
    this.toolCalls.push(row);
    return row;
  }
  async linkToolCalls(callIds: string[], messageId: string) {
    for (const c of this.toolCalls) if (callIds.includes(c.id)) c.messageId = messageId;
  }
  async listToolCalls(conversationId: string) {
    return this.toolCalls.filter((c) => c.conversationId === conversationId);
  }
  async addTokenSpend(conversationId: string, tokens: number) {
    const c = this.conversations.get(conversationId);
    if (c) c.tokenSpend += tokens;
  }
  async accountTokensToday(accountId: string, now: Date) {
    const day = melbourneDayKey(now);
    const convIds = new Set([...this.conversations.values()].filter((c) => c.accountId === accountId).map((c) => c.id));
    return this.messages
      .filter((m) => convIds.has(m.conversationId) && melbourneDayKey(new Date(m.createdAt)) === day)
      .reduce((n, m) => n + m.tokensIn + m.tokensOut, 0);
  }
}
