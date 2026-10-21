"use client";

import { useState } from "react";
import { chipFilterKind, chipState, gates, kindLabel, shortDay, type World } from "@/lib/movements/evaluate";
import type { JobExtras } from "@/lib/movements/load";
import { movementIcon } from "@/lib/movements/gearIcons";
import type { EquipmentCategory, MaterialLineRow, MovementRow } from "@/lib/movements/types";
import { addMaterialLine, removeMaterialLine, type MovementActionResult } from "./actions";

type Act = (run: () => Promise<MovementActionResult>, done?: (value: string) => string | void) => Promise<boolean>;

const SOURCE_WORD: Record<MaterialLineRow["source"], string> = { estimate: "estimate", pc: "job page", painter_request: "painter's request" };

/**
 * Sources (ruling 17): three cards for one job over ONE list — the estimate's internal
 * Materials & sundries field, the job page's pre-start, the tray — and the strip that
 * names the doors. Adding or removing a line in any card changes all three and makes or
 * removes the chip (the sync does, through material_line_add / _remove); a line already on
 * someone's day refuses removal until it is back in the tray (the RPC says `placed`).
 */
export default function SourcesView({ world, materialLines, jobExtras, jobId, onPickJob, onAddChip, onOpenChip, act, busy, personName, categoryOf }: {
  world: World; materialLines: MaterialLineRow[]; jobExtras: Record<string, JobExtras>; jobId: string | null;
  onPickJob: (id: string) => void; onAddChip: () => void; onOpenChip: (m: MovementRow) => void; act: Act; busy: boolean;
  personName: (m: Pick<MovementRow, "assignee_kind" | "assignee_id">) => string | null; categoryOf: (m: MovementRow) => EquipmentCategory | null;
}) {
  const jobs = world.jobs.filter((j) => j.stage !== "closed").sort((a, b) => (a.startDate ?? "9999").localeCompare(b.startDate ?? "9999"));
  const job = (jobId && jobs.find((j) => j.id === jobId)) || jobs[0] || null;
  const [draft, setDraft] = useState<Record<string, string>>({});

  if (!job) {
    return <p className="note" data-testid="sources-empty">No open job on this week&rsquo;s board yet — Sources shows a job&rsquo;s one materials list in its three places.</p>;
  }
  const lines = materialLines.filter((l) => l.work_order_id === job.id && !l.merged_into);
  const chips = world.movements.filter((m) => m.work_order_id === job.id && m.status !== "cancelled");
  const chipOfLine = (l: MaterialLineRow) => chips.find((c) => c.source_key === `matline:${l.id}`);
  const paintChips = chips.filter((c) => c.kind === "paint");
  const gearChips = chips.filter((c) => c.kind === "equipment_out" || c.kind === "hire_on");
  const g = gates(world, job.id);
  const extras = jobExtras[job.id];
  const where = (c: MovementRow) => (c.status === "tray" ? "in the tray" : `${kindLabel(c)} · ${(personName(c) ?? "").split(" ")[0]} · ${c.due_date ? shortDay(c.due_date) : ""} ${c.time ? c.time.slice(0, 5) : c.half ?? ""}`);

  async function addLine(source: "estimate" | "pc", key: string) {
    const text = (draft[key] ?? "").trim();
    if (!text) { await act(async () => ({ ok: false, message: "Type the line first" })); return; }
    const ok = await act(() => addMaterialLine({ workOrderId: job!.id, text, source }), () => `Line added ${source === "estimate" ? "on the estimate" : "on the job page"} — it's a chip in the tray now`);
    if (ok) setDraft((d) => ({ ...d, [key]: "" }));
  }

  const lineList = (source: "estimate" | "pc", key: string) => (
    <>
      <div className="lines">
        {lines.length === 0 && <p className="note" style={{ margin: "4px 0" }}>No materials lines yet.</p>}
        {lines.map((l) => {
          const c = chipOfLine(l);
          return (
            <div key={l.id} className="ln" data-testid="material-line">
              <span>{l.text}<small><span className="src">{SOURCE_WORD[l.source]}</span>{c ? (c.status === "tray" ? " · in the tray" : ` · on ${(personName(c) ?? "").split(" ")[0]}'s ${c.due_date ? shortDay(c.due_date) : ""}`) : " · chip pending"}</small></span>
              <button type="button" disabled={busy} onClick={() => void act(() => removeMaterialLine({ id: l.id, workOrderId: job.id }), () => "Line removed everywhere")}>remove</button>
            </div>
          );
        })}
      </div>
      <div className="addln">
        <input type="text" value={draft[key] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))} maxLength={500}
          placeholder="One order per line — gap filler, interior filler, brushes, rollers" aria-label="Add a materials line"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addLine(source, key); } }} />
        <button type="button" className="btn sm" disabled={busy} onClick={() => void addLine(source, key)}>Add</button>
      </div>
    </>
  );

  const stateWord = (c: MovementRow) => { const s = chipState(c); return s === "tray" ? "to plan" : s === "needs-order" ? "order" : s; };
  const pillClass = (c: MovementRow) => { const s = chipState(c); return s === "booked" ? "p-cy" : s === "needs-order" ? "p-amber" : s === "done" ? "p-em" : ""; };

  return (
    <div data-testid="sources-view">
      <p className="note intro">One list, three places. A materials line typed in the estimate, on the job page or straight into the tray is the <b>same row</b> — it shows in all three and becomes a chip the moment it exists. Paint rows come from the Materials card the same way.</p>
      <div className="sources">
        <div className="card" data-testid="sources-estimate">
          <div className="where">Estimate builder · internal</div>
          <h3>
            {job.address || job.title}
            <em>
              <select value={job.id} onChange={(e) => onPickJob(e.target.value)} aria-label="Job">
                {jobs.map((j) => <option key={j.id} value={j.id}>{j.address || j.title}</option>)}
              </select>
            </em>
          </h3>
          <div className="fakefield">
            <div className="lbl">Crew notes <small>internal · existing field</small></div>
            <p className="note" style={{ margin: "4px 0 0" }}>{extras?.crewNotes || "—"}</p>
          </div>
          <div className="fakefield hi">
            <div className="lbl">Materials &amp; sundries <small>internal · never on the customer&rsquo;s document</small></div>
            {lineList("estimate", "estimate")}
          </div>
          <div className="fakefield">
            <div className="lbl">Materials card · paint <small>existing · per product</small></div>
            <div style={{ marginTop: 6 }}>
              {(extras?.paintRows ?? []).map((r) => (
                <div key={r.rowKey} className="paintrow"><span>{r.brand === "brand?" ? "" : `${r.brand} `}{r.product}<small>{r.colourName || "—"}{r.colourStatus !== "confirmed" ? " · TBC" : ""}</small></span><span className="cans">{r.litres ?? 0} L · {r.cans} can{r.cans === 1 ? "" : "s"}</span></div>
              ))}
              {(extras?.paintRows ?? []).length === 0 && <p className="note" style={{ margin: "4px 0" }}>No paint rows on the Materials card.</p>}
            </div>
          </div>
        </div>

        <div className="card" data-testid="sources-prestart">
          <div className="where">PC Command · job page · pre-start</div>
          <h3>Pre-start <em><a href={`/pc/wo/${job.id}`}>{job.jobRef}</a></em></h3>
          <div className="gate"><span className={`box ${g.paint ? "on" : ""}`}>✓</span><div>Materials ordered<small>{g.paintOrdered} of {g.paintTotal} paint chip{g.paintTotal === 1 ? "" : "s"} ordered · {lines.length} materials line{lines.length === 1 ? "" : "s"}</small></div></div>
          <div className="fakefield">
            <div className="lbl">Paint <small>from the Materials card · one chip per brand</small></div>
            <div style={{ marginTop: 6 }}>
              {paintChips.map((c) => (
                <div key={c.id} className="paintrow"><span>{c.title}<small>{where(c)}</small></span><span className={`pill ${pillClass(c)}`}>{stateWord(c)}</span></div>
              ))}
              {paintChips.length === 0 && <p className="note" style={{ margin: "4px 0" }}>No paint chips — the Materials card has no rows, or the office said not needed.</p>}
            </div>
          </div>
          <div className="fakefield hi">
            <div className="lbl">Materials lines <small>same list as the estimate</small></div>
            {lineList("pc", "pc")}
          </div>
          <div className="gate"><span className={`box ${g.gear ? "on" : ""}`}>✓</span><div>Equipment movements booked<small>{g.gearTotal} gear chip{g.gearTotal === 1 ? "" : "s"} · {g.gearBooked} booked</small></div></div>
          {gearChips.map((c) => <div key={c.id} className="paintrow"><span>{c.title}<small>{where(c)}</small></span><span className={`pill ${pillClass(c)}`}>{stateWord(c)}</span></div>)}
        </div>

        <div className="card" data-testid="sources-tray">
          <div className="where">Movements · tray</div>
          <h3>Chips for this job <em>live</em></h3>
          <div style={{ marginTop: 6 }}>
            {chips.map((c) => (
              <button key={c.id} type="button" className={`chip ${chipFilterKind(c)}`} style={c.status !== "tray" ? { opacity: 0.75 } : undefined} data-testid="tray-chip" data-movement-id={c.id} onClick={() => onOpenChip(c)}>
                <span className={`ic ${chipFilterKind(c)}`}>{movementIcon(c, categoryOf(c))}</span>
                <div className="b"><b>{c.title}</b><small>{c.status === "tray" ? "in the tray — drag it on the Week board" : where(c)}</small></div>
              </button>
            ))}
            {chips.length === 0 && <p className="note">No chips on this job yet.</p>}
          </div>
          <button type="button" className="add" onClick={onAddChip}>+ Add a chip — from scratch</button>
          <p className="note">Painter asks for more in the portal → <b>Accept as a line</b> lands here too.</p>
        </div>
      </div>

      <div className="card doors">
        <h3>How a movement gets created <em>three doors, one record</em></h3>
        <div className="flow"><span className="s">Estimate · Materials &amp; sundries (internal)</span><span className="a">→ at acceptance →</span><span className="s">Job page · Pre-start · Materials lines</span><span className="a">= same rows =</span><span className="s">Tray chip</span><span className="a">→ drag →</span><span className="s">Movement on someone&rsquo;s day</span><span className="a">→ Ordered ✓ →</span><span className="s">Painter texted</span></div>
        <div className="flow"><span className="s">Materials card · paint rows</span><span className="a">→ grouped by brand →</span><span className="s">Paint chip per brand</span><span className="a">→ lines edited in the chip edit the card</span></div>
        <div className="flow"><span className="s">Painter asks for more (portal)</span><span className="a">→ Accept as a line →</span><span className="s">Materials line + chip</span></div>
        <div className="flow"><span className="s">+ Add a chip here</span><span className="a">→ a materials chip also writes the line back to the job page and the estimate</span></div>
      </div>
    </div>
  );
}
