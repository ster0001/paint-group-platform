"use client";

import { useState } from "react";
import SupportView from "@/app/account/(portal)/assist/[estimateId]/SupportView";

/**
 * The bottom-right chat (Tom, 7 Sep 2026): "ask the assistant a general
 * question, or speak with a person about your quote". It opens the SUPPORT
 * conversation on the customer's estimate — answers come from the estimate's
 * own data, then the Brain, then a person (Talk to a person / callback / call).
 * It never opens the guided describe-the-job chat or staff co-work.
 *
 * Mounted on /estimate/scope (the customer's editor) and in the portal shell;
 * with no estimateId the server picks the customer's newest estimate.
 */

type Msg = { id: string; role: "user" | "assistant" | "staff" | "system"; text: string; createdAt: string };
type Session = {
  conversationId: string; estimateId: string; title: string; shareToken: string | null;
  disclosure: string; assistantName: string; transcript: Msg[]; companyPhone: string | null;
};

const CSS = `
.pgw{position:fixed;right:16px;bottom:16px;z-index:70;font-family:inherit}
.pgw-launch{border:0;border-radius:999px;padding:12px 18px;font-weight:700;font-size:14px;cursor:pointer;background:#39D9E6;color:#0b1116;box-shadow:0 8px 24px rgba(0,0,0,.35)}
.pgw-launch:hover{filter:brightness(1.06)}
.pgw-panel{position:absolute;right:0;bottom:56px;width:min(380px,calc(100vw - 32px));max-height:min(72vh,640px);display:flex;flex-direction:column;background:#0f151a;color:#e8edf1;border:1px solid rgba(255,255,255,.12);border-radius:16px;box-shadow:0 18px 48px rgba(0,0,0,.5);overflow:hidden}
.pgw-hd{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.1)}
.pgw-hd b{display:block;font-size:15px}
.pgw-hd span{display:block;font-size:12.5px;color:#9aa7b2;margin-top:2px}
.pgw-x{background:none;border:0;color:#9aa7b2;font-size:22px;line-height:1;cursor:pointer}
.pgw-body{padding:12px 14px;overflow:auto}
.pgw .card{background:transparent;border:0;padding:0}
.pgw .sub{font-size:12.5px;color:#9aa7b2;margin:0 0 8px}
.pgw .msgs{display:flex;flex-direction:column;gap:8px;margin-bottom:10px}
.pgw .msg{max-width:92%;border-radius:12px;padding:8px 11px;font-size:14px;line-height:1.45;white-space:pre-wrap}
.pgw .msg.mine{align-self:flex-end;background:#39D9E6;color:#0b1116}
.pgw .msg.theirs{align-self:flex-start;background:rgba(255,255,255,.07)}
.pgw .msg .sub{margin:0 0 2px;font-size:11px}
.pgw input,.pgw select{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);color:inherit;border-radius:9px;padding:8px 10px;font:inherit;font-size:14px}
.pgw .btn{border:1px solid rgba(255,255,255,.14);background:transparent;color:inherit;border-radius:999px;padding:7px 12px;font-size:12.5px;cursor:pointer;text-decoration:none;display:inline-block}
.pgw .btn-cyan{background:#39D9E6;color:#0b1116;border-color:#39D9E6;font-weight:700}
.pgw .btn[disabled]{opacity:.5;cursor:default}
`;

export default function AssistantWidget({ estimateId = null, lift = 0 }: {
  estimateId?: string | null;
  /** Pixels to sit above a fixed bottom bar (the editor's sticky CTA bar covers the launcher otherwise). */
  lift?: number;
}) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openPanel() {
    setOpen(true);
    if (session || loading) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/agent/support", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(estimateId ? { estimateId } : {}) });
      const j = (await res.json().catch(() => ({}))) as Session & { error?: string };
      if (!res.ok) { setError(j.error ?? "The assistant isn't available just now."); return; }
      setSession(j);
    } catch { setError("The assistant isn't available just now — check the connection and try again."); }
    finally { setLoading(false); }
  }

  return (
    <div className="pgw" data-testid="assistant-widget" style={lift ? { bottom: 16 + lift } : undefined}>
      <style>{CSS}</style>
      {open && (
        <div className="pgw-panel" role="dialog" aria-label="Chat with Paint Group" data-testid="assistant-widget-panel">
          <div className="pgw-hd">
            <div><b>Chat with us</b><span>Ask the assistant anything about your quote, or talk to a person.</span></div>
            <button type="button" className="pgw-x" aria-label="Close chat" onClick={() => setOpen(false)}>×</button>
          </div>
          <div className="pgw-body">
            {loading && <p className="sub">Connecting…</p>}
            {error && <p className="sub" role="alert" data-testid="assistant-widget-error">{error}</p>}
            {session && (
              <>
                <p className="sub">{session.disclosure}</p>
                <SupportView conversationId={session.conversationId} estimateId={session.estimateId} shareToken={session.shareToken}
                  initialTranscript={session.transcript} companyPhone={session.companyPhone} compact />
              </>
            )}
          </div>
        </div>
      )}
      <button type="button" className="pgw-launch" aria-expanded={open} data-testid="assistant-widget-launch"
        onClick={() => (open ? setOpen(false) : void openPanel())}>
        {open ? "Close chat" : "💬 Chat with us"}
      </button>
    </div>
  );
}
