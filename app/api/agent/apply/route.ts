import { NextResponse } from "next/server";
import { z } from "zod";
import { createGateway } from "@/lib/agent/gateway";
import { agentActor, agentDb, loadOwnConversation, uiState } from "@/lib/agent/session";
import { ScopeTools } from "@/lib/agent/scope-tools";
import { NoopTools } from "@/lib/agent/noop";

/**
 * POST /api/agent/apply — commit the pending proposal (co-work, staff only).
 *
 * The same apply_diff tool the model would call, run directly from the
 * panel's button so applying never depends on the model reading "apply".
 * Logged as a tool call on the conversation with a staff note.
 */

export const runtime = "nodejs";

export async function POST(request: Request) {
  const actor = await agentActor();
  if (!actor || actor.kind !== "staff") return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const db = agentDb();
  if (!db) return NextResponse.json({ error: "The assistant isn't available just now." }, { status: 503 });
  const parsed = z.object({ conversationId: z.string().uuid() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });

  const gateway = await createGateway();
  const conv = await loadOwnConversation(gateway.store, parsed.data.conversationId, actor);
  if (!conv || conv.mode !== "cowork" || !conv.estimateId) return NextResponse.json({ error: "No such conversation." }, { status: 404 });

  const tools = new ScopeTools(gateway.scope, gateway.settings, new NoopTools(gateway.settings));
  const result = await tools.execute("apply_diff", { diffId: "pending" }, { conversationId: conv.id, mode: "cowork", view: "staff", estimateId: conv.estimateId, accountId: conv.accountId, actorId: actor.userId });
  const call = await gateway.store.logToolCall({ conversationId: conv.id, messageId: null, tool: "apply_diff", input: { diffId: "pending", by: actor.userId }, result, rpcName: "staff RPC apply diff (logs who applied)", status: result.status });
  const note = result.status === "ok" ? `Applied by staff — ${(result.data as { rows: number }).rows} rows now live.` : result.status === "refused" ? result.reason : result.message;
  const msg = await gateway.store.appendMessage({ conversationId: conv.id, role: "system", content: note, modelId: null, tokensIn: 0, tokensOut: 0 });
  await gateway.store.linkToolCalls([call.id], msg.id);
  const ui = await uiState(gateway.scope, conv.estimateId, "staff", { mode: "cowork", gateCents: gateway.settings.priceImpactGateCents });
  return NextResponse.json({ result, ui, note });
}
