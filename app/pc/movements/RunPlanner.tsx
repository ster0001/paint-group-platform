"use client";

import { useRef, useState } from "react";
import {
  addMinutes, busyOn, firstFreeTime, shortDay, RUN_PURPOSES, RUN_PURPOSE_LABEL, RUN_START,
  type ContextBlock, type MovementLane, type RunPurpose, type World,
} from "@/lib/movements/evaluate";
import type { Point } from "@/lib/movements/types";
import { publishRun, type MovementActionResult } from "./actions";

type Act = (run: () => Promise<MovementActionResult>, done?: (value: string) => string | void) => Promise<boolean>;

/** One row of the draft run: a tray chip, or a purpose on a job. Lives only in the browser until Publish. */
export type PlanEntry = {
  key: string;
  movementId: string | null;
  workOrderId: string | null;
  purpose: RunPurpose | null;
  /** The chip's kind words when it is a chip (the purpose select is for job stops). */
  chipLabel: string | null;
  label: string;
  sub: string;
  point: Point | null;
  time: string;
  durationMin: number;
};

export const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240] as const;
const durationWord = (m: number) => (m < 60 ? `${m} min` : `${m / 60} h${m % 60 ? ` ${m % 60}` : ""}`);

/** The next entry's start: after the last stop ends, or 07:30, whichever is later; never over what the person already has. */
export function nextStart(world: World, laneId: string, day: string, blocks: readonly ContextBlock[], entries: readonly PlanEntry[], durationMin: number): string {
  const busy = [...busyOn(world, laneId, day, blocks), ...entries.map((e) => ({ from: e.time, to: addMinutes(e.time, e.durationMin), label: e.label }))];
  const last = entries[entries.length - 1];
  const from = last ? addMinutes(last.time, last.durationMin) : RUN_START;
  return firstFreeTime(busy, from < RUN_START ? RUN_START : from, durationMin);
}

/**
 * Plan a run on the Map (Tom, 21 Oct 2026): an empty box for the day; jobs and tray chips
 * come in by tap or drag; each stop says what it is for, starts at 07:30 (or the next free
 * quarter hour past what the calendar already holds) and runs an hour unless changed; rows
 * drag up and down; the map draws the line; nothing is posted until Publish, which lands
 * every stop on the person's day in one call.
 */
export default function RunPlanner({ world, lanes, lane, onLane, day, blocks, entries, setEntries, act, busy, onPublished, dropHint }: {
  world: World; lanes: MovementLane[]; lane: MovementLane | null; onLane: (id: string) => void; day: string; blocks: readonly ContextBlock[];
  entries: PlanEntry[]; setEntries: (next: PlanEntry[] | ((cur: PlanEntry[]) => PlanEntry[])) => void;
  act: Act; busy: boolean; onPublished: () => void;
  /** The drop handler the map and the tray list feed (dataTransfer "chip:<id>" or "job:<id>"). */
  dropHint: (e: React.DragEvent) => void;
}) {
  const first = lane?.name.split(" ")[0] ?? "someone";
  const [over, setOver] = useState<{ key: string; before: boolean } | null>(null);
  const [lifted, setLifted] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const dragRef = useRef<{ key: string; startY: number; moved: boolean } | null>(null);

  const retime = (list: PlanEntry[]): PlanEntry[] => {
    // Keep each row's own time when it was typed; a re-order re-slots from the first start (ruling 22's rule, here in the draft).
    if (!lane) return list;
    const out: PlanEntry[] = [];
    for (const e of list) out.push({ ...e, time: nextStart(world, lane.id, day, blocks, out, e.durationMin) });
    return out;
  };
  const update = (key: string, patch: Partial<PlanEntry>) => setEntries((cur) => cur.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  const remove = (key: string) => setEntries((cur) => cur.filter((e) => e.key !== key));

  // ---- drag a row up or down -----------------------------------------------------------------
  const rowUnder = (x: number, y: number): HTMLElement | null => {
    const t = document.elementFromPoint(x, y);
    return t instanceof Element ? (t.closest(".prow[data-key]") as HTMLElement | null) : null;
  };
  const onHandleDown = (e: React.PointerEvent<HTMLButtonElement>, key: string) => {
    if (busy) return;
    dragRef.current = { key, startY: e.clientY, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };
  const onHandleMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientY - d.startY) < 5) return;
    if (!d.moved) { d.moved = true; setLifted(d.key); }
    const target = rowUnder(e.clientX, e.clientY);
    if (!target || target.dataset.key === d.key) { setOver(null); return; }
    const r = target.getBoundingClientRect();
    setOver({ key: target.dataset.key ?? "", before: e.clientY < r.top + r.height / 2 });
  };
  const onHandleUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    setLifted(null);
    const o = over;
    setOver(null);
    if (!d || !d.moved) return;
    const target = rowUnder(e.clientX, e.clientY);
    const targetKey = target?.dataset.key ?? o?.key ?? null;
    if (!targetKey || targetKey === d.key) return;
    const before = target ? e.clientY < target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2 : (o?.before ?? true);
    setEntries((cur) => {
      const moving = cur.find((x) => x.key === d.key);
      if (!moving) return cur;
      const rest = cur.filter((x) => x.key !== d.key);
      const at = rest.findIndex((x) => x.key === targetKey) + (before ? 0 : 1);
      rest.splice(at, 0, moving);
      return retime(rest);
    });
  };
  const nudge = (key: string, dir: -1 | 1) => setEntries((cur) => {
    const i = cur.findIndex((x) => x.key === key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cur.length) return cur;
    const next = cur.slice();
    next.splice(i, 1); next.splice(j, 0, cur[i]);
    return retime(next);
  });

  // ---- publish --------------------------------------------------------------------------------
  const publish = async () => {
    if (!lane || entries.length === 0) return;
    const missing = entries.find((e) => !e.movementId && !e.purpose);
    if (missing) { await act(async () => ({ ok: false, message: `Say what the ${missing.label} stop is for first.` })); return; }
    const ok = await act(() => publishRun({
      personKind: lane.assigneeTable === "profiles" ? "profiles" : "contractors", personId: lane.id, day,
      stops: entries.map((e) => ({ movementId: e.movementId, workOrderId: e.workOrderId, purpose: e.purpose, time: e.time, durationMin: e.durationMin })),
      workOrderIds: [...new Set(entries.flatMap((e) => (e.workOrderId ? [e.workOrderId] : [])))],
    }), (n) => `Published — ${n} stop${n === "1" ? "" : "s"} on ${first}'s ${shortDay(day)}`);
    if (ok) { setEntries([]); onPublished(); }
  };

  const people = lanes.filter((l) => l.kind !== "supplier");
  return (
    <div className={`card planner${dropping ? " dropping" : ""}`} data-testid="run-planner"
      onDragOver={(e) => { if ([...e.dataTransfer.types].includes("text/plain")) { e.preventDefault(); setDropping(true); } }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => { e.preventDefault(); setDropping(false); dropHint(e); }}>
      <h3>
        Plan a run
        <em>
          <select value={lane?.id ?? ""} aria-label="Whose run" data-testid="run-plan-who" onChange={(e) => onLane(e.target.value)}>
            {!lane && <option value="">who?</option>}
            {people.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </em>
      </h3>
      <p className="note">{shortDay(day)} · tap a job on the map or a chip in the list, or drag either in here. The first stop starts at {RUN_START} unless the calendar holds it. Nothing is on {first}&rsquo;s day until you publish.</p>
      <div className="planlist" data-testid="run-plan-list">
        {entries.length === 0 && <p className="note empty" data-testid="run-plan-empty">Empty — add the first stop.</p>}
        {entries.map((e, i) => (
          <div key={e.key} className={`prow${lifted === e.key ? " lift" : ""}${over?.key === e.key ? (over.before ? " before" : " after") : ""}`} style={{ ["--pc" as string]: lane?.colour } as React.CSSProperties}
            data-testid="run-plan-row" data-key={e.key} data-movement-id={e.movementId ?? undefined} data-job-id={e.workOrderId ?? undefined}>
            <button type="button" className="hnd" title="drag up or down" aria-label={`Drag ${e.label}`} disabled={busy} data-testid="run-plan-handle"
              onPointerDown={(ev) => onHandleDown(ev, e.key)} onPointerMove={onHandleMove} onPointerUp={onHandleUp} onPointerCancel={onHandleUp}>⋮⋮</button>
            <span className="num">{i + 1}</span>
            <div className="pbody">
              <b>{e.label}</b>
              <small>{e.sub}</small>
              <div className="pctl">
                {e.movementId
                  ? <span className="chp on" data-testid="run-plan-kind">{e.chipLabel}</span>
                  : (
                    <select value={e.purpose ?? ""} aria-label="What for" data-testid="run-plan-purpose" onChange={(ev) => update(e.key, { purpose: (ev.target.value || null) as RunPurpose | null })}>
                      <option value="">what for?</option>
                      {RUN_PURPOSES.map((p) => <option key={p} value={p}>{RUN_PURPOSE_LABEL[p]}</option>)}
                    </select>
                  )}
                <input type="time" value={e.time} step={300} aria-label="Start" data-testid="run-plan-time" onChange={(ev) => { if (ev.target.value) update(e.key, { time: ev.target.value }); }} />
                <select value={String(e.durationMin)} aria-label="How long" data-testid="run-plan-duration" onChange={(ev) => update(e.key, { durationMin: Number(ev.target.value) })}>
                  {DURATIONS.map((m) => <option key={m} value={String(m)}>{durationWord(m)}</option>)}
                </select>
                <span className="end" data-testid="run-plan-end">ends {addMinutes(e.time, e.durationMin)}</span>
              </div>
            </div>
            <div className="pacts">
              <button type="button" aria-label="Earlier" title="earlier" disabled={busy || i === 0} onClick={() => nudge(e.key, -1)}>▲</button>
              <button type="button" aria-label="Later" title="later" disabled={busy || i === entries.length - 1} onClick={() => nudge(e.key, 1)}>▼</button>
              <button type="button" className="x" aria-label={`Remove ${e.label} from the plan`} disabled={busy} onClick={() => remove(e.key)} data-testid="run-plan-remove">×</button>
            </div>
          </div>
        ))}
      </div>
      <div className="btnrow">
        <button type="button" className="btn" disabled={busy || entries.length === 0} onClick={() => setEntries([])} data-testid="run-plan-clear">Clear</button>
        <button type="button" className="btn primary" disabled={busy || !lane || entries.length === 0} onClick={() => void publish()} data-testid="run-plan-publish">
          Publish this run{entries.length ? ` · ${entries.length} stop${entries.length === 1 ? "" : "s"}` : ""}
        </button>
      </div>
      {lane && <p className="note">Publishing puts every stop on {first}&rsquo;s {shortDay(day)} at its time, an hour each unless you changed it — the same rows the Day view and the week board show. A chip&rsquo;s stop is that chip; a job stop with a purpose is a new chip of its own (an Other chip on the board).</p>}
    </div>
  );
}
