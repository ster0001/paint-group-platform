"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { chipState, kindLabel, runPlan, shortDay, type ContextBlock, type MovementLane } from "@/lib/movements/evaluate";
import { mapsUrl } from "@/lib/movements/painterView";
import type { MovementRow } from "@/lib/movements/types";
import { setMovementStatus, type MovementActionResult } from "../actions";
import { fromSerial, type SerialWorld } from "../world";

/**
 * A staff member's own run for one day, phone-first (brief §3.4 "Phone", ruling 14):
 * the numbered list with Navigate, Call and a Problem button on each stop and the big tick.
 * Reached from the run-plan text (`/pc/movements/run?day=&who=me`). Reads the same
 * `runPlan()` the Day view draws, so the numbers agree.
 */
export default function RunList({ world: serial, ctx, lane, day }: { world: SerialWorld; ctx: ContextBlock[]; lane: MovementLane; day: string }) {
  const router = useRouter();
  const world = fromSerial(serial);
  const plan = runPlan(world, lane.id, day, ctx);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function run(id: string, fn: () => Promise<MovementActionResult>) {
    setBusy(id); setMessage(null);
    const r = await fn();
    setBusy(null);
    if (!r.ok) { setMessage(r.message); return; }
    router.refresh();
  }

  const addressOf = (m: MovementRow): { label: string; address: string } | null => {
    const job = world.jobs.find((j) => j.id === m.work_order_id);
    const branch = world.branches.find((b) => b.id === (m.from_branch_id ?? m.to_branch_id));
    if (m.assignee_kind === "person" && m.from_kind === "branch" && branch) return { label: `${branch.brand} ${branch.branch}`, address: [branch.address, branch.suburb].filter(Boolean).join(", ") };
    if (job && job.address) return { label: job.jobRef, address: job.address };
    const w = world.settings.warehouse;
    return w.address ? { label: w.label || "Warehouse", address: [w.address, w.suburb].filter(Boolean).join(", ") } : null;
  };
  const phoneOf = (m: MovementRow): { who: string; tel: string } | null => {
    const branch = world.branches.find((b) => b.id === (m.from_branch_id ?? m.to_branch_id));
    if (m.from_kind === "branch" && branch?.phone) return { who: branch.brand, tel: branch.phone.replace(/[^\d+]/g, "") };
    return null;
  };

  return (
    <div className="runlist" data-testid="run-list" data-day={day}>
      <h1>{lane.name.split(" ")[0]}&rsquo;s run · {shortDay(day)}</h1>
      <p className="lede">{plan.stopCount} stop{plan.stopCount === 1 ? "" : "s"} · about {plan.totalKm.toFixed(0)} km from the first stop to the last.</p>
      {message && <p className="err" role="alert">{message}</p>}
      <ol>
        {plan.stops.map((s) => {
          if (s.fixed) return (
            <li key={`c:${s.block.id}`} className="fixed" data-testid="run-list-stop" data-fixed="true">
              <span className="n">◌</span>
              <div><b>{s.time} · {s.block.label}</b><small>{[s.block.kindLabel, s.block.sub, s.block.suburb].filter(Boolean).join(" · ")}</small></div>
            </li>
          );
          const m = s.movement;
          const st = chipState(m);
          const done = st === "done";
          const addr = addressOf(m);
          const tel = phoneOf(m);
          return (
            <li key={m.id} className={done ? "done" : ""} data-testid="run-list-stop" data-movement-id={m.id}>
              <span className="n" style={{ background: lane.colour }}>{done ? "✓" : s.n}</span>
              <div>
                <b>{s.time} · {kindLabel(m)}</b>
                <span className="what">{m.title}</span>
                <small>{addr ? `${addr.label} — ${addr.address}` : "no address"}{s.kmFromPrevious != null ? ` · ${s.kmFromPrevious.toFixed(0)} km` : ""}{m.order_ref ? ` · order ${m.order_ref}` : ""}</small>
                {m.note && <small>{m.note}</small>}
                <div className="acts">
                  {addr && <a className="btn" href={mapsUrl(`${addr.label}, ${addr.address}`, null)} target="_blank" rel="noreferrer">Navigate</a>}
                  {tel && <a className="btn" href={`tel:${tel.tel}`}>Ring {tel.who}</a>}
                  {!done && st !== "needs-order" && (
                    <button type="button" className="btn pri" disabled={busy === m.id} onClick={() => void run(m.id, () => setMovementStatus({ id: m.id, status: "done", workOrderId: m.work_order_id }))} data-testid="run-list-done">Done ✓</button>
                  )}
                  {!done && st !== "needs-order" && (
                    <button type="button" className="btn clay" disabled={busy === m.id} onClick={() => {
                      const note = window.prompt("What went wrong? (one line)") ?? "";
                      if (note.trim()) void run(m.id, () => setMovementStatus({ id: m.id, status: "problem", note: note.trim().slice(0, 500), workOrderId: m.work_order_id }));
                    }}>Problem</button>
                  )}
                  {st === "needs-order" && <span className="warn">order not placed yet — the office ticks Ordered first</span>}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {plan.stops.length === 0 && <p className="lede">Nothing on your {shortDay(day)}.</p>}
    </div>
  );
}
