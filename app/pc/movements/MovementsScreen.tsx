"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Board, Tray, Scrim, Sheet, Toast, useBoardDrag, useBoardZoom, hourSlots, type DropTarget,
} from "@/app/components/board";
import {
  blockedReason, chipFilterKind, chipState, context, counts, dropProblem, hotCells, isUndecidedRubbish, kindLabel, lanes,
  movementTime, nearby, needsOrder, shortDay, trayGroupOf, whileYouAreThere,
  type ContextBlock, type MovementLane, type Nearby, type World,
} from "@/lib/movements/evaluate";
import type { JobExtras } from "@/lib/movements/load";
import { movementIcon } from "@/lib/movements/gearIcons";
import type { EquipmentCategory, MaterialLineRow, MovementRow } from "@/lib/movements/types";
import { WEEK_DAYS, weekLabel } from "@/lib/movements/week";
import { addDays } from "@/lib/scheduling/dates";
import { markMovementOrdered, placeMovement, setMovementStatus, unplaceMovement, type MovementActionResult } from "./actions";
import AddChipSheet from "./AddChipSheet";
import ChipSheet from "./ChipSheet";
import DayView from "./DayView";
import GearView from "./GearView";
import HowItWorks from "./HowItWorks";
import SourcesView from "./SourcesView";
import { fromSerial, type SerialWorld } from "./world";
import "@/app/pc/schedule/schedule.css";
import "./movements.css";

/** 07:30 … 16:30 — ruling 16's ten rows. */
export const HOUR_SLOTS: [number, number] = [7.5, 17.5];
const HOURS = hourSlots(HOUR_SLOTS);

type View = "week" | "sources" | "day" | "gear";
type DragPayload = { chip: MovementRow };
type DropCheck = { blocked: boolean; held: false; reason: string | null; warn: string | null; laneName: string; where: string };
type SheetState = { kind: "chip"; id: string } | { kind: "add" } | { kind: "nearby"; laneId: string; day: string } | null;

export type MovementsScreenProps = {
  world: SerialWorld;
  ctx: ContextBlock[];
  failures: string[];
  materialLines: MaterialLineRow[];
  jobExtras: Record<string, JobExtras>;
  view: View;
  weekStart: string;
  jobParam: string | null;
  movementParam: string | null;
  /** Day view (Session 5): the day and the person, from the URL. */
  dayParam: string | null;
  whoParam: string | null;
};

/** The slot a time sits in on an hourly lane: the last row that starts at or before it; a blank time → the first. */
export function hourSlotFor(time: string | null): string {
  if (!time) return HOURS[0];
  let best = HOURS[0];
  for (const h of HOURS) if (h <= time) best = h;
  return best;
}
const halfSlotFor = (time: string | null, half: "AM" | "PM" | "ALL" | null): "am" | "pm" =>
  half === "PM" ? "pm" : half === "AM" || half === "ALL" ? "am" : time && time >= "12:00" ? "pm" : "am";

const FILTERS = [["all", "All"], ["paint", "Paint"], ["materials", "Materials"], ["gear", "Gear"], ["rubbish", "Rubbish"]] as const;
type Filter = (typeof FILTERS)[number][0];

/**
 * The Movements tab (brief §3.4): the week board on the shared engine — lanes are buckets,
 * the tray is everything that has to move — and the Sources view. Nothing here computes a
 * lane, a colour, a count or a rule: `lib/movements/evaluate.ts` does, over the world the
 * server read once; every change goes through app/pc/movements/actions.ts and the page
 * re-reads.
 */
export default function MovementsScreen({ world: serial, ctx, failures, materialLines, jobExtras, view, weekStart, jobParam, movementParam, dayParam, whoParam }: MovementsScreenProps) {
  const router = useRouter();
  const world = useMemo<World>(() => fromSerial(serial), [serial]);
  const laneList = useMemo(() => lanes(world), [world]);
  const laneById = useMemo(() => new Map(laneList.map((l) => [l.id, l])), [laneList]);
  const tally = useMemo(() => counts(world), [world]);
  const movementById = useMemo(() => new Map(world.movements.map((m) => [m.id, m])), [world]);
  const painterName = useCallback((contractorId: string | null) => world.painters.find((p) => p.contractorId === contractorId)?.name ?? null, [world]);
  const personName = useCallback((m: Pick<MovementRow, "assignee_kind" | "assignee_id">) =>
    m.assignee_kind === "supplier" ? "Supplier" : laneById.get(m.assignee_id ?? "")?.name ?? null, [laneById]);
  const categoryOf = useCallback((m: MovementRow): EquipmentCategory | null => {
    const first = m.items[0];
    return first ? world.items.find((i) => i.id === first.equipment_item_id)?.category ?? null : null;
  }, [world]);

  // ---- chrome state -----------------------------------------------------------------------
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = useCallback((text: string, ms = 2800) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), ms);
  }, []);
  const [sheet, setSheet] = useState<SheetState>(movementParam ? { kind: "chip", id: movementParam } : null);
  // A navigation within this screen (Gear → Find it in the tray, a work item link) changes the
  // parameter without remounting: follow it (state derived from a prop, set during render).
  const [seenMovementParam, setSeenMovementParam] = useState(movementParam);
  if (movementParam !== seenMovementParam) {
    setSeenMovementParam(movementParam);
    if (movementParam) setSheet({ kind: "chip", id: movementParam });
  }
  const [filter, setFilter] = useState<Filter>("all");
  const [trayOpen, setTrayOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const go = (next: Partial<{ view: View; week: string; job: string | null; day: string; who: string }>) => {
    const v = next.view ?? view;
    const w = next.week ?? weekStart;
    const j = next.job === undefined ? jobParam : next.job;
    const d = next.day ?? dayParam;
    const who = next.who ?? whoParam;
    router.push(`/pc/movements?view=${v}&week=${w}${j ? `&job=${j}` : ""}${v === "day" && d ? `&day=${d}` : ""}${v === "day" && who ? `&who=${who}` : ""}`);
  };

  /** Run an action, say the result, re-read. */
  const act = useCallback(async (run: () => Promise<MovementActionResult>, done?: (value: string) => string | void) => {
    setBusy(true);
    const r = await run();
    setBusy(false);
    if (!r.ok) { say(r.message, 4200); return false; }
    const line = done?.(r.value);
    if (line) say(line);
    router.refresh();
    return true;
  }, [router, say]);

  // ---- the board ---------------------------------------------------------------------------
  const zoom = useBoardZoom({ from: weekStart, rangeDays: WEEK_DAYS, presets: [WEEK_DAYS], initialDayW: 180, minDayW: 150, maxDayW: 280, fitMinDayW: 150 });
  const { days } = zoom;
  // Six columns fill the width on a laptop; on a phone they stay 150 px and the board scrolls sideways.
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || view !== "week") return;
    fitted.current = true;
    zoom.fitRange(WEEK_DAYS);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, after the scroller exists
  }, [view]);

  const slotTarget = (lane: MovementLane, target: DropTarget): { half: "AM" | "PM" | null; time: string | null } => {
    if (lane.slots === "hour") {
      const t = target.slot && /^\d{2}:\d{2}$/.test(target.slot) ? target.slot : HOURS[0];
      return { half: t < "12:00" ? "AM" : "PM", time: t };
    }
    return { half: target.slot === "pm" ? "PM" : "AM", time: null };
  };

  const check = useCallback((p: DragPayload, t: DropTarget): DropCheck => {
    const lane = laneById.get(t.laneId);
    if (!lane) return { blocked: true, held: false, reason: "not a lane", warn: null, laneName: "", where: "" };
    const v = dropProblem(world, p.chip, lane, t.day);
    const when = lane.slots === "hour" ? (t.slot ?? HOURS[0]) : t.slot === "pm" ? "PM" : "AM";
    return { blocked: v.blocked, held: false, reason: v.reason, warn: v.warn, laneName: lane.name, where: `${shortDay(t.day)} ${when}` };
  }, [laneById, world]);

  const place = useCallback(async (chip: MovementRow, lane: MovementLane, day: string, half: "AM" | "PM" | null, time: string | null) => {
    // The database is the rule: the RPC decides and its answer is the toast. `dropProblem`
    // only words the ghost — the world it reads can be a refresh behind a save just made.
    const v = dropProblem(world, chip, lane, day);
    const ok = await act(() => placeMovement({
      id: chip.id, assigneeKind: lane.kind === "supplier" ? "supplier" : "person", assigneeId: lane.kind === "supplier" ? null : lane.id,
      dueDate: day, half, time, workOrderId: chip.work_order_id,
    }), (status) => {
      const probe = { ...chip, assignee_kind: lane.kind === "supplier" ? "supplier" as const : "person" as const, status: status === "planned" ? "planned" as const : "booked" as const };
      return `${kindLabel(probe)} → ${lane.name}, ${shortDay(day)} ${time ?? half ?? ""}${needsOrder(probe) ? " · tick Ordered when you've placed it" : ""}`;
    });
    if (ok && v.warn) setTimeout(() => say(`That's ${v.warn}`, 4200), 2600);
  }, [act, say, world]);

  const onDrop = useCallback((p: DragPayload, t: DropTarget) => {
    const lane = laneById.get(t.laneId);
    if (!lane) return;
    const { half, time } = slotTarget(lane, t);
    void place(p.chip, lane, t.day, half, time);
  }, [laneById, place]);

  const onDropOnTray = useCallback((p: DragPayload) => {
    if (p.chip.status === "tray") return;
    void act(() => unplaceMovement({ id: p.chip.id, workOrderId: p.chip.work_order_id }), () => "Back in the tray");
  }, [act]);

  const drag = useBoardDrag<DragPayload, DropCheck>({
    days, dayW: zoom.dayW, check, onDrop, onDropOnTray,
    // Brief §4 / acceptance 3: a finger drag on a phone keeps its chip, and the board scrolls at the edges.
    capturePointer: true, autoScroll: true, scroller: zoom.scrollerEl,
  });

  // Hot cells: every lane-day where someone already has context near the dragged chip.
  const hot = useMemo(() => {
    const chip = drag.ghost?.payload.chip;
    if (!chip) return new Set<string>();
    return new Set(hotCells(world, chip, ctx).map((c) => `${c.laneId}|${c.day}`));
  }, [drag.ghost, world, ctx]);

  const openChip = (m: MovementRow) => { if (!drag.dragJustEnded()) setSheet({ kind: "chip", id: m.id }); };

  // ---- actions on a card -------------------------------------------------------------------
  const ordered = useCallback((m: MovementRow) => act(() => markMovementOrdered({ id: m.id, workOrderId: m.work_order_id }), () => {
    const job = world.jobs.find((j) => j.id === m.work_order_id);
    const painter = painterName(job?.contractorId ?? null)?.split(" ")[0] ?? "the painter";
    const lane = m.assignee_kind === "supplier" ? null : laneById.get(m.assignee_id ?? "");
    const branch = world.branches.find((b) => b.id === m.from_branch_id);
    return lane
      ? `Ordered · ${lane.name.split(" ")[0]}'s pickup text is drafted: ready at ${branch ? `${branch.brand} ${branch.branch}` : "the shop"} from ${movementTime(m, world.settings)}, order ${m.order_ref || "—"} under Paint Group`
      : `Ordered · ${painter} will be told a delivery is coming ${m.due_date ? shortDay(m.due_date) : ""} ${m.time ? m.time.slice(0, 5) : m.half ?? ""} · client notice ${m.client_notice ? "on" : "off"}`;
  }), [act, laneById, painterName, world]);
  const done = useCallback((m: MovementRow) => act(() => setMovementStatus({ id: m.id, status: "done", workOrderId: m.work_order_id }), () =>
    m.items.length ? `${m.items.map((i) => i.label.split(" · ")[0]).join(" + ")} now ${m.kind === "equipment_return" ? "at the warehouse" : "on site"}` : "Done"), [act]);
  const unplace = useCallback((m: MovementRow) => act(() => unplaceMovement({ id: m.id, workOrderId: m.work_order_id }), () => "Back in the tray"), [act]);

  // ---- the tray ----------------------------------------------------------------------------
  const trayChips = useMemo(() => {
    const groupOrder = (m: MovementRow) => {
      const g = trayGroupOf(world, m, painterName);
      if (!g.job) return "3";
      return `${g.closed ? "2" : "1"}:${g.job.startDate ?? "9999"}:${g.job.id}`;
    };
    return world.movements.filter((m) => m.status === "tray").sort((a, b) => groupOrder(a).localeCompare(groupOrder(b)) || a.created_at.localeCompare(b.created_at));
  }, [world, painterName]);
  const filterCount = (f: Filter) => (f === "all" ? trayChips.length : trayChips.filter((m) => chipFilterKind(m) === f).length);
  const shownChips = filter === "all" ? trayChips : trayChips.filter((m) => chipFilterKind(m) === filter);

  const trayNode = (
    <Tray<MovementRow>
      className={trayOpen ? "open" : undefined}
      items={shownChips}
      itemKey={(m) => m.id}
      searchText={(m) => { const g = trayGroupOf(world, m, painterName); return `${m.title} ${m.detail ?? ""} ${g.title} ${g.job?.jobRef ?? ""} ${g.job?.suburb ?? ""}`; }}
      searchPlaceholder="Search a chip, job or suburb"
      searchLabel="Search the tray"
      title={<button type="button" className="traytitle" onClick={() => setTrayOpen((o) => !o)} data-testid="tray-toggle">Tray <span>{tally.tray} to plan</span></button>}
      sub="everything that has to move · built from the jobs"
      emptyText={trayChips.length === 0 ? "Everything has a person and a day." : `Nothing ${FILTERS.find((f) => f[0] === filter)?.[1].toLowerCase()} left in the tray.`}
      noMatch={(q, n) => <>Nothing matches &ldquo;{q}&rdquo;. {n} chip{n === 1 ? "" : "s"} in the tray.</>}
      controls={
        <div className="filters" data-testid="tray-filters">
          {FILTERS.map(([k, label]) => (
            <button key={k} type="button" className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{label} {filterCount(k)}</button>
          ))}
        </div>
      }
      groupKey={(m) => trayGroupOf(world, m, painterName).key}
      renderGroupHead={(_key, items) => {
        const g = trayGroupOf(world, items[0], painterName);
        return (
          <div className={`tjob${g.job && g.job.id === jobParam ? " focus" : ""}`} data-testid="tray-group">
            <div className="t"><span>{g.title}</span><small>{g.sub}</small></div>
          </div>
        );
      }}
      onDragStart={(e, m) => { if (!blockedReason(m, world)) drag.beginDrag(e, { chip: m }); }}
      renderItem={(m, bind) => {
        const blocked = blockedReason(m, world);
        const job = world.jobs.find((j) => j.id === m.work_order_id);
        const tbc = m.kind === "paint" && job && !job.coloursConfirmed;
        const sub = blocked ?? (tbc ? "colours TBC — can plan, can't order" : chipSub(m, world));
        return (
          <div
            className={`chip ${blocked ? "blocked" : "todo"} ${chipFilterKind(m)}`}
            data-testid="tray-chip"
            data-movement-id={m.id}
            onPointerDown={bind.onPointerDown}
            onClick={() => openChip(m)}
            title={blocked ? `Can't place yet — ${blocked}` : "Drag onto a lane, or tap to open"}
          >
            <span className={`ic ${chipFilterKind(m)}`}>{movementIcon(m, categoryOf(m))}</span>
            <div className="b"><b>{m.title}</b>{sub && <small className={blocked ? "bad" : tbc ? "warn" : ""}>{sub}</small>}</div>
            <span className="grip">⋮⋮</span>
          </div>
        );
      }}
      after={<button type="button" className="add" onClick={() => setSheet({ kind: "add" })} data-testid="add-chip">+ Add a chip — from scratch</button>}
    />
  );

  // ---- a cell's content --------------------------------------------------------------------
  const renderContext = (b: ContextBlock) => (
    <div key={b.id} className={`ctx ${b.kind === "calendar" ? "cal" : b.kind === "qa" || b.kind === "checkin" || b.kind === "walkthrough" ? "qa" : b.kind}`} title={b.sub}>
      {b.label}
      {(b.sub || b.time) && <small>{[b.sub, b.time].filter(Boolean).join(" · ")}</small>}
    </div>
  );

  const renderGhostSuggestion = (lane: MovementLane, b: ContextBlock) => {
    const n = whileYouAreThere(world, b);
    if (!n) return null;
    const half = b.half === "ALL" ? "AM" : b.half;
    const time = lane.slots === "hour" ? hourSlotFor(b.time) : null;
    return (
      <button key={`wyt:${b.id}`} type="button" className="wyt" data-testid="while-you-are-there" disabled={busy}
        onClick={() => void place(n.chip, lane, b.day, half, time)}>
        While you&rsquo;re there: {n.chip.title} · {n.km.toFixed(1)} km — tap to drop
      </button>
    );
  };

  const renderCard = (m: MovementRow, lane: MovementLane) => {
    const st = chipState(m);
    const skipOrHire = m.kind === "hire_on" || m.kind === "hire_off" || m.kind === "rubbish_in" || (m.kind === "rubbish_out" && (m.source_key ?? "").startsWith("hire_off:"));
    const first = lane.name.split(" ")[0];
    const stateLine = st === "needs-order" ? (skipOrHire ? "Not booked yet" : "Not ordered yet")
      : st === "booked" ? (lane.kind === "supplier" ? (skipOrHire ? "Booked" : "Ordered") + (m.ordered_at ? " · painter told" : "")
        : m.ordered_at ? `Ordered · ${first} alerted` : "Booked")
      : st === "done" ? "Done" : st === "problem" ? `Problem${m.problem_note ? ` · ${m.problem_note}` : ""}` : st === "cancelled" ? "Cancelled" : "Planned";
    const branch = world.branches.find((b) => b.id === m.from_branch_id);
    const job = world.jobs.find((j) => j.id === m.work_order_id);
    const time = m.time ? m.time.slice(0, 5) : m.half ?? "";
    const movable = st !== "done" && st !== "cancelled";
    return (
      <div
        key={m.id}
        className={`mv ${st}`}
        data-testid="movement-card"
        data-movement-id={m.id}
        data-time={m.time ? m.time.slice(0, 5) : undefined}
        style={{ ["--pc" as string]: lane.colour } as React.CSSProperties}
        onPointerDown={movable ? (e) => drag.beginDrag(e, { chip: m }) : undefined}
        onClick={() => openChip(m)}
      >
        <span className={`ic ${chipFilterKind(m)}`}>{movementIcon(m, categoryOf(m))}</span>
        <div className="bd">
          <span className="kl"><i />{kindLabel(m)}</span>
          <b>{m.title}</b>
          <small>{[branch ? `${branch.brand} ${branch.branch}` : null, time, job?.jobRef].filter(Boolean).join(" · ")}</small>
          <span className="st">{stateLine}</span>
          <div className="act" onPointerDown={(e) => e.stopPropagation()}>
            {st === "needs-order" && <button type="button" className="pri" disabled={busy} onClick={(e) => { e.stopPropagation(); void ordered(m); }}>{skipOrHire ? "Booked" : "Ordered"} ✓</button>}
            {(st === "booked" || st === "problem") && <button type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); void done(m); }}>Done</button>}
            {movable && <button type="button" title="back to tray" aria-label="Back to tray" disabled={busy} onClick={(e) => { e.stopPropagation(); void unplace(m); }}>↩</button>}
          </div>
        </div>
      </div>
    );
  };

  const placedOn = (lane: MovementLane, day: string) => world.movements.filter((m) => m.due_date === day && m.status !== "tray" && m.status !== "cancelled"
    && (lane.kind === "supplier" ? m.assignee_kind === "supplier" : m.assignee_kind === "person" && m.assignee_id === lane.id));

  const renderSlot = (lane: MovementLane, day: string, slot: string) => {
    const blocks = context(world, lane.id, day, ctx);
    const inSlot = (time: string | null, half: ContextBlock["half"] | "AM" | "PM" | null) =>
      lane.slots === "hour" ? hourSlotFor(half === "ALL" ? null : time) === slot : halfSlotFor(time, half) === slot;
    const ctxHere = blocks.filter((b) => inSlot(b.time, b.half));
    const cards = placedOn(lane, day).filter((m) => inSlot(m.time ? m.time.slice(0, 5) : null, m.half));
    const near = hot.has(`${lane.id}|${day}`);
    return (
      <div className={`sc${near ? " near" : ""}`}>
        {lane.slots === "hour" && <span className="tlab">{slot}</span>}
        <div className="scb">
          {ctxHere.map((b) => <span key={b.id}>{renderContext(b)}{lane.kind === "staff" && renderGhostSuggestion(lane, b)}</span>)}
          {cards.map((m) => renderCard(m, lane))}
        </div>
      </div>
    );
  };

  const renderCellHead = (lane: MovementLane, day: string) => {
    if (lane.kind !== "staff") return null;
    const n = nearby(world, lane.id, day, ctx);
    if (n.length === 0) return null;
    return (
      <button type="button" className="nearrow" data-testid="nearby-pill" title={`chips near where ${lane.name} already is`}
        onPointerDown={(e) => e.stopPropagation()} onClick={() => setSheet({ kind: "nearby", laneId: lane.id, day })}>
        ◎ Nearby {n.length} — see
      </button>
    );
  };

  // ---- the sheets --------------------------------------------------------------------------
  const sheetChip = sheet?.kind === "chip" ? movementById.get(sheet.id) ?? null : null;
  const nearbyList: Nearby[] = sheet?.kind === "nearby" ? nearby(world, sheet.laneId, sheet.day, ctx) : [];
  const nearbyLane = sheet?.kind === "nearby" ? laneById.get(sheet.laneId) ?? null : null;
  const close = () => setSheet(null);

  const hourlyNames = laneList.filter((l) => l.slots === "hour").map((l) => l.name.split(" ")[0]);
  const headline = tally.tray === 0
    ? <>Week of {weekLabel(weekStart)} is planned. <em className="ok">{tally.placed} movement{tally.placed === 1 ? "" : "s"}, nothing in the tray.</em></>
    : <>Week of {weekLabel(weekStart)} — <em>{tally.tray} chip{tally.tray === 1 ? "" : "s"} still in the tray</em>, {tally.placed} movement{tally.placed === 1 ? "" : "s"} placed.</>;

  return (
    <div className="mvx" data-view={view}>
      <div className="headrow">
        <div>
          <h1 data-testid="movements-headline">{headline}</h1>
          <p className="lede">Drag a chip from the tray onto a person&rsquo;s day. The lane decides who and how; the column{hourlyNames.length ? ` — and for ${hourlyNames.join(" and ")} the hour —` : ""} decides when. Everyone&rsquo;s week is already drawn in, so you can send things with whoever is going that way.</p>
        </div>
        <div className="ctl">
          <div className="seg views" role="tablist">
            <button type="button" role="tab" aria-selected={view === "week"} className={view === "week" ? "on" : ""} onClick={() => go({ view: "week" })}><span>Week</span><small>plan</small></button>
            <button type="button" role="tab" aria-selected={view === "day"} className={view === "day" ? "on" : ""} onClick={() => go({ view: "day", day: dayParam ?? weekStart })}><span>Day</span><small>run plans</small></button>
            <button type="button" role="tab" aria-selected={view === "sources"} className={view === "sources" ? "on" : ""} onClick={() => go({ view: "sources" })}><span>Sources</span><small>where chips come from</small></button>
            <button type="button" role="tab" aria-selected={view === "gear"} className={view === "gear" ? "on" : ""} onClick={() => go({ view: "gear" })}><span>Gear</span><small>the register</small></button>
          </div>
          <div className="weeknav">
            <button type="button" aria-label="Previous week" onClick={() => go({ week: addDays(weekStart, -7) })}>‹</button>
            <b>Week of {shortDay(weekStart)}</b>
            <button type="button" aria-label="Next week" onClick={() => go({ week: addDays(weekStart, 7) })}>›</button>
          </div>
          <button type="button" className="pill p-amber" data-testid="orders-pill" title="Every placed delivery or pickup whose order is not yet placed — opens the Day view's Orders card" onClick={() => go({ view: "day", day: dayParam ?? weekStart })}>Orders to place · {tally.ordersToPlace}</button>
        </div>
      </div>

      {world.settings.showHowItWorks && <HowItWorks hourlyNames={hourlyNames} />}

      {failures.length > 0 && (
        <div className="err" data-testid="movements-failures" role="alert">
          {failures.map((f) => <div key={f}>{f}</div>)}
        </div>
      )}

      {view === "week" ? (
        <>
          <div data-testid="movements-board">
            <Board<MovementLane, never, DragPayload, DropCheck>
              zoom={zoom}
              drag={drag}
              lanes={laneList}
              laneId={(l) => l.id}
              blocks={[]}
              blockId={() => ""}
              blockLane={() => ""}
              blockStart={() => ""}
              blockEnd={() => ""}
              blockPayload={() => { throw new Error("no spanning blocks on the Movements board"); }}
              rowSizing="content"
              slots={(l) => l.slots}
              slotHours={HOUR_SLOTS}
              laneHeadTitle={<><span>Who moves it</span><small>lanes = buckets</small></>}
              laneClass={(l) => `k-${l.kind}`}
              laneData={(l) => ({ "data-lane-kind": l.kind })}
              renderLaneHead={(l) => (
                <div className="lh" style={{ ["--pc" as string]: l.colour } as React.CSSProperties}>
                  <span className={`tag ${l.kind}`}>{l.kind === "supplier" ? "Supplier" : l.kind === "staff" ? (l.employmentType === "employee" ? "Staff · employee" : "Staff") : "Painter"}</span>
                  <b><span className="dot" />{l.name}</b>
                  <small>{l.sub}</small>
                  {l.slots === "hour" && !l.sub.includes("1-hour") && <span className="hint">1-hour slots · 07:30–17:30</span>}
                  {l.calendarNote && <span className="calnote" data-testid="calendar-note">{l.calendarNote}</span>}
                </div>
              )}
              renderBlock={() => null}
              renderSlot={renderSlot}
              renderCellHead={renderCellHead}
              renderGhost={(p, c) => (
                <>
                  <div className="g1">{p.chip.title}</div>
                  <div className="g2">{c?.blocked ? c.reason?.toUpperCase() : c?.warn ? `OUTSIDE THE WINDOW — ${c.warn.toUpperCase()}` : kindLabel(p.chip).toUpperCase()}</div>
                  {c && !c.blocked && <div className="g3">→ {c.laneName} · {c.where}</div>}
                </>
              )}
              emptyMessage={laneList.length <= 1 ? "No painters booked this week and nobody in Settings → Movements → board people yet." : undefined}
              storageKey="pc-movements:scroll"
              tray={trayNode}
            />
          </div>
          <div className="legend">
            <span><i style={{ background: "var(--emerald)" }} />on a job (schedule)</span>
            <span><i style={{ background: "var(--violet)" }} />calendar (Google, read-only)</span>
            <span><i style={{ background: "var(--cyan)" }} />quality check / job check-in</span>
            <span><i style={{ border: "1px dashed var(--cyan)", background: "var(--cyan-soft)" }} />&ldquo;while you&rsquo;re there&rdquo; suggestion</span>
            <span><i style={{ background: "var(--amber)" }} />needs an order placed</span>
            <span><i style={{ background: "var(--muted)" }} />planned</span>
            <span><i style={{ background: "var(--cyan)" }} />ordered / booked</span>
          </div>
        </>
      ) : view === "gear" ? (
        <GearView world={world} lanes={laneList} onFindInTray={(m) => { router.push(`/pc/movements?view=week&week=${weekStart}${m.work_order_id ? `&job=${m.work_order_id}` : ""}&movement=${m.id}`); }} />
      ) : view === "day" ? (
        <DayView
          world={world}
          ctx={ctx}
          lanes={laneList}
          days={days}
          day={dayParam && days.includes(dayParam) ? dayParam : days[0]}
          who={whoParam}
          onPick={(n) => go({ view: "day", ...n })}
          act={act}
          busy={busy}
          onOrdered={ordered}
          onDone={done}
          onOpen={(m) => setSheet({ kind: "chip", id: m.id })}
          categoryOf={categoryOf}
          painterName={painterName}
        />
      ) : (
        <SourcesView
          world={world}
          materialLines={materialLines}
          jobExtras={jobExtras}
          jobId={jobParam}
          onPickJob={(id) => go({ job: id })}
          onAddChip={() => setSheet({ kind: "add" })}
          onOpenChip={(m) => setSheet({ kind: "chip", id: m.id })}
          act={act}
          busy={busy}
          personName={personName}
          categoryOf={categoryOf}
        />
      )}

      <Scrim on={sheet !== null} onClick={close} />
      <Sheet open={sheet !== null} testId={sheet?.kind === "chip" ? "chip-sheet" : sheet?.kind === "add" ? "add-chip-sheet" : sheet?.kind === "nearby" ? "nearby-sheet" : undefined}>
        {sheet && <span className="grab" />}
        {sheet && <button type="button" className="sh-x" onClick={close} aria-label="Close">×</button>}
        {sheetChip && (
          <ChipSheet
            key={sheetChip.id + sheetChip.updated_at}
            chip={sheetChip}
            world={world}
            jobExtras={jobExtras}
            lane={sheetChip.assignee_kind === "supplier" ? laneById.get("supplier") ?? null : laneById.get(sheetChip.assignee_id ?? "") ?? null}
            act={act}
            busy={busy}
            onClose={close}
            say={say}
            onOrdered={() => void ordered(sheetChip).then((ok) => { if (ok) close(); })}
            onUnplace={() => void unplace(sheetChip).then((ok) => { if (ok) close(); })}
          />
        )}
        {sheet?.kind === "chip" && !sheetChip && <p className="sh-sub">That chip is not on this week&rsquo;s board any more.</p>}
        {sheet?.kind === "add" && (
          <AddChipSheet world={world} jobId={jobParam} act={act} busy={busy} onClose={close} />
        )}
        {sheet?.kind === "nearby" && nearbyLane && (
          <>
            <div className="sh-h"><h3>Near {nearbyLane.name} on {shortDay(sheet.day)}</h3></div>
            <p className="sh-sub">
              {context(world, sheet.laneId, sheet.day, ctx).map((b) => b.label).join(" · ")}. These tray chips are within {world.settings.nearKm} km of where {nearbyLane.name.split(" ")[0]} will already be.
            </p>
            <div className="list">
              {nearbyList.map(({ chip, from, km }) => (
                <button key={chip.id} type="button" className="opt" disabled={busy} data-testid="nearby-option"
                  onClick={() => { close(); void place(chip, nearbyLane, sheet.day, from.half === "ALL" ? "AM" : from.half, nearbyLane.slots === "hour" ? hourSlotFor(from.time) : null); }}>
                  <span className={`ic ${chipFilterKind(chip)}`}>{movementIcon(chip, categoryOf(chip))}</span>
                  <span>{chip.title}<span className="sub">{world.jobs.find((j) => j.id === chip.work_order_id)?.jobRef ?? "warehouse"} · {km.toFixed(1)} km from {from.suburb || from.kindLabel}</span></span>
                  <span className="km">drop →</span>
                </button>
              ))}
            </div>
          </>
        )}
      </Sheet>
      <Toast text={toast} />
    </div>
  );
}

/** The chip's second line in the tray. */
function chipSub(m: MovementRow, world: World): string {
  const branch = world.branches.find((b) => b.id === (m.from_branch_id ?? m.to_branch_id));
  const b = branch ? `${branch.brand} ${branch.branch}` : "";
  if (isUndecidedRubbish(m)) return "painter disposed · painter drops at warehouse · left on site";
  const parts = [m.detail, b].filter(Boolean);
  if (m.kind === "equipment_return" || m.kind === "hire_off") {
    const job = world.jobs.find((j) => j.id === m.work_order_id);
    if (job?.stage === "closed") return "left on a closed job";
    return `auto-created · job ends ${job?.endDate ? shortDay(job.endDate) : "—"}`;
  }
  return parts.join(" · ");
}
