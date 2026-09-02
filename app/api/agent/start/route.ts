import { NextResponse } from "next/server";
import { z } from "zod";
import { createGateway } from "@/lib/agent/gateway";
import { accountTypeOf, agentActor, agentDb, createDraftEstimate, loadOwnEstimate } from "@/lib/agent/session";
import { graphInput } from "@/lib/agent/scope-doc";
import { nextGap } from "@/lib/agent/question-graph";
import { logCrmEvent } from "@/lib/crm/events";
import { reportError } from "@/lib/monitoring/report";

/**
 * POST /api/agent/start — begin (or resume) a guided conversation.
 *
 * Body: { estimateId?: string }. Without one, a blank customer_intake draft
 * is created for this actor; with one, the actor must own it. The reply is
 * the conversation id and the estimate id; the greeting (disclosure + the
 * graph's first question) is seeded straight from the tools, no model call.
 */

export const runtime = "nodejs";

const bodySchema = z.object({ estimateId: z.string().uuid().optional() });

export async function POST(request: Request) {
  const actor = await agentActor();
  if (!actor) return NextResponse.json({ error: "Sign in or start an estimate first." }, { status: 403 });
  const db = agentDb();
  if (!db) return NextResponse.json({ error: "The assistant isn't available just now." }, { status: 503 });

  const raw = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw ?? {});
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });

  let gateway;
  try { gateway = await createGateway(); } catch (e) {
    reportError(e, { where: "agent.start.gateway" });
    return NextResponse.json({ error: "The assistant isn't available just now." }, { status: 503 });
  }

  // The account (and its type) when the actor has a verified email.
  let accountId: string | null = null;
  let accountType: "residential" | "trade" | null = null;
  if (actor.verifiedEmail) {
    const { data: acct } = await db.from("accounts").select("id, account_type").eq("email", actor.verifiedEmail).maybeSingle();
    accountId = (acct as { id?: string } | null)?.id ?? null;
    accountType = accountTypeOf(acct as { account_type?: string } | null);
  }

  let estimateId: string;
  if (parsed.data.estimateId) {
    const est = await loadOwnEstimate(db, parsed.data.estimateId, actor);
    if (!est) return NextResponse.json({ error: "No such estimate." }, { status: 404 });
    estimateId = est.id;
    // Resume an open conversation on this estimate if the actor has one.
    const { data: existing } = await db.from("agent_conversations").select("id")
      .eq("estimate_id", estimateId).eq("created_by", actor.userId).eq("status", "open")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (existing?.id) return NextResponse.json({ conversationId: existing.id as string, estimateId, resumed: true });
  } else {
    estimateId = await createDraftEstimate(db, actor, accountType, accountId);
  }

  const conv = await gateway.startConversation({
    accountId, propertyId: null, estimateId, channel: "portal", mode: "guided", view: "customer",
    createdBy: actor.userId, anonToken: null, externalThreadId: null,
  });

  // The greeting: disclosure + the first question, straight off the graph.
  const doc = await gateway.scope.load(estimateId);
  let greeting = gateway.settings.disclosureText;
  if (doc) {
    const deps = { refs: await gateway.scope.refs(), ctx: await gateway.scope.ctx(), actor: "customer" as const };
    const gap = nextGap(graphInput(doc, deps));
    const call = await gateway.store.logToolCall({ conversationId: conv.id, messageId: null, tool: "next_gap", input: {}, result: { status: "ok", data: { gap } }, rpcName: "lib/agent/question-graph nextGap", status: "ok" });
    if (gap) greeting = `${greeting} ${gap.phrasingHint}`;
    const msg = await gateway.store.appendMessage({ conversationId: conv.id, role: "assistant", content: greeting, modelId: null, tokensIn: 0, tokensOut: 0 });
    await gateway.store.linkToolCalls([call.id], msg.id);
  }

  // Drop-outs are leads (§3.1): the conversation is a wizard start.
  await logCrmEvent(db, { type: "wizard_started", accountId, estimateId, source: "customer", payload: { mode: "customer" } }).catch(() => null);

  return NextResponse.json({ conversationId: conv.id, estimateId });
}
