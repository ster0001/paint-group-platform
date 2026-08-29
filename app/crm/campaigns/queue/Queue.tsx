"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { approveAndSend, cancelMessage, sweepNow } from "../campaignActions";

type Item = {
  id: string; accountName: string; email: string; campaign: string;
  templateName: string; templateId: string | null; subject: string;
  templateApproved: boolean; step: number; state: string; reason: string | null;
};

export default function Queue({ waiting, done }: { waiting: Item[]; done: Item[] }) {
  const [said, setSaid] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, start] = useTransition();
  const [working, setWorking] = useState<string | null>(null);

  const run = (id: string | null, work: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => { setWorking(id); setSaid(await work()); setWorking(null); });

  return (
    <>
      <div className="panel">
        <div className="row">
          <button className="go" disabled={busy} onClick={() => run(null, sweepNow)}>
            {busy && working === null ? "Sweeping…" : "Sweep now"}
          </button>
          <p className="bhint" style={{ flex: 1, margin: 0 }}>
            Runs the same sweep the schedule runs each weekday morning. It only ever queues.
          </p>
        </div>
        {said && <p className={`said ${said.ok ? "" : "bad"}`}>{said.message}</p>}
      </div>

      {waiting.map((m) => (
        <div className="bcard" key={m.id}>
          <div className="bhead">
            <span className="bkind">{m.campaign} · step {m.step}</span>
            <span className="cchip">{m.state === "held" ? "waiting" : "to approve"}</span>
          </div>
          <p className="segname" style={{ fontSize: 14 }}>{m.accountName}</p>
          <p className="segdesc" style={{ margin: "2px 0 8px" }}>
            {m.email} · &ldquo;{m.subject || m.templateName}&rdquo;
          </p>
          {m.reason && <p className="bhint" style={{ margin: "0 0 8px" }}>{m.reason}</p>}
          {!m.templateApproved && (
            <p className="partial" style={{ margin: "0 0 8px" }}>
              Nobody has read this email yet — approve the email itself first.
            </p>
          )}
          <div className="chips">
            <button className="go" disabled={busy} onClick={() => run(m.id, () => approveAndSend(m.id))}>
              {busy && working === m.id ? "Sending…" : "Approve & send"}
            </button>
            {m.templateId && (
              <Link className="chip" href={`/crm/campaigns/emails/${m.templateId}`}>Edit the email</Link>
            )}
            <button className="chip" disabled={busy}
              onClick={() => run(m.id, () => cancelMessage(m.id, "Cancelled by the office."))}>
              Cancel
            </button>
          </div>
        </div>
      ))}

      {done.length > 0 && (
        <>
          <p className="plabel" style={{ marginTop: 20 }}>Already dealt with</p>
          <div className="table">
            {done.slice(0, 40).map((m) => (
              <div className="trow" key={m.id} style={{ gridTemplateColumns: "1fr 90px 1.2fr" }}>
                <span>{m.accountName}</span>
                <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{m.state}</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{m.reason ?? "—"}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
