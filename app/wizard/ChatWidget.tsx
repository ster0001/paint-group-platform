"use client";

import { useEffect, useRef, useState } from "react";
import { useLiveConversation } from "@/app/estimate/assist/useLiveConversation";
import "./chat.css";

type Msg = { id: string; role: "user" | "assistant" | "staff" | "system"; text: string; createdAt: string };
type Snap = { conversationId: string; status: string; handoff: { status: string } | null; transcript: Msg[] };

const KEY = "pg-wizard-chat";

/**
 * Tom, 8 Sep 2026: the chat bubble in the bottom-left corner of the online
 * estimate — "so they can talk to us". A direct line to the office: the
 * first message asks for a person, staff answer from the dock on any screen,
 * and Realtime brings the reply here. The conversation id is kept in the
 * browser so a reload picks the same thread up.
 */
export default function ChatWidget({ ready, place = "wizard", ensureSession }: {
  ready: boolean;
  /** Where it is mounted — the marketing site sits above its own call bar. */
  place?: "wizard" | "site";
  /**
   * Tom, 8 Sep 2026: the same bubble on the website. A visitor there has no
   * anonymous session yet and we are not making one for every passer-by, so
   * the host hands over a function that signs in ON THE FIRST OPEN. Supplying
   * it also means the bubble renders before `ready` — the session is what the
   * tap is for.
   */
  ensureSession?: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [snap, setSnap] = useState<Snap | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const seen = useRef(0);
  const endRef = useRef<HTMLDivElement | null>(null);

  async function start() {
    if (snap || busy) return;
    setBusy(true); setError(null);
    if (ensureSession) {
      const up = await ensureSession().catch(() => false);
      if (!up) { setError("Chat isn't available just now — try again in a moment."); setBusy(false); return; }
    }
    let saved: string | null = null;
    try { saved = window.localStorage.getItem(KEY); } catch { /* fine */ }
    try {
      // The wizard's anonymous session can be a beat behind the first tap:
      // a 403 here is "not signed in yet", so try again briefly.
      let res: Response | null = null, j: { error?: string } & Partial<Snap> = {};
      for (let attempt = 0; attempt < 4; attempt++) {
        res = await fetch("/api/agent/website", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start", ...(saved ? { conversationId: saved } : {}) }) });
        j = await res.json().catch(() => ({}));
        if (res.status !== 403) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (!res || !res.ok) { setError(j.error ?? "Chat isn't available just now."); return; }
      setSnap(j as Snap);
      seen.current = (j as Snap).transcript.length;
      try { window.localStorage.setItem(KEY, (j as Snap).conversationId); } catch { /* fine */ }
    } catch { setError("Chat isn't available just now — try again in a moment."); }
    finally { setBusy(false); }
  }

  // Opening the panel opens the conversation (once the wizard's session is
  // up). Deferred a tick: the lint rule keeps state changes out of effect bodies.
  useEffect(() => {
    if (!open || !(ready || ensureSession) || snap) return;
    const t = setTimeout(() => { void start(); }, 0);
    return () => clearTimeout(t);
  }, [open, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) endRef.current?.scrollIntoView({ block: "end" }); }, [snap?.transcript.length, open]);

  useLiveConversation(snap?.conversationId ?? "", (live) => {
    if (!snap) return;
    setSnap((s) => (s ? { ...s, status: live.status, handoff: live.handoff, transcript: live.transcript } : s));
    const fresh = live.transcript.filter((m) => m.role === "staff").length;
    if (open) seen.current = fresh;
    else if (fresh > seen.current) setUnread(fresh - seen.current);
  }, { pollMs: 10_000 });
  const toggle = () => {
    const next = !open;
    if (next && snap) { seen.current = snap.transcript.filter((m) => m.role === "staff").length; setUnread(0); }
    setOpen(next);
  };

  async function send() {
    if (!snap || !text.trim() || busy) return;
    setBusy(true); setError(null);
    const line = text.trim();
    setText("");
    setSnap((s) => (s ? { ...s, transcript: [...s.transcript, { id: `local-${Date.now()}`, role: "user", text: line, createdAt: new Date().toISOString() }] } : s));
    try {
      const res = await fetch("/api/agent/website", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "say", conversationId: snap.conversationId, text: line }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "That didn't go through."); return; }
      setSnap(j as Snap);
    } catch { setError("That didn't go through — check the connection."); }
    finally { setBusy(false); }
  }

  if (!ready && !ensureSession) return null;
  const waiting = snap?.status === "handed_off" && snap.handoff?.status === "requested";
  const live = snap?.status === "handed_off" && (snap.handoff?.status === "active" || snap.handoff?.status === "claimed");

  return (
    <div className={`wz-chat ${place === "site" ? "site" : ""} ${open ? "open" : ""}`} data-testid="wz-chat">
      {open && (
        <div className="wz-chat-panel" role="dialog" aria-label="Chat with Paint Group" data-testid="wz-chat-panel" data-status={snap?.status ?? ""}>
          <div className="wz-chat-head">
            <b>Chat with us</b>
            <span className="wz-chat-state">{live ? "A person is with you" : waiting ? "Finding someone…" : "We answer here"}</span>
            <button type="button" className="wz-chat-x" onClick={toggle} aria-label="Minimise chat">—</button>
          </div>
          <div className="wz-chat-log" data-testid="wz-chat-log">
            {!snap && !error && <p className="wz-chat-note">Opening the chat…</p>}
            {snap?.transcript.map((m) => (
              <div key={m.id} className={`wz-chat-msg ${m.role === "user" ? "me" : "them"}`} data-testid={`wz-chat-${m.role}`}>
                {m.role !== "user" && <span className="wz-chat-who">{m.role === "staff" ? "Paint Group" : "Paint Group"}</span>}
                <span>{m.text}</span>
              </div>
            ))}
            {error && <p className="wz-chat-err" role="alert">{error}</p>}
            <div ref={endRef} />
          </div>
          <form className="wz-chat-input" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message…" aria-label="Message" disabled={busy || !snap} data-testid="wz-chat-text" />
            <button type="submit" disabled={busy || !snap || !text.trim()} data-testid="wz-chat-send">Send</button>
          </form>
        </div>
      )}
      <button type="button" className="wz-chat-bubble" onClick={toggle} aria-label={open ? "Minimise chat" : "Chat with us"} aria-expanded={open} data-testid="wz-chat-bubble">
        <span aria-hidden="true">💬</span>
        <span className="wz-chat-bubble-lbl">{open ? "Close" : "Chat with us"}</span>
        {unread > 0 && !open && <span className="wz-chat-badge" data-testid="wz-chat-badge">{unread}</span>}
      </button>
    </div>
  );
}
