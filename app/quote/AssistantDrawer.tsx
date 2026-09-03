"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { UiState } from "@/lib/agent/session";
import { Chips } from "@/app/estimate/assist/AssistView";
import { flushBuilder } from "./builderBridge";
import "./assistant-drawer.css";

/**
 * The assistant INSIDE the builder (Tom, 3 Sep): a floating button opens a
 * side panel; what you type is applied to the estimate live and the builder
 * beside it remounts on the fresh row after every turn. No separate page, no
 * Apply step. Before each turn the builder's unsaved edits are flushed so the
 * two never overwrite each other (see builderBridge.ts).
 */
type Msg = { id: string; role: "user" | "assistant" | "staff" | "system"; text: string; createdAt: string };
const fmt = (c: number) => `$${Math.round(c / 100).toLocaleString("en-AU")}`;

export default function AssistantDrawer({ estimateId }: { estimateId: string | null }) {
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(params.get("assist") === "1");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [assistantName, setAssistantName] = useState("Assistant");
  const [transcript, setTranscript] = useState<Msg[]>([]);
  const [ui, setUi] = useState<UiState | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [transcript.length, busy, open]);

  // Opening: attach to this estimate's conversation, or make the draft first.
  // Runs once per open; the in-flight request is never cancelled by its own
  // busy flag (that left the input disabled for good).
  const startedRef = useRef(false);
  useEffect(() => {
    if (!open || conversationId || startedRef.current) return;
    startedRef.current = true;
    (async () => {
      setBusy(true); setError(null);
      try {
        const res = await fetch("/api/agent/cowork", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ estimateId }) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) { setError(j.error ?? "The assistant isn't available just now."); startedRef.current = false; return; }
        if (!estimateId && j.estimateId) {
          // A fresh draft: the builder must load it — reopen on the new id.
          window.location.assign(`/quote?id=${j.estimateId}&assist=1`);
          return;
        }
        setConversationId(j.conversationId);
        setAssistantName(j.assistantName ?? "Assistant");
        setTranscript(j.transcript ?? []);
        setUi(j.ui ?? null);
      } catch { setError("The assistant isn't available — check the connection."); startedRef.current = false; }
      finally { setBusy(false); }
    })();
  }, [open, conversationId, estimateId]);

  async function send(message: string, answer: { key: string; value: unknown } | null) {
    if (busy || !conversationId) return;
    setBusy(true); setError(null);
    setTranscript((t) => [...t, { id: `local-${Date.now()}`, role: "staff", text: message.trim() || `[${answer?.key}]`, createdAt: new Date().toISOString() }]);
    try {
      await flushBuilder().catch(() => undefined);
      const res = await fetch("/api/agent/turn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, text: message.trim(), answer }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "That didn't go through."); return; }
      setTranscript(j.transcript ?? []);
      setUi(j.ui ?? null);
      setText("");
      // The builder beside us remounts on the fresh row.
      router.refresh();
    } catch { setError("That didn't go through — check the connection."); }
    finally { setBusy(false); }
  }

  const gap = ui?.nextGap ?? null;
  const price = ui?.price ?? null;

  return (
    <>
      {!open && (
        <button
          type="button"
          data-testid="assistant-fab"
          aria-label="Ask the assistant"
          title="Ask the assistant"
          onClick={() => setOpen(true)}
          className="group fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gray-900 text-white shadow-lg ring-1 ring-black/10 transition hover:bg-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 print:hidden"
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-4.6A8 8 0 1 1 21 12z" />
            <path d="M8 12h.01M12 12h.01M16 12h.01" strokeWidth="2.4" />
          </svg>
          <span className="pointer-events-none absolute right-16 whitespace-nowrap rounded-md bg-gray-900 px-2.5 py-1.5 text-sm text-white opacity-0 shadow transition group-hover:opacity-100 group-focus-visible:opacity-100">Ask the assistant</span>
        </button>
      )}
      {open && (
        <>
          {busy && conversationId && <div className="asd-lock" aria-hidden="true" data-testid="assistant-lock" />}
          <aside className="asd-panel" aria-label="Assistant" data-testid="assistant-drawer">
            <header className="asd-head">
              <div><strong>{assistantName}</strong><small>Changes land on this estimate as we go.</small></div>
              <button type="button" className="asd-close" aria-label="Close the assistant" onClick={() => setOpen(false)}>×</button>
            </header>
            <div className="asd-log" data-testid="assistant-log">
              {transcript.length === 0 && !busy && !error && (
                <div className="asd-msg asd-assistant">{"Tell me the job — a line, a pasted email or a call summary — and I'll build the tree here, listing everything I assumed. Or say what to change."}</div>
              )}
              {transcript.map((m) => (
                <div key={m.id} className={`asd-msg asd-${m.role}`} data-testid={`assistant-msg-${m.role}`}>{m.text}</div>
              ))}
              {busy && <div className="asd-msg asd-assistant asd-typing" data-testid="assistant-typing">…</div>}
              <div ref={endRef} />
            </div>
            {gap && !busy && !gap.key.startsWith("stop.") && (
              <div className="asd-chips" data-gap={gap.key} data-testid="assistant-chips">
                <p className="as-note">{gap.phrasingHint}</p>
                <Chips gap={gap} estimateId={estimateId ?? undefined} onAnswer={(value, label) => send(label ?? "", { key: gap.key, value })} />
              </div>
            )}
            {price && ui?.built && (
              <div className="asd-price" data-testid="assistant-price">
                <span>LIVE · INCL. GST · {Math.round(price.accuracyPct)}% settled</span>
                <strong>{fmt(price.loCents)} – {fmt(price.hiCents)}</strong>
              </div>
            )}
            <form className="asd-form" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send(text, null); }}>
              <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Describe the job, paste a brief, or say what to change…" aria-label="Message the assistant" rows={3} disabled={busy || !conversationId} data-testid="assistant-input"
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (text.trim()) send(text, null); } }} />
              <button type="submit" disabled={busy || !conversationId || !text.trim()} data-testid="assistant-send">Send</button>
            </form>
            {error && <p className="asd-err" role="alert">{error}</p>}
          </aside>
        </>
      )}
    </>
  );
}
