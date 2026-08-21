"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { tickSurfaceAction } from "./tickActions";
import {
  nextState, needsBeforePhoto, progressByHeading, progressOf,
  type SurfaceRow, type SurfaceState,
} from "@/lib/workorder/surfaces";

/**
 * The tick list on the contractor's phone.
 *
 * One tap cycles TO DO → PREPPED → DONE, and round to TO DO again so a mis-tap
 * is fixable without hunting for an undo. The before-photo rule is enforced by
 * the server; this asks for the photo BEFORE the first tap on an elevation so
 * the painter meets it as a prompt rather than an error. If the server refuses
 * anyway (a photo was deleted, two phones at once) the message still lands here.
 */

type Props = {
  workOrderId: string;
  surfaces: SurfaceRow[];
  headingsWithBeforePhoto: string[];
  headingMeta: Record<string, string>;
};

const LABEL: Record<SurfaceState, string> = { todo: "To do", prepped: "Prepped", done: "Done" };

export default function TickList({ workOrderId, surfaces, headingsWithBeforePhoto, headingMeta }: Props) {
  const [rows, setRows] = useState<SurfaceRow[]>(surfaces);
  const [photoHeadings, setPhotoHeadings] = useState<string[]>(headingsWithBeforePhoto);
  const [message, setMessage] = useState<{ text: string; heading?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const pendingHeading = useRef<string | null>(null);

  const headings = useMemo(() => {
    const seen: string[] = [];
    for (const s of rows) if (!seen.includes(s.heading)) seen.push(s.heading);
    return seen;
  }, [rows]);

  const overall = progressOf(rows);
  const byHeading = progressByHeading(rows);

  function askForPhoto(heading: string) {
    pendingHeading.current = heading;
    setMessage({ text: `Before photo of ${heading} — one shot before you start.`, heading });
    fileInput.current?.click();
  }

  async function onPhotoPicked(file: File) {
    const heading = pendingHeading.current;
    if (!heading) return;
    setUploading(heading);
    setMessage(null);
    try {
      const signRes = await fetch("/api/wo/photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workOrderId, path: sign.path, kind: "before", area: heading }),
      });
      const done = await ingest.json();
      if (!ingest.ok) throw new Error(done.error ?? "upload");

      setPhotoHeadings((h) => [...h, heading]);
      setMessage({ text: `Before photo saved for ${heading}. Tick away.` });
    } catch (e) {
      setMessage({ text: e instanceof Error && e.message !== "upload" ? e.message : "That photo didn't upload — check your signal and try again." });
    } finally {
      setUploading(null);
      pendingHeading.current = null;
    }
  }

  function tap(row: SurfaceRow) {
    const to = nextState(row.state);
    // Ask for the photo before the tap, not after the refusal.
    if (to !== "todo" && needsBeforePhoto(row.heading, rows, photoHeadings)) {
      askForPhoto(row.heading);
      return;
    }
    setBusy(row.id);
    setMessage(null);
    startTransition(async () => {
      const result = await tickSurfaceAction({ surfaceId: row.id, to });
      if (result.ok) {
        setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, state: to } : r)));
      } else {
        setMessage({ text: result.message, heading: result.needsPhoto });
        if (result.needsPhoto) setPhotoHeadings((h) => h.filter((x) => x !== result.needsPhoto));
      }
      setBusy(null);
    });
  }

  return (
    <div className="card" style={{ marginTop: 12 }} data-testid="tick-list">
      <div className="tick-head">
        <b>Scope &amp; ticks</b>
        <span className="tick-count" data-testid="tick-progress">{overall.done} / {overall.total}</span>
      </div>
      <div className="tick-prog"><i style={{ width: `${overall.pct}%` }} /></div>

      {message && (
        <p className="tick-msg" role="status" data-testid="tick-message">{message.text}</p>
      )}

      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
        capture="environment"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void onPhotoPicked(f);
        }}
      />

      {headings.map((heading) => {
        const p = byHeading.get(heading);
        const wants = needsBeforePhoto(heading, rows, photoHeadings);
        return (
          <div className="elev" key={heading}>
            <div className="eh">
              <b>{heading}</b>
              {headingMeta[heading] ? <em>{headingMeta[heading]}</em> : null}
              <span className="ct">{p ? `${p.done}/${p.total}` : ""}{p && p.done === p.total ? " ✓" : ""}</span>
            </div>

            {wants && (
              <button
                type="button"
                className="tick-photo"
                onClick={() => askForPhoto(heading)}
                disabled={uploading === heading}
                data-testid={`photo-prompt-${heading}`}
              >
                {uploading === heading ? "Uploading…" : `📷 Before photo of ${heading} — needed before the first tick`}
              </button>
            )}

            {rows.filter((r) => r.heading === heading).map((row) => (
              <button
                key={row.id}
                type="button"
                className={`tickrow ${row.state}`}
                onClick={() => tap(row)}
                disabled={busy === row.id}
                data-testid={`tick-${row.id}`}
                aria-label={`${row.label} — ${LABEL[row.state]}. Tap to mark ${LABEL[nextState(row.state)]}`}
              >
                <span className="sw" aria-hidden="true">
                  <i className={row.state !== "todo" ? "a" : ""} />
                  <i className={row.state === "done" ? "a" : row.state === "prepped" ? "b" : ""} />
                  <i className={row.state === "done" ? "a" : ""} />
                </span>
                <span className="tickrow-label">
                  {row.label}
                  {row.rectification ? <span className="chip amb" style={{ marginLeft: 6 }}>Rectify</span> : null}
                </span>
                <span className={`chip ${row.state === "done" ? "grn" : row.state === "prepped" ? "cyn" : ""}`}>
                  {LABEL[row.state]}
                </span>
              </button>
            ))}
          </div>
        );
      })}

      {rows.length === 0 && (
        <p className="tick-msg">No tick list on this job yet — the office adds it when the job sheet is issued.</p>
      )}
    </div>
  );
}
