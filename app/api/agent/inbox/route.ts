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
  /** Tom, 20 Sep: "estimate" rows are the estimate chat (estimate_messages), keyed est:<estimateId>. */
  kind?: "agent" | "estimate";
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
  const estimateRows = await estimateChatRows(db, since, actor.userId);
  if (handoffs.length === 0) return NextResponse.json({ rows: estimateRows });
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
  return NextResponse.json({ rows: [...rows, ...estimateRows] });
}

/**
 * Tom, 20 Sep: "all messages the customer sends in the chat are sent to the
 * chat in the software". Every estimate thread with a customer line in the
 * last three days is a dock row: Waiting while their last line is
 * unanswered, Live once a person has replied. One read for the messages,
 * one for the estimates they belong to.
 */
async function estimateChatRows(db: NonNullable<ReturnType<typeof agentDb>>, since: string, userId: string): Promise<InboxRow[]> {
  void userId;
  type M = { id: string; estimate_id: string; direction: "customer" | "staff"; body: string; created_at: string };
  const { data: recent, error: mErr } = await db.from("estimate_messages").select("id, estimate_id, direction, body, created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(400);
  if (mErr) throw mErr;
  const msgs = (recent ?? []) as M[];
  const withCustomer = new Set(msgs.filter((m) => m.direction === "customer").map((m) => m.estimate_id));
  if (withCustomer.size === 0) return [];
  const ids = [...withCustomer].slice(0, 60);
  // The thread's true last line may be older than the window (a staff reply
  // before `since` cannot outrank a customer line inside it, so the window is enough).
  const lastOf = new Map<string, M>(), lastCustomerOf = new Map<string, M>(), firstCustomerOf = new Map<string, M>();
  for (const m of msgs) {
    if (!lastOf.has(m.estimate_id)) lastOf.set(m.estimate_id, m);
    if (m.direction === "customer") { if (!lastCustomerOf.has(m.estimate_id)) lastCustomerOf.set(m.estimate_id, m); firstCustomerOf.set(m.estimate_id, m); }
  }
  const { data: ests, error: eErr } = await db.from("estimates").select("id, title, account_id, builder_state, sent_snapshot, accounts(name, phone, email)").in("id", ids);
  if (eErr) throw eErr;
  type E = { id: string; title: string | null; account_id: string | null; builder_state: { contact?: { name?: string | null; phone?: string | null } } | null; sent_snapshot: { contactName?: string; jobAddress?: string } | null; accounts?: { name: string | null; phone: string | null; email: string | null } | null };
  const rows: InboxRow[] = [];
  for (const e of ((ests ?? []) as unknown as E[])) {
    const last = lastOf.get(e.id)!;
    const lastCustomer = lastCustomerOf.get(e.id)!;
    const first = firstCustomerOf.get(e.id)!;
    const name = (e.sent_snapshot?.contactName || e.builder_state?.contact?.name || e.accounts?.name || "").trim();
    const job = (e.sent_snapshot?.jobAddress || e.title || "").trim();
    rows.push({
      kind: "estimate",
      conversationId: `est:${e.id}`, handoffId: "", status: last.direction === "customer" ? "requested" : "active", reason: "estimate_chat", requestedAt: first.created_at,
      claimedBy: null, mine: false,
      who: [name || "Customer", job].filter(Boolean).join(" · "), phone: e.builder_state?.contact?.phone ?? e.accounts?.phone ?? null, accountId: e.account_id, estimateId: e.id,
      lastText: last.body.slice(0, 160), lastRole: last.direction === "customer" ? "user" : "staff", lastAt: last.created_at, lastId: last.id, lastCustomerAt: lastCustomer.created_at,
    });
  }
  return rows.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}
