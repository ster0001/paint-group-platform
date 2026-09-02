"use client";

import { useEffect, useRef, useState } from "react";
import { useLiveConversation } from "@/app/estimate/assist/useLiveConversation";

type Msg = { id: string; role: "user" | "assistant" | "staff" | "system"; text: string; createdAt: string };

const QUICK = ["What's included in my estimate?", "How much is the deposit and when do I pay?", "Can someone come out and look at it?"];

export default function SupportView({ conversationId, estimateId, shareToken, initialTranscript, companyPhone = null }: {
  conversationId: string; estimateId: string; shareToken: string | null; initialTranscript: Msg[]; companyPhone?: string | null;
}) {
  const [transcript, setTranscript] = useState<Msg[]>(initialTranscript);
  const [status, setStatus] = useState<"open" | "handed_off" | "closed">("open");
  const [handoff, setHandoff] = useState<{ status: string } | null>(null);
  const [callback, setCallback] = useState<{ open: boolean; window: "am" | "pm" | "any"; phone: string }>({ open: false, window: "any", phone: "" });
  // S7: a person's replies land here live; the status line says who's on.
  useLiveConversation(conversationId, (snap) => { setTranscript(snap.transcript); setStatus(snap.status); setHandoff(snap.handoff); });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [transcript.length, busy]);

  async function send(message: string, answer: { key: string; value: unknown } | null = null) {
    if (busy || (!message.trim() && !answer)) return;
    setBusy(true); setError(null);
    setTranscript((t) => [...t, { id: `local-${Date.now()}`, role: "user", text: message.trim(), createdAt: new Date().toISOString() }]);
    try {
      const res = await fetch("/api/agent/turn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, text: message.trim(), answer }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "That didn't go through — try again."); return; }
      setTranscript(j.transcript ?? []);
    } catch { setError("That didn't go through — check the connection and try again."); }
    finally { setBusy(false); setText(""); }
  }

  return (
    <div className="card" data-testid="support" data-status={status}>
      {status === "handed_off" && (
        <p className="sub" data-testid="sp-status">{handoff?.status === "active" || handoff?.status === "claimed" ? "A person from Paint Group is with you now." : "Waiting for a person — your messages are saved and they'll see them."}</p>
      )}
      <div className="msgs" data-testid="sp-log" style={{ maxHeight: "55vh", overflow: "auto" }}>
        {transcript.map((m) => (
          <div key={m.id} className={`msg ${m.role === "user" ? "mine" : "theirs"}`} data-testid={`sp-msg-${m.role}`}>
            {m.role === "staff" && <div className="sub">Paint Group</div>}
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
        <button type="button" className="btn btn-ghost" disabled={busy} data-testid="sp-callback" onClick={() => setCallback((c) => ({ ...c, open: !c.open }))}>Request a callback</button>
        {companyPhone && <a className="btn btn-ghost" href={`tel:${companyPhone.replace(/\s+/g, "")}`} data-testid="sp-call">Call us</a>}
        {shareToken && <a className="btn btn-ghost" href={`/e/${shareToken}?portal=1`}>Open the estimate</a>}
        <a className="btn btn-ghost" href={`/account/messages/${estimateId}`}>Message the team</a>
      </div>
      {callback.open && (
        <form data-testid="sp-callback-form" style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }} onSubmit={(e) => {
          e.preventDefault();
          const phone = callback.phone.replace(/[\s-]/g, "").replace(/^0/, "+61");
          setCallback((c) => ({ ...c, open: false }));
          send(`Please call me back (${callback.window === "am" ? "morning" : callback.window === "pm" ? "afternoon" : "any time"})`, { key: "callback", value: { window: callback.window, phoneE164: phone } });
        }}>
          <select value={callback.window} onChange={(e) => setCallback((c) => ({ ...c, window: e.target.value as "am" | "pm" | "any" }))} aria-label="When">
            <option value="am">Morning</option><option value="pm">Afternoon</option><option value="any">Any time</option>
          </select>
          <input value={callback.phone} onChange={(e) => setCallback((c) => ({ ...c, phone: e.target.value }))} placeholder="Mobile number" aria-label="Mobile number" inputMode="tel" required />
          <button type="submit" className="btn btn-cyan" disabled={busy}>Book the callback</button>
        </form>
      )}
      {error && <p className="sub" role="alert" style={{ color: "#ff8a8a" }}>{error}</p>}
    </div>
  );
}
