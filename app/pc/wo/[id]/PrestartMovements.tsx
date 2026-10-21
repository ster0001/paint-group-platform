"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { chipFilterKind, chipState, kindLabel, type Gates } from "@/lib/movements/evaluate";
import { movementIcon } from "@/lib/movements/gearIcons";
import type { BranchRow, EquipmentItemRow, LogisticsDecisionRow, MaterialLineRow, MovementRow } from "@/lib/movements/types";
import { addMaterialLine, createMovement, decideLogistics, mergeMaterialLines, removeMaterialLine, splitMaterialLine, updateMaterialLine, type MovementActionResult } from "@/app/pc/movements/actions";
import { MaterialBubbles } from "@/app/components/materials/MaterialBubbles";

/**
 * The job page's pre-start, under the two gate items (brief §3.4 "Job page", Session 7):
 * under Materials ordered — this job's paint and materials chips, as cards (tap → the
 * same chip sheet on the Movements board), and the one materials list (add / remove; a
 * line already on someone's day refuses removal); under Equipment movements booked — the
 * gear chips. The gate ticks read `gates()` — the same answer the tick RPC gives.
 */
export type PrestartMovementsProps = {
  workOrderId: string;
  kind: "materials" | "equipment";
  movements: MovementRow[];
  lines: MaterialLineRow[];
  decisions: LogisticsDecisionRow[];
  branches: BranchRow[];
  items: EquipmentItemRow[];
  gates: Gates;
  failures: string[];
  /** Off on the standalone card (a job past pre-start): the gate sentence is about the tick. */
  showGate?: boolean;
};

const STATE_WORD: Record<ReturnType<typeof chipState>, string> = {
  tray: "in the tray — not planned yet", "needs-order": "placed · order not placed", planned: "planned", booked: "ordered / booked", done: "done", problem: "problem", cancelled: "cancelled",
};

export default function PrestartMovements({ workOrderId, kind, movements, lines, decisions, branches, items, gates, failures, showGate = true }: PrestartMovementsProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const run = (fn: () => Promise<MovementActionResult>, done?: string) => start(async () => {
    setMsg(null);
    const r = await fn();
    setMsg(r.ok ? done ?? null : r.message);
    if (r.ok) { setDraft(""); router.refresh(); }
  });

  const chips = movements.filter((m) => (kind === "materials" ? m.kind === "paint" || m.kind === "materials" : m.kind === "equipment_out" || m.kind === "hire_on" || m.kind === "equipment_return" || m.kind === "hire_off"));
  const decision = decisions.find((d) => d.line === (kind === "materials" ? "paint" : "equipment"))?.decision ?? null;
  const liveLines = lines.filter((l) => !l.merged_into);
  const chipOfLine = (l: MaterialLineRow) => movements.find((m) => m.source_key === `matline:${l.id}`);
  const shopOf = (m: MovementRow) => { const b = branches.find((x) => x.id === (m.from_branch_id ?? m.to_branch_id)); return b ? `${b.brand} ${b.branch}` : null; };
  const categoryOf = (m: MovementRow) => { const first = m.items[0]; return first ? items.find((i) => i.id === first.equipment_item_id)?.category ?? null : null; };
  const boardHref = (m?: MovementRow) => `/pc/movements?view=week&job=${workOrderId}${m ? `&movement=${m.id}` : ""}`;
  const ok = kind === "materials" ? gates.paint : gates.gear;
  const blocker = kind === "materials" ? gates.paintBlocker : gates.gearBlocker;

  return (
    <div className="prestart-mv" data-testid={`prestart-${kind}`} data-gate={ok ? "open" : "blocked"}>
      {failures.map((f) => <p key={f} className="note" style={{ color: "var(--amber)" }} data-testid="prestart-mv-failure">{f}</p>)}
      {showGate && <p className="note" data-testid={`prestart-${kind}-gate`} style={{ color: ok ? "var(--emerald)" : "var(--amber)", margin: "4px 0" }}>
        {kind === "materials"
          ? (decision ? `Marked ${decision === "not_needed" ? "not needed" : "painter supplies"} — the tick is free.` : ok ? `${gates.paintOrdered} of ${gates.paintTotal} paint chip${gates.paintTotal === 1 ? "" : "s"} ordered — the tick is free.` : `Ordered ${gates.paintOrdered} of ${gates.paintTotal} paint chip${gates.paintTotal === 1 ? "" : "s"} — the tick refuses until ${blocker ? `"${blocker.title}"` : "every chip"} is ordered.`)
          : (decision ? "Marked not needed — the tick is free." : ok ? `${gates.gearBooked} of ${gates.gearTotal} gear chip${gates.gearTotal === 1 ? "" : "s"} booked — the tick is free.` : `Booked ${gates.gearBooked} of ${gates.gearTotal} gear chip${gates.gearTotal === 1 ? "" : "s"} — the tick refuses until ${blocker ? `"${blocker.title}"` : "every chip"} is booked.`)}
      </p>}
      {chips.length > 0 && (
        <div className="mvcards" data-testid={`prestart-${kind}-chips`}>
          {chips.map((m) => {
            const st = chipState(m);
            return (
              <Link key={m.id} href={boardHref(m)} className={`mvcard ${st}`} data-testid="prestart-chip" data-movement-id={m.id} data-state={st}>
                <span className={`ic ${chipFilterKind(m)}`}>{movementIcon(m, categoryOf(m))}</span>
                <span className="bd">
                  <b>{m.title}</b>
                  <small>{[kindLabel(m), shopOf(m), m.due_date ? `${m.due_date}${m.time ? ` ${m.time.slice(0, 5)}` : m.half ? ` ${m.half}` : ""}` : null].filter(Boolean).join(" · ")}</small>
                  <small className="st">{STATE_WORD[st]}</small>
                </span>
              </Link>
            );
          })}
        </div>
      )}
      {kind === "materials" && (
        <div className="mvlines" data-testid="prestart-material-lines">
          <div className="k">Materials orders <small>one bubble = one order chip; commas separate the items · tap the words to edit · × on an item splits it into its own order · same list on the estimate and in the tray</small></div>
          {liveLines.length === 0 && <p className="note" style={{ margin: "4px 0" }}>No materials orders yet.</p>}
          <MaterialBubbles
            testId="prestart-material-line"
            busy={pending}
            bubbles={liveLines.map((l) => {
              const chip = chipOfLine(l);
              const placed = Boolean(chip && chip.status !== "tray" && chip.status !== "cancelled");
              return { id: l.id, text: l.text, locked: placed, sub: `${l.source === "estimate" ? "estimate" : l.source === "painter_request" ? "painter asked" : "job page"}${chip ? ` · ${STATE_WORD[chipState(chip)]}` : ""}` };
            })}
            onEdit={(id, text) => run(() => updateMaterialLine({ id, text, workOrderId }), "Line updated — its chip follows")}
            onRemove={(id) => run(() => removeMaterialLine({ id, workOrderId }), "Line removed")}
            onSplit={(id, item) => run(() => splitMaterialLine({ id, item, workOrderId }), `${item} is its own order now — a new chip in the tray`)}
          />
          {liveLines.filter((l) => { const c = chipOfLine(l); return !c || c.status === "tray"; }).length > 1 && (
            <button type="button" className="btn dim sm" disabled={pending} data-testid="prestart-lines-combine"
              title="Every line still in the tray becomes one order"
              onClick={() => { const free = liveLines.filter((l) => { const c = chipOfLine(l); return !c || c.status === "tray"; }); run(() => mergeMaterialLines({ ids: free.slice(1).map((l) => l.id), into: free[0].id, workOrderId }), "Combined into one order"); }}>
              Combine into one order
            </button>
          )}
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <input className="num" style={{ flex: 1 }} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="One order per line, commas between items — gap filler, interior filler, brushes, rollers" maxLength={500} data-testid="prestart-line-input"
              onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) run(() => addMaterialLine({ workOrderId, text: draft.trim(), source: "pc" }), "Line added — it is a chip in the tray now"); }} />
            <button type="button" className="btn" disabled={pending || !draft.trim()} onClick={() => run(() => addMaterialLine({ workOrderId, text: draft.trim(), source: "pc" }), "Line added — it is a chip in the tray now")} data-testid="prestart-line-add">Add</button>
          </div>
        </div>
      )}
      {kind === "equipment" && (
        <div className="mvlines" data-testid="prestart-gear-lines">
          <div className="k">Gear needed <small>one line = one gear chip; separate the items with commas · its return chip appears when it is booked</small></div>
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <input className="num" style={{ flex: 1 }} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Extension ladder, drop sheets, sprayer" maxLength={160} data-testid="prestart-gear-input"
              onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) run(() => createMovement({ kind: "equipment_out", workOrderId, title: draft.trim() }), "Gear chip added to the tray — its return appears once it is booked"); }} />
            <button type="button" className="btn" disabled={pending || !draft.trim()} onClick={() => run(() => createMovement({ kind: "equipment_out", workOrderId, title: draft.trim() }), "Gear chip added to the tray — its return appears once it is booked")} data-testid="prestart-gear-add">Add</button>
          </div>
        </div>
      )}
      <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        <Link className="btn" href={boardHref()} data-testid={`prestart-${kind}-board`}>{kind === "materials" ? "Plan on the Movements board" : "Pick gear from the register"}</Link>
        {!decision && (
          <>
            <button type="button" className="btn dim" disabled={pending} onClick={() => run(() => decideLogistics({ workOrderId, line: kind === "materials" ? "paint" : "equipment", decision: "not_needed" }), "Marked not needed")} data-testid={`prestart-${kind}-not-needed`}>Not needed</button>
            {kind === "materials" && <button type="button" className="btn dim" disabled={pending} onClick={() => run(() => decideLogistics({ workOrderId, line: "paint", decision: "painter_supplies" }), "Marked painter supplies")} data-testid="prestart-materials-painter-supplies">Painter supplies</button>}
          </>
        )}
      </div>
      {msg && <p className="note" data-testid={`prestart-${kind}-msg`}>{msg}</p>}
    </div>
  );
}
