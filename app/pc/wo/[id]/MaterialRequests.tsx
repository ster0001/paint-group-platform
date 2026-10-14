"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { replyMaterialRequestAction } from "@/app/pc/materialActions";

export type MaterialRequestRow = { id: string; item: string; quantity: string; note: string; status: "requested" | "ordered" | "declined"; reply: string; createdAt: string; repliedAt: string | null };

const when = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Australia/Melbourne" });

/**
 * The painter's materials requests on this job (induction Step 3b): what they
 * asked for, and the office's reply box for each open one. Ordered = tell them
 * where and when; declined = tell them why. Both show on the painter's job.
 */
export default function MaterialRequests({ workOrderId, rows }: { workOrderId: string; rows: MaterialRequestRow[] }) {
  const router = useRouter();
  const [reply, setReply] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const run = (id: string, status: "ordered" | "declined") => start(async () => {
    setMsg(null);
    const r = await replyMaterialRequestAction({ workOrderId, requestId: id, status, reply: reply[id] ?? "" });
    setMsg({ ok: r.ok, text: r.message });
    if (r.ok) router.refresh();
  });
  if (rows.length === 0) return null;
  return (
    <div className="card" id="materials" data-testid="material-requests">
      <h3>Materials requested <em>{rows.filter((r) => r.status === "requested").length} open</em></h3>
      <p className="note">The painter asked from the job. Order it, then reply with where and when to collect — the reply shows on their phone.</p>
      {rows.map((r) => (
        <div key={r.id} className="row" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }} data-testid={`material-request-${r.id}`} data-status={r.status}>
          <span><b>{r.item}</b>{r.quantity ? ` × ${r.quantity}` : ""}{r.note ? ` — ${r.note}` : ""} <span className="note">{when(r.createdAt)}</span></span>
          {r.status === "requested" ? (
            <div className="row" style={{ alignItems: "center", gap: 6 }}>
              <input className="num" style={{ flex: 1 }} value={reply[r.id] ?? ""} onChange={(e) => setReply({ ...reply, [r.id]: e.target.value })}
                placeholder="e.g. Ordered. At Dulux Preston from 7 am tomorrow." data-testid={`material-reply-${r.id}`} />
              <button type="button" className="btn" disabled={pending} data-testid={`material-ordered-${r.id}`} onClick={() => run(r.id, "ordered")}>Ordered</button>
              <button type="button" className="btn dim" disabled={pending} data-testid={`material-declined-${r.id}`} onClick={() => run(r.id, "declined")}>Decline</button>
            </div>
          ) : (
            <span className="note" data-testid={`material-answer-${r.id}`}>{r.status === "ordered" ? "Ordered" : "Declined"}{r.reply ? ` — ${r.reply}` : ""}{r.repliedAt ? ` · ${when(r.repliedAt)}` : ""}</span>
          )}
        </div>
      ))}
      {msg && <p className="note" style={{ color: msg.ok ? "var(--emerald)" : "var(--amber)" }} data-testid="material-reply-msg">{msg.text}</p>}
    </div>
  );
}
