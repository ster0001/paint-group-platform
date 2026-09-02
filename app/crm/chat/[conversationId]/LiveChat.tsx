"use client";

import { useEffect, useRef, useState } from "react";
import { useLiveConversation } from "@/app/estimate/assist/useLiveConversation";

type Msg = { id: string; role: "user" | "assistant" | "staff" | "system"; text: string; createdAt: string };
type Handoff = { id: string; status: string; summary: string | null } | null;

export default function LiveChat({ conversationId, initialTranscript, initialStatus, initialHandoff }: {
  conversationId: string; initialTranscript: Msg[]; initialStatus: "open" | "handed_off" | "closed"; initialHandoff: Handoff;
}) {
  const [transcript, setTranscript] = useState<Msg[]>(initialTranscript);
  const [status, setStatus] = useState(initialStatus);
  const [handoff, setHandoff] = useState<Handoff>(initialHandoff);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  useLiveConversation(conversationId, (snap) => { setTranscript(snap.transcript); setStatus(snap.status); setHandoff((h) => (snap.handoff ? { id: h?.id ?? "", status: snap.handoff.status, summary: h?.summary ?? null } : null)); }, { pollMs: 5000 });
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [transcript.length]);

  async function post(body: Record<string, unknown>) {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/agent/handoff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, ...body }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "That didn't go through."); return null; }
      return j;
    } catch { setError("That didn't go through — check the connection."); return null; }
    finally { setBusy(false); }
  }

  const waiting = status === "handed_off" && handoff?.status === "requested";
  const live = status === "handed_off" && (handoff?.status === "active" || handoff?.status === "claimed");

  return (
    <div data-testid="live-chat" data-status={status}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <span className="pill">{waiting ? "Waiting for a person" : live ? "You're on" : status === "closed" ? "Closed" : "With the assistant"}</span>
        {waiting && <button type="button" className="btn btn-cyan" disabled={busy} data-testid="lc-claim" onClick={async () => { const j = await post({ action: "claim" }); if (j?.handoff) setHandoff({ id: j.handoff.id, status: j.handoff.status, summary: j.handoff.summary }); }}>Claim</button>}
        {(live || waiting) && <button type="button" className="btn btn-ghost" disabled={busy} data-testid="lc-resolve" onClick={async () => { const j = await post({ action: "resolve" }); if (j?.resolved) { setStatus("open"); setHandoff(null); } }}>Resolve — hand back to the assistant</button>}
      </div>
      {handoff?.summary && <pre className="card" style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", marginBottom: 10 }} data-testid="lc-summary">{handoff.summary}</pre>}
      <div className="msgs" data-testid="lc-log" style={{ maxHeight: "50vh", overflow: "auto" }}>
        {transcript.map((m) => (
          <div key={m.id} className={`msg ${m.role === "staff" ? "mine" : "theirs"}`} data-testid={`lc-msg-${m.role}`}>
            <div className="sub">{m.role === "user" ? "Customer" : m.role === "assistant" ? "Assistant" : m.role === "staff" ? "You" : "System"}</div>
            <div className="msg-body">{m.text}</div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form onSubmit={async (e) => { e.preventDefault(); if (!text.trim()) return; const j = await post({ action: "reply", text }); if (j?.message) { setText(""); setStatus("handed_off"); } }} style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply to the customer…" aria-label="Reply" disabled={busy || status === "closed"} data-testid="lc-input" style={{ flex: 1 }} />
        <button type="submit" className="btn btn-cyan" disabled={busy || !text.trim() || status === "closed"} data-testid="lc-send">Send</button>
      </form>
      {error && <p className="sub" role="alert" style={{ color: "#ff8a8a" }}>{error}</p>}
    </div>
  );
}
