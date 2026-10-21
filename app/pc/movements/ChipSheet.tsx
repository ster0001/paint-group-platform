"use client";

import { useState } from "react";
import { hourSlots } from "@/app/components/board";
import {
  chipFilterKind, chipPoint, chipState, isSkip, isUndecidedRubbish, kindLabel, locations, methodLabel, needsOrder, shortDay,
  type MovementLane, type World,
} from "@/lib/movements/evaluate";
import { km } from "@/lib/movements/sync";
import type { JobExtras } from "@/lib/movements/load";
import { GEAR_ICONS, movementIcon } from "@/lib/movements/gearIcons";
import type { BranchRow, MovementRow, RubbishHow } from "@/lib/movements/types";
import { redateMovement, setMovementMethod, setMovementStatus, setPaintLine, updateMovement, type MovementActionResult } from "./actions";

const HOURS = hourSlots([7.5, 17.5]);
const HALF_TIMES = ["06:00", "06:30", "07:00", "AM", "13:00", "PM", "15:30"] as const;

type Act = (run: () => Promise<MovementActionResult>, done?: (value: string) => string | void) => Promise<boolean>;

const RUBBISH_OPTIONS: [RubbishHow, string][] = [["painter_disposed", "Painter disposed"], ["painter_warehouse", "Painter drops at warehouse"], ["left_on_site", "Left on site"]];

/**
 * Tap any chip, tray or placed (brief §3.4): its lines, items, the rubbish question, the
 * shop nearest first, time chips, order reference, client notice, note; Ordered ✓, Copy
 * order text, Back to tray, Remove (manual chips), Save. Every write is an action over one
 * RPC; a paint line edit goes through the Materials card's own writer (wo_set_material).
 */
export default function ChipSheet({ chip, world, jobExtras, lane, act, busy, onClose, say, onOrdered, onUnplace }: {
  chip: MovementRow; world: World; jobExtras: Record<string, JobExtras>; lane: MovementLane | null;
  act: Act; busy: boolean; onClose: () => void; say: (text: string, ms?: number) => void; onOrdered: () => void; onUnplace: () => void;
}) {
  const job = world.jobs.find((j) => j.id === chip.work_order_id) ?? null;
  const state = chipState(chip);
  const placed = chip.status !== "tray";
  const filterKind = chipFilterKind(chip);
  const skip = isSkip(chip);
  const hire = chip.kind === "hire_on" || chip.kind === "hire_off";
  const branchKind: BranchRow["kind"] | null = chip.kind === "paint" ? "paint" : chip.kind === "materials" || chip.kind === "restock" ? "hardware" : skip || hire ? "hire" : null;
  const point = chipPoint(chip, world);
  const shops = branchKind
    ? world.branches.filter((b) => b.kind === branchKind).map((b) => ({ b, d: km(point, b.lat != null && b.lng != null ? { lat: b.lat, lng: b.lng } : null) }))
      .sort((x, y) => (x.d ?? 9e9) - (y.d ?? 9e9) || x.b.branch.localeCompare(y.b.branch))
    : [];
  const brand = chip.kind === "paint" && chip.source_key?.startsWith("paint:") ? chip.source_key.slice(6) : null;
  const liveRows = brand && job ? (jobExtras[job.id]?.paintRows ?? []).filter((r) => r.brand === brand) : [];
  const rows = chip.lines ?? liveRows;
  const coloursTbc = chip.kind === "paint" && job ? !job.coloursConfirmed : false;
  const manual = chip.source_key === null;
  const lineChip = chip.kind === "materials" && (chip.source_key ?? "").startsWith("matline:");

  // The draft: what Save sends in one movement_update.
  const [branchId, setBranchId] = useState<string | null>(chip.from_branch_id ?? chip.to_branch_id);
  const [time, setTime] = useState<string>(chip.time ? chip.time.slice(0, 5) : chip.half ?? HOURS[0]);
  const [note, setNote] = useState(chip.note);
  const [orderRef, setOrderRef] = useState(chip.order_ref);
  const [clientNotice, setClientNotice] = useState(chip.client_notice);
  const [title, setTitle] = useState(chip.title);
  const [skipIn, setSkipIn] = useState(job?.startDate ?? "");
  const [skipOut, setSkipOut] = useState(job?.endDate ?? "");
  const [skipYard, setSkipYard] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<string | null>(null);
  const [rowColour, setRowColour] = useState("");
  const [rowLitres, setRowLitres] = useState("");

  const dirty = {
    branch: branchId !== (chip.from_branch_id ?? chip.to_branch_id),
    time: placed && time !== (chip.time ? chip.time.slice(0, 5) : chip.half ?? HOURS[0]),
    note: note !== chip.note, orderRef: orderRef !== chip.order_ref, clientNotice: clientNotice !== chip.client_notice, title: title !== chip.title,
  };

  /** Save the draft: one movement_update (plus a redate when the time chip is AM/PM). Returns false on a refusal. */
  async function save(): Promise<boolean> {
    const patch: {
      id: string; workOrderId: string | null; fromBranchId?: string | null; toBranchId?: string | null; note?: string; orderRef?: string;
      clientNotice?: boolean; title?: string; time?: string | null;
    } = { id: chip.id, workOrderId: chip.work_order_id };
    let any = false;
    if (dirty.branch) { if (chip.to_branch_id && !chip.from_branch_id) patch.toBranchId = branchId; else patch.fromBranchId = branchId; any = true; }
    if (dirty.note) { patch.note = note; any = true; }
    if (dirty.orderRef) { patch.orderRef = orderRef; any = true; }
    if (dirty.clientNotice) { patch.clientNotice = clientNotice; any = true; }
    if (dirty.title && (manual || lineChip)) { patch.title = title; any = true; }
    if (dirty.time && time !== "AM" && time !== "PM") { patch.time = time; any = true; }
    if (any) { const ok = await act(() => updateMovement(patch)); if (!ok) return false; }
    if (dirty.time && (time === "AM" || time === "PM") && chip.due_date) {
      const ok = await act(() => redateMovement({ id: chip.id, dueDate: chip.due_date!, half: time, workOrderId: chip.work_order_id }));
      if (!ok) return false;
      if (chip.time) { const ok2 = await act(() => updateMovement({ id: chip.id, workOrderId: chip.work_order_id, time: null })); if (!ok2) return false; }
    }
    return true;
  }

  /** Tom, 21 Oct 2026: delivered or picked up, with the shop — delivery lands it on the Supplier lane. */
  async function confirmMethod(method: "delivery" | "pickup") {
    const ok = await act(() => setMovementMethod({ id: chip.id, workOrderId: chip.work_order_id, method, branchId }), (v) =>
      v === "placed" ? "Delivery — placed on the Supplier lane on the job's first day; tick Ordered once the shop has it"
      : v === "pickshop" ? "Pick the shop first, then Delivered to site"
      : v === "nodelivery" ? "That shop is counter-only — pick one that delivers, or choose Picked up"
      : "Picked up — drag the chip onto whoever collects it");
    if (ok && method === "delivery") onClose();
  }

  async function rubbish(how: RubbishHow) {
    const painter = world.painters.find((p) => p.contractorId === job?.contractorId)?.name.split(" ")[0] ?? "the painter";
    const ok = await act(() => updateMovement({ id: chip.id, workOrderId: chip.work_order_id, rubbishHow: how }), () =>
      how === "painter_disposed" ? `Recorded: ${painter} disposes of it — nothing for anyone to move`
      : how === "painter_warehouse" ? `${painter} drops it at the warehouse on their last day — on their lane`
      : "Left on site — drop the chip on whoever collects it, or make it a skip from the chip");
    if (ok) onClose();
  }

  async function makeSkip() {
    if (!skipYard) { say("Pick a hire yard first"); return; }
    if (!skipIn || !skipOut) { say("Pick the in and out days"); return; }
    const ok = await act(() => updateMovement({ id: chip.id, workOrderId: chip.work_order_id, skip: { branchId: skipYard, inDate: skipIn, outDate: skipOut } }), () => "Now drop the skip on the Supplier lane");
    if (ok) onClose();
  }

  async function saveRow(rowKey: string, status: string | null) {
    if (!job) return;
    const litres = rowLitres.trim() === "" ? null : Number(rowLitres);
    if (litres !== null && !(litres >= 0)) { say("Litres must be a number"); return; }
    const ok = await act(() => setPaintLine({ workOrderId: job.id, rowKey, colourName: rowColour, status: status === "confirmed" ? "confirmed" : "tbc", litres }), () => "Materials card updated — the chip re-reads it");
    if (ok) setEditRow(null);
  }

  function copyOrderText() {
    const shop = world.branches.find((b) => b.id === branchId);
    const text = [
      `Order ${orderRef || chip.order_ref || ""} · Paint Group`.trim(),
      shop ? `${shop.brand} ${shop.branch}${shop.address ? `, ${shop.address}` : ""}` : "",
      job ? `Deliver to: ${job.address}` : "",
      ...rows.map((r) => `- ${r.product}${r.colourName ? ` · ${r.colourName}` : ""} · ${r.litres ?? 0} L (${r.cans} can${r.cans === 1 ? "" : "s"})`),
      note ? `Note: ${note}` : "",
    ].filter(Boolean).join("\n");
    navigator.clipboard?.writeText(text).then(() => say("Order text copied — paste into the email or the Trade app"), () => say("Couldn't copy — select the lines and copy them by hand"));
  }

  const itemViews = chip.items.length ? locations(world, new Map(world.painters.map((p) => [p.contractorId, p.name]))) : [];
  const timeChips: readonly string[] = lane?.slots === "hour" ? HOURS : HALF_TIMES;
  const canCopy = chip.kind === "paint" && !coloursTbc;

  return (
    <>
      <div className="sh-h">
        <h3>{filterKind === "paint" ? "Paint" : filterKind === "materials" ? "Materials" : filterKind === "gear" ? "Gear" : "Rubbish"} · {chip.title.split(" · ")[0]}</h3>
        <span className="ref">{job ? `${job.jobRef} · ${job.address}` : world.settings.warehouse.label || "Warehouse"}</span>
      </div>
      <p className="sh-sub">
        {placed && lane
          ? <><span className="kl" style={{ ["--pc" as string]: lane.colour } as React.CSSProperties}><i />{kindLabel(chip)}</span> {methodLabel(chip, lane.name)} · {chip.due_date ? shortDay(chip.due_date) : ""} {chip.time ? chip.time.slice(0, 5) : chip.half ?? ""}</>
          : "In the tray — drag it onto a person's day"}
        {coloursTbc && <> · <span className="warn">⚑ colours TBC — plan now, order unlocks when the colours are confirmed</span></>}
      </p>

      {chip.kind === "paint" && rows.length > 0 && (
        <div className="fld">
          <div className="k">Lines <em>{chip.lines ? "frozen at ordering" : "the Materials card — editing here edits it"}</em></div>
          <div className="list">
            {rows.map((r) => (
              <div key={r.rowKey} className="opt rowline" data-testid="paint-line">
                {editRow === r.rowKey && !chip.lines ? (
                  <span className="rowedit" onPointerDown={(e) => e.stopPropagation()}>
                    <span>{r.product}</span>
                    <input type="text" value={rowColour} onChange={(e) => setRowColour(e.target.value)} placeholder="Colour" aria-label="Colour name" />
                    <input type="text" inputMode="decimal" value={rowLitres} onChange={(e) => setRowLitres(e.target.value)} placeholder="Litres" aria-label="Litres" />
                    <button type="button" className="btn sm primary" disabled={busy} onClick={() => void saveRow(r.rowKey, r.colourStatus)}>Save line</button>
                    <button type="button" className="btn sm" onClick={() => setEditRow(null)}>Cancel</button>
                  </span>
                ) : (
                  <>
                    <button type="button" className="rowbtn" disabled={Boolean(chip.lines)} onClick={() => { setEditRow(r.rowKey); setRowColour(r.colourName ?? ""); setRowLitres(r.litres == null ? "" : String(r.litres)); }}>
                      {r.product}<span className={`sub ${r.colourStatus !== "confirmed" ? "warn" : ""}`}>{r.colourName || "—"}{r.colourStatus !== "confirmed" ? " · TBC" : ""}</span>
                    </button>
                    <span className="km">{r.litres ?? 0} L · {r.cans} can{r.cans === 1 ? "" : "s"}</span>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {(chip.kind === "paint" || chip.kind === "materials") && !placed && (
        <div className="fld" data-testid="chip-method">
          <div className="k">How does it get to site? <em>{chip.method_pref ? (chip.method_pref === "delivery" ? "delivered" : "picked up") : "not confirmed"}</em></div>
          <div className="chips">
            <button type="button" className={`chp ${chip.method_pref === "delivery" ? "on" : ""}`} disabled={busy} onClick={() => void confirmMethod("delivery")} data-testid="method-delivery">Delivered to site</button>
            <button type="button" className={`chp ${chip.method_pref === "pickup" ? "on" : ""}`} disabled={busy} onClick={() => void confirmMethod("pickup")} data-testid="method-pickup">Picked up</button>
          </div>
          <p className="note">Pick the shop below first. Delivered = this chip goes onto the Supplier lane on the job&rsquo;s first day. Picked up = drag it onto whoever collects it.</p>
        </div>
      )}

      {(lineChip || manual) && (
        <div className="fld">
          <div className="k">{lineChip ? "Line" : "What"} <em>{lineChip ? "same row on the estimate and the job page" : "your words"}</em></div>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} aria-label="Line text" />
        </div>
      )}

      {chip.items.length > 0 && (
        <div className="fld">
          <div className="k">Items <em>from the register</em></div>
          <div className="list">
            {chip.items.map((it) => {
              const v = itemViews.find((x) => x.item.id === it.equipment_item_id);
              return (
                <div key={it.equipment_item_id} className="opt" style={{ cursor: "default" }}>
                  <span className="ic gear">{v ? GEAR_ICONS[v.item.category] : movementIcon(chip)}</span>
                  <span>{v?.item.name ?? it.label}<span className="sub">{v?.detail ?? ""}</span></span>
                  <span className="km">{v?.item.tag ?? it.label.split(" · ")[0]}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isUndecidedRubbish(chip) && (
        <div className="fld">
          <div className="k">How</div>
          <div className="chips">
            {RUBBISH_OPTIONS.map(([v, label]) => <button key={v} type="button" className="chp" disabled={busy} onClick={() => void rubbish(v)}>{label}</button>)}
          </div>
          <p className="note">Painter disposed = nothing to move. Drops at warehouse = a drop-off on the painter&rsquo;s last day. Left on site = someone collects, or a skip.</p>
        </div>
      )}

      {chip.kind === "rubbish_out" && !isUndecidedRubbish(chip) && !skip && !placed && (
        <div className="fld">
          <div className="k">Skip bin instead <em>a skip from a hire yard, in and out</em></div>
          <div className="list">
            {world.branches.filter((b) => b.kind === "hire").map((b) => ({ b, d: km(point, b.lat != null && b.lng != null ? { lat: b.lat, lng: b.lng } : null) })).sort((x, y) => (x.d ?? 9e9) - (y.d ?? 9e9)).map(({ b, d }) => (
              <button key={b.id} type="button" className={`opt ${skipYard === b.id ? "on" : ""}`} onClick={() => setSkipYard(b.id)}>
                <span className="rad" /><span>{b.brand} {b.branch}<span className="sub">{b.address}{b.delivers_to_site ? " · delivers" : ""}</span></span><span className="km">{d == null ? "" : `${d.toFixed(1)} km`}</span>
              </button>
            ))}
          </div>
          <div className="daterow">
            <label>In <input type="date" value={skipIn} onChange={(e) => setSkipIn(e.target.value)} /></label>
            <label>Out <input type="date" value={skipOut} onChange={(e) => setSkipOut(e.target.value)} /></label>
            <button type="button" className="btn sm" disabled={busy} onClick={() => void makeSkip()}>Make it a skip</button>
          </div>
        </div>
      )}

      {shops.length > 0 && (
        <div className="fld">
          <div className="k">{branchKind === "hire" ? "Hire yard" : "Shop"} <em>nearest first</em></div>
          <div className="list">
            {shops.map(({ b, d }) => (
              <button key={b.id} type="button" className={`opt ${branchId === b.id ? "on" : ""}`} data-testid="shop-option" onClick={() => setBranchId(b.id)}>
                <span className="rad" />
                <span>{b.brand} {b.branch}<span className="sub">{[b.address, b.opens_weekday ? `opens ${b.opens_weekday.slice(0, 5)}` : null, b.delivers_to_site ? "delivers" : "pickup"].filter(Boolean).join(" · ")}</span></span>
                <span className="km">{d == null ? "" : `${d.toFixed(1)} km`}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {placed && lane && (
        <div className="fld">
          <div className="k">Time</div>
          <div className="chips">
            {timeChips.map((t) => <button key={t} type="button" className={`chp ${time === t ? "on" : ""}`} onClick={() => setTime(t)}>{t}</button>)}
          </div>
        </div>
      )}

      {job && (chip.kind === "paint" || chip.kind === "materials") && (
        <div className="fld">
          <div className="k">Order reference</div>
          <div className="orderref">
            <input type="text" value={orderRef} onChange={(e) => setOrderRef(e.target.value)} maxLength={40} aria-label="Order reference" />
            <small>printed on the supplier order — the invoice matches itself to the job</small>
          </div>
        </div>
      )}

      {placed && lane?.kind === "supplier" && filterKind !== "rubbish" && (
        <div className="fld">
          <div className="k">Client notice <em>off by default</em></div>
          <div className="chips">
            <button type="button" className={`chp ${clientNotice ? "" : "on"}`} onClick={() => setClientNotice(false)}>Don&rsquo;t tell the client</button>
            <button type="button" className={`chp ${clientNotice ? "on" : ""}`} onClick={() => setClientNotice(true)}>Text the client it&rsquo;s coming</button>
          </div>
        </div>
      )}

      <div className="fld">
        <div className="k">Note for the shop / painter</div>
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. tint to the Lexicon Quarter sample · leave with Josef at the front door" aria-label="Note" />
      </div>

      <div className="sh-acts">
        {placed && state === "needs-order" && (
          <button type="button" className="btn primary" disabled={busy || coloursTbc} onClick={() => void save().then((ok) => { if (ok) onOrdered(); })}>
            {skip || hire ? "Booked" : "Ordered"} ✓
          </button>
        )}
        {canCopy && <button type="button" className="btn" onClick={copyOrderText}>Copy order text</button>}
        {placed && state !== "done" && <button type="button" className="btn" disabled={busy} onClick={onUnplace}>Back to tray</button>}
        {!placed && manual && (
          <button type="button" className="btn clay" disabled={busy} onClick={() => void act(() => setMovementStatus({ id: chip.id, status: "cancelled", workOrderId: chip.work_order_id }), () => "Chip removed").then((ok) => { if (ok) onClose(); })}>
            Remove
          </button>
        )}
        <button type="button" className="btn" disabled={busy} onClick={() => void save().then((ok) => { if (ok) { say("Saved"); onClose(); } })}>Save</button>
      </div>
      {needsOrder(chip) && !placed && null}
    </>
  );
}
