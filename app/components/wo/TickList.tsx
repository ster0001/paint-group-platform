"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { setSurfacePhotosOptionalAction, tickSurfaceAction } from "./tickAction";
import { bulkTickAction, undoBulkTickAction } from "./bulkTickAction";
import {
  jobNeedsBeforePhotos, nextState, progressByHeading, progressOf, tickNeedsBeforePhotos,
  type SurfaceRow, type SurfaceState,
} from "@/lib/workorder/surfaces";
import {
  ROOM_STATE_WORD, UNDO_SHOWN_MS, VIEW_STORAGE_KEY, bulkTargets, bulkToast, groupViews, hasGroups, paintBlocked,
  viewFromStorage, type GroupView, type TickView,
} from "@/lib/workorder/surfaceGroups";

/**
 * The tick list on the contractor's phone.
 *
 * Two views of the SAME rows (work order UX brief §4.1, 24 Oct 2026):
 *
 *  · By surface (the default, ruling R2): one row per surface group on the job
 *    — all the ceilings, all the walls — with "n of N" and two buttons that
 *    mark every room at once. Painted waits until every room is prepped (R3).
 *    Each bulk tap can be undone for six seconds (R6). No whole-job button,
 *    ever (R1).
 *  · By room: the list as it always was. One tap cycles TO DO → PREPPED → DONE,
 *    and round to TO DO again so a mis-tap is fixable without hunting for an undo.
 *
 * The photo rule (Tom, 30 Sep: per JOB — Step 1's before photos unlock every
 * row) is enforced by the server for both views; until the job has one this
 * list is shown LOCKED with a line saying so, and a tap says it too. If the
 * server refuses anyway (a photo was deleted, two phones at once) the message
 * still lands here.
 */

type Props = {
  /** The job — a bulk tap is addressed to the job and a group, not to rows. */
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

// ---- the remembered view, per browser ---------------------------------------------------
const viewListeners = new Set<() => void>();
function readView(): TickView {
  try { return viewFromStorage(window.localStorage.getItem(VIEW_STORAGE_KEY)); } catch { return "surface"; }
}
function writeView(v: TickView) {
  try { window.localStorage.setItem(VIEW_STORAGE_KEY, v); } catch { /* private mode: the choice lasts the page */ }
  for (const l of viewListeners) l();
}
function subscribeView(l: () => void) {
  viewListeners.add(l);
  window.addEventListener("storage", l);
  return () => { viewListeners.delete(l); window.removeEventListener("storage", l); };
}

type Toast = { text: string; parentEventId: string | null; /** state per surface before the tap, for Undo's redraw */ before: Record<string, SurfaceState> };

export default function TickList({
  workOrderId, surfaces, hasBeforePhoto,
  headingMeta, surface = "portal", canWaivePhotos = false,
}: Props) {
  const c = surface === "console" ? "pcw" : "";
  const [rows, setRows] = useState<SurfaceRow[]>(surfaces);
  const [message, setMessage] = useState<{ text: string; heading?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [waiving, setWaiving] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const locked = jobNeedsBeforePhotos(rows, hasBeforePhoto);

  // The view. By surface is the default; the last choice is remembered per
  // browser (R2: local, never a Settings value). A job with no grouped rows —
  // a list seeded before 20270300 and not rebuilt, or rectification only —
  // has nothing to show By surface, so it opens By room with no toggle.
  const groupable = hasGroups(rows);
  // The server renders the default; the browser swaps in the remembered choice
  // on hydration without a setState-in-effect (useSyncExternalStore does that).
  const view = useSyncExternalStore(subscribeView, readView, () => "surface" as TickView);
  function pickView(v: TickView) {
    writeView(v);
    setMessage(null);
  }
  const showSurface = groupable && view === "surface";

  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  function showToast(t: Toast) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(null), UNDO_SHOWN_MS);
  }

  const headings = useMemo(() => {
    const seen: string[] = [];
    for (const s of rows) if (!seen.includes(s.heading)) seen.push(s.heading);
    return seen;
  }, [rows]);

  const overall = progressOf(rows);
  const byHeading = progressByHeading(rows);
  const groups = useMemo(() => groupViews(rows), [rows]);

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

  /** One tap, every room of one surface. The rows it will move are known
   * before the call (R5), so the screen can say what happened and Undo can
   * put exactly those back. */
  function bulk(g: GroupView, to: "prepped" | "done") {
    const targets = bulkTargets(rows, g.code, to);
    if (targets.length === 0) return;
    if (to === "done" && paintBlocked(rows, g.code)) {
      setMessage({ text: "Mark every room prepped first — then painted unlocks." });
      return;
    }
    if (targets.some((r) => tickNeedsBeforePhotos(r, hasBeforePhoto))) {
      setMessage({ text: "Step 1 first — tap the green Upload photos button above, then every row unlocks." });
      return;
    }
    const before: Record<string, SurfaceState> = {};
    for (const r of targets) before[r.id] = r.state;
    const key = `${g.code}:${to}`;
    setBusy(key);
    setMessage(null);
    startTransition(async () => {
      const result = await bulkTickAction({ workOrderId, groupCode: g.code, to });
      if (result.ok) {
        const moved = new Set(result.surfaceIds);
        setRows((rs) => rs.map((r) => (moved.has(r.id) ? { ...r, state: to } : r)));
        if (result.count > 0) showToast({ text: bulkToast(g.label, result.count, to), parentEventId: result.parentEventId, before });
      } else {
        setMessage({ text: result.message });
      }
      setBusy(null);
    });
  }

  function undo() {
    const t = toast;
    setToast(null);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    if (!t?.parentEventId) return;
    setBusy("undo");
    startTransition(async () => {
      const result = await undoBulkTickAction({ workOrderId, parentEventId: t.parentEventId });
      if (result.ok) {
        const back = new Set(result.surfaceIds);
        setRows((rs) => rs.map((r) => (back.has(r.id) ? { ...r, state: t.before[r.id] ?? r.state } : r)));
        setMessage({ text: result.count === 1 ? "1 room put back." : `${result.count} rooms put back.` });
      } else {
        setMessage({ text: result.message });
      }
      setBusy(null);
    });
  }

  return (
    <div className={`card ${c}`} data-testid="tick-list" data-view={showSurface ? "surface" : "room"}>
      <div className={`tick-head ${c}`}>
        <b>Scope &amp; ticks</b>
        <span className="tick-count" data-testid="tick-progress">{overall.done} / {overall.total}</span>
      </div>
      <div className="tick-prog"><i style={{ width: `${overall.pct}%` }} /></div>

      {groupable && (
        <div className="tick-view" role="tablist" aria-label="How to tick" data-testid="tick-view">
          <button type="button" role="tab" aria-selected={view === "surface"} className={view === "surface" ? "on" : ""}
            onClick={() => pickView("surface")} data-testid="tick-view-surface">By surface</button>
          <button type="button" role="tab" aria-selected={view === "room"} className={view === "room" ? "on" : ""}
            onClick={() => pickView("room")} data-testid="tick-view-room">By room</button>
        </div>
      )}

      {locked && (
        <p className="tick-msg locked" role="status" data-testid="tick-locked">
          🔒 Locked until Step 1 — tap the green Upload photos button above, then tick each surface here.
        </p>
      )}

      {message && (
        <p className="tick-msg" role="status" data-testid="tick-message">{message.text}</p>
      )}

      {showSurface && (
        <div className="tick-groups" data-testid="tick-groups">
          {groups.map((g) => {
            const isOpen = Boolean(open[g.code]);
            const prepBusy = busy === `${g.code}:prepped`;
            const paintBusy = busy === `${g.code}:done`;
            const preppedPct = g.total ? Math.round(((g.prepped - g.done) / g.total) * 100) : 0;
            const donePct = g.total ? Math.round((g.done / g.total) * 100) : 0;
            return (
              <div className={`surf${isOpen ? " open" : ""}`} key={g.code} data-testid={`group-${g.code}`}>
                <button type="button" className="surf-head" onClick={() => setOpen((o) => ({ ...o, [g.code]: !isOpen }))}
                  aria-expanded={isOpen} data-testid={`group-head-${g.code}`}>
                  <span className="surf-name">{g.label}</span>
                  <span className="surf-rooms" data-testid={`group-summary-${g.code}`}>
                    {g.summary} <span className="chev" aria-hidden="true">{isOpen ? "▴" : "▾"}</span>
                  </span>
                </button>
                <div className="surf-bar" aria-hidden="true">
                  <i className="d" style={{ width: `${donePct}%` }} />
                  <i className="p" style={{ width: `${preppedPct}%` }} />
                </div>
                <div className="surf-acts">
                  <button type="button"
                    className={`surf-btn ${g.prepButton === "done" ? "done" : "next"}${locked ? " locked" : ""}`}
                    disabled={g.prepButton === "done" || prepBusy || busy === "undo"}
                    onClick={() => bulk(g, "prepped")}
                    data-testid={`group-prep-${g.code}`}>
                    {g.prepButton === "done" ? "✓ Prepped" : prepBusy ? "Saving…" : "Mark all prepped"}
                  </button>
                  <button type="button"
                    className={`surf-btn ${g.paintButton === "done" ? "done" : g.paintButton === "next" ? "next" : ""}${locked ? " locked" : ""}`}
                    disabled={g.paintButton !== "next" || paintBusy || busy === "undo"}
                    onClick={() => bulk(g, "done")}
                    data-testid={`group-paint-${g.code}`}>
                    {g.paintButton === "done" ? "✓ Painted" : paintBusy ? "Saving…" : "Mark all painted"}
                  </button>
                </div>
                {isOpen && (
                  <div className="surf-detail" data-testid={`group-rooms-${g.code}`}>
                    {g.rooms.map((r, i) => (
                      <span key={r.id}>{i > 0 ? " · " : ""}{r.heading} <b>{ROOM_STATE_WORD[r.state]}</b></span>
                    ))}
                    {g.paintButton === "disabled" && <span className="surf-hint"> — painted unlocks once every room is prepped.</span>}
                  </div>
                )}
              </div>
            );
          })}
          <p className="tick-note">Anything not listed here — a repair, a line with no standard — is under <b>By room</b>.</p>
        </div>
      )}

      {!showSurface && headings.map((heading) => {
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
                    {row.count != null && <span className="tickrow-count">× {row.count}</span>}
                  </span>
                  <span className="chip amb">Removed from scope</span>
                </div>
              ) : (
                <div key={row.id} className="tickwrap">
                <button
                  type="button"
                  className={`tickrow ${row.state}${locked && !row.photosOptional ? " locked" : ""}`}
                  onClick={() => tap(row)}
                  disabled={busy === row.id}
                  data-testid={`tick-${row.id}`}
                  aria-label={`${row.label}${row.count != null ? ` × ${row.count}` : ""} — ${LABEL[row.state]}. Tap to mark ${LABEL[nextState(row.state)]}`}
                >
                  <span className="sw" aria-hidden="true">
                    <i className={row.state !== "todo" ? "a" : ""} />
                    <i className={row.state === "done" ? "a" : row.state === "prepped" ? "b" : ""} />
                    <i className={row.state === "done" ? "a" : ""} />
                  </span>
                  <span className="tickrow-label">
                    {row.label}
                    {/* "Doors × 4": the count from the job sheet, so the painter
                        knows how many this row covers (Tom, 14 Oct 2026). */}
                    {row.count != null && (
                      <span className="tickrow-count" data-testid={`tick-count-${row.id}`}>× {row.count}</span>
                    )}
                    {row.rectification ? <span className="chip amb" style={{ marginLeft: 6 }}>Rectify</span> : null}
                    {row.photosOptional ? (
                      <span className="chip" style={{ marginLeft: 6 }} data-testid={`no-photos-${row.id}`}>No photos</span>
                    ) : null}
                  </span>
                  <span className={`chip ${row.state === "done" ? "grn" : row.state === "prepped" ? "cyn" : ""}`}>
                    {LABEL[row.state]}
                  </span>
                </button>
                </div>
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

      {toast && (
        <div className="tick-toast" role="status" data-testid="bulk-toast">
          <span>{toast.text}</span>
          {toast.parentEventId && (
            <button type="button" onClick={undo} disabled={busy === "undo"} data-testid="bulk-undo">Undo</button>
          )}
        </div>
      )}
    </div>
  );
}
