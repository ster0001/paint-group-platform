"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { requestMaterialAction } from "./gapActions";

export type MaterialsRequestRow = { id: string; item: string; quantity: string; status: "requested" | "ordered" | "declined"; reply: string; createdAt: string };

/**
 * "Request more" on the job (induction brief §6, Module 4): short of something
 * → item and quantity → the office orders it and the reply lands here. Never
 * leave a job waiting because something ran out.
 */
export default function MaterialsRequest({ workOrderId, rows, canRequest }: { workOrderId: string; rows: MaterialsRequestRow[]; canRequest: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [item, setItem] = useState("");
  const [quantity, setQuantity] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function send() {
    setBusy(true); setMessage(null);
    const r = await requestMaterialAction({ workOrderId, item, quantity });
    setBusy(false); setMessage(r.message);
    if (r.ok) { setItem(""); setQuantity(""); setOpen(false); router.refresh(); }
  }

  const input = { fontSize: 14, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--graphite)", color: "var(--text)" } as const;

  return (
    <div className="card" id="materials" data-testid="materials-request">
      <div className="tick-head"><b>Materials</b>{rows.length > 0 && <span className="tick-count">{rows.filter((r) => r.status === "requested").length} waiting</span>}</div>
      <p className="hint" style={{ padding: 0, marginTop: 6 }}>
        Short of something? Tap Request more the moment you see you will be short, not the morning you need it. The office orders it and replies here.
      </p>
      {rows.length > 0 && (
        <ul className="clean" style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "grid", gap: 6 }} data-testid="materials-request-list">
          {rows.map((r) => (
            <li key={r.id} data-testid={`materials-request-${r.id}`} data-status={r.status} style={{ fontSize: 12.5 }}>
              <b>{r.item}</b>{r.quantity ? ` × ${r.quantity}` : ""}
              <span className="hint" style={{ display: "block", padding: 0, color: r.status === "requested" ? "var(--muted)" : r.status === "ordered" ? "var(--text)" : "var(--amber)" }}>
                {r.status === "requested" ? "Sent to the office — waiting for a reply" : r.status === "ordered" ? `Ordered${r.reply ? ` — ${r.reply}` : ""}` : `Not ordered${r.reply ? ` — ${r.reply}` : ""}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      {message && <p className="tick-msg" role="status" data-testid="materials-request-msg">{message}</p>}
      {canRequest && (open ? (
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          <input type="text" value={item} onChange={(e) => setItem(e.target.value)} placeholder="What do you need? e.g. Wash&Wear Natural White" maxLength={200} style={input} data-testid="materials-item" />
          <input type="text" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="How much? e.g. 10 L" maxLength={60} style={input} data-testid="materials-quantity" />
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn narrow cy" disabled={busy || !item.trim()} onClick={() => void send()} data-testid="materials-send">{busy ? "Sending…" : "Send to the office"}</button>
            <button type="button" className="btn narrow gh" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn gh" style={{ marginTop: 10 }} onClick={() => { setOpen(true); setMessage(null); }} data-testid="materials-request-open">Request more</button>
      ))}
    </div>
  );
}
