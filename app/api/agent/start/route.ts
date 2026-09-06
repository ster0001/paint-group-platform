import { NextResponse } from "next/server";
import { z } from "zod";
import { createGateway } from "@/lib/agent/gateway";
import { accountTypeOf, agentActor, agentDb, createDraftEstimate, loadOwnEstimate } from "@/lib/agent/session";
import { graphInput, isBuilt } from "@/lib/agent/scope-doc";
import { nextGap } from "@/lib/agent/question-graph";
import { logCrmEvent } from "@/lib/crm/events";
import { ScopeTools } from "@/lib/agent/scope-tools";
import { NoopTools } from "@/lib/agent/noop";
import { reportError } from "@/lib/monitoring/report";
import { createHash } from "node:crypto";
import { finishDescribedEstimate } from "@/lib/wizard/describeFinish";

/**
 * POST /api/agent/start — begin (or resume) a guided conversation.
 *
 * Body: { estimateId?: string }. Without one, a blank customer_intake draft
 * is created for this actor; with one, the actor must own it. The reply is
 * the conversation id and the estimate id; the greeting (disclosure + the
 * graph's first question) is seeded straight from the tools, no model call.
 */

export const runtime = "nodejs";

const bodySchema = z.object({
  estimateId: z.string().uuid().optional(),
  brief: z.string().trim().max(20000).optional(),
  /** Tom, 7 Sep: the describe path still asks name/phone/email last — they
   * ride the build request so the estimate joins the customer record. */
  contact: z.object({ name: z.string().trim().max(120).default(""), email: z.string().trim().max(200).default(""), phone: z.string().trim().max(30).default("") }).optional(),
  address: z.object({ street: z.string().max(120).default(""), suburb: z.string().max(80).default(""), postcode: z.string().max(10).default(""), state: z.string().max(10).default("VIC"), formatted: z.string().max(250).default("") }).nullable().optional(),
});

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

  // A known address lands first (the service-area check runs with it).
  const addr = parsed.data.address;
  if (addr && (addr.suburb || addr.postcode)) {
    const tools = new ScopeTools(gateway.scope, gateway.settings, new NoopTools(gateway.settings));
    await tools.execute("answer_gap", { key: "q.address", value: addr, provenance: "customer_stated" }, { conversationId: conv.id, mode: "guided", view: "customer", estimateId, accountId, actorId: actor.userId }).catch(() => undefined);
  }

  // Addendum A §3.3 "Describe the job": the paragraph IS the first turn —
  // the draft tree lands at once, priced as a range with every assumption a chip.
  let built = false;
  if (parsed.data.brief && parsed.data.brief.length >= 20) {
    // Tom, 7 Sep: ONE request builds the estimate and the customer lands
    // STRAIGHT in the editor. The build is deterministic — propose_diff
    // (one extraction call, applied straight on the customer's own draft) —
    // not left to the model's choice of tools, which once recorded the
    // facts one by one and never built. The chat interview is the fallback
    // when the paragraph was not enough to build from.
    const ctx = { conversationId: conv.id, mode: "guided" as const, view: "customer" as const, estimateId, accountId, actorId: actor.userId };
    let proposed: Awaited<ReturnType<typeof gateway.tools.execute>> | null = null;
    try { proposed = await gateway.tools.execute("propose_diff", { text: parsed.data.brief, sourceKind: "paste" }, ctx); }
    catch (e) { reportError(e, { where: "agent.start.propose", bestEffort: true }); }
    const after = await gateway.scope.load(estimateId);
    built = after ? isBuilt(after) : false;
    if (built && proposed) {
      const contact = parsed.data.contact;
      const email = actor.verifiedEmail ?? contact?.email?.trim().toLowerCase() ?? "";
      if (email.includes("@")) {
        const ipHash = createHash("sha256")
          .update(`${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"}::${process.env.WIZARD_IP_SALT ?? "pg-wizard"}`)
          .digest("hex").slice(0, 32);
        await finishDescribedEstimate(db, {
          estimateId, userId: actor.userId, verifiedEmail: actor.verifiedEmail,
          contact: { name: contact?.name ?? "", email, phone: contact?.phone ?? "" },
          address: addr && (addr.street || addr.suburb) ? { street: addr.street, suburb: addr.suburb, state: addr.state, postcode: addr.postcode, formatted: addr.formatted || [addr.street, addr.suburb, addr.state, addr.postcode].filter(Boolean).join(" ") } : null,
          suburb: addr?.suburb ?? "", postcode: addr?.postcode ?? "", ipHash,
        });
      }
      const userMsg = await gateway.store.appendMessage({ conversationId: conv.id, role: "user", content: parsed.data.brief, modelId: null, tokensIn: 0, tokensOut: 0 });
      const call = await gateway.store.logToolCall({ conversationId: conv.id, messageId: userMsg.id, tool: "propose_diff", input: { sourceKind: "paste" }, result: proposed, rpcName: "lib/agent/propose", status: proposed.status });
      const reply = await gateway.store.appendMessage({ conversationId: conv.id, role: "assistant", content: "Built from your description — every assumption is marked in your estimate, and you can change anything there.", modelId: null, tokensIn: 0, tokensOut: 0 });
      await gateway.store.linkToolCalls([call.id], reply.id);
    } else {
      try { await gateway.turn({ conversationId: conv.id, text: parsed.data.brief, actor: "user", heavy: true }); }
      catch (e) { reportError(e, { where: "agent.start.brief", bestEffort: true }); }
      const retry = await gateway.scope.load(estimateId);
      built = retry ? isBuilt(retry) : false;
    }
  }

  return NextResponse.json({ conversationId: conv.id, estimateId, built });
}
