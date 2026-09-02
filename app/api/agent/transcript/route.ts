import { NextResponse } from "next/server";
import { createGateway } from "@/lib/agent/gateway";
import { agentActor, agentDb, displayText, loadOwnConversation } from "@/lib/agent/session";

/** GET /api/agent/transcript?c=… — the owner's (or staff's) current transcript
 *  and status; the live pages refetch on a Realtime event. */
export const runtime = "nodejs";

export async function GET(request: Request) {
  const actor = await agentActor();
  if (!actor) return NextResponse.json({ error: "Sign in first." }, { status: 403 });
  if (!agentDb()) return NextResponse.json({ error: "Not available." }, { status: 503 });
  const id = new URL(request.url).searchParams.get("c") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const gateway = await createGateway();
  const conv = await loadOwnConversation(gateway.store, id, actor);
  if (!conv) return NextResponse.json({ error: "No such conversation." }, { status: 404 });
  const messages = await gateway.store.listMessages(conv.id);
  const handoff = await gateway.store.openHandoff(conv.id);
  return NextResponse.json({
    status: conv.status,
    handoff: handoff ? { status: handoff.status } : null,
    transcript: messages.filter((m) => actor.kind === "staff" || m.role !== "system").map((m) => ({ id: m.id, role: m.role, text: displayText(m.content), createdAt: m.createdAt })),
  });
}
