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
import { addPlace, redateMovement, setMovementDuration, setMovementMethod, setMovementPlace, setMovementStatus, setPaintLine, splitMaterialLine, updateMovement, type MovementActionResult } from "./actions";
import { MaterialBubbles } from "@/app/components/materials/MaterialBubbles";

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
  // Tom, 21 Oct 2026: paint and materials orders list EVERY paint shop first (nearest first),
  // then the hardware stores, and a search box narrows by brand, branch or suburb.
  const [shopQuery, setShopQuery] = useState("");
  // Tom, 23 Oct 2026: every chip has a pickup place and a drop-off place. Paint and materials list the
  // shops first; gear, rubbish and the rest list the saved places (and hire yards for a hire or skip).
  const shopKinds: BranchRow["kind"][] = branchKind === "paint" || branchKind === "hardware" ? ["paint", "hardware", "other"] : branchKind === "hire" ? ["hire", "other"] : ["other"];
  const q = shopQuery.trim().toLowerCase();
  const shops = shopKinds.length
    ? world.branches.filter((b) => shopKinds.includes(b.kind)).map((b) => ({ b, d: km(point, b.lat != null && b.lng != null ? { lat: b.lat, lng: b.lng } : null) }))
      .filter(({ b }) => !q || `${b.brand} ${b.branch} ${b.suburb}`.toLowerCase().includes(q))
      .sort((x, y) => shopKinds.indexOf(x.b.kind) - shopKinds.indexOf(y.b.kind) || (x.d ?? 9e9) - (y.d ?? 9e9) || x.b.branch.localeCompare(y.b.branch))
    : [];
  const lineId = chip.kind === "materials" && chip.source_key?.startsWith("matline:") ? chip.source_key.slice(8) : null;
  const [duration, setDuration] = useState(String(chip.duration_min ?? 60));
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
    duration: placed && Number(duration) !== (chip.duration_min ?? 60),
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
    if (dirty.duration) {
      const mins = Number(duration);
      if (!(mins >= 15 && mins <= 600)) { say("A stop is between 15 minutes and 10 hours"); return false; }
      const ok = await act(() => setMovementDuration({ id: chip.id, minutes: mins, workOrderId: chip.work_order_id }));
      if (!ok) return false;
    }
    if (dirty.time && (time === "AM" || time === "PM") && chip.due_date) {
      const ok = await act(() => redateMovement({ id: chip.id, dueDate: chip.due_date!, half: time, workOrderId: chip.work_order_id }));
      if (!ok) return false;
      if (chip.time) { const ok2 = await act(() => updateMovement({ id: chip.id, workOrderId: chip.work_order_id, time: null })); if (!ok2) return false; }
    }
    return true;
  }

  /** Tom, 21 Oct 2026: delivered or picked up, with the shop — delivery lands it on the Supplier lane. */
  async function confirmMethod(method: "delivery" | "pickup" | "dropoff" | "pickup_deliver") {
    const ok = await act(() => setMovementMethod({ id: chip.id, workOrderId: chip.work_order_id, method, branchId: method === "dropoff" ? null : branchId }), (v) =>
      v === "dropoff" ? "Drop off — from the warehouse to the drop-off place, nothing to order; drop the chip on whoever carries it"
      : v === "pickup_deliver" ? "Pick up and deliver — both places are on the run; drop the chip on whoever does it"
      : v === "placed" ? "Delivery — placed on the Supplier lane on the job's first day; tick Ordered once the shop has it"
      : v === "pickshop" ? "Pick the shop first, then Delivered to site"
      : v === "nodelivery" ? "That shop is counter-only — pick one that delivers, or choose Picked up"
      : "Picked up — drag the chip onto whoever collects it");
    if (ok && method === "delivery") onClose();
  }

  /** Tom, 23 Oct 2026: the pickup place (from) or the drop-off place (to) — a saved place, the warehouse or the site. */
  async function setPlace(side: "from" | "to", kind: "branch" | "warehouse" | "site", id: string | null = null) {
    const ok = await act(() => setMovementPlace({ id: chip.id, side, kind, branchId: id, workOrderId: chip.work_order_id }), () =>
      side === "from" ? "Pickup place set" : "Drop-off place set");
    if (ok && side === "from" && kind === "branch") setBranchId(id);
  }
  const [addingFor, setAddingFor] = useState<"from" | "to" | null>(null);
  const [placeName, setPlaceName] = useState("");
  const [placeAddress, setPlaceAddress] = useState("");
  async function savePlace() {
    if (!addingFor) return;
    if (!placeName.trim() || placeAddress.trim().length < 3) { say("A name and an address, please"); return; }
    let newId: string | null = null;
    const ok = await act(() => addPlace({ name: placeName.trim(), address: placeAddress.trim() }), (v) => { newId = v; return "Place saved — it is in every list now"; });
    if (ok && newId) { await setPlace(addingFor, "branch", newId); setAddingFor(null); setPlaceName(""); setPlaceAddress(""); }
  }
  const placeWord = (kind: MovementRow["to_kind"], text: string, fallback: string) => kind === "warehouse" ? "the warehouse" : kind === "site" ? "the job site" : kind === "branch" && text ? text : kind === "tip" ? "the tip" : fallback;
  const dropoffWord = placeWord(chip.to_kind, chip.to_text, "the job site");
  const pickupWord = placeWord(chip.from_kind, chip.from_text, chip.kind === "equipment_out" || chip.kind === "hire_on" || chip.kind === "repair_back" ? "the warehouse" : "not set");
  const live = chip.status !== "done" && chip.status !== "cancelled";

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
        {job && (filterKind === "paint" || filterKind === "materials" || filterKind === "gear") && (
          <a className="btn sm" href={`/pc/wo/${job.id}`} data-testid="chip-open-pc" title="The same job in PC Command — its materials and movements card">Open in PC Command →</a>
        )}
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
          <div className="k">How does it move? <em>{chip.method_pref === "delivery" ? "delivered" : chip.method_pref === "pickup" ? "pick up" : chip.method_pref === "dropoff" ? "drop off" : chip.method_pref === "pickup_deliver" ? "pick up and deliver" : "not confirmed"}</em></div>
          <div className="chips">
            <button type="button" className={`chp ${chip.method_pref === "pickup" ? "on" : ""}`} disabled={busy} onClick={() => void confirmMethod("pickup")} data-testid="method-pickup">Pick up</button>
            <button type="button" className={`chp ${chip.method_pref === "dropoff" ? "on" : ""}`} disabled={busy} onClick={() => void confirmMethod("dropoff")} data-testid="method-dropoff">Drop off</button>
            <button type="button" className={`chp ${chip.method_pref === "pickup_deliver" ? "on" : ""}`} disabled={busy} onClick={() => void confirmMethod("pickup_deliver")} data-testid="method-pickup-deliver">Pick up and deliver</button>
            <button type="button" className={`chp ${chip.method_pref === "delivery" ? "on" : ""}`} disabled={busy} onClick={() => void confirmMethod("delivery")} data-testid="method-delivery">Delivered by the shop</button>
          </div>
          <p className="note">Pick up = someone collects it at the pickup place and brings it to the drop-off place. Drop off = it comes from our warehouse to the drop-off place, nothing to order. Pick up and deliver = collected at the pickup place and delivered to the drop-off place, both on the run. Delivered by the shop = the shop drives it; this chip goes onto the Supplier lane on the job&rsquo;s first day.</p>
        </div>
      )}

      {live && (
        <div className="fld" data-testid="chip-pickup">
          <div className="k">Pickup place <em>{pickupWord}</em></div>
          <div className="chips">
            <button type="button" className={`chp ${chip.from_kind === "site" ? "on" : ""}`} disabled={busy || !job} onClick={() => void setPlace("from", "site")} data-testid="pickup-site">The job site</button>
            <button type="button" className={`chp ${chip.from_kind === "warehouse" ? "on" : ""}`} disabled={busy} onClick={() => void setPlace("from", "warehouse")} data-testid="pickup-warehouse">Our warehouse</button>
            {chip.from_kind === "branch" && <span className="chp on" data-testid="pickup-branch">{chip.from_text}</span>}
            <button type="button" className="chp" disabled={busy} onClick={() => setAddingFor("from")} data-testid="pickup-add-row">+ Another address</button>
          </div>
          <p className="note">Any saved place can be the pickup: tap it in the list below.</p>
        </div>
      )}

      {live && (
        <div className="fld" data-testid="chip-dropoff">
          <div className="k">Drop-off place <em>{dropoffWord}</em></div>
          <div className="chips">
            <button type="button" className={`chp ${!chip.to_kind || chip.to_kind === "site" ? "on" : ""}`} disabled={busy || !job} onClick={() => void setPlace("to", "site")} data-testid="dropoff-site">The job site</button>
            <button type="button" className={`chp ${chip.to_kind === "warehouse" ? "on" : ""}`} disabled={busy} onClick={() => void setPlace("to", "warehouse")} data-testid="dropoff-warehouse">Our warehouse</button>
            {chip.to_kind === "branch" && <span className="chp on" data-testid="dropoff-branch">{chip.to_text}</span>}
            {chip.to_kind === "tip" && <span className="chp on">The tip</span>}
            <button type="button" className="chp" disabled={busy} onClick={() => setAddingFor("to")} data-testid="dropoff-add">+ Another address</button>
          </div>
          <p className="note">Any saved place can be the drop-off too: pick it in the list below and press <b>Use as drop-off</b>.</p>
        </div>
      )}

      {addingFor && (
        <div className="fld" data-testid="add-place">
          <div className="k">New {addingFor === "from" ? "pickup" : "drop-off"} place <em>saved for next time</em></div>
          <div className="daterow" style={{ alignItems: "center" }}>
            <input type="text" value={placeName} onChange={(e) => setPlaceName(e.target.value)} placeholder="Name — e.g. Customer's storage unit" aria-label="Place name" maxLength={80} data-testid="place-name" />
            <input type="text" value={placeAddress} onChange={(e) => setPlaceAddress(e.target.value)} placeholder="Address — 12 Example St, Suburb VIC 3000" aria-label="Place address" maxLength={200} style={{ minWidth: 260 }} data-testid="place-address" />
            <button type="button" className="btn sm primary" disabled={busy} onClick={() => void savePlace()} data-testid="place-save">Save and use</button>
            <button type="button" className="btn sm" disabled={busy} onClick={() => setAddingFor(null)}>Cancel</button>
          </div>
        </div>
      )}

      {(lineChip || manual) && (
        <div className="fld">
          <div className="k">{lineChip ? "Line" : "What"} <em>{lineChip ? "same row on the estimate and the job page" : "your words"}</em></div>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} aria-label="Line text" />
          {lineId && chip.title.includes(",") && (
            <>
              <p className="note">Tom, 21 Oct: an item out of stock? Its × takes it off this order into a new chip of its own.</p>
              <MaterialBubbles
                testId="chip-line-bubble"
                busy={busy}
                bubbles={[{ id: lineId, text: chip.title, locked: false }]}
                onEdit={(id, text) => act(() => updateMovement({ id: chip.id, workOrderId: chip.work_order_id, title: text }), () => "Line updated")}
                onRemove={() => say("Remove the whole line from the job page")}
                onSplit={async (id, item) => { const ok = await act(() => splitMaterialLine({ id, item, workOrderId: chip.work_order_id }), () => `${item} is its own chip now — in the tray`); if (ok) onClose(); }}
              />
            </>
          )}
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

      {(shops.length > 0 || q) && (
        <div className="fld">
          <div className="k">{branchKind === "hire" ? "Hire yards and saved places" : branchKind ? "Shops and saved places" : "Saved places"} <em>{branchKind === "paint" || branchKind === "hardware" ? "paint shops first, then hardware and saved places · nearest first" : "nearest first · tap = pickup place"}</em></div>
          {(
            <div className="daterow" style={{ alignItems: "center", marginBottom: 6 }}>
              <input type="search" value={shopQuery} onChange={(e) => setShopQuery(e.target.value)} placeholder="Search a shop, brand, suburb or saved place" aria-label="Search shops" data-testid="shop-search" style={{ flex: 1 }} />
              <button type="button" className="btn sm" disabled={busy} onClick={() => setAddingFor("from")} data-testid="pickup-add">+ Type an address</button>
            </div>
          )}
          <div className="list">
            {shops.map(({ b, d }) => (
              <div key={b.id} className={`opt ${branchId === b.id ? "on" : ""}`} data-testid="shop-option" data-branch-id={b.id} role="button" tabIndex={0} onClick={() => void setPlace("from", "branch", b.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void setPlace("from", "branch", b.id); } }}>
                <span className="rad" />
                <span>{b.brand} {b.branch}<span className="sub">{[b.address, b.opens_weekday ? `opens ${b.opens_weekday.slice(0, 5)}` : null, b.delivers_to_site ? "delivers" : b.kind === "other" ? "saved place" : "pickup"].filter(Boolean).join(" · ")}</span></span>
                <span className="km">{d == null ? "" : `${d.toFixed(1)} km`}
                  <button type="button" className="btn sm" style={{ marginLeft: 6 }} disabled={busy} onClick={(e) => { e.stopPropagation(); void setPlace("to", "branch", b.id); }} data-testid="use-as-dropoff">Use as drop-off</button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {placed && lane && (
        <div className="fld">
          <div className="k">Time <em>any time of day · how long it takes</em></div>
          <div className="chips">
            {timeChips.map((t) => <button key={t} type="button" className={`chp ${time === t ? "on" : ""}`} onClick={() => setTime(t)}>{t}</button>)}
          </div>
          <div className="row" style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
            <input type="time" value={/^\d{2}:\d{2}$/.test(time) ? time : ""} step={300} aria-label="Exact time" data-testid="chip-time" onChange={(e) => { if (e.target.value) setTime(e.target.value); }} />
            <select value={duration} aria-label="How long" data-testid="chip-duration" onChange={(e) => setDuration(e.target.value)}>
              {[15, 30, 45, 60, 90, 120, 180, 240].map((m) => <option key={m} value={String(m)}>{m < 60 ? `${m} min` : `${m / 60} h${m % 60 ? ` ${m % 60}` : ""}`}</option>)}
            </select>
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
