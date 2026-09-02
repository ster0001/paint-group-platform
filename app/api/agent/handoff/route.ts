import { NextResponse } from "next/server";
import { z } from "zod";
import { createGateway } from "@/lib/agent/gateway";
import { agentActor, agentDb } from "@/lib/agent/session";
import { handoffSummary, RESUME_TEXT } from "@/lib/agent/handoff";
import { priceScope } from "@/lib/agent/scope-tools";
import { isBuilt } from "@/lib/agent/scope-doc";
import { parseAnswerMarker } from "@/lib/agent/model-stub";

/**
 * POST /api/agent/handoff — the staff side of a live chat (S7).
 *   claim   → handoff active, a 3-line summary posted for the person
 *   reply   → a staff message into the SAME transcript (single-threaded)
 *   resolve → handoff resolved, conversation open, the assistant resumes
 * Messages are persisted before anything else; Realtime carries them.
 */

export const runtime = "nodejs";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("claim"), conversationId: z.string().uuid() }),
  z.object({ action: z.literal("reply"), conversationId: z.string().uuid(), text: z.string().trim().min(1).max(4000) }),
  z.object({ action: z.literal("resolve"), conversationId: z.string().uuid() }),
]);

export async function POST(request: Request) {
  const actor = await agentActor();
  if (!actor || actor.kind !== "staff") return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const db = agentDb();
  if (!db) return NextResponse.json({ error: "Not available." }, { status: 503 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const body = parsed.data;
  const gateway = await createGateway();
  const store = gateway.store;
  const conv = await store.getConversation(body.conversationId);
  if (!conv) return NextResponse.json({ error: "No such conversation." }, { status: 404 });

  if (body.action === "claim") {
    const open = await store.openHandoff(conv.id);
    if (!open) return NextResponse.json({ error: "Nothing to claim." }, { status: 409 });
    const messages = await store.listMessages(conv.id);
    const [est, acct] = await Promise.all([
      conv.estimateId ? db.from("estimates").select("title").eq("id", conv.estimateId).maybeSingle() : Promise.resolve({ data: null }),
      conv.accountId ? db.from("accounts").select("name").eq("id", conv.accountId).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    let priceLine: string | null = null;
    if (conv.estimateId) {
      const doc = await gateway.scope.load(conv.estimateId);
      if (doc && isBuilt(doc)) {
        const p = priceScope(doc, { refs: await gateway.scope.refs(), ctx: await gateway.scope.ctx(), actor: "staff" });
        priceLine = `Range $${Math.round(p.loCents / 100).toLocaleString("en-AU")} – $${Math.round(p.hiCents / 100).toLocaleString("en-AU")} (${Math.round(p.accuracyPct)}% settled).`;
      }
    }
    const summary = handoffSummary({
      estimateTitle: (est.data as { title?: string } | null)?.title ?? null,
      customerName: (acct.data as { name?: string } | null)?.name ?? null,
      lastUserMessages: messages.filter((m) => m.role === "user").map((m) => parseAnswerMarker(m.content)?.text ?? m.content),
      priceLine, reason: open.reason,
    });
    const h = await store.claimHandoff(open.id, actor.userId, summary);
    if (!h) return NextResponse.json({ error: "Already claimed." }, { status: 409 });
    await store.appendMessage({ conversationId: conv.id, role: "system", content: `Claimed by staff.\n${summary}`, modelId: null, tokensIn: 0, tokensOut: 0 });
    return NextResponse.json({ handoff: h });
  }

  if (body.action === "reply") {
    if (conv.status === "closed") return NextResponse.json({ error: "Closed." }, { status: 409 });
    const msg = await store.appendMessage({ conversationId: conv.id, role: "staff", content: body.text, modelId: null, tokensIn: 0, tokensOut: 0 });
    // A reply without a claim IS a join (§5: staff can join any conversation).
    const open = await store.openHandoff(conv.id);
    if (open && open.status === "requested") await store.claimHandoff(open.id, actor.userId, "Joined from the console.");
    if (!open && conv.status !== "handed_off") await store.requestHandoff(conv.id, "staff_joined").then((h) => store.claimHandoff(h.id, actor.userId, "Joined from the console."));
    return NextResponse.json({ message: msg });
  }

  // resolve
  const open = await store.openHandoff(conv.id);
  if (open) await store.resolveHandoff(open.id);
  else await store.setStatus(conv.id, "open");
  await store.appendMessage({ conversationId: conv.id, role: "assistant", content: RESUME_TEXT, modelId: null, tokensIn: 0, tokensOut: 0 });
  return NextResponse.json({ resolved: true });
}
