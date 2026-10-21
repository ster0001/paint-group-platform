"use client";

import { useMemo, useState } from "react";
import {
  addMinutes, chipFilterKind, chipState, isSkip, kindLabel, needsOrder, reorder, runPlan, shortDay,
  type ContextBlock, type MovementLane, type RunPlanStop, type World,
} from "@/lib/movements/evaluate";
import { movementIcon } from "@/lib/movements/gearIcons";
import type { EquipmentCategory, MovementRow } from "@/lib/movements/types";
import { reorderDay, sendRunPlan, type MovementActionResult } from "./actions";

type Act = (run: () => Promise<MovementActionResult>, done?: (value: string) => string | void) => Promise<boolean>;

export type DayViewProps = {
  world: World; ctx: ContextBlock[]; lanes: MovementLane[];
  days: string[]; day: string; who: string | null;
  onPick: (next: { day?: string; who?: string }) => void;
  act: Act; busy: boolean;
  onOrdered: (m: MovementRow) => Promise<boolean>;
  onDone: (m: MovementRow) => Promise<boolean>;
  onOpen: (m: MovementRow) => void;
  categoryOf: (m: MovementRow) => EquipmentCategory | null;
  painterName: (contractorId: string | null) => string | null;
};

/** Where a stop is, in words: "Paint Spot Carnegie → 12 Demo St, Oakleigh". */
function whereOf(m: MovementRow, world: World): string {
  const job = world.jobs.find((j) => j.id === m.work_order_id);
  const site = job ? job.address || job.suburb || job.jobRef : "warehouse";
  const branch = world.branches.find((b) => b.id === (m.from_branch_id ?? m.to_branch_id));
  const shop = branch ? `${branch.brand} ${branch.branch}` : null;
  if (m.kind === "equipment_return" || m.kind === "hire_off" || m.kind === "repair_back") return `${site} → warehouse`;
  if (m.kind === "rubbish_out") return m.detail?.startsWith("collected on the run") ? `${site} · rubbish in the car` : m.to_kind === "tip" ? `${site} → the tip` : m.to_kind === "warehouse" ? `${site} → warehouse` : site;
  if (m.assignee_kind === "person" && m.from_kind === "branch" && shop) return `${shop} → ${site}`;
  if (m.assignee_kind === "person" && m.from_kind === "warehouse") return `warehouse → ${site}`;
  return shop ? `${shop} → ${site}` : site;
}

/**
 * Day — run plans (brief §3.4, Session 5): day chips with move counts, person chips in lane
 * colours, the numbered timeline from the warehouse (context stops ◌ and dashed, movements
 * numbered with km from the previous stop), ▲▼ to reorder (ruling 22: the same set of
 * times handed out in the new order), the big tick, Send to <name>'s phone, and the Orders
 * to place card. Every number here is the evaluator's (`runPlan`, `reorder`, `needsOrder`).
 */
export default function DayView({ world, ctx, lanes, days, day, who, onPick, act, busy, onOrdered, onDone, onOpen, categoryOf, painterName }: DayViewProps) {
  const placedOn = (d: string) => world.movements.filter((m) => m.due_date === d && m.status !== "tray" && m.status !== "cancelled");
  // People with a stop that day: a movement, or a fixed appointment (calendar, QA, check-in, walkthrough).
  const people = useMemo(() => lanes.filter((l) => l.kind !== "supplier" && runPlan(world, l.id, day, ctx).stops.length > 0), [lanes, world, day, ctx]);
  const lane = people.find((l) => l.id === who) ?? people[0] ?? null;
  const plan = useMemo(() => (lane ? runPlan(world, lane.id, day, ctx) : null), [world, lane, day, ctx]);
  const [sent, setSent] = useState<string | null>(null);

  const movementIds = () => (plan?.stops ?? []).flatMap((s) => (s.fixed ? [] : [s.movement.id]));
  const move = async (id: string, dir: -1 | 1) => {
    if (!lane) return;
    const ids = movementIds();
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    ids.splice(i, 1); ids.splice(j, 0, id);
    const patches = reorder(world, lane.id, day, ids);
    await act(() => reorderDay({
      assigneeKind: "person", assigneeId: lane.id, day, patches: patches.map((p) => ({ id: p.id, sequence: p.sequence, time: p.time })),
      workOrderIds: [...new Set(world.movements.filter((m) => ids.includes(m.id)).flatMap((m) => (m.work_order_id ? [m.work_order_id] : [])))],
    }), () => "Reordered — the times moved with it");
  };

  const send = async () => {
    if (!lane || !plan) return;
    const first = lane.name.split(" ")[0];
    const ok = await act(() => sendRunPlan({
      personKind: lane.assigneeTable === "profiles" ? "profiles" : "contractors", personId: lane.id, day, stops: plan.stopCount, km: plan.totalKm,
    }), (n) => `Run plan sent to ${first}'s phone — ${n} stop${n === "1" ? "" : "s"}, with Navigate and Call on each`);
    if (ok) setSent(lane.id + day);
  };

  const orders = useMemo(() => world.movements
    .filter((m) => needsOrder(m) && m.due_date && m.due_date >= days[0] && m.due_date <= days[days.length - 1])
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "") || (a.time ?? "").localeCompare(b.time ?? "")), [world, days]);

  const renderStop = (s: RunPlanStop) => {
    if (s.fixed) {
      const b = s.block;
      return (
        <div key={`ctx:${b.id}`} className="stop" data-testid="run-stop" data-fixed="true">
          <span className="t">{s.time}</span><span className="n ctx">◌</span>
          <div className="bx ctx"><div><b>{b.label}</b><small>{[b.sub, b.suburb, s.kmFromPrevious != null ? `${s.kmFromPrevious.toFixed(0)} km` : null].filter(Boolean).join(" · ")}</small></div><span className="km">{b.kindLabel}</span></div>
        </div>
      );
    }
    const m = s.movement;
    const st = chipState(m);
    const done = st === "done";
    const skipOrHire = isSkip(m) || m.kind === "hire_on" || m.kind === "hire_off";
    const stateWord = st === "needs-order" ? <span style={{ color: "var(--amber)" }}>order not placed</span> : st === "booked" ? "booked" : done ? "done" : st === "problem" ? <span style={{ color: "var(--clay)" }}>problem</span> : "planned";
    const ids = movementIds();
    const at = ids.indexOf(m.id);
    return (
      <div key={m.id} className="stop" style={{ ["--pc" as string]: lane?.colour } as React.CSSProperties} data-testid="run-stop" data-movement-id={m.id} data-n={s.n ?? undefined}>
        <span className="t">{s.time}<br /><small>–{addMinutes(s.time, m.duration_min ?? 60)}</small></span>
        <span className={`n${done ? " done" : ""}`} data-testid="run-stop-n">{done ? "✓" : s.n}</span>
        <div className="bx">
          <button type="button" className="bxb" onClick={() => onOpen(m)}>
            <span className="kl" style={{ ["--pc" as string]: lane?.colour } as React.CSSProperties}><i />{kindLabel(m)}</span>
            <b><span className={`ic ${chipFilterKind(m)}`}>{movementIcon(m, categoryOf(m))}</span>{m.title}</b>
            <small>{whereOf(m, world)}{s.kmFromPrevious != null ? ` · ${s.kmFromPrevious.toFixed(0)} km` : ""} · {stateWord}{m.order_ref ? ` · ${m.order_ref}` : ""}</small>
          </button>
          <div className="acts">
            {!done && (
              <div className="ord">
                <button type="button" title="earlier" aria-label="Earlier" disabled={busy || at <= 0} onClick={() => void move(m.id, -1)} data-testid="run-up">▲</button>
                <button type="button" title="later" aria-label="Later" disabled={busy || at < 0 || at >= ids.length - 1} onClick={() => void move(m.id, 1)} data-testid="run-down">▼</button>
              </div>
            )}
            {st === "needs-order" && <button type="button" className="btn sm primary" disabled={busy || (m.kind === "paint" && world.jobs.find((j) => j.id === m.work_order_id)?.coloursConfirmed === false)} onClick={() => void onOrdered(m)}>{skipOrHire ? "Booked" : "Ordered"} ✓</button>}
            <button type="button" className={`tick${done ? " on" : ""}`} title={done ? "done" : "tick when done"} aria-label={done ? "Done" : "Mark done"} disabled={busy || done || st === "needs-order"} onClick={() => void onDone(m)} data-testid="run-tick">✓</button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="dayview" data-testid="day-view">
      <div className="card">
        <h3>Run plans <em data-testid="day-summary">{lane && plan ? `${lane.name} · ${shortDay(day)} · ${plan.stopCount} stop${plan.stopCount === 1 ? "" : "s"} · ${plan.totalKm.toFixed(0)} km` : `${shortDay(day)} · nobody has a stop`}</em></h3>
        <div className="days" data-testid="day-chips">
          {days.map((d) => { const n = placedOn(d).length; return (
            <button key={d} type="button" className={d === day ? "on" : ""} onClick={() => onPick({ day: d })} data-day={d}><b>{shortDay(d)}</b><small>{n} move{n === 1 ? "" : "s"}</small></button>
          ); })}
        </div>
        <div className="people" data-testid="person-chips">
          {people.map((l) => (
            <button key={l.id} type="button" className={lane?.id === l.id ? "on" : ""} style={{ ["--pc" as string]: l.colour } as React.CSSProperties} onClick={() => onPick({ who: l.id })} data-lane={l.id}>
              <i />{l.name.split(" ")[0]} · {placedOn(day).filter((m) => m.assignee_kind === "person" && m.assignee_id === l.id).length}
            </button>
          ))}
          {people.length === 0 && <span className="note">Nothing placed on {shortDay(day)} — drop chips on the Week board first.</span>}
        </div>
        {lane && plan && (
          <>
            <div className="tl" data-testid="run-timeline">
              <div className="stop"><span className="t">—</span><span className="n ctx">⌂</span><div className="bx ctx"><div><b>{world.settings.warehouse.label || "Warehouse"}</b><small>{[world.settings.warehouse.address, world.settings.warehouse.suburb].filter(Boolean).join(", ") || "set the address in Settings → Movements"}</small></div><span className="km">start</span></div></div>
              {plan.stops.map(renderStop)}
              {plan.stops.length === 0 && <p className="note">Nothing on {lane.name}&rsquo;s {shortDay(day)}.</p>}
            </div>
            <div className="btnrow" data-testid="day-actions">
              <button type="button" className="btn primary" disabled={busy || plan.stopCount === 0} onClick={() => void send()} data-testid="send-run-plan">
                {sent === lane.id + day ? "Sent ✓ — send again" : `Send to ${lane.name.split(" ")[0]}'s phone`}
              </button>
              {lane.kind === "staff" && <a className="btn" href={`/pc/movements/run?day=${day}&who=${lane.id}`} target="_blank" rel="noreferrer">Open the phone list</a>}
            </div>
            <p className="note">▲▼ reorder and the times move with the stops, so the Week board agrees. {lane.kind === "painter" ? `${lane.name.split(" ")[0]} gets the list as the "Your pickups and drop-offs today" card in the portal.` : `${lane.name.split(" ")[0]} gets the list with Navigate and Call on each stop.`}</p>
          </>
        )}
      </div>

      <div className="card" data-testid="orders-card">
        <h3>Orders to place <em>{orders.length === 0 ? "none this week" : `${orders.length} this week · soonest first`}</em></h3>
        {orders.length === 0 ? <p className="note">Every placed delivery and pickup this week has its order in.</p> : (
          <div className="list" style={{ marginTop: 10 }}>
            {orders.map((m) => {
              const job = world.jobs.find((j) => j.id === m.work_order_id);
              const tbc = m.kind === "paint" && job ? !job.coloursConfirmed : false;
              const branch = world.branches.find((b) => b.id === m.from_branch_id);
              const skipOrHire = isSkip(m) || m.kind === "hire_on" || m.kind === "hire_off";
              const laneName = m.assignee_kind === "supplier" ? "delivered to site" : `${(lanes.find((l) => l.id === m.assignee_id)?.name ?? painterName(m.assignee_id) ?? "someone").split(" ")[0]} picks up`;
              return (
                <div key={m.id} className="opt" style={{ cursor: "default" }} data-testid="order-row" data-movement-id={m.id}>
                  <span className={`ic ${chipFilterKind(m)}`}>{movementIcon(m, categoryOf(m))}</span>
                  <button type="button" className="optb" onClick={() => onOpen(m)}>
                    {m.title}
                    <span className="sub">{[branch ? `${branch.brand} ${branch.branch}` : null, laneName, `${shortDay(m.due_date!)} ${m.time ? m.time.slice(0, 5) : m.half ?? ""}`, job?.jobRef ? `order ${m.order_ref || job.jobRef}` : null].filter(Boolean).join(" · ")}{tbc && <> · <span style={{ color: "var(--amber)" }}>colours TBC — can&rsquo;t order yet</span></>}</span>
                  </button>
                  <button type="button" className="btn sm primary" disabled={busy || tbc} title={tbc ? "Confirm the colours on the job first" : undefined} onClick={() => void onOrdered(m)}>{skipOrHire ? "Booked" : "Ordered"} ✓</button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
