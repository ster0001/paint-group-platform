"use client";

import { useState } from "react";
import { locations, type World } from "@/lib/movements/evaluate";
import { GEAR_ICONS } from "@/lib/movements/gearIcons";
import { addMaterialLine, createMovement, type MovementActionResult } from "./actions";

type Act = (run: () => Promise<MovementActionResult>, done?: (value: string) => string | void) => Promise<boolean>;
type Kind = "paint" | "materials" | "gear" | "rubbish";

/**
 * + Add a chip (brief §3.4): kind → job (or Warehouse) → what. A materials chip on a job is a
 * LINE (material_line_add) — the sync makes its chip, so it shows on the job page and the
 * estimate too (one list, three doors). Gear shows the register with each item's location
 * and disables anything not at the warehouse. Rubbish is refused for a job that already
 * has its chip (the RPC says so). Paint from scratch is a manual chip titled brand · lines.
 */
export default function AddChipSheet({ world, jobId, act, busy, onClose }: { world: World; jobId: string | null; act: Act; busy: boolean; onClose: () => void }) {
  const jobs = world.jobs.filter((j) => j.stage !== "closed").sort((a, b) => (a.startDate ?? "9999").localeCompare(b.startDate ?? "9999"));
  const [kind, setKind] = useState<Kind>("materials");
  const [job, setJob] = useState<string>(jobId && jobs.some((j) => j.id === jobId) ? jobId : jobs[0]?.id ?? "");
  const [text, setText] = useState("");
  const [items, setItems] = useState<string[]>([]);
  const register = locations(world, new Map(world.painters.map((p) => [p.contractorId, p.name])));

  async function add() {
    const wo = job || null;
    const t = text.trim();
    if (kind === "materials") {
      if (!t) { return act(async () => ({ ok: false, message: "Type what it is" })); }
      if (wo) return act(() => addMaterialLine({ workOrderId: wo, text: t, source: "pc" }), () => "Added — it's now a line on the job page and the estimate too");
      return act(() => createMovement({ kind: "restock", workOrderId: null, title: t, detail: "added in the tray", from: { kind: "branch" }, to: { kind: "warehouse" } }), () => "Added to the tray");
    }
    if (kind === "paint") {
      if (!t || !wo) return act(async () => ({ ok: false, message: "Pick a job and type the brand" }));
      return act(() => createMovement({ kind: "paint", workOrderId: wo, title: t, detail: "added from the tray — confirm the Materials card", from: { kind: "branch" }, to: { kind: "site" } }), () => "Added to the tray — the office confirms the Materials card");
    }
    if (kind === "gear") {
      if (!items.length || !wo) return act(async () => ({ ok: false, message: "Tick at least one item and pick a job" }));
      return act(() => createMovement({ kind: "equipment_out", workOrderId: wo, items }), () => "Added to the tray");
    }
    if (!wo) return act(async () => ({ ok: false, message: "Pick a job" }));
    return act(() => createMovement({ kind: "rubbish_out", workOrderId: wo, title: "Rubbish — how?", detail: "undecided" }), () => "Added to the tray");
  }

  return (
    <>
      <div className="sh-h"><h3>Add a chip</h3><span className="ref">anything that has to move</span></div>
      <p className="sh-sub">A materials chip you add here also appears as a line on the job page and in the estimate — one list.</p>
      <div className="fld">
        <div className="k">What kind</div>
        <div className="chips">
          {([["paint", "Paint"], ["materials", "Materials"], ["gear", "Gear"], ["rubbish", "Rubbish"]] as const).map(([v, label]) => (
            <button key={v} type="button" className={`chp ${kind === v ? "on" : ""}`} onClick={() => setKind(v)}>{label}</button>
          ))}
        </div>
      </div>
      <div className="fld">
        <div className="k">Job</div>
        <select value={job} onChange={(e) => setJob(e.target.value)} aria-label="Job">
          {jobs.map((j) => <option key={j.id} value={j.id}>{j.address || j.title} · {j.jobRef}</option>)}
          <option value="">{world.settings.warehouse.label || "Warehouse"} · no job</option>
        </select>
      </div>
      {kind === "gear" ? (
        <div className="fld">
          <div className="k">Our equipment <em>where it is now</em></div>
          <div className="list">
            {register.length === 0 && <p className="note" style={{ padding: "8px 12px" }}>The register is empty — add items under Settings → Equipment.</p>}
            {register.map(({ item, state, detail }) => {
              const away = state !== "warehouse";
              const on = items.includes(item.id);
              return (
                <button key={item.id} type="button" className={`opt box ${on ? "on" : ""}`} disabled={away} data-testid="register-item"
                  onClick={() => setItems((cur) => (cur.includes(item.id) ? cur.filter((x) => x !== item.id) : [...cur, item.id]))}>
                  <span className="rad" />
                  <span><span className="iname"><span className="ic gear">{GEAR_ICONS[item.category]}</span>{item.name}</span><span className={`sub ${away ? "warn" : ""}`}>{detail}</span></span>
                  <span className="km">{item.tag}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="fld">
          <div className="k">{kind === "paint" ? "What (brand · lines)" : kind === "rubbish" ? "Rubbish" : "What"}</div>
          {kind === "rubbish"
            ? <p className="note">One rubbish chip per job — you answer how (painter disposed · drops at warehouse · left on site) in the chip.</p>
            : <input type="text" value={text} onChange={(e) => setText(e.target.value)} maxLength={160} aria-label="What"
                placeholder={kind === "materials" ? "e.g. 4× drop sheets 12 m, 2 rolls 48 mm tape" : "e.g. Haymes · Expressions Low Sheen · 2×10 L"} />}
        </div>
      )}
      <div className="sh-acts">
        <button type="button" className="btn primary" disabled={busy} data-testid="add-chip-go" onClick={() => void add().then((ok) => { if (ok) onClose(); })}>Add to the tray</button>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
      </div>
    </>
  );
}
