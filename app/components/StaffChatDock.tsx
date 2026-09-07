"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { useLiveConversation } from "@/app/estimate/assist/useLiveConversation";
import "./staffdock.css";

/**
 * Tom, 8 Sep 2026: "if someone messages on the chat bot, it doesn't matter
 * which page staff are on — the chat pops up in the bottom-left corner,
 * minimisable, with the customer's message, so they can talk to the customer
 * while doing other things. Make it make a noise when a message comes in."
 *
 * Mounted by every staff shell. Reads /api/agent/inbox (every open hand-off
 * with the last line), refreshes on a Realtime insert into agent_messages,
 * pops open and chimes when a customer line arrives that this browser has
 * not seen, and holds the whole conversation — claim, reply, resolve —
 * through the same /api/agent/handoff route the full chat page uses.
 */
type Row = {
  conversationId: string; handoffId: string; status: string; reason: string; requestedAt: string;
  claimedBy: string | null; mine: boolean;
  who: string; phone: string | null; accountId: string | null; estimateId: string | null;
  lastText: string; lastRole: string; lastAt: string; lastId: string; lastCustomerAt: string | null;
};
type Msg = { id: string; role: "user" | "assistant" | "staff" | "system"; text: string; createdAt: string };

const SEEN_KEY = "pg-dock-seen";      // conversationId → last customer line id this browser has seen
const OPEN_KEY = "pg-dock-open";      // "1" while expanded
const SOUND_KEY = "pg-dock-sound";    // "off" to mute

function readSeen(): Record<string, string> { try { return JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? "{}"); } catch { return {}; } }
function writeSeen(v: Record<string, string>) { try { window.localStorage.setItem(SEEN_KEY, JSON.stringify(v)); } catch { /* fine */ } }

/** A short two-note chime from the Web Audio API — no file to host, no
 *  autoplay download; browsers allow it once the person has clicked anything. */
function chime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const play = (freq: number, at: number) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = "sine"; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.25, at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
      o.connect(g); g.connect(ctx.destination); o.start(at); o.stop(at + 0.4);
    };
    play(880, ctx.currentTime); play(1175, ctx.currentTime + 0.18);
    setTimeout(() => { void ctx.close(); }, 1200);
  } catch { /* no sound is not an error */ }
}

const ago = (iso: string) => {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  return m < 1 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
};

export default function StaffChatDock() {
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [unseen, setUnseen] = useState<Set<string>>(new Set());
  const [sound, setSound] = useState(true);
  const seenRef = useRef<Record<string, string>>({});
  const firstLoad = useRef(true);

  // Remembered choices, read after mount (deferred a tick — the lint rule
  // keeps state changes out of effect bodies; a server render has no storage).
  useEffect(() => {
    seenRef.current = readSeen();
    const t = setTimeout(() => {
      try { setOpen(window.localStorage.getItem(OPEN_KEY) === "1"); setSound(window.localStorage.getItem(SOUND_KEY) !== "off"); } catch { /* fine */ }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/inbox", { cache: "no-store" });
      if (!res.ok) return;
      const j = (await res.json()) as { rows?: Row[] };
      const next = j.rows ?? [];
      setRows(next);
      // A customer line this browser hasn't seen → badge, pop open, chime.
      const fresh = new Set<string>();
      for (const r of next) {
        if (r.lastRole !== "user") continue;
        if (seenRef.current[r.conversationId] !== r.lastId) fresh.add(r.conversationId);
      }
      setUnseen(fresh);
      if (fresh.size > 0) {
        setOpen(true);
        // Quiet on the very first load only when nothing is new; a customer
        // already waiting when the page opens still deserves the chime.
        if (sound) chime();
      }
      firstLoad.current = false;
    } catch { /* the next poll retries */ }
  }, [sound]);

  useEffect(() => {
    const first = setTimeout(() => { void refresh(); }, 0);
    const timer = setInterval(() => { void refresh(); }, 12_000);
    // Realtime: any new agent message (staff may read them all) refreshes the inbox at once.
    const supabase = createBrowserClient();
    const channel = supabase.channel("staff-dock")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "agent_messages" }, () => { void refresh(); })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "agent_handoffs" }, () => { void refresh(); })
      .subscribe();
    return () => { clearTimeout(first); clearInterval(timer); void supabase.removeChannel(channel); };
  }, [refresh]);

  const markSeen = (r: Row) => {
    if (r.lastRole === "user") { seenRef.current = { ...seenRef.current, [r.conversationId]: r.lastId }; writeSeen(seenRef.current); }
    setUnseen((u) => { const n = new Set(u); n.delete(r.conversationId); return n; });
  };
  const toggleOpen = (v: boolean) => { setOpen(v); try { window.localStorage.setItem(OPEN_KEY, v ? "1" : "0"); } catch { /* fine */ } };
  const toggleSound = () => { const v = !sound; setSound(v); try { window.localStorage.setItem(SOUND_KEY, v ? "on" : "off"); } catch { /* fine */ } };

  if (rows.length === 0 && !open) return null;
  const current = selected ? rows.find((r) => r.conversationId === selected) ?? null : null;
  const waitingCount = rows.filter((r) => r.status === "requested").length;

  return (
    <div className="pgdock" data-testid="staff-dock" data-open={open ? "1" : "0"} data-unseen={unseen.size}>
      {open ? (
        <div className="dk-panel" role="dialog" aria-label="Customer chats">
          {current ? (
            <DockThread row={current} onBack={() => setSelected(null)} onMinimise={() => toggleOpen(false)} onActivity={refresh} />
          ) : (
            <>
              <div className="dk-head">
                <b>Customer chats</b>
                <span className="dk-sub">{waitingCount ? `${waitingCount} waiting for a person` : rows.length ? "Live" : "Nothing open"}</span>
                <button type="button" className="dk-sound" onClick={toggleSound} title={sound ? "Mute the chime" : "Chime on a new message"}>{sound ? "🔔 on" : "🔕 off"}</button>
                <button type="button" className="dk-x" onClick={() => toggleOpen(false)} aria-label="Minimise" data-testid="dock-minimise">—</button>
              </div>
              <div className="dk-list" data-testid="dock-list">
                {rows.length === 0 && <p className="dk-empty">No customer is chatting right now. This corner lights up — and chimes — when one does.</p>}
                {rows.map((r) => (
                  <button type="button" key={r.conversationId} className={`dk-row ${unseen.has(r.conversationId) ? "unread" : ""}`} onClick={() => { markSeen(r); setSelected(r.conversationId); }} data-testid="dock-row">
                    <span className="dk-who">
                      {r.who}
                      <span className={`dk-state ${r.status === "requested" ? "wait" : "live"}`}>{r.status === "requested" ? "Waiting" : r.mine ? "You" : "Live"}</span>
                      <span className="dk-when">{ago(r.lastAt)}</span>
                    </span>
                    <span className="dk-last">{r.lastRole === "user" ? "" : r.lastRole === "staff" ? "You: " : "Assistant: "}{r.lastText || "…"}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        <button type="button" className="dk-pill" onClick={() => toggleOpen(true)} aria-label="Open customer chats" data-testid="dock-pill">
          <span aria-hidden="true">💬</span>
          <span>{waitingCount ? `${waitingCount} waiting` : `${rows.length} chat${rows.length === 1 ? "" : "s"}`}</span>
          {unseen.size > 0 ? <span className="dk-badge" data-testid="dock-badge">{unseen.size}</span> : <span className="dk-badge quiet">{rows.length}</span>}
        </button>
      )}
    </div>
  );
}

function DockThread({ row, onBack, onMinimise, onActivity }: { row: Row; onBack: () => void; onMinimise: () => void; onActivity: () => void }) {
  const [transcript, setTranscript] = useState<Msg[]>([]);
  const [status, setStatus] = useState<string>("open");
  const [handoff, setHandoff] = useState<{ status: string } | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useLiveConversation(row.conversationId, (snap) => { setTranscript(snap.transcript); setStatus(snap.status); setHandoff(snap.handoff); }, { pollMs: 6_500 });
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [transcript.length]);

  async function post(body: Record<string, unknown>) {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/agent/handoff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: row.conversationId, ...body }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "That didn't go through."); return null; }
      onActivity();
      return j;
    } catch { setError("That didn't go through — check the connection."); return null; }
    finally { setBusy(false); }
  }

  const waiting = status === "handed_off" && handoff?.status === "requested";
  return (
    <>
      <div className="dk-head">
        <button type="button" className="dk-back" onClick={onBack} aria-label="Back to the list">‹</button>
        <b>{row.who}</b>
        <span className="dk-sub">{waiting ? "Waiting for a person" : status === "handed_off" ? "Live" : status === "closed" ? "Closed" : "With the assistant"}</span>
        <button type="button" className="dk-x" onClick={onMinimise} aria-label="Minimise" data-testid="dock-minimise">—</button>
      </div>
      <div className="dk-actions">
        {waiting && <button type="button" className="dk-btn primary" disabled={busy} onClick={() => void post({ action: "claim" })} data-testid="dock-claim">I&rsquo;ll take it</button>}
        {row.phone && <a className="dk-btn" href={`tel:${row.phone.replace(/\s+/g, "")}`}>Call {row.phone}</a>}
        {row.accountId && <a className="dk-btn" href={`/crm/customers/${row.accountId}`}>Record</a>}
        <a className="dk-btn" href={`/crm/chat/${row.conversationId}`}>Full page</a>
        {status === "handed_off" && <button type="button" className="dk-btn" disabled={busy} onClick={() => { if (window.confirm("Mark this chat as sorted? The assistant takes it back.")) void post({ action: "resolve" }); }} data-testid="dock-resolve">Sorted</button>}
      </div>
      <div className="dk-log" data-testid="dock-log">
        {transcript.map((m) => (
          <div key={m.id} className={`dk-msg ${m.role === "staff" ? "me" : m.role === "system" ? "sys" : "them"}`} data-testid={`dock-msg-${m.role}`}>
            {m.role !== "staff" && m.role !== "system" && <span className="dk-role">{m.role === "user" ? row.who : "Assistant"}</span>}
            <span>{m.text}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {error && <p className="dk-err" role="alert">{error}</p>}
      <form className="dk-input" onSubmit={async (e) => { e.preventDefault(); if (!text.trim()) return; const j = await post({ action: "reply", text }); if (j?.message) setText(""); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply to the customer…" aria-label="Reply" disabled={busy || status === "closed"} data-testid="dock-input" />
        <button type="submit" disabled={busy || !text.trim() || status === "closed"} data-testid="dock-send">Send</button>
      </form>
    </>
  );
}
