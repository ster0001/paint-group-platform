"use client";

import { useMemo, useState, useTransition } from "react";
import { setSurfacePhotosOptionalAction, tickSurfaceAction } from "./tickAction";
import {
  jobNeedsBeforePhotos, nextState, progressByHeading, progressOf, tickNeedsBeforePhotos,
  type SurfaceRow, type SurfaceState,
} from "@/lib/workorder/surfaces";

/**
 * The tick list on the contractor's phone.
 *
 * One tap cycles TO DO → PREPPED → DONE, and round to TO DO again so a mis-tap
 * is fixable without hunting for an undo. The photo rule (Tom, 30 Sep: per
 * JOB — Step 1's before photos unlock every row) is enforced by the server;
 * until the job has one this list is shown LOCKED with a line saying so, and
 * a tap says it too. If the server refuses anyway (a photo was deleted, two
 * phones at once) the message still lands here.
 */

type Props = {
  workOrderId: string;
  surfaces: SurfaceRow[];
  /** Step 1 done: a before photo exists anywhere on the job. */
  hasBeforePhoto: boolean;
  headingMeta: Record<string, string>;
  /**
   * Which chrome this is rendering in. The two surfaces have different
   * stylesheets, so the class names differ — the behaviour does not, which is
   * the point: the office ticking on a quality visit uses the same list, the
   * same photo gate and the same events as the painter.
   */
  surface?: "portal" | "console";
  /**
   * Console only: the office can mark a line "photos not required" (a fuel
   * allowance, a set-up line). The RPC refuses anyone who is not staff.
   */
  canWaivePhotos?: boolean;
};

const LABEL: Record<SurfaceState, string> = { todo: "To do", prepped: "Prepped", done: "Done" };

export default function TickList({
  surfaces, hasBeforePhoto,
  headingMeta, surface = "portal", canWaivePhotos = false,
}: Props) {
  const c = surface === "console" ? "pcw" : "";
  const [rows, setRows] = useState<SurfaceRow[]>(surfaces);
  const [message, setMessage] = useState<{ text: string; heading?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [waiving, setWaiving] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const locked = jobNeedsBeforePhotos(rows, hasBeforePhoto);

  const headings = useMemo(() => {
    const seen: string[] = [];
    for (const s of rows) if (!seen.includes(s.heading)) seen.push(s.heading);
    return seen;
  }, [rows]);

  const overall = progressOf(rows);
  const byHeading = progressByHeading(rows);

  function waivePhotos(row: SurfaceRow) {
    setWaiving(row.id);
    setMessage(null);
    startTransition(async () => {
      const r = await setSurfacePhotosOptionalAction({ surfaceId: row.id, optional: !row.photosOptional });
      if (r.ok) {
        setRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, photosOptional: r.optional } : x)));
        setMessage({ text: r.optional
          ? `${row.label}: no photos asked for on this line.`
          : `${row.label}: photos asked for again on this line.` });
      } else {
        setMessage({ text: r.message });
      }
      setWaiving(null);
    });
  }

  function tap(row: SurfaceRow) {
    const to = nextState(row.state);
    // Say it before the tap, not after the refusal. A "photos not required"
    // line never asks.
    if (to !== "todo" && tickNeedsBeforePhotos(row, hasBeforePhoto)) {
      setMessage({ text: "Step 1 first — tap the green Upload photos button above, then every row unlocks.", heading: row.heading });
      return;
    }
    setBusy(row.id);
    setMessage(null);
    startTransition(async () => {
      const result = await tickSurfaceAction({ surfaceId: row.id, to });
      if (result.ok) {
        setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, state: to } : r)));
      } else {
        setMessage({ text: result.message, heading: row.heading });
      }
      setBusy(null);
    });
  }

  return (
    <div className={`card ${c}`} data-testid="tick-list">
      <div className={`tick-head ${c}`}>
        <b>Scope &amp; ticks</b>
        <span className="tick-count" data-testid="tick-progress">{overall.done} / {overall.total}</span>
      </div>
      <div className="tick-prog"><i style={{ width: `${overall.pct}%` }} /></div>

      {locked && (
        <p className="tick-msg locked" role="status" data-testid="tick-locked">
          🔒 Locked until Step 1 — tap the green Upload photos button above, then tick each surface here.
        </p>
      )}

      {message && (
        <p className="tick-msg" role="status" data-testid="tick-message">{message.text}</p>
      )}

      {headings.map((heading) => {
        const p = byHeading.get(heading);
        return (
          <div className="elev" key={heading}>
            <div className="eh">
              <b>{heading}</b>
              {headingMeta[heading] ? <em>{headingMeta[heading]}</em> : null}
              <span className="ct">{p ? `${p.done}/${p.total}` : ""}{p && p.done === p.total ? " ✓" : ""}</span>
            </div>

            {rows.filter((r) => r.heading === heading).map((row) =>
              row.removed ? (
                // Struck by a signed credit — visible, marked, never tickable
                // (addendum ruling 2: removed, not deleted).
                <div
                  key={row.id}
                  className="tickrow removed"
                  data-testid={`tick-${row.id}`}
                  aria-label={`${row.label} — removed from scope`}
                  style={{ opacity: 0.55 }}
                >
                  <span className="sw" aria-hidden="true"><i /><i /><i /></span>
                  <span className="tickrow-label" style={{ textDecoration: "line-through" }}>
                    {row.label}
                  </span>
                  <span className="chip amb">Removed from scope</span>
                </div>
              ) : (
                <button
                  key={row.id}
                  type="button"
                  className={`tickrow ${row.state}${locked && !row.photosOptional ? " locked" : ""}`}
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
                    {row.photosOptional ? (
                      <span className="chip" style={{ marginLeft: 6 }} data-testid={`no-photos-${row.id}`}>No photos</span>
                    ) : null}
                  </span>
                  <span className={`chip ${row.state === "done" ? "grn" : row.state === "prepped" ? "cyn" : ""}`}>
                    {LABEL[row.state]}
                  </span>
                </button>
              ),
            )}

            {/* Console only (Tom, 24 Sep): a line that is not a surface — a
                fuel allowance, a set-up line — need not be photographed. One
                small control per line; the RPC refuses anyone but staff. */}
            {canWaivePhotos && rows.filter((r) => r.heading === heading && !r.removed).map((row) => (
              <button key={`waive-${row.id}`} type="button" className="btn dim"
                style={{ fontSize: 11, padding: "3px 8px", margin: "0 0 4px 0" }}
                disabled={waiving === row.id} onClick={() => waivePhotos(row)}
                data-testid={`photos-optional-${row.id}`}>
                {waiving === row.id ? "Saving…" : row.photosOptional
                  ? `Photos required again — ${row.label}`
                  : `Photos not required — ${row.label}`}
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
