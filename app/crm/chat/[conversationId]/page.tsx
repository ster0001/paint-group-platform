import { openStaffChat } from "@/lib/agent/session";
import LiveChat from "./LiveChat";

/** /crm/chat/[conversationId] — the staff side of a live handoff (S7). */
export const dynamic = "force-dynamic";
export const metadata = { title: "Live chat · Paint Group" };

export default async function StaffChatPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  const s = await openStaffChat(conversationId);
  if (s.kind === "holding") return <div style={{ padding: 24 }}><h1>{s.line}</h1></div>;
  return (
    <div style={{ padding: 16, maxWidth: 860 }}>
      <a href="/crm/today" className="note">← Today</a>
      <h1 style={{ margin: "8px 0 2px" }}>{s.customerName ?? "Customer"}{s.estimateTitle ? ` · ${s.estimateTitle}` : ""}</h1>
      <p className="sub" style={{ marginBottom: 12 }}>
        {s.estimateId && <a href={`/quote?id=${s.estimateId}`}>Open the estimate</a>}
        {s.customerPhone && <> · <a href={`tel:${s.customerPhone.replace(/\s+/g, "")}`}>Call {s.customerPhone}</a></>}
      </p>
      <LiveChat conversationId={s.conversationId} initialTranscript={s.transcript} initialStatus={s.status} initialHandoff={s.handoff ? { id: s.handoff.id, status: s.handoff.status, summary: s.handoff.summary } : null} />
    </div>
  );
}
