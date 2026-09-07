"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markMessagesRead, sendReply } from "../../recordActions";
import type { CrmResult } from "../../actions";

/**
 * P3 — the Messages section (deep dive §4.2.6): one conversation across
 * channels, newest first, with reply-in-place. Every row is `messages`; a
 * reply goes through the same send primitives as everything else, so it is
 * recorded and delivery-tracked like everything else. Opening the section
 * marks the inbound rows read.
 */
export type MessageRow = {
  id: string; channel: string; direction: "in" | "out"; subject: string | null; body: string; provider: string;
  status: string; status_at: string | null; read_at: string | null; occurred_at: string;
  to_address: string | null; from_address: string | null; meta: Record<string, unknown> | null;
};

const CHANNEL: Record<string, string> = { email: "Email", sms: "Text", call: "Call", chat: "Chat", portal: "Portal", note: "Note" };
const STATUS_WORD: Record<string, string> = {
  queued: "queued", sent: "sent", delivered: "delivered", opened: "opened", clicked: "clicked",
  bounced: "bounced", complained: "marked as spam", failed: "failed", not_configured: "not sent — channel not configured", received: "",
};

const stamp = (iso: string) =>
  new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

export default function Messages({ accountId, messages, hasEmail, hasPhone }: {
  accountId: string; messages: MessageRow[]; hasEmail: boolean; hasPhone: boolean;
}) {
  const [channel, setChannel] = useState<"email" | "sms">(hasEmail ? "email" : "sms");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [said, setSaid] = useState<CrmResult | null>(null);
  const [busy, start] = useTransition();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const router = useRouter();
  const unread = messages.some((m) => m.direction === "in" && !m.read_at);

  useEffect(() => {
    if (!unread) return;
    const t = setTimeout(() => { void markMessagesRead(accountId); }, 800);
    return () => clearTimeout(t);
  }, [accountId, unread]);

  const send = () => start(async () => {
    const r = await sendReply(accountId, { channel, subject, body });
    setSaid(r);
    if (r.ok) { setBody(""); setSubject(""); }
    router.refresh();
  });

  return (
    <>
      {(hasEmail || hasPhone) && (
        <div className="reply" data-testid="reply-box">
          <div className="chips">
            {hasEmail && <button type="button" className={`chip sm ${channel === "email" ? "on" : ""}`} onClick={() => setChannel("email")}>Email</button>}
            {hasPhone && <button type="button" className={`chip sm ${channel === "sms" ? "on" : ""}`} onClick={() => setChannel("sms")}>Text</button>}
          </div>
          {channel === "email" && (
            <input className="field" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" />
          )}
          <textarea className="field logta" rows={3} placeholder={channel === "sms" ? "The text — keep it short" : "The email"} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Reply" />
          <div className="row" style={{ marginTop: 0 }}>
            <button type="button" className="go" disabled={busy || !body.trim()} onClick={send}>{busy ? "Sending…" : channel === "sms" ? "Send text" : "Send email"}</button>
            {said && <span className={`said ${said.ok ? "" : "bad"}`}>{said.message}</span>}
          </div>
        </div>
      )}

      {messages.length === 0 ? (
        <p className="empty" style={{ marginBottom: 16 }}>Nothing sent or received yet. Every email, text, call and portal message lands here from now on.</p>
      ) : (
        <div className="msgs" data-testid="messages">
          {messages.map((m) => {
            const long = m.body.length > 400;
            const shown = open.has(m.id) || !long;
            const word = STATUS_WORD[m.status] ?? m.status;
            return (
              <div key={m.id} className={`msg ${m.direction} ${m.direction === "in" && !m.read_at ? "unread" : ""}`}>
                <span>
                  <span className="msghead">
                    <b>{m.direction === "in" ? "They wrote" : "We sent"}</b>
                    <span>{CHANNEL[m.channel] ?? m.channel}</span>
                    {m.direction === "in" && m.from_address && <span>from {m.from_address}</span>}
                    {m.direction === "out" && m.to_address && <span>to {m.to_address}</span>}
                    {m.subject && <span>· {m.subject}</span>}
                  </span>
                  <span className={`msgbody ${shown ? "" : "clip"}`}>{shown ? m.body : m.body.slice(0, 400) + "…"}</span>
                  {long && <button type="button" className="chip sm" style={{ marginTop: 6 }} onClick={() => setOpen((o) => { const n = new Set(o); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })}>{shown ? "Less" : "More"}</button>}
                </span>
                <span style={{ textAlign: "right" }}>
                  <span className="evwhen">{stamp(m.occurred_at)}</span><br />
                  {word && <span className={`msgstatus ${m.status === "failed" || m.status === "bounced" || m.status === "complained" || m.status === "not_configured" ? "bad" : m.status === "delivered" || m.status === "opened" || m.status === "clicked" ? "good" : ""}`}>{word}</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
