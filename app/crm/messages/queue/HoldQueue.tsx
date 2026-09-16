"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { approveHold, approveHolds, skipHold } from "./queueActions";

export type HoldItem = {
  id: string; key: string; name: string; audience: string; who: string; accountId: string | null; workOrderId: string | null;
  toEmail: string | null; toPhone: string | null; channels: string[]; subject: string | null; bodyText: string; hasHtml: boolean;
  smsBody: string | null; reason: "approve" | "quiet" | "cap"; reasonDetail: string | null; releaseAt: string | null;
  status: "pending" | "held" | "sent" | "skipped" | "failed"; result: Record<string, unknown> | null; createdAt: string;
};

const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default function HoldQueue({ waiting, done }: { waiting: HoldItem[]; done: HoldItem[] }) {
  const [said, setSaid] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, start] = useTransition();
  const [working, setWorking] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);

  const run = (id: string | null, work: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => { setWorking(id); setSaid(await work()); setWorking(null); });
  const pending = waiting.filter((m) => m.status === "pending");
  const chosen = pending.filter((m) => picked.has(m.id));
  const toggle = (id: string) => setPicked((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <>
      {pending.length > 0 && (
        <div className="panel">
          <div className="row" style={{ marginTop: 0 }}>
            <button className="chip" onClick={() => setPicked(new Set(pending.map((m) => m.id)))}>Select all {pending.length}</button>
            <button className="chip" onClick={() => setPicked(new Set())} disabled={picked.size === 0}>Clear</button>
            <button className="go" disabled={busy || chosen.length === 0} data-testid="approve-selected"
              onClick={() => run("many", async () => { const r = await approveHolds(chosen.map((m) => m.id)); setPicked(new Set()); return r; })}>
              {busy && working === "many" ? "Sending…" : `Approve & send ${chosen.length || ""}`.trim()}
            </button>
          </div>
          {said && <p className={`said ${said.ok ? "" : "bad"}`} data-testid="queue-said">{said.message}</p>}
        </div>
      )}
      {pending.length === 0 && said && <p className={`said ${said.ok ? "" : "bad"}`} data-testid="queue-said">{said.message}</p>}
      {waiting.length === 0 && <p className="bhint" data-testid="queue-empty">Nothing waiting. Automatic messages are going out on their own.</p>}

      {waiting.map((m) => (
        <div className="bcard" key={m.id} data-testid={`hold-${m.id}`} data-automation={m.key}>
          <div className="bhead">
            {m.status === "pending" && (
              <input type="checkbox" className="qsel" checked={picked.has(m.id)} onChange={() => toggle(m.id)} aria-label={`Select ${m.who}`} />
            )}
            <span className="bkind">{m.name} · to {m.audience === "painter" ? "the painter" : m.audience === "office" ? "staff" : "the customer"} · {m.channels.map((c) => (c === "sms" ? "text" : "email")).join(" + ")}</span>
            <span className={`cchip ${m.status === "held" ? "warn" : ""}`}>
              {m.status === "held" ? `held · goes ${m.releaseAt ? when(m.releaseAt) : "soon"}` : "to approve"}
            </span>
          </div>
          <p className="segname" style={{ fontSize: 14 }}>
            {m.accountId ? <Link href={`/crm/customers/${m.accountId}`}>{m.who}</Link> : m.who}
            {m.workOrderId && <> · <Link href={`/pc/wo/${m.workOrderId}`}>job</Link></>}
          </p>
          <p className="segdesc" style={{ margin: "2px 0 8px" }}>
            {[m.toEmail, m.toPhone].filter(Boolean).join(" · ")}{m.subject ? <> · &ldquo;{m.subject}&rdquo;</> : null}
          </p>
          {m.reasonDetail && <p className="bhint" style={{ margin: "0 0 8px" }}>{m.reasonDetail}</p>}

          {editing === m.id ? (
            <EditForm m={m} busy={busy} onCancel={() => setEditing(null)}
              onSend={(edits) => run(m.id, async () => { const r = await approveHold(m.id, edits); if (r.ok) setEditing(null); return r; })} />
          ) : (
            <details style={{ margin: "0 0 8px" }}>
              <summary className="bhint" style={{ cursor: "pointer" }}>Read it</summary>
              {m.channels.includes("email") && <pre style={{ whiteSpace: "pre-wrap", font: "inherit", fontSize: 13, margin: "6px 0" }} data-testid="hold-email-body">{m.bodyText}</pre>}
              {m.channels.includes("sms") && m.smsBody && <p className="segdesc"><b>Text:</b> {m.smsBody}</p>}
            </details>
          )}

          <div className="chips">
            <button className="go" disabled={busy} onClick={() => run(m.id, () => approveHold(m.id))} data-testid="approve-one">
              {busy && working === m.id ? "Sending…" : m.status === "held" ? "Send now" : "Approve & send"}
            </button>
            <button className="chip" disabled={busy} onClick={() => setEditing((e) => (e === m.id ? null : m.id))} data-testid="edit-one">
              {editing === m.id ? "Close" : "Edit then send"}
            </button>
            <button className="chip" disabled={busy} data-testid="skip-one"
              onClick={() => run(m.id, () => skipHold(m.id, "Skipped by the office."))}>
              Skip
            </button>
          </div>
        </div>
      ))}

      {done.length > 0 && (
        <>
          <p className="plabel" style={{ marginTop: 20 }}>Already dealt with</p>
          <div className="table">
            {done.slice(0, 60).map((m) => (
              <div className="trow" key={m.id} style={{ gridTemplateColumns: "1fr 90px 1.2fr" }} data-testid={`done-${m.id}`}>
                <span>{m.who} <i className="cchip">{m.name}</i></span>
                <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{m.status}</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{typeof m.result?.reason === "string" ? m.result.reason : m.result ? "sent" : "—"}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function EditForm({ m, busy, onCancel, onSend }: {
  m: HoldItem; busy: boolean; onCancel: () => void;
  onSend: (edits: { subject?: string; bodyText?: string; smsBody?: string }) => void;
}) {
  const [subject, setSubject] = useState(m.subject ?? "");
  const [bodyText, setBodyText] = useState(m.bodyText);
  const [smsBody, setSmsBody] = useState(m.smsBody ?? "");
  const email = m.channels.includes("email");
  const sms = m.channels.includes("sms");
  return (
    <div className="panel" style={{ margin: "0 0 8px" }} data-testid="hold-edit">
      {email && (
        <>
          <label className="plabel">Subject<input className="field" value={subject} onChange={(e) => setSubject(e.target.value)} data-testid="edit-subject" /></label>
          <label className="plabel">Message<textarea className="field" rows={8} value={bodyText} onChange={(e) => setBodyText(e.target.value)} data-testid="edit-body" /></label>
        </>
      )}
      {sms && <label className="plabel">Text message<textarea className="field" rows={3} value={smsBody} onChange={(e) => setSmsBody(e.target.value)} data-testid="edit-sms" /></label>}
      <div className="chips">
        <button className="go" disabled={busy} data-testid="edit-send"
          onClick={() => onSend({ ...(email ? { subject, bodyText } : {}), ...(sms ? { smsBody } : {}) })}>Send with these changes</button>
        <button className="chip" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
