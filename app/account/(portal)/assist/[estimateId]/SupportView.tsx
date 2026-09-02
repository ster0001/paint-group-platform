"use client";

import { useEffect, useRef, useState } from "react";

type Msg = { id: string; role: "user" | "assistant" | "staff" | "system"; text: string; createdAt: string };

const QUICK = ["What's included in my estimate?", "How much is the deposit and when do I pay?", "Can someone come out and look at it?"];

export default function SupportView({ conversationId, estimateId, shareToken, initialTranscript }: {
  conversationId: string; estimateId: string; shareToken: string | null; initialTranscript: Msg[];
}) {
  const [transcript, setTranscript] = useState<Msg[]>(initialTranscript);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [transcript.length, busy]);

  async function send(message: string) {
    if (busy || !message.trim()) return;
    setBusy(true); setError(null);
    setTranscript((t) => [...t, { id: `local-${Date.now()}`, role: "user", text: message.trim(), createdAt: new Date().toISOString() }]);
    try {
      const res = await fetch("/api/agent/turn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, text: message.trim() }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "That didn't go through — try again."); return; }
      setTranscript(j.transcript ?? []);
    } catch { setError("That didn't go through — check the connection and try again."); }
    finally { setBusy(false); setText(""); }
  }

  return (
    <div className="card" data-testid="support">
      <div className="msgs" data-testid="sp-log" style={{ maxHeight: "55vh", overflow: "auto" }}>
        {transcript.map((m) => (
          <div key={m.id} className={`msg ${m.role === "user" ? "mine" : "theirs"}`} data-testid={`sp-msg-${m.role}`}>
            <div className="msg-body">{m.text}</div>
          </div>
        ))}
        {busy && <div className="msg theirs"><div className="msg-body">…</div></div>}
        <div ref={endRef} />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "10px 0" }}>
        {QUICK.map((q) => <button key={q} type="button" className="btn btn-ghost" disabled={busy} onClick={() => send(q)}>{q}</button>)}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(text); }} style={{ display: "flex", gap: 8 }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask about your estimate…" aria-label="Your question" disabled={busy} data-testid="sp-input" style={{ flex: 1 }} />
        <button type="submit" className="btn btn-cyan" disabled={busy || !text.trim()} data-testid="sp-send">Send</button>
      </form>
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-ghost" disabled={busy} data-testid="sp-person" onClick={() => send("I'd like to talk to a person, please.")}>Talk to a person</button>
        {shareToken && <a className="btn btn-ghost" href={`/e/${shareToken}?portal=1`}>Open the estimate</a>}
        <a className="btn btn-ghost" href={`/account/messages/${estimateId}`}>Message the team</a>
      </div>
      {error && <p className="sub" role="alert" style={{ color: "#ff8a8a" }}>{error}</p>}
    </div>
  );
}
