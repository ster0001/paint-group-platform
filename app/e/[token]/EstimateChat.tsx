"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { reportError } from "@/lib/monitoring/report";
import { AFTER_HOURS_NOTE, officeOpenAt } from "@/lib/messaging/officeHours";

/**
 * The customer's estimate chat — ONE implementation (automations A‑F, 12 Nov
 * 2026), moved out of CustomerEstimate so the sent estimate and the lead's
 * page (`LeadRange`) draw the same thread from the same token. Reads
 * `get_estimate_thread_by_token`, posts through `/api/estimates/chat` (which
 * tells the office), polls every 15 s, opens itself on `#chat`.
 */
export type ChatMessage = { id: string; direction: "staff" | "customer"; body: string; author_name: string | null; created_at: string };

export function useEstimateChat(token: string | undefined, interactive: boolean) {
  const [open, setOpen] = useState(false);
  // Tom, 20 Sep: out of hours the chat says so, once, after their message lands.
  const [afterHours, setAfterHours] = useState(false);
  const [thread, setThread] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const loadThread = useCallback(async () => {
    if (!interactive || !token) return;
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_estimate_thread_by_token", { p_token: token });
    // A failed read keeps the thread on screen (the next poll tries again) and is
    // reported, rather than drawing "no messages" over a conversation.
    if (error) { reportError(error, { where: "estimateChat.thread", bestEffort: true }); return; }
    setThread((data as ChatMessage[] | null) ?? []);
  }, [interactive, token]);

  useEffect(() => {
    if (!interactive) return;
    // loadThread awaits the RPC before any setState — it's a subscribe-style
    // fetch, not a synchronous render loop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadThread();
    // A staff reply links the customer to #chat: open it after mount (an
    // initializer reading location.hash would fail hydration).
    if (typeof window !== "undefined" && window.location.hash === "#chat") setOpen(true);
    const iv = setInterval(loadThread, 15000); // keep the conversation live
    return () => clearInterval(iv);
  }, [interactive, loadThread]);

  async function send() {
    const body = draft.trim();
    if (!body) return;
    setBusy(true); setErr("");
    // Through the route (Tom, 20 Sep): the message lands the same way, and
    // the office is emailed / texted in the same breath.
    let res: { ok?: boolean; error?: string } | null = null;
    try {
      const r = await fetch("/api/estimates/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, body }) });
      res = await r.json().catch(() => null);
      if (!r.ok) { setBusy(false); setErr(res?.error || "That didn't go through — please try again."); return; }
    } catch {
      setBusy(false); setErr("That didn't go through — check the connection and try again."); return;
    }
    setBusy(false);
    setDraft("");
    if (!officeOpenAt(new Date())) setAfterHours(true);
    await loadThread();
  }

  return { open, setOpen, afterHours, thread, draft, setDraft, busy, err, send, interactive };
}
export type EstimateChatState = ReturnType<typeof useEstimateChat>;

/** The thread and the reply box. `intro` is what an empty thread says; `staffName` signs a reply with no author. */
export function ChatPanel({ chat, intro, staffName, relTime }: { chat: EstimateChatState; intro: ReactNode; staffName: string; relTime: (iso: string) => string }) {
  return (
    <div className="panelbox" id="chatbox">
      <h3>Chat with us</h3>
      <div className="chatthread">
        {chat.thread.length === 0
          ? <p className="sub" style={{ margin: "4px 0 10px" }}>{intro}</p>
          : chat.thread.map((m) => (
              <div key={m.id} className={`chatrow ${m.direction === "customer" ? "mine" : "theirs"}`}>
                <div className="chatbubble">
                  <div className="chatbody">{m.body}</div>
                  <div className="chatmeta">{m.direction === "staff" ? (m.author_name || staffName) : "You"} · {relTime(m.created_at)}</div>
                </div>
              </div>
            ))}
        {chat.afterHours && <div className="chatnote" role="status" data-testid="chat-after-hours">{AFTER_HOURS_NOTE}</div>}
      </div>
      <label className="field">
        <textarea
          rows={3} value={chat.draft}
          onChange={(e) => chat.setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void chat.send(); } }}
          placeholder="Type your message…"
        />
      </label>
      <button className="btn btn-primary" onClick={() => void chat.send()} disabled={!chat.interactive || chat.busy || chat.draft.trim() === ""}>{chat.busy ? "Sending…" : "Send message"}</button>
      {chat.err && <p className="errline">{chat.err}</p>}
    </div>
  );
}
