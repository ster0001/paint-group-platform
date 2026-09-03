import "server-only";
/**
 * The AI gateway (parent brief S1): the ONLY place the assistant's model,
 * store and tools are bound together for production. Server-only — the
 * lint rule in eslint.config.mjs keeps it out of pages and components; reach
 * it from app/api/agent/** route handlers.
 *
 * S3 binds the scope/pricing tools (ScopeTools over the estimates table);
 * anything not yet bound (documents, Brain, visits, handoff) falls through
 * to NoopTools until its session lands. The loop (turn.ts) never changes.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { AnthropicModelClient } from "./model-anthropic";
import { StubModel } from "./model-stub";
import { extractBrief } from "./brief-extract";
import { sendSms } from "@/lib/messaging/send";
import { SupabaseAgentStore, loadAgentSettings } from "./store-supabase";
import { NoopTools } from "./noop";
import { ScopeTools } from "./scope-tools";
import { SupabaseScopeStore } from "./scope-store-supabase";
import { runTurn, type TurnInput, type TurnResult } from "./turn";
import type { ToolExecutor } from "./schemas";
import type { AgentSettings } from "./settings";
import type { NewConversation, ConversationRow } from "./store";
import { automationOn } from "@/lib/messaging/config";
import { loadMessaging } from "@/lib/messaging/load";

export type Gateway = {
  settings: AgentSettings;
  store: SupabaseAgentStore;
  scope: SupabaseScopeStore;
  startConversation(input: NewConversation): Promise<ConversationRow>;
  turn(input: TurnInput): Promise<TurnResult>;
};

/** AGENT_MODEL_STUB=1 swaps the phrasing layer for templates (the C1 test
 *  stack / CI). Everything else runs exactly as in production. */
export const usingStubModel = () => process.env.AGENT_MODEL_STUB === "1";

export async function createGateway(opts: { tools?: (settings: AgentSettings) => ToolExecutor } = {}): Promise<Gateway> {
  const db = createServiceClient();
  if (!db) throw new Error("agent gateway: SUPABASE_SERVICE_ROLE_KEY is not set");
  if (!usingStubModel() && !process.env.ANTHROPIC_API_KEY) throw new Error("agent gateway: ANTHROPIC_API_KEY is not set");
  const settings = await loadAgentSettings(db);
  const store = new SupabaseAgentStore(db);
  const scope = new SupabaseScopeStore(db);
  const model = usingStubModel() ? new StubModel() : new AnthropicModelClient();
  // Settings → Automations: "Assistant — someone wants a person". Off = the
  // handoff card still appears in Today → Messages; nobody is texted.
  const notify = async (to: string[], body: string) => {
    if (!automationOn((await loadMessaging(db)).messaging, "assistant_handoff")) return;
    await Promise.all(to.map((n) => sendSms({ to: n, body }).catch(() => undefined)));
  };
  const tools = opts.tools ? opts.tools(settings) : new ScopeTools(scope, settings, new NoopTools(settings), () => new Date(), (text) => extractBrief(model, settings.modelHeavy, text), store, notify);
  return {
    settings,
    store,
    scope,
    startConversation: (input) => store.createConversation(input),
    turn: (input) => runTurn({ model, tools, store, settings }, input),
  };
}
