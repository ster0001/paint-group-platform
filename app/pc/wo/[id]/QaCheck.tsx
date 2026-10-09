"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordQa, tickQaItem } from "../../actions";
import { logCallbackAction } from "@/app/pc/callbackActions";
import { uploadFailureText, uploadWorkOrderMedia } from "@/lib/workorder/uploadMedia";

export type QaStandard = { id: string; label: string; detail: string; done: boolean };
export type QaCheckView = {
  id: string; kind: string; result: string | null; thinRecord: boolean;
  /** The failed check this one re-inspects (migration 20270196), or null. */
  retryOf: string | null;
  /** A logged FAIL that already has its re-check — a record, not a hold. */
  superseded: boolean;
  standards: QaStandard[];
};

/**
 * A quality check, worked through rather than rubber-stamped.
 *
 * The standards come from the lifecycle mockup and are ticked one at a time; a
 * PASS is refused until every one has been looked at. A FAIL is not — the point
 * of a fail is to record what was wrong and get it back to the painter, on the
 * same tick list they already use.
 *
 * A FAIL is never reset. It spawns its own re-check (same kind, `retryOf` = the
 * failed check, all standards fresh) the moment it is logged; the painter's
 * re-finish brings the job back here and THAT card is the one with controls.
 * The failed card stays as the record and says where its re-check went.
 */

export default function QaCheck({ check, workOrderId }: { check: QaCheckView; workOrderId: string }) {
  const router = useRouter();
  const [standards, setStandards] = useState(check.standards);
  const [result, setResult] = useState(check.result);
  const [notes, setNotes] = useState("");
  const [failing, setFailing] = useState(false);
  const [heading, setHeading] = useState("");
  const [label, setLabel] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Photos of exactly where it failed (Tom, 1 Sep #2) — uploaded as they're
  // picked, kind 'qa', tagged with the "Where". The painter sees them on the
  // job's fail card. Multiple allowed.
  const [failPhotos, setFailPhotos] = useState(0);
  const [uploading, setUploading] = useState(false);
  // Step 3 route 1 (ruling C2/C4): a logged FAIL asks whether the painter can
  // rectify today (a failed check, no call back) or it needs another day.
  const [askCallback, setAskCallback] = useState(false);
  const [callbackDate, setCallbackDate] = useState("");
  const [callbackDone, setCallbackDone] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  async function uploadFailPhoto(file: File) {
    setUploading(true);
    setMessage(null);
    try {
      await uploadWorkOrderMedia({
        workOrderId, file, kind: "qa",
        area: heading.trim() || "Rectification",
        caption: label.trim() ? `QA fail — ${label.trim().slice(0, 280)}` : "QA fail",
      });
      setFailPhotos((n) => n + 1);
    } catch (e) {
      setMessage(uploadFailureText(e, file));
    } finally {
      setUploading(false);
    }
  }

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
      if (r.ok) {
        setResult(outcome);
        setMessage(r.message ?? null);
        setFailing(false);
        if (outcome === "fail") setAskCallback(true);
        // The last PASS sends the pack and the job moves to Walkthrough; a FAIL
        // sends it back to In progress. Either way the rest of this page (next
        // step, walkthrough card, rail) must show the new stage — refresh it.
        router.refresh();
      }
      else setMessage(r.message);
    });
  }

  const kindLabel = check.kind === "mid" ? "mid-job" : check.kind.replace(/_/g, " ");

  function logCallback() {
    setMessage(null);
    startTransition(async () => {
      const r = await logCallbackAction({
        workOrderId, source: "qc_fail", reason: "workmanship", qaCheckId: check.id,
        description: label.trim() ? `Quality check failed: ${label.trim()}` : "Quality check failed",
        returnStart: callbackDate || null, returnEnd: callbackDate || null,
      });
      if (r.ok) { setCallbackDone(r.message); setAskCallback(false); router.refresh(); }
      else setMessage(r.message);
    });
  }

  if (result) {
    // A fail logged this session has its re-check on the way (the refresh
    // draws it); one loaded from the record has it already.
    const rechecked = check.superseded || result === "fail";
    return (
      <div className="card" data-testid={`qa-${check.id}`}>
        <h3>Quality check <em>{kindLabel}{check.retryOf ? " · re-check" : ""}</em></h3>
        {askCallback && (
          <div className="card" style={{ borderColor: "rgba(224,168,60,.45)" }} data-testid={`qa-callback-ask-${check.id}`}>
            <h3>Can the contractor rectify today, or is it a call back?</h3>
            <p className="note">Fixed today: a failed check, no call back. Another day: a call back is logged against the painter and the return visit goes in their scheduler.</p>
            <div className="row" style={{ alignItems: "flex-end" }}>
              <button type="button" className="btn" disabled={pending} onClick={() => setAskCallback(false)} data-testid={`qa-callback-today-${check.id}`}>Fixed today</button>
              <label className="fld">Return visit
                <input type="date" className="num" style={{ width: 150 }} value={callbackDate} onChange={(e) => setCallbackDate(e.target.value)} data-testid={`qa-callback-date-${check.id}`} />
              </label>
              <button type="button" className="btn primary" disabled={pending} onClick={logCallback} data-testid={`qa-callback-yes-${check.id}`}>Call back</button>
            </div>
          </div>
        )}
        {callbackDone && <p className="note" data-testid={`qa-callback-done-${check.id}`}>{callbackDone}</p>}
        <p className="note" data-testid={`qa-result-${check.id}`}>
          Logged: <b style={{ color: result === "pass" ? "var(--emerald)" : "var(--clay)" }}>
            {result.toUpperCase()}
          </b>
          {check.thinRecord && " · thin photo record"}
          {result === "fail" && rechecked && (
            <> · re-check scheduled — it appears here once the painter finishes again</>
          )}
        </p>
        {message && <p className="note" data-testid={`qa-msg-${check.id}`}>{message}</p>}
      </div>
    );
  }

  return (
    <div className="card" data-testid={`qa-${check.id}`}>
      <h3>
        Quality check <em>{check.retryOf ? "re-check · " : ""}{left === 0 ? "ready to log" : `${left} to check`}</em>
      </h3>
      <p className="note">
        {check.retryOf
          ? "Re-inspection after a fail: the rectification is ticked, every standard looked at again before a pass."
          : "Photo-logged against the standards. Every line looked at before a pass."}
      </p>

      {message && <p className="note" style={{ color: "var(--amber)" }} data-testid={`qa-msg-${check.id}`}>{message}</p>}

      {/* The finish standard for each surface on the job, at the job's level —
          the same record the painter opened from their work order, so both
          sides judge against the same words. */}

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
          {/* No `capture` — camera OR gallery, the painter-side rule. */}
          <input ref={fileInput} type="file" hidden multiple
            accept="image/jpeg,image/png,image/webp,image/heic"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = "";
              void (async () => { for (const f of files) await uploadFailPhoto(f); })();
            }} />
          <button type="button" className="btn" disabled={uploading}
            onClick={() => fileInput.current?.click()} data-testid={`qa-fail-photo-${check.id}`}>
            {uploading ? "Uploading…"
              : failPhotos === 0 ? "📷 Photos of where it failed — show the painter"
              : `📷 ${failPhotos} photo${failPhotos === 1 ? "" : "s"} attached — add another`}
          </button>
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
