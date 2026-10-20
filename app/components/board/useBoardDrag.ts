"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { DropTarget, GhostFlags } from "./types";

export type AutoScrollOptions = {
  /** Distance from a scroller edge, in px, inside which the board scrolls. */
  edge?: number;
  /** Pixels per frame. */
  step?: number;
};

export type BoardDragOptions<P, C extends GhostFlags> = {
  /** The visible days, in order — `data-day` on a cell resolves to its index here. */
  days: string[];
  dayW: number;
  /**
   * Is this drop allowed, and what would it mean? Called once per cell the
   * pointer enters (not per move), and its result is drawn on the ghost. The
   * engine reads `blocked` / `held` to tint the lane and the ghost; the rest
   * is the caller's to render.
   */
  check: (payload: P, target: DropTarget) => C;
  /** The pointer was released over a cell after a real drag. */
  onDrop: (payload: P, target: DropTarget) => void;
  /** A marquee across empty lane space was released — inclusive ISO days. */
  onRangeSelect?: (laneId: string, startDay: string, endDay: string) => void;
  /**
   * OFF by default (the Schedule board never had it — Session 0 item 9.9).
   * Pointer capture keeps a touch drag alive when the finger leaves the
   * element that started it.
   */
  capturePointer?: boolean;
  /**
   * OFF by default (same reason). Scroll the board when the pointer is held
   * near an edge of the scroller during a drag.
   */
  autoScroll?: boolean | AutoScrollOptions;
  /** The scroller auto-scroll drives (`main.tl`, `zoom.scrollerEl`); the page scrolls when it can't. */
  scroller?: () => HTMLElement | null;
};

type Drag<P> = {
  payload: P;
  el: HTMLElement;
  startX: number;
  startY: number;
  moved: boolean;
  pointerId: number;
};

type Marquee = { laneId: string; anchor: number; laneEl: HTMLElement; pointerId: number; moved: boolean };

type LaneRect = { id: string; rect: DOMRect; el: HTMLElement };

const DRAG_THRESHOLD_PX = 5; // let clicks be clicks

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  const ra = a as Record<string, unknown>, rb = b as Record<string, unknown>;
  return ka.every((k) => ra[k] === rb[k]);
}

/**
 * Scroll the board toward a pointer held within `edge` px of a scroller edge.
 * The scroller moves sideways (and down when it is the vertical scrollport);
 * otherwise the page scrolls. Returns whether anything moved.
 */
function nudgeScroll(tl: HTMLElement | null, x: number, y: number, edge: number, step: number): boolean {
  const r = tl ? tl.getBoundingClientRect() : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
  let dx = 0, dy = 0;
  if (x < r.left + edge) dx = -step; else if (x > r.right - edge) dx = step;
  if (y < r.top + edge) dy = -step; else if (y > r.bottom - edge) dy = step;
  if (!dx && !dy) return false;
  let scrolled = false;
  if (tl) {
    const before = { l: tl.scrollLeft, t: tl.scrollTop };
    tl.scrollLeft += dx;
    if (tl.scrollHeight > tl.clientHeight) tl.scrollTop += dy;
    scrolled = tl.scrollLeft !== before.l || tl.scrollTop !== before.t;
  }
  if (dy && (!tl || tl.scrollHeight <= tl.clientHeight)) {
    const before = window.scrollY;
    window.scrollBy(0, dy);
    scrolled = scrolled || window.scrollY !== before;
  }
  return scrolled;
}

/** The `.bgc` cells of a lane, in day order. */
const cellsOf = (laneEl: HTMLElement) => Array.from(laneEl.querySelectorAll<HTMLElement>(":scope > .bgc"));

/**
 * Pointer drag for a lanes × days board.
 *
 * Everything here writes to the DOM directly. React does not re-render during
 * a drag: the ghost moves on the compositor via transform, and the drop-target
 * highlight is a single class toggle. That is what keeps it smooth.
 *
 * Pointer Events only (`onPointerDown` + window `pointermove` / `pointerup` /
 * `pointercancel`); a drag follows only its own `pointerId`. Listeners go on
 * `window` and one AbortController tears them all down.
 */
export function useBoardDrag<P, C extends GhostFlags>({
  days, dayW, check, onDrop, onRangeSelect, capturePointer = false, autoScroll = false, scroller,
}: BoardDragOptions<P, C>) {
  const range = days.length;
  const dayIdx = useMemo(() => new Map(days.map((d, i) => [d, i] as const)), [days]);

  const laneRefs = useRef(new Map<string, HTMLElement>());
  const ghostEl = useRef<HTMLDivElement | null>(null);
  const hotEl = useRef<HTMLElement | null>(null);
  const hotLane = useRef<HTMLElement | null>(null);
  const rafId = useRef<number | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const laneRects = useRef<LaneRect[]>([]);
  const target = useRef<DropTarget | null>(null);
  const dragAbort = useRef<AbortController | null>(null);
  const drag = useRef<Drag<P> | null>(null);
  const marquee = useRef<Marquee | null>(null);
  const scrollRaf = useRef<number | null>(null);

  // What the ghost shows: the payload being dragged, the LAST check result
  // (it persists while the pointer is off the grid, as the Schedule board's
  // blocked/held flags always did) and the cell under the pointer (null off
  // the grid).
  const [ghost, setGhost] = useState<null | { payload: P; check: C | null; target: DropTarget | null }>(null);

  // The latest callbacks, so the window listeners never go stale and never
  // need re-subscribing mid-drag.
  const latest = useRef({ check, onDrop, onRangeSelect, days, dayW, dayIdx, range });
  useEffect(() => {
    latest.current = { check, onDrop, onRangeSelect, days, dayW, dayIdx, range };
  });

  /** Where the ghost is drawn — bind to the `.ghost` element's `ref`. */
  const setGhostEl = useCallback((el: HTMLDivElement | null) => { ghostEl.current = el; }, []);

  const registerLane = useCallback((id: string, el: HTMLElement | null) => {
    if (el) laneRefs.current.set(id, el);
    else laneRefs.current.delete(id);
  }, []);

  const cacheLaneRects = useCallback(() => {
    laneRects.current = [...laneRefs.current.entries()]
      .filter(([, el]) => el?.isConnected)
      .map(([id, el]) => ({ id, rect: el.getBoundingClientRect(), el }));
  }, []);

  const clearHot = useCallback(() => {
    if (hotEl.current) {
      hotEl.current.classList.remove("hot");
      hotLane.current?.classList.remove("blocked");
      hotEl.current = null;
      hotLane.current = null;
    }
  }, []);

  // Only the visual follow lives in rAF. Painting the ghost is the one thing
  // worth coalescing to a frame; correctness must not depend on a frame ever
  // firing (it doesn't in a background tab), so the hit-test happens in the
  // pointer handler instead.
  const frame = useCallback(() => {
    rafId.current = null;
    if (!drag.current || !ghostEl.current) return;
    const { x, y } = pointer.current;
    ghostEl.current.style.transform = `translate3d(${x + 14}px, ${y + 14}px, 0)`;
  }, []);

  /**
   * The cell under the pointer. Tom, 22 Sep: "the calendar days don't line up
   * when dragging and dropping" — the lane rects are cached when the drag
   * starts, so any scroll of the page or the timeline during the drag (and a
   * zoom that lands between cell widths) put the arithmetic one or more days
   * off. Ask the browser which day cell is under the pointer instead; the
   * cached rects remain the fallback when nothing is hit (the ghost, a gap).
   *
   * The day comes from the cell's `data-day`, the lane from the lane's
   * `data-lane`, the sub-slot from `data-slot` — never from DOM order.
   */
  const updateTarget = useCallback((x: number, y: number) => {
    const { days, dayW, dayIdx, range, check } = latest.current;
    const d = drag.current;
    if (!d) return;

    let hit = laneRects.current.find((l) => y >= l.rect.top && y <= l.rect.bottom);
    let idx = hit ? Math.floor((x - hit.rect.left) / dayW) : -1;
    let cell: HTMLElement | null = null;
    let slotEl: HTMLElement | null = null;
    if (typeof document !== "undefined" && typeof document.elementsFromPoint === "function") {
      const stack = document.elementsFromPoint(x, y);
      const under = stack.find((el) => el.classList.contains("bgc") && el.parentElement?.classList.contains("lane")) as HTMLElement | undefined;
      const laneEl = under?.parentElement ?? null;
      const lane = laneEl ? laneRects.current.find((l) => l.el === laneEl) : undefined;
      if (under && lane) {
        hit = lane;
        const day = under.dataset.day ?? "";
        idx = dayIdx.get(day) ?? -1;
        cell = under;
        slotEl = (stack.find((el) => el instanceof HTMLElement && el.dataset.slot != null && under.contains(el)) as HTMLElement | undefined) ?? null;
      }
    }
    if (!hit || idx < 0 || idx >= range) {
      clearHot();
      target.current = null;
      setGhost((prev) => (prev === null || prev.target === null ? prev : { ...prev, target: null }));
      return;
    }
    if (!cell) cell = hit.el.querySelector<HTMLElement>(`:scope > .bgc[data-day="${days[idx]}"]`);
    const slot = slotEl?.dataset.slot ?? null;
    const next: DropTarget = { laneId: hit.id, dayIndex: idx, day: days[idx], slot };
    const hot = slotEl ?? cell;
    if (hot && hot !== hotEl.current) {
      clearHot();
      hot.classList.add("hot");
      const result = check(d.payload, next);
      hit.el.classList.toggle("blocked", Boolean(result.blocked));
      hotEl.current = hot;
      hotLane.current = hit.el;
      setGhost((prev) => ({ payload: d.payload, check: prev && shallowEqual(prev.check, result) ? prev.check : result, target: next }));
    }
    target.current = next;
  }, [clearHot]);

  // ---- edge auto-scroll (opt-in) --------------------------------------------
  const autoOn = Boolean(autoScroll);
  const autoEdge = typeof autoScroll === "object" ? autoScroll.edge ?? 40 : 40;
  const autoStep = typeof autoScroll === "object" ? autoScroll.step ?? 14 : 14;
  const autoScrollTick = useCallback(function tick() {
    scrollRaf.current = null;
    const d = drag.current;
    if (!d || !d.moved || !autoOn) return;
    const { x, y } = pointer.current;
    if (!nudgeScroll(scroller?.() ?? null, x, y, autoEdge, autoStep)) return;
    cacheLaneRects();
    updateTarget(x, y);
    scrollRaf.current = requestAnimationFrame(tick);
  }, [autoOn, autoEdge, autoStep, scroller, cacheLaneRects, updateTarget]);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    pointer.current = { x: e.clientX, y: e.clientY };

    if (!d.moved) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD_PX) return;
      d.moved = true;
      d.el.classList.add("dragging");
      cacheLaneRects();
    }
    updateTarget(e.clientX, e.clientY);
    if (rafId.current == null) rafId.current = requestAnimationFrame(frame);
    if (autoOn && scrollRaf.current == null) scrollRaf.current = requestAnimationFrame(autoScrollTick);
  }, [frame, cacheLaneRects, updateTarget, autoOn, autoScrollTick]);

  const onPointerUp = useCallback((e: PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;

    if (rafId.current != null) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    if (scrollRaf.current != null) {
      cancelAnimationFrame(scrollRaf.current);
      scrollRaf.current = null;
    }
    d.el.classList.remove("dragging");
    if (capturePointer) {
      try { d.el.releasePointerCapture(d.pointerId); } catch { /* already released */ }
    }

    const t = target.current;
    if (d.moved && t) latest.current.onDrop(d.payload, t);

    clearHot();
    target.current = null;
    drag.current = null;
    setGhost(null);
    // One abort tears down every listener, so no handler has to reference
    // another to unsubscribe.
    dragAbort.current?.abort();
    dragAbort.current = null;
  }, [clearHot, capturePointer]);

  /** Start dragging `payload` from the element under the pointer. Bind to `onPointerDown`. */
  const beginDrag = useCallback((e: ReactPointerEvent, payload: P) => {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    drag.current = { payload, el, startX: e.clientX, startY: e.clientY, moved: false, pointerId: e.pointerId };
    pointer.current = { x: e.clientX, y: e.clientY };
    setGhost({ payload, check: null, target: null });
    if (capturePointer) {
      try { el.setPointerCapture(e.pointerId); } catch { /* not a pointer the element can capture */ }
    }
    dragAbort.current?.abort();
    const ac = new AbortController();
    dragAbort.current = ac;
    window.addEventListener("pointermove", onPointerMove, { signal: ac.signal });
    window.addEventListener("pointerup", onPointerUp, { signal: ac.signal });
    window.addEventListener("pointercancel", onPointerUp, { signal: ac.signal });
  }, [onPointerMove, onPointerUp, capturePointer]);

  // A scroll mid-drag moves every lane: re-cache the rects the fallback uses.
  useEffect(() => {
    const onScroll = () => {
      if (drag.current?.moved) cacheLaneRects();
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [cacheLaneRects]);

  // Nothing survives unmount: no window listener, no frame.
  useEffect(() => () => {
    dragAbort.current?.abort();
    if (rafId.current != null) cancelAnimationFrame(rafId.current);
    if (scrollRaf.current != null) cancelAnimationFrame(scrollRaf.current);
  }, []);

  // ---- marquee across empty lane space --------------------------------------
  const paintMarquee = useCallback((laneEl: HTMLElement, a: number, b: number) => {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    cellsOf(laneEl).forEach((cell, i) => cell.classList.toggle("marq", i >= lo && i <= hi));
  }, []);

  const clearMarquee = useCallback((laneEl: HTMLElement) => {
    for (const cell of cellsOf(laneEl)) cell.classList.remove("marq");
  }, []);

  /**
   * Dragging across EMPTY lane space selects a run of days — far quicker than
   * a form, and it reads the same as the drag used to place a block. Bind to
   * the lane's `onPointerDown`; it only starts on a bare day cell, never on a
   * block.
   */
  const beginRangeSelect = useCallback((e: ReactPointerEvent, laneId: string) => {
    if (!latest.current.onRangeSelect) return;
    const el = e.target as HTMLElement;
    const cell = el.classList.contains("bgc") ? el : (el.closest(".bgc") as HTMLElement | null);
    if (!cell || e.button !== 0) return;
    const laneEl = e.currentTarget as HTMLElement;
    if (cell.parentElement !== laneEl) return;
    const { dayIdx, range, dayW, days } = latest.current;
    const idx = dayIdx.get(cell.dataset.day ?? "") ?? -1;
    if (idx < 0 || idx >= range) return;

    marquee.current = { laneId, anchor: idx, laneEl, pointerId: e.pointerId, moved: false };
    paintMarquee(laneEl, idx, idx);

    const indexAt = (clientX: number) => {
      const r = laneEl.getBoundingClientRect();
      return Math.max(0, Math.min(range - 1, Math.floor((clientX - r.left) / dayW)));
    };
    const ac = new AbortController();
    const move = (ev: PointerEvent) => {
      const m = marquee.current;
      if (!m || ev.pointerId !== m.pointerId) return;
      m.moved = true;
      paintMarquee(m.laneEl, m.anchor, indexAt(ev.clientX));
    };
    const up = (ev: PointerEvent) => {
      const m = marquee.current;
      ac.abort();
      if (!m || ev.pointerId !== m.pointerId) return;
      const i = indexAt(ev.clientX);
      clearMarquee(m.laneEl);
      marquee.current = null;
      const lo = Math.min(m.anchor, i), hi = Math.max(m.anchor, i);
      latest.current.onRangeSelect?.(m.laneId, days[lo], days[hi]);
    };
    window.addEventListener("pointermove", move, { signal: ac.signal });
    window.addEventListener("pointerup", up, { signal: ac.signal });
    window.addEventListener("pointercancel", up, { signal: ac.signal });
  }, [paintMarquee, clearMarquee]);

  return {
    beginDrag,
    beginRangeSelect,
    registerLane,
    /** The ghost's content: null when nothing is being dragged. */
    ghost,
    setGhostEl,
    /** The payload mid-drag, for callers whose check needs it (a block ignoring itself). */
    dragging: () => drag.current?.payload ?? null,
  };
}

export type BoardDrag<P, C extends GhostFlags> = ReturnType<typeof useBoardDrag<P, C>>;
