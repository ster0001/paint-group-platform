"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { approveAndSend, approveMany, cancelMessage, removeFromCampaign, sweepNow } from "../campaignActions";

type Item = {
  id: string; accountId: string; enrolmentId: string; accountName: string; email: string; campaign: string; campaignId: string;
  campaignClass: string; autoSend: boolean; templateName: string; templateId: string | null; subject: string;
  templateApproved: boolean; step: number; condition: string; channel: string; state: string; reason: string | null;
  approved: boolean; dueAt: string | null;
};

export default function Queue({ waiting, done, campaigns, filter }: {
  waiting: Item[]; done: Item[]; campaigns: Array<{ id: string; name: string }>; filter: string;
}) {
  const [said, setSaid] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, start] = useTransition();
  const [working, setWorking] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const router = useRouter();

  const run = (id: string | null, work: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => { setWorking(id); setSaid(await work()); setWorking(null); });

  const approvable = waiting.filter((m) => m.templateApproved && !m.approved);
  const chosen = approvable.filter((m) => picked.has(m.id));
  const toggle = (id: string) => setPicked((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <>
      <div className="panel">
        <div className="row" style={{ marginTop: 0 }}>
          <button className="go" disabled={busy} onClick={() => run(null, sweepNow)} data-testid="sweep-now">
            {busy && working === null ? "Sweeping…" : "Sweep now"}
          </button>
          <select className="field" style={{ maxWidth: 260 }} value={filter} aria-label="Campaign"
            onChange={(e) => router.push(e.target.value ? `/crm/campaigns/queue?c=${e.target.value}` : "/crm/campaigns/queue")}>
            <option value="">Every campaign</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <p className="bhint" style={{ flex: 1, margin: 0 }}>
            Runs the same sweep the schedule runs each weekday morning: it enrols, queues, and delivers only what auto-send or an earlier approval allows.
          </p>
        </div>
        {approvable.length > 0 && (
          <div className="row">
            <button className="chip" onClick={() => setPicked(new Set(approvable.map((m) => m.id)))}>Select all {approvable.length}</button>
            <button className="chip" onClick={() => setPicked(new Set())} disabled={picked.size === 0}>Clear</button>
            <button className="go" disabled={busy || chosen.length === 0} data-testid="approve-selected"
              onClick={() => run("many", async () => { const r = await approveMany(chosen.map((m) => m.id)); setPicked(new Set()); return r; })}>
              {busy && working === "many" ? "Sending…" : `Approve & send ${chosen.length || ""}`.trim()}
            </button>
          </div>
        )}
        {said && <p className={`said ${said.ok ? "" : "bad"}`} data-testid="queue-said">{said.message}</p>}
      </div>

      {waiting.map((m) => (
        <div className="bcard" key={m.id} data-testid={`queue-${m.id}`}>
          <div className="bhead">
            {m.templateApproved && !m.approved && (
              <input type="checkbox" className="qsel" checked={picked.has(m.id)} onChange={() => toggle(m.id)} aria-label={`Select ${m.accountName}`} />
            )}
            <span className="bkind">
              {m.campaign} · step {m.step}{m.channel === "sms" ? " · text" : ""}{m.campaignClass === "followup" ? " · follow-up" : ""}
            </span>
            <span className={`cchip ${m.state === "held" ? "warn" : ""}`}>{m.state === "held" ? (m.approved ? "approved · held" : "waiting") : "to approve"}</span>
          </div>
          <p className="segname" style={{ fontSize: 14 }}>
            <Link href={`/crm/customers/${m.accountId}`}>{m.accountName}</Link>
          </p>
          <p className="segdesc" style={{ margin: "2px 0 8px" }}>
            {m.email} · &ldquo;{m.subject || m.templateName}&rdquo;
            {m.condition !== "none" ? ` · only if ${m.condition.replace(/_/g, " ")}` : ""}
          </p>
          {m.reason && <p className="bhint" style={{ margin: "0 0 8px" }}>{m.reason}</p>}
          {!m.templateApproved && (
            <p className="partial" style={{ margin: "0 0 8px" }}>
              Nobody has read this {m.channel === "sms" ? "text" : "email"} yet — approve it under Emails &amp; texts first.
            </p>
          )}
          <div className="chips">
            {!m.approved && (
              <button className="go" disabled={busy} onClick={() => run(m.id, () => approveAndSend(m.id))} data-testid="approve-one">
                {busy && working === m.id ? "Sending…" : "Approve & send"}
              </button>
            )}
            {m.templateId && (
              <Link className="chip" href={`/crm/campaigns/emails/${m.templateId}`}>Edit the {m.channel === "sms" ? "text" : "email"}</Link>
            )}
            <button className="chip" disabled={busy}
              onClick={() => run(m.id, () => cancelMessage(m.id, "Cancelled by the office."))}>
              Cancel this one
            </button>
            <button className="chip" disabled={busy}
              onClick={() => run(m.id, () => removeFromCampaign(m.enrolmentId))}>
              Take them out of the campaign
            </button>
          </div>
        </div>
      ))}

      {done.length > 0 && (
        <>
          <p className="plabel" style={{ marginTop: 20 }}>Already dealt with</p>
          <div className="table">
            {done.slice(0, 60).map((m) => (
              <div className="trow" key={m.id} style={{ gridTemplateColumns: "1fr 90px 1.2fr" }}>
                <span>{m.accountName} <i className="cchip">{m.campaign} · {m.step}</i></span>
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
