import { createClient } from "@/lib/supabase/server";
import { settingsFromRow } from "@/lib/agent/settings";
import { costCents, dropOffByGap, handoffRate, type SpendRow } from "@/lib/agent/evals/metrics";

/**
 * /admin/agent — spend, handoff rate, drop-off by gap key (S8). Staff shell;
 * reads the agent tables under the staff session (RLS). Every figure is a
 * derivation of rows the assistant already writes — nothing is stored twice.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Assistant · admin" };

const fmtAud = (c: number) => `$${(c / 100).toFixed(2)}`;
const daysAgoIso = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

export default async function AgentAdminPage() {
  const supabase = await createClient();
  const since30 = daysAgoIso(30);
  const [settingsRes, convs, msgs, handoffs, calls, prepPacks] = await Promise.all([
    supabase.from("agent_settings").select("*").eq("tenant_key", "paint-group").maybeSingle(),
    supabase.from("agent_conversations").select("id, mode, channel, status, created_at, estimate_id").gte("created_at", since30).limit(2000),
    supabase.from("agent_messages").select("conversation_id, model_id, tokens_in, tokens_out, created_at").gte("created_at", since30).limit(20000),
    supabase.from("agent_handoffs").select("id, conversation_id, status, requested_at, escalated_at").gte("requested_at", since30).limit(2000),
    supabase.from("agent_tool_calls").select("conversation_id, tool, result, created_at").eq("tool", "next_gap").gte("created_at", since30).order("created_at", { ascending: true }).limit(20000),
    supabase.from("estimates").select("id, builder_state->prepPack").not("builder_state->prepPack", "is", null).limit(2000),
  ]);
  const settings = settingsFromRow(settingsRes.data);
  const conversations = (convs.data ?? []) as Array<{ id: string; mode: string; channel: string; status: string; created_at: string; estimate_id: string | null }>;
  const messages = (msgs.data ?? []) as Array<SpendRow & { conversation_id: string }>;
  const hs = (handoffs.data ?? []) as Array<{ id: string; conversation_id: string; status: string; escalated_at: string | null }>;
  const completedEstimates = new Set(((prepPacks.data ?? []) as Array<{ id: string }>).map((e) => e.id));

  // Spend by Melbourne day.
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" });
  const byDay = new Map<string, SpendRow[]>();
  for (const m of messages) { const k = day.format(new Date(m.created_at)); byDay.set(k, [...(byDay.get(k) ?? []), m]); }
  const spendRows = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 14).map(([d, rows]) => ({ day: d, tokens: rows.reduce((n, r) => n + r.tokens_in + r.tokens_out, 0), cents: costCents(rows, settings.modelPrices) }));
  const totalCents = costCents(messages, settings.modelPrices);

  // Completed guided estimates = a guided conversation whose estimate has a prep pack (accepted or booked).
  const guided = conversations.filter((c) => c.mode === "guided");
  const completed = guided.filter((c) => c.estimate_id && completedEstimates.has(c.estimate_id));
  const guidedMsgs = messages.filter((m) => guided.some((c) => c.id === m.conversation_id));
  const costPerCompleted = completed.length ? Math.round(costCents(guidedMsgs, settings.modelPrices) / completed.length) : null;

  // Drop-off: the last next_gap asked in each unfinished guided conversation.
  const lastGap = new Map<string, string | null>();
  for (const c of (calls.data ?? []) as Array<{ conversation_id: string; result: { data?: { gap?: { key?: string } | null } } | null }>) {
    lastGap.set(c.conversation_id, c.result?.data?.gap?.key ?? null);
  }
  const drop = dropOffByGap(guided.map((c) => ({ conversationId: c.id, gapKey: lastGap.get(c.id) ?? null, completed: completed.some((x) => x.id === c.id) })));

  const byMode = ["guided", "cowork", "support"].map((m) => ({ mode: m, n: conversations.filter((c) => c.mode === m).length }));
  const byChannel = ["portal", "staff", "website", "meta"].map((ch) => ({ channel: ch, n: conversations.filter((c) => c.channel === ch).length }));
  const rate = handoffRate(conversations.length, hs.length);
  const escalated = hs.filter((h) => h.escalated_at).length;

  return (
    <div style={{ padding: 16, maxWidth: 1000 }}>
      <h1>Assistant — last 30 days</h1>
      <p className="sub">Models: {settings.modelDefault} (default) · {settings.modelHeavy} (heavy). Budgets: {settings.budgetTokensPerConversation.toLocaleString()} tokens / conversation · {settings.dailyCapPerAccount.toLocaleString()} / account / day.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, margin: "14px 0" }}>
        <Tile label="Conversations" value={String(conversations.length)} sub={byMode.map((m) => `${m.mode} ${m.n}`).join(" · ")} />
        <Tile label="Estimated spend" value={fmtAud(totalCents)} sub={`${messages.reduce((n, m) => n + m.tokens_in + m.tokens_out, 0).toLocaleString()} tokens`} />
        <Tile label="Cost per completed guided estimate" value={costPerCompleted == null ? "—" : fmtAud(costPerCompleted)} sub={`${completed.length} completed of ${guided.length} guided`} />
        <Tile label="Handoff rate" value={`${rate}%`} sub={`${hs.length} handoffs · ${escalated} past the SLA`} />
      </div>
      <h2 style={{ fontSize: 16 }}>Drop-off by question</h2>
      <p className="sub">Where unfinished guided conversations stopped — the question they were last asked.</p>
      <table className="table"><thead><tr><th>Question key</th><th>Stopped here</th></tr></thead>
        <tbody>{drop.slice(0, 20).map((d) => <tr key={d.gapKey}><td>{d.gapKey}</td><td>{d.count}</td></tr>)}{drop.length === 0 && <tr><td colSpan={2}>Nothing unfinished.</td></tr>}</tbody></table>
      <h2 style={{ fontSize: 16, marginTop: 18 }}>Spend by day</h2>
      <table className="table"><thead><tr><th>Day</th><th>Tokens</th><th>Est. cost</th></tr></thead>
        <tbody>{spendRows.map((r) => <tr key={r.day}><td>{r.day}</td><td>{r.tokens.toLocaleString()}</td><td>{fmtAud(r.cents)}</td></tr>)}{spendRows.length === 0 && <tr><td colSpan={3}>No model calls yet.</td></tr>}</tbody></table>
      <h2 style={{ fontSize: 16, marginTop: 18 }}>By channel</h2>
      <p className="sub">{byChannel.map((c) => `${c.channel} ${c.n}`).join(" · ")}</p>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="sub" style={{ letterSpacing: ".04em", fontSize: 11 }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 24, fontWeight: 600 }}>{value}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}
