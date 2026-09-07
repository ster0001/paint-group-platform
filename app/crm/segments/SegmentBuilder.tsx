"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FIELD_BY_KEY, FIELD_GROUPS, FIELDS, OPS, blankRule, type FieldDef, type Rule } from "@/lib/crm/fields";
import type { Audience, RuleGroup } from "@/lib/crm/segments";
import { deleteSegment, previewAudience, saveSegment, type AudiencePreview } from "./actions";

/**
 * Building a list by hand (Tom, 30 Aug: "we need to have control over building
 * this, not a predefined list") — P5: with groups.
 *
 * Everyone on the list matches EVERY group. Inside a group, the office picks
 * "all of these" or "any of these", and any rule can be flipped to NOT. That
 * is the pivot-style if / and / or Tom described; a second level of nesting is
 * deliberately not offered.
 *
 * Every rule is a FORM ROW — a field, a comparison, a value — never a query
 * box, and the menu is the field registry: nothing here knows a column name.
 * The preview under it runs the real SQL evaluator over the facts layer, so
 * the number someone builds against is the number the campaign acts on.
 */

export type BuilderOptions = {
  tags: Array<{ value: string; label: string }>;
  owners: Array<{ value: string; label: string }>;
  campaigns: Array<{ value: string; label: string }>;
};

const money = (c: number) => "$" + Math.round(c / 100).toLocaleString("en-AU");

export default function SegmentBuilder({ initial, options }: {
  initial: { key: string | null; name: string; description: string; audience: Audience; standing: boolean; dropped?: string[]; legacy?: boolean };
  options: BuilderOptions;
}) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [audience, setAudience] = useState<Audience>(initial.audience.groups.length ? initial.audience : { groups: [{ match: "all", rules: [] }] });
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [said, setSaid] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, start] = useTransition();
  const [adding, setAdding] = useState<number | null>(null);
  const router = useRouter();

  const total = audience.groups.reduce((n, g) => n + g.rules.length, 0);
  const setGroups = (fn: (groups: RuleGroup[]) => RuleGroup[]) => {
    setAudience((cur) => ({ groups: fn(cur.groups) }));
    setPreview(null);   // the number on screen no longer matches the rules
  };
  const patchRule = (g: number, i: number, next: Rule) =>
    setGroups((groups) => groups.map((grp, n) => (n === g ? { ...grp, rules: grp.rules.map((r, m) => (m === i ? next : r)) } : grp)));
  const removeRule = (g: number, i: number) =>
    setGroups((groups) => groups.map((grp, n) => (n === g ? { ...grp, rules: grp.rules.filter((_, m) => m !== i) } : grp)));
  const addRule = (g: number, key: string) => {
    setGroups((groups) => groups.map((grp, n) => (n === g ? { ...grp, rules: [...grp.rules, blankRule(key)] } : grp)));
    setAdding(null);
  };
  const setMatch = (g: number, match: "all" | "any") => setGroups((groups) => groups.map((grp, n) => (n === g ? { ...grp, match } : grp)));
  const addGroup = () => setGroups((groups) => [...groups, { match: "any", rules: [] }]);
  const removeGroup = (g: number) => setGroups((groups) => groups.filter((_, n) => n !== g));

  const optionsFor = (f: FieldDef): Array<{ value: string; label: string }> =>
    f.optionSource === "tags" ? options.tags
    : f.optionSource === "owners" ? options.owners
    : f.optionSource === "campaigns" ? options.campaigns
    : f.options ?? [];

  const num = (value: unknown, onChange: (n: number) => void, width = 80, scale = 1) => (
    <input className="field" style={{ maxWidth: width, minWidth: width }} inputMode="numeric"
      value={String(Math.round((Number(value) || 0) / scale))}
      onChange={(e) => onChange((Number(e.target.value.replace(/[^0-9]/g, "")) || 0) * scale)} />
  );

  const chips = (list: Array<{ value: string; label: string }>, value: unknown, onChange: (v: string[]) => void) => {
    const cur = Array.isArray(value) ? (value as string[]) : [];
    return list.map((o) => (
      <button key={o.value} type="button" className={`chip ${cur.includes(o.value) ? "on" : ""}`}
        onClick={() => onChange(cur.includes(o.value) ? cur.filter((x) => x !== o.value) : [...cur, o.value])}>{o.label}</button>
    ));
  };

  const valueEditor = (f: FieldDef, r: Rule, g: number, i: number) => {
    const set = (value: unknown) => patchRule(g, i, { ...r, value });
    switch (f.type) {
      case "enum": case "tags": case "campaign":
        return chips(optionsFor(f), r.value, set);
      case "owner":
        return r.op === "is" ? chips(optionsFor(f), r.value, set) : null;
      case "bool":
        return (
          <select className="field rop-select" value={r.value === false ? "no" : "yes"} onChange={(e) => set(e.target.value === "yes")}>
            <option value="yes">yes</option><option value="no">no</option>
          </select>
        );
      case "text":
        return (
          <input className="field" placeholder="Camberwell, Kew, Balwyn" value={Array.isArray(r.value) ? (r.value as string[]).join(", ") : ""}
            onChange={(e) => set(e.target.value.split(",").map((v) => v.trim()).filter(Boolean))} />
        );
      case "number":
        return r.op === "between"
          ? (<>{num(Array.isArray(r.value) ? r.value[0] : 0, (n) => set([n, Array.isArray(r.value) ? r.value[1] : n]))}<span className="rop">and</span>{num(Array.isArray(r.value) ? r.value[1] : 0, (n) => set([Array.isArray(r.value) ? r.value[0] : 0, n]))}</>)
          : num(r.value, set);
      case "money":
        return r.op === "between"
          ? (<>{num(Array.isArray(r.value) ? r.value[0] : 0, (n) => set([n, Array.isArray(r.value) ? r.value[1] : n]), 90, 100)}<span className="rop">and $</span>{num(Array.isArray(r.value) ? r.value[1] : 0, (n) => set([Array.isArray(r.value) ? r.value[0] : 0, n]), 90, 100)}</>)
          : num(r.value, set, 90, 100);
      case "minutes":
        return (<>{num(r.value, set, 70, 60)}<span className="rop">minutes</span></>);
      case "days":
        return r.op === "more_than_days" || r.op === "less_than_days" ? (<>{num(r.value, set, 70)}<span className="rop">days{r.op === "more_than_days" ? " ago" : ""}</span></>) : null;
      case "due":
        return r.op === "within_days" ? (<>{num(r.value, set, 70)}<span className="rop">days</span></>) : null;
    }
  };

  const ruleRow = (r: Rule, g: number, i: number) => {
    const f = FIELD_BY_KEY[r.field];
    if (!f) return <span className="rop">Unknown rule “{r.field}” — remove it.</span>;
    const ops = OPS[f.type];
    return (
      <>
        <button type="button" className={`chip rnot ${r.not ? "on" : ""}`} title="Flip this rule to NOT"
          onClick={() => patchRule(g, i, { ...r, not: !r.not })}>{r.not ? "not" : "is"}</button>
        <span className="rfield" title={f.help}>{f.label}</span>
        {ops.length > 1 ? (
          <select className="field rop-select" value={r.op} onChange={(e) => {
            const op = e.target.value;
            const fresh = blankRule(f.key);
            // Keep the value when the shape still fits; otherwise start the operator clean.
            const keep = (op === "between") === (r.op === "between") && !(f.type === "days" && (op === "never" || op === "ever"));
            patchRule(g, i, { ...r, op, value: keep ? r.value : (op === "between" ? [0, 0] : fresh.value) });
          }}>
            {ops.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
          </select>
        ) : <span className="rop">{ops[0].label}</span>}
        {valueEditor(f, r, g, i)}
      </>
    );
  };

  return (
    <>
      <div className="row">
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name the list — “Quoted, opened it, gone quiet”" />
        <button className="go" disabled={busy} onClick={() => start(async () => {
          const r = await saveSegment({ key: initial.key, name, description, audience });
          setSaid(r);
          if (r.ok && !initial.key && r.data) router.push(`/crm/segments/${r.data.key}`);
        })}>{busy ? "Saving…" : "Save list"}</button>
      </div>
      <input className="field" style={{ marginTop: 8, width: "100%" }} value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="One line on who this is — future-you will thank you" />

      {initial.legacy && (
        <p className="partial" style={{ marginTop: 12 }}>
          This list was built before rule groups existed. It has been translated; check it reads right and save it once.
          {initial.dropped?.length ? ` Rules with no home in the new builder were left out: ${initial.dropped.join(", ")}.` : ""}
        </p>
      )}

      <p className="plabel" style={{ marginTop: 18 }}>The rules — everyone on the list matches every group</p>
      {audience.groups.map((grp, g) => (
        <div className="bcard" key={g} data-testid={`group-${g}`}>
          <div className="bhead">
            <span className="bkind">{g === 0 ? "Group 1" : `and group ${g + 1}`}</span>
            <span className="rop">match</span>
            <select className="field rop-select" value={grp.match} onChange={(e) => setMatch(g, e.target.value as "all" | "any")} aria-label={`Group ${g + 1} match`}>
              <option value="all">all of these</option>
              <option value="any">any of these</option>
            </select>
            {audience.groups.length > 1 && (
              <button className="bbtn" aria-label={`Remove group ${g + 1}`} onClick={() => removeGroup(g)}>×</button>
            )}
          </div>
          {grp.rules.length === 0 && <p className="bhint" style={{ margin: "8px 0 0" }}>No rules in this group yet.</p>}
          <div className="rules" style={{ marginTop: 8 }}>
            {grp.rules.map((r, i) => (
              <div className="rule redit" key={i}>
                {i > 0 && <i className="and">{grp.match === "any" ? "or" : "and"}</i>}
                {ruleRow(r, g, i)}
                <button className="bbtn" aria-label="Remove rule" onClick={() => removeRule(g, i)}>×</button>
              </div>
            ))}
          </div>
          {adding === g ? (
            <div style={{ marginTop: 10 }}>
              {FIELD_GROUPS.map((grpName) => (
                <div key={grpName} style={{ marginTop: 6 }}>
                  <p className="bhint" style={{ margin: "0 0 4px" }}>{grpName}</p>
                  <div className="chips">
                    {FIELDS.filter((f) => f.group === grpName).map((f) => (
                      <button key={f.key} className="chip" title={f.help} onClick={() => addRule(g, f.key)}>+ {f.label}</button>
                    ))}
                  </div>
                </div>
              ))}
              <button className="chip" style={{ marginTop: 8 }} onClick={() => setAdding(null)}>Never mind</button>
            </div>
          ) : (
            <button className="chip" style={{ marginTop: 10 }} onClick={() => setAdding(g)} data-testid={`add-rule-${g}`}>+ Add a rule</button>
          )}
        </div>
      ))}
      <button className="chip" onClick={addGroup} data-testid="add-group">+ Another group (and…)</button>
      <p className="bhint" style={{ marginTop: 8 }}>
        A second group is how you say “and one of these”: past customers, <b>and</b> (in Kew <b>or</b> tagged VIP).
      </p>

      <div className="panel" style={{ marginTop: 18 }}>
        <div className="row">
          <button className="go" disabled={busy || total === 0} data-testid="preview" onClick={() => start(async () => {
            const r = await previewAudience(audience);
            setSaid(r);
            setPreview(r.ok ? r.data ?? null : null);
          })}>{busy ? "Counting…" : "Who matches right now?"}</button>
          <p className="bhint" style={{ flex: 1, margin: 0 }}>
            Counted by the database over every customer — the same question the campaign asks before each send.
          </p>
        </div>
        {preview && (
          <div style={{ marginTop: 12 }} data-testid="preview-result">
            <div className="stats">
              <div className="stat"><span>Match today</span><b>{preview.count.toLocaleString("en-AU")}</b>
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
