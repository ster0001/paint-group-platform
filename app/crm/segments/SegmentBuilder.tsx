"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Criterion } from "@/lib/crm/segments";
import { deleteSegment, previewCriteria, saveSegment } from "./actions";

/**
 * Building a list by hand (Tom, 30 Aug: "we need to have control over building
 * this, not a predefined list").
 *
 * Every rule is a FORM ROW — a field, a comparison, a value — never a query
 * box. The menu below is the entire vocabulary, including the journey fields
 * the funnels need: unfinished estimate, how far through, how long ago they
 * left, whether they uploaded, how many times they came back.
 *
 * The preview under it runs the real evaluator over the real customers, so the
 * number someone builds against is the number the campaign will act on.
 */

const MENU: Array<{ label: string; hint: string; blank: Criterion; group: string }> = [
  // ---- who they are ----
  { group: "Who they are", label: "Has had work done", hint: "A customer, or not yet", blank: { field: "is_customer", op: "is", value: true } },
  { group: "Who they are", label: "Was quoted", hint: "Ever given a price", blank: { field: "quoted", op: "is", value: true } },
  { group: "Who they are", label: "Job type", hint: "Interior, exterior, both", blank: { field: "job_type", op: "is", value: "interior" } },
  { group: "Who they are", label: "Never had a…", hint: "The cross-sell rule", blank: { field: "has_job_type", op: "is_not", value: "exterior" } },
  { group: "Who they are", label: "Suburb", hint: "One or more, comma-separated", blank: { field: "suburb", op: "is", value: [] } },
  { group: "Who they are", label: "Temperature", hint: "Your own hot/warm/cold", blank: { field: "temperature", op: "is", value: ["hot"] } },
  // ---- their history ----
  { group: "Their history", label: "Job value", hint: "Total won work, between", blank: { field: "job_value", op: "between", minCents: 0, maxCents: 3_000_000 } },
  { group: "Their history", label: "Completed", hint: "Time since the last job", blank: { field: "completed", op: "more_than", months: 12 } },
  { group: "Their history", label: "Last contact", hint: "Any touch at all", blank: { field: "last_contact", op: "more_than", months: 6 } },
  // ---- where they are in the journey ----
  { group: "Their journey", label: "Unfinished estimate", hint: "Started the wizard, didn't finish", blank: { field: "abandoned_draft", op: "is", value: true } },
  { group: "Their journey", label: "Estimate progress", hint: "How far through they got", blank: { field: "draft_progress", op: "less_than", pct: 80 } },
  { group: "Their journey", label: "Left it", hint: "How long since they were in it", blank: { field: "draft_age", op: "more_than", hours: 24 } },
  { group: "Their journey", label: "Uploaded a plan or photos", hint: "Real effort — nobody does it idly", blank: { field: "draft_uploaded", op: "is", value: true } },
  { group: "Their journey", label: "Came back", hint: "Separate visits to their draft", blank: { field: "draft_visits", op: "more_than", count: 1 } },
  // ---- guardrails ----
  { group: "Never include", label: "Exclude…", hint: "Unsubscribed, open work, snoozed", blank: { field: "status", op: "is_not", value: ["unsubscribed", "open_work"] } },
];

type Preview = { count: number; sample: Array<{ accountId: string; name: string; detail: string }>; worthCents: number | null; averageCents: number | null };

const money = (c: number) => "$" + Math.round(c / 100).toLocaleString("en-AU");

export default function SegmentBuilder({ initial }: {
  initial: { key: string | null; name: string; description: string; criteria: Criterion[]; standing: boolean };
}) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [criteria, setCriteria] = useState<Criterion[]>(initial.criteria);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [said, setSaid] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, start] = useTransition();
  const router = useRouter();

  const patch = (i: number, next: Criterion) => {
    setCriteria((cur) => cur.map((c, n) => (n === i ? next : c)));
    setPreview(null);   // the number on screen no longer matches the rules
  };
  const remove = (i: number) => { setCriteria((cur) => cur.filter((_, n) => n !== i)); setPreview(null); };
  const add = (blank: Criterion) => { setCriteria((cur) => [...cur, structuredClone(blank)]); setPreview(null); };

  const opSelect = (i: number, c: Criterion & { op: string }, ops: Array<[string, string]>) => (
    <select className="field rop-select" value={c.op}
      onChange={(e) => patch(i, { ...c, op: e.target.value } as Criterion)}>
      {ops.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
  const num = (value: number, onChange: (n: number) => void, width = 90) => (
    <input className="field" style={{ maxWidth: width, minWidth: width }} inputMode="numeric" value={String(value)}
      onChange={(e) => onChange(Number(e.target.value.replace(/[^0-9]/g, "")) || 0)} />
  );

  const editor = (c: Criterion, i: number) => {
    switch (c.field) {
      case "is_customer": return null;   // rendered by editorWrapped below
      case "quoted": return (<><span className="rfield">Was quoted</span>
        <select className="field rop-select" value={c.value ? "yes" : "no"}
          onChange={(e) => patch(i, { ...c, value: e.target.value === "yes" })}>
          <option value="yes">yes</option><option value="no">no</option>
        </select></>);
      case "job_type": return (<><span className="rfield">Job type</span>
        {opSelect(i, c, [["is", "is"], ["is_not", "is not"]])}
        <select className="field rop-select" value={c.value}
          onChange={(e) => patch(i, { ...c, value: e.target.value as typeof c.value })}>
          <option value="interior">interior</option><option value="exterior">exterior</option><option value="both">both</option>
        </select></>);
      case "has_job_type": return (<><span className="rfield">Has never had</span>
        <select className="field rop-select" value={c.value}
          onChange={(e) => patch(i, { ...c, value: e.target.value as typeof c.value })}>
          <option value="exterior">an exterior job</option><option value="interior">an interior job</option>
        </select></>);
      case "suburb": return (<><span className="rfield">Suburb</span><span className="rop">is</span>
        <input className="field" placeholder="Camberwell, Kew, Balwyn" value={c.value.join(", ")}
          onChange={(e) => patch(i, { ...c, value: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) })} /></>);
      case "temperature": return (<><span className="rfield">Temperature</span><span className="rop">is</span>
        {(["hot", "warm", "cold"] as const).map((t) => (
          <button key={t} className={`chip ${c.value.includes(t) ? "on" : ""}`}
            onClick={() => patch(i, { ...c, value: c.value.includes(t) ? c.value.filter((v) => v !== t) : [...c.value, t] })}>{t}</button>
        ))}</>);
      case "job_value": return (<><span className="rfield">Job value</span><span className="rop">between $</span>
        {num(Math.round(c.minCents / 100), (n) => patch(i, { ...c, minCents: n * 100 }))}
        <span className="rop">and $</span>
        {num(Math.round(c.maxCents / 100), (n) => patch(i, { ...c, maxCents: n * 100 }))}</>);
      case "completed": return (<><span className="rfield">Completed</span>
        {opSelect(i, c, [["more_than", "more than"], ["less_than", "less than"]])}
        {num(c.months, (n) => patch(i, { ...c, months: n }), 70)}<span className="rop">months ago</span></>);
      case "last_contact": return (<><span className="rfield">Last contact</span>
        {opSelect(i, c, [["more_than", "more than"], ["less_than", "less than"]])}
        {num(c.months, (n) => patch(i, { ...c, months: n }), 70)}<span className="rop">months ago</span></>);
      case "abandoned_draft": return (<><span className="rfield">Unfinished estimate</span>
        <select className="field rop-select" value={c.value ? "yes" : "no"}
          onChange={(e) => patch(i, { ...c, value: e.target.value === "yes" })}>
          <option value="yes">yes</option><option value="no">no</option>
        </select></>);
      case "draft_progress": return (<><span className="rfield">Estimate progress</span>
        {opSelect(i, c, [["less_than", "less than"], ["more_than", "more than"]])}
        {num(c.pct, (n) => patch(i, { ...c, pct: Math.min(100, n) }), 70)}<span className="rop">% answered</span></>);
      case "draft_age": return (<><span className="rfield">Left it</span>
        {opSelect(i, c, [["more_than", "more than"], ["less_than", "less than"]])}
        {num(c.hours, (n) => patch(i, { ...c, hours: n }), 70)}<span className="rop">hours ago</span></>);
      case "draft_uploaded": return (<><span className="rfield">Uploaded a plan or photos</span>
        <select className="field rop-select" value={c.value ? "yes" : "no"}
          onChange={(e) => patch(i, { ...c, value: e.target.value === "yes" })}>
          <option value="yes">yes</option><option value="no">no</option>
        </select></>);
      case "draft_visits": return (<><span className="rfield">Came back</span><span className="rop">more than</span>
        {num(c.count, (n) => patch(i, { ...c, count: Math.max(1, n) }), 60)}<span className="rop">time{c.count === 1 ? "" : "s"}</span></>);
      case "status": return (<><span className="rfield">Never include</span>
        {(["unsubscribed", "open_work", "snoozed"] as const).map((v) => (
          <button key={v} className={`chip ${c.value.includes(v) ? "on" : ""}`}
            onClick={() => patch(i, { ...c, value: c.value.includes(v) ? c.value.filter((x) => x !== v) : [...c.value, v] })}>
            {v === "open_work" ? "has open work" : v}
          </button>
        ))}</>);
    }
  };

  // The is_customer editor above cheats its select through the op slot; wire
  // its change properly here to keep the switch readable.
  const editorWrapped = (c: Criterion, i: number) => {
    if (c.field === "is_customer") {
      return (<><span className="rfield">Has had work done</span>
        <select className="field rop-select" value={c.value ? "yes" : "no"}
          onChange={(e) => patch(i, { ...c, value: e.target.value === "yes" })}>
          <option value="yes">yes</option><option value="no">no</option>
        </select></>);
    }
    return editor(c, i);
  };

  const groups = [...new Set(MENU.map((m) => m.group))];

  return (
    <>
      <div className="row">
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name the list — “Left their estimate, big job”" />
        <button className="go" disabled={busy} onClick={() => start(async () => {
          const r = await saveSegment({ key: initial.key, name, description, criteria });
          setSaid(r);
          if (r.ok && !initial.key && r.data) router.push(`/crm/segments/${r.data.key}`);
        })}>{busy ? "Saving…" : "Save list"}</button>
      </div>
      <input className="field" style={{ marginTop: 8, width: "100%" }} value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="One line on who this is — future-you will thank you" />

      <p className="plabel" style={{ marginTop: 18 }}>The rules — everyone on the list matches ALL of them</p>
      {criteria.length === 0 && <p className="empty">No rules yet. Add one below — start with who they are.</p>}
      <div className="rules" style={{ marginTop: 8 }}>
        {criteria.map((c, i) => (
          <div className="rule redit" key={i}>
            {i > 0 && <i className="and">and</i>}
            {editorWrapped(c, i)}
            <button className="bbtn" aria-label="Remove rule" onClick={() => remove(i)}>×</button>
          </div>
        ))}
      </div>

      <p className="plabel" style={{ marginTop: 16 }}>Add a rule</p>
      {groups.map((g) => (
        <div key={g} style={{ marginTop: 8 }}>
          <p className="bhint" style={{ margin: "0 0 5px" }}>{g}</p>
          <div className="chips">
            {MENU.filter((m) => m.group === g).map((m) => (
              <button key={m.label} className="chip" title={m.hint} onClick={() => add(m.blank)}>+ {m.label}</button>
            ))}
          </div>
        </div>
      ))}

      <div className="panel" style={{ marginTop: 18 }}>
        <div className="row">
          <button className="go" disabled={busy || criteria.length === 0} onClick={() => start(async () => {
            const r = await previewCriteria(criteria);
            setSaid(r);
            setPreview(r.ok ? r.data ?? null : null);
          })}>{busy ? "Counting…" : "Who matches right now?"}</button>
          <p className="bhint" style={{ flex: 1, margin: 0 }}>
            The same evaluator every campaign uses — this number is who a campaign would act on.
          </p>
        </div>
        {preview && (
          <div style={{ marginTop: 12 }}>
            <div className="stats">
              <div className="stat"><span>Match today</span><b>{preview.count}</b>
                <em>{preview.count === 1 ? "person" : "people"}</em></div>
              <div className="stat"><span>Worth roughly</span>
                <b>{preview.worthCents == null ? "—" : money(preview.worthCents)}</b>
                <em>{preview.averageCents == null ? "no finished jobs to average yet" : `at ${money(preview.averageCents)}, your average job`}</em></div>
            </div>
            {preview.sample.length > 0 && (
              <div className="table" style={{ marginTop: 10 }}>
                {preview.sample.map((s) => (
                  <div className="trow" key={s.accountId} style={{ gridTemplateColumns: "1fr 1fr" }}>
                    <span>{s.name}</span>
                    <span style={{ color: "var(--muted)", fontSize: 12 }}>{s.detail || "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {initial.key && (
        <button className="chip" style={{ marginTop: 16 }} disabled={busy} onClick={() => start(async () => {
          const r = await deleteSegment(initial.key!);
          setSaid(r);
          if (r.ok) router.push("/crm/segments");
        })}>Delete this list</button>
      )}
      {said && <p className={`said ${said.ok ? "" : "bad"}`}>{said.message}</p>}
    </>
  );
}
