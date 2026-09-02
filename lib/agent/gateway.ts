import "server-only";
/**
 * The AI gateway (parent brief S1): the ONLY place the assistant's model,
 * store and tools are bound together for production. Server-only — the
 * lint rule in eslint.config.mjs keeps it out of pages and components; reach
 * it from app/api/agent/** route handlers.
 *
 * S1 binds NoopTools. S3 replaces them with the scope/pricing bindings; the
 * loop (turn.ts) does not change.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { AnthropicModelClient } from "./model-anthropic";
import { SupabaseAgentStore, loadAgentSettings } from "./store-supabase";
import { NoopTools } from "./noop";
import { runTurn, type TurnInput, type TurnResult } from "./turn";
import type { ToolExecutor } from "./schemas";
import type { AgentSettings } from "./settings";
import type { NewConversation, ConversationRow } from "./store";

export type Gateway = {
  settings: AgentSettings;
  startConversation(input: NewConversation): Promise<ConversationRow>;
  turn(input: TurnInput): Promise<TurnResult>;
};

export async function createGateway(opts: { tools?: (settings: AgentSettings) => ToolExecutor } = {}): Promise<Gateway> {
  const db = createServiceClient();
  if (!db) throw new Error("agent gateway: SUPABASE_SERVICE_ROLE_KEY is not set");
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("agent gateway: ANTHROPIC_API_KEY is not set");
  const settings = await loadAgentSettings(db);
  const store = new SupabaseAgentStore(db);
  const model = new AnthropicModelClient();
  const tools = opts.tools ? opts.tools(settings) : new NoopTools(settings);
  return {
    settings,
    startConversation: (input) => store.createConversation(input),
    turn: (input) => runTurn({ model, tools, store, settings }, input),
  };
}
