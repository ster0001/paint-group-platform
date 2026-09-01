"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordQa, tickQaItem } from "../../actions";

export type QaStandard = { id: string; label: string; detail: string; done: boolean };
export type QaCheckView = {
  id: string; kind: string; result: string | null; thinRecord: boolean;
  standards: QaStandard[];
};

/**
 * A quality check, worked through rather than rubber-stamped.
 *
 * The standards come from the lifecycle mockup and are ticked one at a time; a
 * PASS is refused until every one has been looked at. A FAIL is not — the point
 * of a fail is to record what was wrong and get it back to the painter, on the
 * same tick list they already use.
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
  const fileInput = useRef<HTMLInputElement | null>(null);

  async function uploadFailPhoto(file: File) {
    setUploading(true);
    setMessage(null);
    try {
      const signRes = await fetch("/api/wo/photos", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workOrderId, size: file.size }),
      });
      const sign = await signRes.json();
      if (!signRes.ok) throw new Error(sign.error ?? "upload");
      const put = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/upload/sign/wo-photos/${sign.path}?token=${sign.token}`,
        { method: "PUT", body: file },
      );
      if (!put.ok) throw new Error("upload");
      const ingest = await fetch("/api/wo/photos", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workOrderId, path: sign.path, kind: "qa",
          area: heading.trim() || "Rectification",
          caption: label.trim() ? `QA fail — ${label.trim().slice(0, 280)}` : "QA fail",
        }),
      });
      const done = await ingest.json();
      if (!ingest.ok) throw new Error(done.error ?? "upload");
      setFailPhotos((n) => n + 1);
    } catch (e) {
      setMessage(e instanceof Error && e.message !== "upload" ? e.message : "That photo didn't upload — try again.");
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
        // The last PASS sends the pack and the job moves to Walkthrough; a FAIL
        // sends it back to In progress. Either way the rest of this page (next
        // step, walkthrough card, rail) must show the new stage — refresh it.
        router.refresh();
      }
      else setMessage(r.message);
    });
  }

  if (result) {
    return (
      <div className="card" data-testid={`qa-${check.id}`}>
        <h3>Quality check <em>{check.kind.replace(/_/g, " ")}</em></h3>
        <p className="note" data-testid={`qa-result-${check.id}`}>
          Logged: <b style={{ color: result === "pass" ? "var(--emerald)" : "var(--clay)" }}>
            {result.toUpperCase()}
          </b>
          {check.thinRecord && " · thin photo record"}
        </p>
        {message && <p className="note" data-testid={`qa-msg-${check.id}`}>{message}</p>}
      </div>
    );
  }

  return (
    <div className="card" data-testid={`qa-${check.id}`}>
      <h3>
        Quality check <em>{left === 0 ? "ready to log" : `${left} to check`}</em>
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
