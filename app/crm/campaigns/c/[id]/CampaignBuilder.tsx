"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { CAMPAIGN_CLASSES, EXIT_RULES, STEP_CONDITIONS, effectiveExits, type CampaignClass, type ExitRule, type StepCondition } from "@/lib/campaigns/guard";
import { TRIGGER_EVENTS, type CampaignStep } from "@/lib/campaigns/sweep";
import { campaignStats, dryRunCampaign, saveCampaign, type CampaignStats, type DryRunReport } from "../../campaignActions";

/**
 * Building one campaign (P5), and — the part that matters — seeing who would
 * get it and what happened to the ones that went.
 *
 * Three decisions up top: what KIND it is (a follow-up about their own quote,
 * or marketing), what STARTS it (a list, or an event), and what ENDS it (the
 * exit rules). Then the steps, each with a wait counted from the start and a
 * condition. The dry run calls the real audience query, the real planner and
 * the real guard chain and writes nothing.
 */

export type BuilderInitial = {
  name: string;
  class: CampaignClass;
  entry: "audience" | "event";
  segmentKey: string | null;
  triggerEvent: string | null;
  exitRules: ExitRule[];
  status: "draft" | "live" | "paused";
  steps: CampaignStep[];
  autoSend: boolean;
  conversionDays: number;
  lastSweptAt: string | null;
};

const money = (c: number) => "$" + Math.round(c / 100).toLocaleString("en-AU");
const pct = (n: number, of: number) => (of > 0 ? ` · ${Math.round((n / of) * 100)}%` : "");

export default function CampaignBuilder({ id, initial, segments, templates }: {
  id: string;
  initial: BuilderInitial;
  segments: Array<{ key: string; name: string; description: string }>;
  templates: Array<{ id: string; name: string; approved: boolean; kind: "email" | "sms" }>;
}) {
  const [name, setName] = useState(initial.name);
  const [cls, setCls] = useState<CampaignClass>(initial.class);
  const [entry, setEntry] = useState(initial.entry);
  const [segmentKey, setSegmentKey] = useState(initial.segmentKey ?? "");
  const [triggerEvent, setTriggerEvent] = useState(initial.triggerEvent ?? "estimate_sent");
  const [exitRules, setExitRules] = useState<ExitRule[]>(initial.exitRules);
  const [status, setStatus] = useState(initial.status);
  const [autoSend, setAutoSend] = useState(initial.autoSend);
  const [conversionDays, setConversionDays] = useState(initial.conversionDays);
  const [steps, setSteps] = useState<CampaignStep[]>(
    initial.steps.length ? initial.steps : [{ step: 1, templateId: null, afterDays: 0, channel: "email", condition: "none" }],
  );
  const [said, setSaid] = useState<{ ok: boolean; message: string } | null>(null);
  const [report, setReport] = useState<DryRunReport | null>(null);
  const [stats, setStats] = useState<CampaignStats | null>(null);
  const [busy, start] = useTransition();

  useEffect(() => {
    let live = true;
    campaignStats(id).then((r) => { if (live && r.ok && r.data) setStats(r.data); });
    return () => { live = false; };
  }, [id]);

  const segment = segments.find((s) => s.key === segmentKey);
  const always = effectiveExits({ class: cls, entry, exitRules: [] });
  const renumber = (list: CampaignStep[]) => list.map((s, i) => ({ ...s, step: i + 1 }));
  const patch = (i: number, next: Partial<CampaignStep>) =>
    setSteps((cur) => cur.map((s, n) => (n === i ? { ...s, ...next } : s)));
  const anchorWord = entry === "event"
    ? (TRIGGER_EVENTS.find((t) => t.key === triggerEvent)?.label.toLowerCase() ?? "the event")
    : "they join";

  const save = (over: Parameters<typeof saveCampaign>[1] = {}) =>
    start(async () => setSaid(await saveCampaign(id, {
      name, class: cls, entry, segmentKey: segmentKey || null, triggerEvent: entry === "event" ? triggerEvent : null,
      exitRules, steps, status, autoSend, conversionDays, ...over,
    })));

  return (
    <>
      <div className="row">
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Campaign name" />
        <button className="go" disabled={busy} onClick={() => save()} data-testid="save-campaign">{busy ? "Saving…" : "Save"}</button>
      </div>

      {stats && (stats.enrolled > 0 || stats.sent > 0) && (
        <div className="panel" style={{ marginTop: 14 }} data-testid="stats">
          <p className="plabel">How it&rsquo;s going</p>
          <div className="funnel">
            <div><span>Enrolled</span><b>{stats.enrolled}</b><em>{stats.active} still in it</em></div>
            <div><span>Sent</span><b>{stats.sent}</b><em>{stats.waiting} waiting · {stats.stopped} stopped</em></div>
            <div><span>Delivered</span><b>{stats.delivered}</b><em>{stats.bounced} bounced</em></div>
            <div><span>Opened</span><b>{stats.opened}</b><em>of sent{pct(stats.opened, stats.sent)}</em></div>
            <div><span>Clicked</span><b>{stats.clicked}</b><em>of sent{pct(stats.clicked, stats.sent)}</em></div>
            <div><span>Replied</span><b>{stats.replied}</b><em>within 14 days</em></div>
            <div><span>Unsubscribed</span><b>{stats.unsubscribed}</b><em>after a send</em></div>
            <div><span>Converted</span><b>{stats.converted}</b><em>accepted within {conversionDays} days</em></div>
            <div><span>Revenue</span><b>{money(stats.revenue_cents)}</b><em>from those quotes</em></div>
          </div>
          <p className="bhint" style={{ margin: 0 }}>
            Opens and clicks come from the mail service and the tracked links; texts count as delivered, not opened.
          </p>
        </div>
      )}

      <p className="plabel" style={{ marginTop: 18 }}>What kind of campaign</p>
      <div className="kinds">
        {CAMPAIGN_CLASSES.map((c) => (
          <button key={c.key} type="button" className={`kind ${cls === c.key ? "on" : ""}`} data-testid={`class-${c.key}`}
            onClick={() => setCls(c.key)}>
            <b>{c.label}</b><span>{c.help}</span>
          </button>
        ))}
      </div>

      <p className="plabel" style={{ marginTop: 18 }}>What starts it</p>
      <div className="kinds">
        <button type="button" className={`kind ${entry === "audience" ? "on" : ""}`} onClick={() => setEntry("audience")} data-testid="entry-audience">
          <b>Everyone on a list</b><span>The list is asked again every sweep; new matches join, and anyone who stops matching stops receiving.</span>
        </button>
        <button type="button" className={`kind ${entry === "event" ? "on" : ""}`} onClick={() => setEntry("event")} data-testid="entry-event">
          <b>When something happens</b><span>Each person joins the moment the event happens to them, and the waits count from that moment.</span>
        </button>
      </div>
      <div className="panel">
        {entry === "event" && (
          <label className="bfield" style={{ marginTop: 0 }}>
            <span>The event</span>
            <select className="field" value={triggerEvent} onChange={(e) => setTriggerEvent(e.target.value)} data-testid="trigger-event">
              {TRIGGER_EVENTS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
            <span style={{ marginTop: 4 }}>{TRIGGER_EVENTS.find((t) => t.key === triggerEvent)?.help}</span>
          </label>
        )}
        <label className="bfield" style={{ marginTop: entry === "event" ? 9 : 0 }}>
          <span>{entry === "event" ? "Only people on this list (optional)" : "The list"}</span>
          <select className="field" value={segmentKey} onChange={(e) => setSegmentKey(e.target.value)} data-testid="segment">
            {entry === "event" && <option value="">— anyone —</option>}
            {entry === "audience" && !segmentKey && <option value="">— pick a list —</option>}
            {segments.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
          </select>
        </label>
        {segment && <p className="bhint" style={{ marginTop: 7 }}>{segment.description}</p>}
        <p className="bhint" style={{ marginBottom: 0 }}>
          <Link href="/crm/segments" style={{ textDecoration: "underline" }}>Build or change a list</Link>
        </p>
      </div>

      <p className="plabel" style={{ marginTop: 18 }}>What ends it</p>
      <div className="panel">
        {EXIT_RULES.map((x) => {
          const forced = always.has(x.key);
          const on = forced || exitRules.includes(x.key);
          return (
            <label className="exit" key={x.key}>
              <input type="checkbox" checked={on} disabled={forced} data-testid={`exit-${x.key}`}
                onChange={(e) => setExitRules((cur) => (e.target.checked ? [...new Set([...cur, x.key])] : cur.filter((k) => k !== x.key)))} />
              <div>
                {x.label}{forced ? <i className="cchip" style={{ marginLeft: 6 }}>always</i> : null}
                <span>{x.help}</span>
              </div>
            </label>
          );
        })}
        <p className="bhint" style={{ margin: "8px 0 0" }}>
          Checked at every sweep and again at the moment of sending. A hit finishes their run — nothing further from this campaign.
        </p>
      </div>

      <p className="plabel" style={{ marginTop: 18 }}>The steps — waits count from when {anchorWord}</p>
      {steps.map((s, i) => (
        <div className="bcard" key={i} data-testid={`step-${s.step}`}>
          <div className="bhead">
            <span className="bkind">Step {s.step}</span>
            {steps.length > 1 && (
              <button className="bbtn" aria-label="Remove step"
                onClick={() => setSteps((cur) => renumber(cur.filter((_, n) => n !== i)))}>×</button>
            )}
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <label className="bfield" style={{ flex: 1, marginTop: 0 }}>
              <span>Send as</span>
              <select className="field" value={s.channel}
                onChange={(e) => {
                  const channel = e.target.value as "email" | "sms";
                  // A channel change orphans a template of the other kind — clear
                  // it rather than quietly sending an email body as a text.
                  patch(i, { channel, templateId: null });
                }}>
                <option value="email">Email</option>
                <option value="sms">Text message</option>
              </select>
            </label>
            <label className="bfield" style={{ flex: 1, marginTop: 0 }}>
              <span>Days after {anchorWord}</span>
              <input className="field" inputMode="numeric" value={String(s.afterDays)} data-testid={`step-${s.step}-days`}
                onChange={(e) => patch(i, { afterDays: Math.max(0, Math.min(730, Number(e.target.value.replace(/[^0-9]/g, "")) || 0)) })} />
            </label>
            <label className="bfield" style={{ flex: 1, marginTop: 0 }}>
              <span>Plus hours</span>
              <input className="field" inputMode="numeric" value={String(s.afterHours ?? 0)}
                onChange={(e) => patch(i, { afterHours: Math.max(0, Math.min(23, Number(e.target.value.replace(/[^0-9]/g, "")) || 0)) })} />
            </label>
          </div>
          <label className="bfield">
            <span>{s.channel === "sms" ? "Send this text" : "Send this email"}</span>
            <select className="field" value={s.templateId ?? ""} onChange={(e) => patch(i, { templateId: e.target.value || null })} data-testid={`step-${s.step}-template`}>
              <option value="">— nothing chosen —</option>
              {templates.filter((t) => t.kind === s.channel).map((t) => (
                <option key={t.id} value={t.id}>{t.name}{t.approved ? "" : " (not approved)"}</option>
              ))}
            </select>
          </label>
          {s.channel === "sms" && templates.filter((t) => t.kind === "sms").length === 0 && (
            <p className="bhint">No texts written yet — start one under Emails &amp; texts.</p>
          )}
          <label className="bfield">
            <span>Only if…</span>
            <select className="field" value={s.condition} onChange={(e) => patch(i, { condition: e.target.value as StepCondition })} data-testid={`step-${s.step}-condition`}>
              {STEP_CONDITIONS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <span style={{ marginTop: 4 }}>{STEP_CONDITIONS.find((c) => c.key === s.condition)?.help}</span>
          </label>
        </div>
      ))}
      <button className="chip" data-testid="add-step" onClick={() => setSteps((cur) => renumber([...cur, {
        step: cur.length + 1, templateId: null, afterDays: (cur[cur.length - 1]?.afterDays ?? 0) + 7, channel: "email", condition: "none",
      }]))}>
        + Another step
      </button>
      {cls === "followup" && steps.length > 4 && (
        <p className="partial" style={{ marginTop: 12 }}>A quote follow-up is four steps at most — after that it&rsquo;s marketing.</p>
      )}
      {templates.length === 0 && (
        <p className="partial" style={{ marginTop: 12 }}>
          No emails written yet. <Link href="/crm/campaigns/emails" style={{ textDecoration: "underline" }}>Write one first</Link> —
          a step with no email queues nothing.
        </p>
      )}

      <p className="plabel" style={{ marginTop: 18 }}>Before you turn it on</p>
      <div className="panel">
        <button className="go" disabled={busy} data-testid="dry-run" onClick={() => start(async () => {
          const r = await dryRunCampaign(id);
          setSaid(r);
          setReport(r.ok ? r.data ?? null : null);
        })}>
          {busy ? "Working it out…" : "Who would get this?"}
        </button>
        <p className="bhint" style={{ marginTop: 8 }}>
          Runs the real list (or the real event scan), the real sweep and the real guard chain, and writes nothing. Save first.
        </p>

        {report && (
          <div style={{ marginTop: 14 }} data-testid="dry-run-result">
            <div className="stats">
              <div className="stat"><span>{entry === "audience" ? "On the list" : "To enrol"}</span><b>{report.matching.toLocaleString("en-AU")}</b><em>right now</em></div>
              <div className="stat"><span>Would go</span><b>{report.wouldQueue.length}</b><em>{autoSend ? "on its own" : "if approved"}</em></div>
              <div className="stat"><span>Would wait</span><b>{report.held.length}</b><em>timing, frequency or approval</em></div>
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

      <p className="plabel" style={{ marginTop: 18 }}>Sending</p>
      <div className="panel">
        <label className="switch">
          <input type="checkbox" checked={autoSend} data-testid="auto-send"
            onChange={(e) => { setAutoSend(e.target.checked); save({ autoSend: e.target.checked }); }} />
          <div>
            Auto-send: due messages go out on their own, inside the sending window
            <span className="bhint" style={{ display: "block", margin: "2px 0 0" }}>
              Off, every message waits in the queue for a person. On, the guard chain still runs on every one — consent, exits, conditions,
              the monthly cap, weekdays 9–6 — and only then does it go. The sweep runs each weekday morning.
            </span>
          </div>
        </label>
        <label className="bfield" style={{ maxWidth: 260 }}>
          <span>Count a conversion if they accept within (days)</span>
          <input className="field" inputMode="numeric" value={String(conversionDays)}
            onChange={(e) => setConversionDays(Math.max(1, Math.min(365, Number(e.target.value.replace(/[^0-9]/g, "")) || 30)))} />
        </label>
      </div>

      <p className="plabel" style={{ marginTop: 18 }}>Status</p>
      <div className="chips">
        {(["draft", "live", "paused"] as const).map((v) => (
          <button key={v} className={`chip ${status === v ? "on" : ""}`} disabled={busy} data-testid={`status-${v}`}
            onClick={() => { setStatus(v); save({ status: v }); }}>
            {v}
          </button>
        ))}
      </div>
      <p className="bhint" style={{ marginTop: 8 }}>
        Live means it enrols people and queues messages from the next sweep.
        {autoSend ? " Auto-send is on, so due messages go on their own inside the sending window." : " Every message waits for approval on the queue."}
        {initial.lastSweptAt ? ` Last swept ${new Date(initial.lastSweptAt).toLocaleString("en-AU", { timeZone: "Australia/Melbourne" })}.` : ""}
      </p>

      {said && <p className={`said ${said.ok ? "" : "bad"}`} data-testid="said">{said.message}</p>}
    </>
  );
}
