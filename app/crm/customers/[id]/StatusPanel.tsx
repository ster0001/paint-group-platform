"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTag, setPermission, setRelationshipState, setTags } from "../../recordActions";
import type { CrmResult } from "../../actions";
import {
  LOST_REASONS, PERMIT_CHANNELS, PERMIT_LABEL, RELATIONSHIP_STATES, STATE_HELP, STATE_LABEL,
  type PermitChannel, type PermitValue, type RelationshipState,
} from "@/lib/crm/states";

/**
 * P4 — the status model on the record (deep dive §4.5): relationship state
 * (with its date, reason and the five ruled lost reasons), per-channel contact
 * permissions with provenance, and tags. Five independent dimensions, not one
 * dropdown nobody updates.
 */
export type TagOption = { key: string; label: string };

const localDay = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };
const fmt = (iso: string) => new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));

export default function StatusPanel({ accountId, state, stateUntil, stateNote, stateReason, lostReason, permits, permitMeta, tags, tagOptions }: {
  accountId: string;
  state: RelationshipState;
  stateUntil: string | null;
  stateNote: string | null;
  stateReason: string | null;
  lostReason: string | null;
  permits: Record<PermitChannel, PermitValue>;
  permitMeta: Record<string, { how?: string; at?: string }>;
  tags: string[];
  tagOptions: TagOption[];
}) {
  const [picking, setPicking] = useState<RelationshipState | null>(null);
  const [until, setUntil] = useState(localDay(30));
  const [note, setNote] = useState("");
  const [reason, setReason] = useState<string>(LOST_REASONS[0].key);
  const [newTag, setNewTag] = useState("");
  const [said, setSaid] = useState<CrmResult | null>(null);
  const [busy, start] = useTransition();
  const router = useRouter();

  const run = (work: () => Promise<CrmResult>) => start(async () => {
    const r = await work();
    setSaid(r);
    if (r.ok) { setPicking(null); setNote(""); router.refresh(); }
  });

  const pick = (s: RelationshipState) => {
    if (s === state && s !== "delayed" && s !== "lost") return;
    if (s === "delayed" || s === "lost") { setPicking(s); return; }
    if (s === "archived" && !window.confirm("Archive this record? It disappears from every list except search.")) return;
    run(() => setRelationshipState(accountId, { state: s, note }));
  };

  const toggleTag = (key: string) => {
    const next = tags.includes(key) ? tags.filter((t) => t !== key) : [...tags, key];
    run(() => setTags(accountId, next));
  };

  const addTag = () => start(async () => {
    const r = await createTag(newTag);
    setSaid(r);
    if (r.ok && r.key) { setNewTag(""); const r2 = await setTags(accountId, [...tags, r.key]); setSaid(r2); router.refresh(); }
  });

  return (
    <div className="panel stpanel" data-testid="status-panel">
      <div className="strow">
        <span>Status</span>
        <div>
          <div className="chips">
            {RELATIONSHIP_STATES.map((s) => (
              <button key={s} type="button" className={`chip st-${s} ${state === s ? "on" : ""}`} disabled={busy} onClick={() => pick(s)} data-testid={`state-${s}`}>
                {STATE_LABEL[s]}
              </button>
            ))}
          </div>
          <p className="sthelp">
            {STATE_HELP[state]}
            {state === "delayed" && stateUntil && <> Until <b>{fmt(stateUntil)}</b>{stateNote ? <> — &ldquo;{stateNote}&rdquo;</> : null}.</>}
            {state === "lost" && lostReason && <> Reason: <b>{LOST_REASONS.find((r) => r.key === lostReason)?.label ?? lostReason}</b>{stateNote ? <> — &ldquo;{stateNote}&rdquo;</> : null}.</>}
            {(state === "do_not_contact" || state === "archived") && stateReason && <> &ldquo;{stateReason}&rdquo;.</>}
          </p>
          {picking === "delayed" && (
            <div className="stform" data-testid="delay-form">
              <input className="field" type="date" value={until} min={localDay(1)} onChange={(e) => setUntil(e.target.value)} aria-label="Delayed until" />
              <input className="field" placeholder="What to do when it wakes — “ring about the exterior”" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Delay note" />
              <div className="row">
                <button type="button" className="go" disabled={busy} onClick={() => run(() => setRelationshipState(accountId, { state: "delayed", untilDay: until, note }))}>Delay until {until}</button>
                <button type="button" className="chip" disabled={busy} onClick={() => setPicking(null)}>Cancel</button>
              </div>
            </div>
          )}
          {picking === "lost" && (
            <div className="stform" data-testid="lost-form">
              <select className="field" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Lost reason">
                {LOST_REASONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
              <input className="field" placeholder="Anything else they said" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Lost note" />
              <div className="row">
                <button type="button" className="go" disabled={busy} onClick={() => run(() => setRelationshipState(accountId, { state: "lost", lostReason: reason, note }))}>Mark lost</button>
                <button type="button" className="chip" disabled={busy} onClick={() => setPicking(null)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="strow">
        <span>May we</span>
        <div className="permrow">
          {PERMIT_CHANNELS.map((c) => (
            <div key={c} className="perm" data-testid={`permit-${c}`}>
              <b>{PERMIT_LABEL[c]}</b>
              <span className="seg">
                {(["allowed", "declined", "unknown"] as PermitValue[]).map((v) => (
                  <button key={v} type="button" className={permits[c] === v ? "on" : ""} disabled={busy} onClick={() => run(() => setPermission(accountId, c, v))}>
                    {v === "allowed" ? "Yes" : v === "declined" ? "No" : "Unknown"}
                  </button>
                ))}
              </span>
              <small>{permitMeta[c]?.how ? `${String(permitMeta[c].how).replace(/_/g, " ")}${permitMeta[c].at ? ` · ${fmt(String(permitMeta[c].at))}` : ""}` : "not asked yet"}</small>
            </div>
          ))}
        </div>
      </div>

      <div className="strow">
        <span>Tags</span>
        <div className="tagpick" data-testid="tags">
          {tagOptions.map((t) => (
            <button key={t.key} type="button" className={`tag ${tags.includes(t.key) ? "on" : ""}`} disabled={busy} onClick={() => toggleTag(t.key)}>{t.label}</button>
          ))}
          <input className="field sm" placeholder="New tag…" value={newTag} onChange={(e) => setNewTag(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newTag.trim()) addTag(); }} aria-label="New tag" style={{ minWidth: 120 }} />
        </div>
      </div>

      {said && <p className={`said ${said.ok ? "" : "bad"}`}>{said.message}</p>}
    </div>
  );
}
