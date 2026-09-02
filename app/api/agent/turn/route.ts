import { NextResponse } from "next/server";
import { z } from "zod";
import { createGateway } from "@/lib/agent/gateway";
import { accountTypeOf, agentActor, agentDb, displayText, loadOwnConversation, loadOwnEstimate, uiState } from "@/lib/agent/session";
import { docAnswers, docFacts, docWizard } from "@/lib/agent/scope-doc";
import { loadCustomerScope } from "@/lib/wizard/customer-scope";
import { ensureAccountAndProperty } from "@/lib/accounts/link";
import { reportError } from "@/lib/monitoring/report";

/**
 * POST /api/agent/turn — one message from the person, one reply.
 *
 * Body: { conversationId, text, answer?: { key, value } }. A chip tap
 * arrives as `answer`; the gateway carries it on the message as a marker
 * the model turns into answer_gap. The response carries the reply, the UI
 * state (next question, price, thresholds) and the customer scope bundle
 * so the editor beside the chat re-renders the same tree the tools edited.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  conversationId: z.string().uuid(),
  text: z.string().max(4000).default(""),
  answer: z.object({ key: z.string().min(1).max(120), value: z.unknown() }).nullable().optional(),
});

export async function POST(request: Request) {
  const actor = await agentActor();
  if (!actor) return NextResponse.json({ error: "Sign in or start an estimate first." }, { status: 403 });
  const db = agentDb();
  if (!db) return NextResponse.json({ error: "The assistant isn't available just now." }, { status: 503 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const { conversationId, text, answer } = parsed.data;
  if (!text.trim() && !answer) return NextResponse.json({ error: "Say something, or tap an option." }, { status: 400 });

  let gateway;
  try { gateway = await createGateway(); } catch (e) {
    reportError(e, { where: "agent.turn.gateway" });
    return NextResponse.json({ error: "The assistant isn't available just now." }, { status: 503 });
  }
  const conv = await loadOwnConversation(gateway.store, conversationId, actor);
  if (!conv) return NextResponse.json({ error: "No such conversation." }, { status: 404 });

  const result = await gateway.turn({ conversationId, text: text.trim() || "(tapped an option)", actor: "user", answer: answer ?? null });

  // Email captured → the account link (same seed the wizard submit makes).
  if (conv.estimateId && !conv.accountId && conv.mode !== "cowork") {
    try {
      const doc = await gateway.scope.load(conv.estimateId);
      const email = doc ? (docFacts(doc).email ?? docWizard(doc)?.customer?.email ?? docAnswers(doc).customer?.email ?? null) : null;
      if (doc && email) {
        const address = docWizard(doc)?.address ?? docAnswers(doc).address ?? null;
        const linked = await ensureAccountAndProperty(db, { email, address: address ? { street: address.street, suburb: address.suburb, postcode: address.postcode, state: address.state } : undefined });
        if (linked.accountId) {
          await db.from("agent_conversations").update({ account_id: linked.accountId, ...(linked.propertyId ? { property_id: linked.propertyId } : {}) }).eq("id", conversationId);
          await db.from("estimates").update({ account_id: linked.accountId, ...(linked.propertyId ? { property_id: linked.propertyId } : {}) }).eq("id", conv.estimateId);
          const { data: acct } = await db.from("accounts").select("account_type").eq("id", linked.accountId).maybeSingle();
          const type = accountTypeOf(acct as { account_type?: string } | null);
          if (type) {
            const agent = (doc.builderState.agent ?? {}) as { answers?: unknown; facts?: Record<string, unknown> };
            await gateway.scope.save({ ...doc, builderState: { ...doc.builderState, agent: { answers: agent.answers ?? {}, facts: { ...(agent.facts ?? {}), accountType: type } } } });
          }
        }
      }
    } catch (e) {
      reportError(e, { where: "agent.turn.accountLink", bestEffort: true });
    }
  }

  const cowork = conv.mode === "cowork";
  const ui = conv.estimateId
    ? await uiState(gateway.scope, conv.estimateId, conv.view, { mode: cowork ? "cowork" : "guided", gateCents: gateway.settings.priceImpactGateCents })
    : { built: false, nextGap: null, price: null, thresholds: null, proposal: null };
  let bundle = null;
  if (conv.estimateId && ui.built && conv.mode === "guided") {
    const est = await loadOwnEstimate(db, conv.estimateId, actor);
    if (est) bundle = await loadCustomerScope(db, est);
  }
  const transcript = (await gateway.store.listMessages(conversationId))
    .filter((m) => m.role !== "system")
    .map((m) => ({ id: m.id, role: m.role, text: displayText(m.content), createdAt: m.createdAt }));

  return NextResponse.json({ reply: result.text, degraded: result.degraded, ui, bundle, transcript });
}
