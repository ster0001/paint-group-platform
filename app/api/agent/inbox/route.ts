import { NextResponse } from "next/server";
import { agentActor, agentDb, displayText } from "@/lib/agent/session";
import { SupabaseAgentStore } from "@/lib/agent/store-supabase";

/**
 * GET /api/agent/inbox — every chat waiting for, or live with, a person
 * (Tom, 8 Sep: the chat pops up in the corner of whichever staff screen you
 * are on). One row per open hand-off: who, their last line, when, and
 * whether someone has claimed it. Staff only; the dock polls it and a
 * Realtime insert on agent_messages refreshes it sooner.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type InboxRow = {
  conversationId: string; handoffId: string; status: string; reason: string; requestedAt: string;
  claimedBy: string | null; mine: boolean;
  who: string; phone: string | null; accountId: string | null; estimateId: string | null;
  lastText: string; lastRole: string; lastAt: string; lastId: string; lastCustomerAt: string | null;
};

export async function GET() {
  const actor = await agentActor();
  if (!actor || actor.kind !== "staff") return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const db = agentDb();
  if (!db) return NextResponse.json({ rows: [] });
  const store = new SupabaseAgentStore(db);
  // Open hand-offs from the last three days (older ones are dead chats —
  // Today still lists them), newest 60; the last lines across them in ONE
  // read (a transcript read per chat timed out on the test project).
  const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const handoffs = (await store.listHandoffs(["requested", "claimed", "active"])).filter((h) => h.requestedAt >= since).slice(-60);
  if (handoffs.length === 0) return NextResponse.json({ rows: [] });
  const ids = handoffs.map((h) => h.conversationId);
  const { data: recent } = await db.from("agent_messages").select("id, conversation_id, role, content, created_at")
    .in("conversation_id", ids).neq("role", "system").order("created_at", { ascending: false }).limit(400);
  type M = { id: string; conversation_id: string; role: string; content: string; created_at: string };
  const lastOf = new Map<string, M>(), lastCustomerOf = new Map<string, M>();
  for (const m of (recent ?? []) as M[]) {
    if (!lastOf.has(m.conversation_id)) lastOf.set(m.conversation_id, m);
    if (m.role === "user" && !lastCustomerOf.has(m.conversation_id)) lastCustomerOf.set(m.conversation_id, m);
  }
  const { data: convs } = await db.from("agent_conversations").select("id, account_id, estimate_id, status, accounts(name, phone, email)").in("id", ids);
  type Conv = { id: string; account_id: string | null; estimate_id: string | null; status: string; accounts?: { name: string | null; phone: string | null; email: string | null } | null };
  const byConv = new Map(((convs ?? []) as unknown as Conv[]).map((c) => [c.id, c]));
  const rows: InboxRow[] = [];
  for (const h of handoffs) {
    const c = byConv.get(h.conversationId);
    if (!c || c.status === "closed") continue;
    const last = lastOf.get(h.conversationId);
    const lastCustomer = lastCustomerOf.get(h.conversationId);
    const acct = c.accounts ?? null;
    rows.push({
      conversationId: h.conversationId, handoffId: h.id, status: h.status, reason: h.reason, requestedAt: h.requestedAt,
      claimedBy: h.claimedBy, mine: h.claimedBy === actor.userId,
      who: acct?.name?.trim() || acct?.email || "Website visitor", phone: acct?.phone ?? null, accountId: c.account_id, estimateId: c.estimate_id,
      lastText: last ? displayText(last.content).slice(0, 160) : "", lastRole: last?.role ?? "user", lastAt: last?.created_at ?? h.requestedAt, lastId: last?.id ?? h.id,
      lastCustomerAt: lastCustomer?.created_at ?? null,
    });
  }
  rows.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  return NextResponse.json({ rows });
}
