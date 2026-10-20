"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  kindLabel, mapPins, reorder, runPlan, shortDay,
  type ContextBlock, type JobPin, type MapBadge, type MovementLane, type RunPlanStop, type World,
} from "@/lib/movements/evaluate";
import type { JobExtras } from "@/lib/movements/load";
import { KIND_ICONS, movementIcon } from "@/lib/movements/gearIcons";
import type { EquipmentCategory, MovementRow, Point } from "@/lib/movements/types";
import { loadGoogleMaps, mapsBrowserKey } from "@/lib/maps/googleMaps";
import { geocodeJobs, reorderDay, sendRunPlan, type MovementActionResult } from "./actions";

type Act = (run: () => Promise<MovementActionResult>, done?: (value: string) => string | void) => Promise<boolean>;

export type MapViewProps = {
  world: World; ctx: ContextBlock[]; lanes: MovementLane[]; jobExtras: Record<string, JobExtras>;
  days: string[]; day: string; who: string | null;
  onPick: (next: { day?: string; who?: string }) => void;
  onRunPlan: (day: string, who: string) => void;
  act: Act; busy: boolean;
  onOpen: (m: MovementRow) => void;
  /** The page re-read after the lazy geocode set a point (the pins move from the suburb centre to the house). */
  onRefresh: () => void;
  categoryOf: (m: MovementRow) => EquipmentCategory | null;
};

const HOUSE = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" />
  </svg>
);
const WAREHOUSE = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 9l9-5 9 5v11H3z" /><path d="M7 20v-7h10v7" /><path d="M7 16h10" />
  </svg>
);
const FILL: Record<JobPin["fill"], string> = { teal: "#1A9DAE", amber: "#C9962F", grey: "#9AA3AB" };
const VIOLET = "#5B4FD6";
const INK = "#12161A";

/** Where a stop is, in words (the order card's second line). */
function whereOf(m: MovementRow, world: World, lane: MovementLane): string {
  const job = world.jobs.find((j) => j.id === m.work_order_id);
  const site = job ? `${job.address.split(",")[0] || job.jobRef}${job.suburb ? `, ${job.suburb}` : ""}` : "warehouse";
  const branch = world.branches.find((b) => b.id === (m.from_branch_id ?? m.to_branch_id));
  const shop = branch ? `${branch.brand} ${branch.branch}` : null;
  if (m.kind === "equipment_return" || m.kind === "hire_off" || m.kind === "repair_back") return `${site} → warehouse`;
  if (m.kind === "rubbish_out") return m.to_kind === "tip" ? `${site} → the tip` : m.to_kind === "warehouse" ? `${site} → warehouse` : site;
  if (m.from_kind === "branch" && shop && lane.kind !== "supplier") return `${shop} → ${site}`;
  if (m.from_kind === "warehouse") return `warehouse → ${site}`;
  return shop ? `${shop} → ${site}` : site;
}

type MapState = { kind: "off" } | { kind: "loading" } | { kind: "ready" } | { kind: "failed"; why: string };

/**
 * Map (brief §3.4, rulings 13, 21, 22; flags 3, 7): Google Maps JS underneath, one icon per
 * job from `mapPins` (teal house · amber with the first need's icon · grey house on a closed
 * job), the warehouse as a dark square, shops as faint dots behind the Shops toggle (solid
 * when a stop today), the selected person's order numbers on each stop (◌ violet for a fixed
 * appointment), a Route line toggle off by default (straight lines — flag 7), and beside it
 * the order card: the day's stops as rows, drag the handle to reorder → the same `reorder()`
 * patches and `reorderDay` action the Day view's ▲▼ use, so the numbers here and in Day are
 * one source. The pins are React, drawn into the map's overlay pane; nothing here computes a
 * colour, a number or a kilometre — the evaluator does.
 */
export default function MapView({ world, ctx, lanes, jobExtras, days, day, who, onPick, onRunPlan, act, busy, onOpen, onRefresh, categoryOf }: MapViewProps) {
  const placedOn = (d: string) => world.movements.filter((m) => m.due_date === d && m.status !== "tray" && m.status !== "cancelled");
  const people = useMemo(() => lanes.filter((l) => l.kind !== "supplier" && runPlan(world, l.id, day, ctx).stops.length > 0), [lanes, world, day, ctx]);
  const lane = people.find((l) => l.id === who) ?? people[0] ?? null;
  const plan = useMemo(() => (lane ? runPlan(world, lane.id, day, ctx) : null), [world, lane, day, ctx]);
  const pins = useMemo(() => mapPins(world, lane?.id ?? null, day, ctx), [world, lane, day, ctx]);
  const [shops, setShops] = useState(false);
  const [route, setRoute] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  // ---- the map itself ------------------------------------------------------------------------
  const key = mapsBrowserKey();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const libRef = useRef<google.maps.MapsLibrary | null>(null);
  const overlayRef = useRef<google.maps.OverlayView | null>(null);
  const lineRef = useRef<google.maps.Polyline | null>(null);
  const projRef = useRef<google.maps.MapCanvasProjection | null>(null);
  const [pane, setPane] = useState<HTMLDivElement | null>(null);
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<MapState>(key ? { kind: "loading" } : { kind: "off" });

  useEffect(() => {
    if (!key || !boxRef.current) return;
    let gone = false;
    loadGoogleMaps(key).then((lib) => {
      if (gone || !boxRef.current) return;
      libRef.current = lib;
      const map = new lib.Map(boxRef.current, {
        center: { lat: -37.86, lng: 145.02 }, zoom: 11, mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
        clickableIcons: false, gestureHandling: "greedy", backgroundColor: "#e9eef0",
      });
      mapRef.current = map;
      // The pin layer: one OverlayView whose pane div React portals into. draw() runs on every
      // pan and zoom; it stores the projection and bumps a tick so the pins re-place themselves.
      class PinLayer extends lib.OverlayView {
        el: HTMLDivElement | null = null;
        onAdd() {
          const el = document.createElement("div");
          el.className = "pinlayer";
          el.setAttribute("data-testid", "map-pins");
          lib.OverlayView.preventMapHitsAndGesturesFrom(el);
          this.getPanes()?.overlayMouseTarget.appendChild(el);
          this.el = el;
          setPane(el);
        }
        draw() {
          projRef.current = this.getProjection();
          setTick((t) => t + 1);
        }
        onRemove() {
          this.el?.remove();
          this.el = null;
          setPane(null);
        }
      }
      const layer = new PinLayer();
      layer.setMap(map);
      overlayRef.current = layer;
      setState({ kind: "ready" });
    }, (e: unknown) => { if (!gone) setState({ kind: "failed", why: e instanceof Error ? e.message : String(e) }); });
    return () => {
      gone = true;
      overlayRef.current?.setMap(null);
      lineRef.current?.setMap(null);
      overlayRef.current = null; lineRef.current = null; mapRef.current = null;
    };
  }, [key]);

  // Fit once to everything with a point; after that the person's own pan and zoom are kept.
  const fitted = useRef(false);
  useEffect(() => {
    const map = mapRef.current, lib = libRef.current;
    if (!map || !lib || state.kind !== "ready" || fitted.current) return;
    const b = new lib.LatLngBounds();
    for (const p of pins.jobs) b.extend(p.point);
    if (pins.warehouse) b.extend(pins.warehouse.point);
    for (const s of pins.shops) if (s.stopToday) b.extend(s.point);
    if (b.isEmpty()) return;
    fitted.current = true;
    map.fitBounds(b, 48);
  }, [pins, state]);

  // The route line (flag 7: straight lines, dashed, the lane's colour), only while toggled on.
  useEffect(() => {
    const map = mapRef.current, lib = libRef.current;
    if (!map || !lib || state.kind !== "ready") return;
    if (!route || pins.route.length < 2 || !lane) { lineRef.current?.setMap(null); return; }
    const opts: google.maps.PolylineOptions = {
      path: pins.route, map, strokeColor: lane.colour, strokeOpacity: 0, strokeWeight: 2, clickable: false,
      icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 0.7, strokeWeight: 2, scale: 2.2, strokeColor: lane.colour }, offset: "0", repeat: "11px" }],
    };
    if (lineRef.current) lineRef.current.setOptions(opts);
    else lineRef.current = new lib.Polyline(opts);
    lineRef.current.setMap(map);
  }, [route, pins, lane, state]);

  // Flag 3, lazily: the jobs of the week with no real point get one from the Places key, once.
  const geocoded = useRef(false);
  useEffect(() => {
    if (geocoded.current || state.kind === "off") return;
    const wanted = world.jobs.filter((j) => jobExtras[j.id]?.geocodeWanted).map((j) => j.id).slice(0, 8);
    if (wanted.length === 0) return;
    geocoded.current = true;
    void geocodeJobs({ workOrderIds: wanted }).then((r) => { if (r.ok && Number(r.value) > 0) onRefresh(); });
  }, [world, jobExtras, state, onRefresh]);

  // ---- the order card: drag a handle to reorder (pointer events; fixed rows have no handle) ----
  const listRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ id: string; row: HTMLElement; startY: number; moved: boolean } | null>(null);
  const [over, setOver] = useState<{ id: string; before: boolean } | null>(null);
  const [lifted, setLifted] = useState<string | null>(null);

  const movementIds = useCallback(() => (plan?.stops ?? []).flatMap((s) => (s.fixed ? [] : [s.movement.id])), [plan]);
  const commit = useCallback(async (ids: string[]) => {
    if (!lane) return;
    const patches = reorder(world, lane.id, day, ids);
    await act(() => reorderDay({
      assigneeKind: "person", assigneeId: lane.id, day, patches: patches.map((p) => ({ id: p.id, sequence: p.sequence, time: p.time })),
      workOrderIds: [...new Set(world.movements.filter((m) => ids.includes(m.id)).flatMap((m) => (m.work_order_id ? [m.work_order_id] : [])))],
    }), () => "Order updated — the numbers on the map and the run plan follow");
  }, [act, day, lane, world]);

  const rowUnder = (x: number, y: number): HTMLElement | null => {
    const t = document.elementFromPoint(x, y);
    return t instanceof Element ? (t.closest(".orow[data-movement-id]") as HTMLElement | null) : null;
  };
  const onHandleDown = (e: React.PointerEvent<HTMLButtonElement>, id: string) => {
    if (busy) return;
    const row = e.currentTarget.closest(".orow") as HTMLElement | null;
    if (!row) return;
    dragRef.current = { id, row, startY: e.clientY, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };
  const onHandleMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientY - d.startY) < 5) return;
    if (!d.moved) { d.moved = true; setLifted(d.id); }
    const target = rowUnder(e.clientX, e.clientY);
    if (!target || target === d.row) { setOver(null); return; }
    const r = target.getBoundingClientRect();
    setOver({ id: target.dataset.movementId ?? "", before: e.clientY < r.top + r.height / 2 });
  };
  const onHandleUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    setLifted(null);
    const o = over;
    setOver(null);
    if (!d || !d.moved) return;
    const target = rowUnder(e.clientX, e.clientY);
    const targetId = target?.dataset.movementId ?? o?.id ?? null;
    if (!targetId || targetId === d.id) return;
    const before = target ? e.clientY < target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2 : (o?.before ?? true);
    const ids = movementIds().filter((x) => x !== d.id);
    const at = ids.indexOf(targetId) + (before ? 0 : 1);
    ids.splice(at, 0, d.id);
    void commit(ids);
  };

  const send = async () => {
    if (!lane || !plan) return;
    const first = lane.name.split(" ")[0];
    const ok = await act(() => sendRunPlan({
      personKind: lane.assigneeTable === "profiles" ? "profiles" : "contractors", personId: lane.id, day, stops: plan.stopCount, km: plan.totalKm,
    }), (n) => `Run plan sent to ${first}'s phone — ${n} stop${n === "1" ? "" : "s"}, in this order`);
    if (ok) setSent(lane.id + day);
  };

  // ---- pins ------------------------------------------------------------------------------------
  const place = (p: Point): { left: number; top: number } | null => {
    const px = projRef.current?.fromLatLngToDivPixel(p);
    return px ? { left: px.x, top: px.y } : null;
  };
  const badges = (list: MapBadge[], colour: string) => list.map((b, i) => (
    <span key={`${b.n}:${i}`} className={`mbadge${b.fixed ? " ctx" : ""}`} style={{ background: b.fixed ? VIOLET : colour, left: -14 - i * 2, top: -14 + i * 14 }} title={b.label} data-testid="map-badge" data-n={String(b.n)}>{b.n}</span>
  ));
  const colour = lane?.colour ?? "#1A9DAE";
  const pinNodes = pane && createPortal(
    <>
      {pins.shops.filter((s) => shops || s.stopToday).map((s) => { const at = place(s.point); if (!at) return null; return (
        <div key={`shop:${s.branch.id}`} className={`mpin shop${s.stopToday ? " stop" : ""}`} style={at} data-testid="map-shop" data-branch-id={s.branch.id} data-stop={s.stopToday ? "true" : "false"}>
          <i /><span className="jsub">{s.branch.brand} {s.branch.branch}</span>
          {badges(s.badges, colour)}
        </div>
      ); })}
      {pins.warehouse && (() => { const at = place(pins.warehouse.point); if (!at) return null; return (
        <div className="mpin wh" style={at} data-testid="map-warehouse">
          <span className="ibox" style={{ background: INK }}>{WAREHOUSE}</span><span className="jlbl">{pins.warehouse.label}</span>
          {badges(pins.warehouse.badges, colour)}
        </div>
      ); })()}
      {pins.jobs.map((p) => { const at = place(p.point); if (!at) return null; const first = p.needs[0]; return (
        <div key={`job:${p.job.id}`} className={`mpin job ${p.fill}`} style={at} data-testid="map-job" data-job-id={p.job.id} data-fill={p.fill} data-need={p.need ?? ""} data-point={jobExtras[p.job.id]?.pointSource ?? "none"}>
          <button type="button" className="ibox" style={{ background: FILL[p.fill] }} title={first ? `${p.job.jobRef} · ${kindLabel(first)} — tap to open` : `${p.job.jobRef} · ${p.line}`}
            onClick={() => { if (first) onOpen(first); }} aria-label={`${p.label} — ${p.line}`}>
            {first ? movementIcon(first, categoryOf(first)) : HOUSE}
          </button>
          <span className="jlbl">{p.label}</span><span className="jsub">{p.line}</span>
          {badges(p.badges, colour)}
        </div>
      ); })}
    </>,
    pane,
  );
  void tick;

  // ---- the order card rows -------------------------------------------------------------------
  const renderRow = (s: RunPlanStop) => {
    if (s.fixed) {
      const b = s.block;
      return (
        <div key={`ctx:${b.id}`} className="orow fixed" data-testid="order-row" data-fixed="true">
          <span className="hnd" aria-hidden="true">⋮⋮</span><span className="num ctx">◌</span>
          <span><b>{b.label}</b><small>{[b.sub, `fixed at ${s.time}`].filter(Boolean).join(" · ")}</small></span>
          <span className="km">{s.time}<br />{s.kmFromPrevious != null ? `${s.kmFromPrevious.toFixed(0)} km` : ""}</span>
        </div>
      );
    }
    const m = s.movement;
    return (
      <div key={m.id} className={`orow${lifted === m.id ? " lift" : ""}${over?.id === m.id ? (over.before ? " before" : " after") : ""}`} style={{ ["--pc" as string]: colour } as React.CSSProperties}
        data-testid="order-row" data-movement-id={m.id} data-n={s.n ?? undefined}>
        <button type="button" className="hnd" title="drag to reorder" aria-label={`Drag to reorder ${m.title}`} disabled={busy} data-testid="order-handle"
          onPointerDown={(e) => onHandleDown(e, m.id)} onPointerMove={onHandleMove} onPointerUp={onHandleUp} onPointerCancel={onHandleUp}>⋮⋮</button>
        <span className="num" data-testid="order-n">{s.n}</span>
        <button type="button" className="obody" onClick={() => onOpen(m)}>
          <b><span className="ic">{movementIcon(m, categoryOf(m))}</span>{kindLabel(m)} · {m.title}</b>
          <small>{whereOf(m, world, lane!)}</small>
        </button>
        <span className="km">{s.time}<br />{s.kmFromPrevious != null ? `${s.kmFromPrevious.toFixed(0)} km` : ""}</span>
      </div>
    );
  };

  const first = lane?.name.split(" ")[0] ?? "";
  return (
    <div className="mapview" data-testid="map-view">
      <div>
        <div className="days" data-testid="map-days">
          {days.map((d) => { const n = placedOn(d).length; return (
            <button key={d} type="button" className={d === day ? "on" : ""} onClick={() => onPick({ day: d })} data-day={d}><b>{shortDay(d)}</b><small>{n} move{n === 1 ? "" : "s"}</small></button>
          ); })}
        </div>
        <div className="people" data-testid="map-people">
          {people.map((l) => (
            <button key={l.id} type="button" className={lane?.id === l.id ? "on" : ""} style={{ ["--pc" as string]: l.colour } as React.CSSProperties} onClick={() => onPick({ who: l.id })} data-lane={l.id}>
              <i />{l.name.split(" ")[0]}&rsquo;s day
            </button>
          ))}
          {people.length === 0 && <span className="note">Nobody has a stop on {shortDay(day)} — the jobs still show.</span>}
        </div>
        <div className="layers" data-testid="map-layers">
          <button type="button" className={shops ? "on" : ""} aria-pressed={shops} onClick={() => setShops((v) => !v)} data-testid="toggle-shops">Shops</button>
          <button type="button" className={route ? "on" : ""} aria-pressed={route} onClick={() => setRoute((v) => !v)} data-testid="toggle-route">Route line</button>
        </div>
        <div className="mapbox" data-testid="map-box" data-state={state.kind}>
          <div ref={boxRef} className="gmap" />
          {state.kind === "off" && <p className="mapnote">The Map view is off: set <code>NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY</code> (Settings → Movements says whether it is present). The order card still works.</p>}
          {state.kind === "loading" && <p className="mapnote">Loading the map…</p>}
          {state.kind === "failed" && <p className="mapnote bad" role="alert">{state.why}</p>}
          {pinNodes}
        </div>
        <p className="note">Every job is one icon. It turns amber and shows a paint / materials / gear / rubbish icon when that job still needs something planned or ordered — tap it to open that chip. Numbers are {lane ? `${first}'s` : "the selected person's"} order for the day.</p>
      </div>

      <div className="side">
        <div className="card" data-testid="order-card">
          <h3>{lane ? `${lane.name} · ${shortDay(day)}` : `${shortDay(day)}`}<em data-testid="order-summary">{lane && plan ? `${plan.stopCount} stop${plan.stopCount === 1 ? "" : "s"} · ${plan.totalKm.toFixed(0)} km · drag to reorder` : "no stops"}</em></h3>
          <div className="orderlist" ref={listRef} data-testid="order-list">
            {plan?.stops.map(renderRow)}
            {(!plan || plan.stops.length === 0) && <p className="note">No stops — drop chips on this day in Week.</p>}
          </div>
          {lane && plan && (
            <div className="btnrow">
              <button type="button" className="btn" onClick={() => onRunPlan(day, lane.id)} data-testid="open-run-plan">Run plan</button>
              <button type="button" className="btn primary" disabled={busy || plan.stopCount === 0} onClick={() => void send()} data-testid="map-send-run-plan">
                {sent === lane.id + day ? "Sent ✓ — send again" : `Send to ${first}'s phone`}
              </button>
            </div>
          )}
        </div>
        <div className="card">
          <h3>Icons <em>what they mean</em></h3>
          <div className="maplegend" data-testid="map-legend">
            <span><i className="sq" style={{ background: FILL.teal }} />Job — nothing outstanding</span>
            <span><i className="sq" style={{ background: FILL.amber }} />Job — needs something (the icon says what)</span>
            <span><i className="sq" style={{ background: FILL.grey }} />Closed job — gear still there</span>
            <span><i className="sq" style={{ background: INK }} />Warehouse</span>
            <span><i style={{ background: FILL.teal, opacity: 0.5 }} />Shop / hire yard (faint until a stop today, or Shops is on)</span>
            <span><i style={{ background: colour }} />Numbered = {lane ? `${first}'s` : "the person's"} order today</span>
            <span><i style={{ background: VIOLET }} />◌ Fixed appointment (calendar / check)</span>
            <div className="needs">
              {([["Paint", KIND_ICONS.paint], ["Materials", KIND_ICONS.materials], ["Gear", KIND_ICONS.gear], ["Rubbish", KIND_ICONS.rubbish]] as const).map(([t, ic]) => (
                <span key={t} className="kl"><span className="ki">{ic}</span>{t}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
