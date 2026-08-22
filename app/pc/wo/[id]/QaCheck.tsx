"use client";

import { useState, useTransition } from "react";
import { recordQa, tickQaItem } from "../../actions";

export type QaStandard = { id: string; label: string; detail: string; done: boolean };
export type QaCheckView = {
  id: string; kind: string; result: string | null; thinRecord: boolean;
  standards: QaStandard[];
};

/**
 * A QA check, worked through rather than rubber-stamped.
 *
 * The standards come from the lifecycle mockup and are ticked one at a time; a
 * PASS is refused until every one has been looked at. A FAIL is not — the point
 * of a fail is to record what was wrong and get it back to the painter, on the
 * same tick list they already use.
 */
export default function QaCheck({ check }: { check: QaCheckView }) {
  const [standards, setStandards] = useState(check.standards);
  const [result, setResult] = useState(check.result);
  const [notes, setNotes] = useState("");
  const [failing, setFailing] = useState(false);
  const [heading, setHeading] = useState("");
  const [label, setLabel] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const left = standards.filter((s) => !s.done).length;

  function tick(item: QaStandard) {
    setMessage(null);
    startTransition(async () => {
      const r = await tickQaItem({ itemId: item.id, done: !item.done });
      if (r.ok) setStandards((ss) => ss.map((s) => (s.id === item.id ? { ...s, done: !s.done } : s)));
      else setMessage(r.message);
    });
  }

  function log(outcome: "pass" | "fail") {
    setMessage(null);
    startTransition(async () => {
      const r = await recordQa({
        checkId: check.id, result: outcome, notes,
        rectify: outcome === "fail" && label.trim()
          ? [{ heading: heading.trim() || "Rectification", label: label.trim() }]
          : [],
      });
      if (r.ok) { setResult(outcome); setMessage(r.message ?? null); setFailing(false); }
      else setMessage(r.message);
    });
  }

  if (result) {
    return (
      <div className="card" data-testid={`qa-${check.id}`}>
        <h3>QA check <em>{check.kind.replace(/_/g, " ")}</em></h3>
        <p className="note" data-testid={`qa-result-${check.id}`}>
          Logged: <b style={{ color: result === "pass" ? "var(--emerald)" : "var(--clay)" }}>
            {result.toUpperCase()}
          </b>
          {check.thinRecord && " · thin photo record"}
        </p>
      </div>
    );
  }

  return (
    <div className="card" data-testid={`qa-${check.id}`}>
      <h3>
        QA check <em>{left === 0 ? "ready to log" : `${left} to check`}</em>
      </h3>
      <p className="note">Photo-logged against the standards. Every line looked at before a pass.</p>

      {message && <p className="note" style={{ color: "var(--amber)" }} data-testid={`qa-msg-${check.id}`}>{message}</p>}

      {standards.map((s) => (
        <button key={s.id} type="button" className={`chk ${s.done ? "on" : ""}`}
          onClick={() => tick(s)} disabled={pending} data-testid={`qa-item-${s.id}`}>
          <span className="chk-box" aria-hidden="true">{s.done ? "✓" : ""}</span>
          <span className="chk-body"><b>{s.label}</b><small>{s.detail}</small></span>
        </button>
      ))}

      <textarea className="edit" rows={2} value={notes} placeholder="Notes (optional)"
        onChange={(e) => setNotes(e.target.value)} data-testid={`qa-notes-${check.id}`} />

      {failing ? (
        <>
          <label className="fld">
            Where
            <input className="num" style={{ width: 140 }} value={heading}
              onChange={(e) => setHeading(e.target.value)} placeholder="Left side"
              data-testid={`qa-where-${check.id}`} />
          </label>
          <textarea className="edit" rows={2} value={label} data-testid={`qa-what-${check.id}`}
            placeholder="What needs putting right — this goes on the painter's tick list"
            onChange={(e) => setLabel(e.target.value)} />
          <div className="row">
            <button type="button" className="btn" disabled={pending || !label.trim()}
              onClick={() => log("fail")} data-testid={`qa-confirm-fail-${check.id}`}>
              Log FAIL — raise rectification
            </button>
            <button type="button" className="btn" onClick={() => setFailing(false)}>Back</button>
          </div>
        </>
      ) : (
        <div className="row">
          <button type="button" className="btn primary" disabled={pending || left > 0}
            onClick={() => log("pass")} data-testid={`qa-pass-${check.id}`}>
            {left > 0 ? `${left} standard${left === 1 ? "" : "s"} to check` : "Log check — PASS"}
          </button>
          <button type="button" className="btn" disabled={pending}
            onClick={() => setFailing(true)} data-testid={`qa-fail-${check.id}`}>
            Log FAIL
          </button>
        </div>
      )}
    </div>
  );
}
