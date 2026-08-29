"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { dryRunCampaign, saveCampaign, type DryRunReport } from "../../campaignActions";

type Step = { step: number; templateId: string | null; waitDays: number; channel: "email" | "sms" };

/**
 * Building one campaign, and — the part that matters — seeing who would get it.
 *
 * The dry run calls the real segment evaluator, the real sweep and the real
 * guard chain. It writes nothing. A preview built from different code than the
 * send is a preview that lies, and this is the screen someone decides on.
 */
export default function CampaignBuilder({ id, initial, segments, templates }: {
  id: string;
  initial: { name: string; segmentKey: string; status: "draft" | "live" | "paused"; steps: Step[]; autoSend: boolean };
  segments: Array<{ key: string; name: string; description: string }>;
  templates: Array<{ id: string; name: string; approved: boolean }>;
}) {
  const [name, setName] = useState(initial.name);
  const [segmentKey, setSegmentKey] = useState(initial.segmentKey);
  const [status, setStatus] = useState(initial.status);
  const [steps, setSteps] = useState<Step[]>(
    initial.steps.length ? initial.steps : [{ step: 1, templateId: null, waitDays: 0, channel: "email" }],
  );
  const [said, setSaid] = useState<{ ok: boolean; message: string } | null>(null);
  const [report, setReport] = useState<DryRunReport | null>(null);
  const [busy, start] = useTransition();

  const segment = segments.find((s) => s.key === segmentKey);
  const renumber = (list: Step[]) => list.map((s, i) => ({ ...s, step: i + 1 }));
  const patch = (i: number, next: Partial<Step>) =>
    setSteps((cur) => cur.map((s, n) => (n === i ? { ...s, ...next } : s)));

  const save = (over: Partial<Parameters<typeof saveCampaign>[1]> = {}) =>
    start(async () => setSaid(await saveCampaign(id, { name, segmentKey, steps, status, ...over })));

  return (
    <>
      <div className="row">
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Campaign name" />
        <button className="go" disabled={busy} onClick={() => save()}>{busy ? "Saving…" : "Save"}</button>
      </div>

      <div className="panel" style={{ marginTop: 14 }}>
        <p className="plabel">Who it goes to</p>
        <select className="field" value={segmentKey} onChange={(e) => setSegmentKey(e.target.value)}>
          {segments.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
        </select>
        {segment && <p className="bhint" style={{ marginTop: 7 }}>{segment.description}</p>}
        <p className="bhint">
          The list is asked again at send time, so anyone who stops matching stops receiving.
        </p>
      </div>

      <p className="plabel" style={{ marginTop: 18 }}>The steps</p>
      {steps.map((s, i) => (
        <div className="bcard" key={i}>
          <div className="bhead">
            <span className="bkind">Step {s.step}</span>
            {steps.length > 1 && (
              <button className="bbtn" aria-label="Remove step"
                onClick={() => setSteps((cur) => renumber(cur.filter((_, n) => n !== i)))}>×</button>
            )}
          </div>
          <label className="bfield">
            <span>Send this email</span>
            <select className="field" value={s.templateId ?? ""} onChange={(e) => patch(i, { templateId: e.target.value || null })}>
              <option value="">— nothing chosen —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}{t.approved ? "" : " (not approved)"}</option>
              ))}
            </select>
          </label>
          <label className="bfield">
            <span>{i === 0 ? "Wait before the first one (days)" : "Wait after the previous step (days)"}</span>
            <input className="field" inputMode="numeric" value={String(s.waitDays)}
              onChange={(e) => patch(i, { waitDays: Math.max(0, Math.min(365, Number(e.target.value.replace(/[^0-9]/g, "")) || 0)) })} />
          </label>
        </div>
      ))}
      <button className="chip" onClick={() => setSteps((cur) => renumber([...cur, { step: cur.length + 1, templateId: null, waitDays: 7, channel: "email" }]))}>
        + Another step
      </button>
      {templates.length === 0 && (
        <p className="partial" style={{ marginTop: 12 }}>
          No emails written yet. <Link href="/crm/campaigns/emails" style={{ textDecoration: "underline" }}>Write one first</Link> —
          a step with no email queues nothing.
        </p>
      )}

      <p className="plabel" style={{ marginTop: 18 }}>Before you turn it on</p>
      <div className="panel">
        <button className="go" disabled={busy} onClick={() => start(async () => {
          const r = await dryRunCampaign(id);
          setSaid(r);
          setReport(r.ok ? r.data ?? null : null);
        })}>
          {busy ? "Working it out…" : "Who would get this?"}
        </button>
        <p className="bhint" style={{ marginTop: 8 }}>
          Runs the real list, the real sweep and the real guard chain, and writes nothing.
        </p>

        {report && (
          <div style={{ marginTop: 14 }}>
            <div className="stats">
              <div className="stat"><span>On the list</span><b>{report.matching}</b><em>right now</em></div>
              <div className="stat"><span>Would go</span><b>{report.wouldQueue.length}</b><em>if approved</em></div>
              <div className="stat"><span>Would wait</span><b>{report.held.length}</b><em>timing or frequency</em></div>
              <div className="stat"><span>Would not go</span><b>{report.stopped.length}</b><em>and why</em></div>
            </div>
            {report.notes.map((n) => <p className="partial" key={n}>{n}</p>)}
            {[["Waiting", report.held], ["Not going", report.stopped], ["Ready", report.wouldQueue]].map(([label, rows]) => {
              const list = rows as DryRunReport["held"];
              return list.length === 0 ? null : (
                <div key={label as string} style={{ marginTop: 12 }}>
                  <p className="plabel">{label as string}</p>
                  <div className="table">
                    {list.slice(0, 25).map((r, i) => (
                      <div className="trow" key={i} style={{ gridTemplateColumns: "1fr 1.2fr" }}>
                        <span>{r.name}</span>
                        <span style={{ color: "var(--muted)", fontSize: 12 }}>{r.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="plabel" style={{ marginTop: 18 }}>Status</p>
      <div className="chips">
        {(["draft", "live", "paused"] as const).map((v) => (
          <button key={v} className={`chip ${status === v ? "on" : ""}`} disabled={busy}
            onClick={() => { setStatus(v); save({ status: v }); }}>
            {v}
          </button>
        ))}
      </div>
      <p className="bhint" style={{ marginTop: 8 }}>
        Live means it enrols people and queues messages. It does not mean anything is sent:
        every message waits for approval, and there is no sending code yet.
      </p>

      {said && <p className={`said ${said.ok ? "" : "bad"}`}>{said.message}</p>}
    </>
  );
}
