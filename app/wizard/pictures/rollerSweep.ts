"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

/**
 * Wizard mobile v5 §3.3 / §6 — THE ROLLER SWEEP, shared by the phone's
 * picture (MobilePicture) and the desktop room (RoomPicture, session 6).
 *
 * Every painted surface is a layer clipped by a `<rect>`; ticking sweeps
 * the rect's width 0 → `full` over ~520ms (ease-out cubic) with a roller
 * glyph riding the leading edge at the surface's mid-height, and unticking
 * wipes it back. The width is written to the rect's ATTRIBUTE from
 * `requestAnimationFrame` — never a CSS transition on a clipPath child,
 * which Safari does not animate (§3.6) — and React never writes it, so a
 * re-render mid-sweep cannot reset the roller. Each rendered copy owns its
 * own frames (the v4 bug was one shared handle). `prefers-reduced-motion`
 * snaps. On first paint every rect simply shows its state.
 *
 * Exterior on mobile v5 (S2): the drawn house (`Elevation`) builds its SVG
 * as a markup string, so its rects cannot take a ref — `query` names the
 * `<svg>` and a version of its markup, and the hook finds every
 * `[data-surf=k] rect.cprect` (a part may be drawn in several pieces) each
 * time the markup is re-injected. A re-injected rect carries no width: one
 * whose state has not changed is snapped to it; one whose state has changed
 * sweeps from nothing — so a part that is DRAWN for the first time on its
 * tick (a gable on a hip roof) still rolls in.
 */
export const SWEEP_MS = 520;

function reducedMotion(): boolean {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

/** The surface's mid-height, for the glyph: the base layer's box (a browser without getBBox gets the middle). */
function midY(rect: SVGRectElement, fallback: number): number {
  try {
    const base = rect.closest("[data-surf]")?.querySelector(".base, .trimbase, .rl-base") as SVGGraphicsElement | null;
    const b = base?.getBBox();
    return b ? b.y + b.height / 2 : fallback;
  } catch { return fallback; }
}

export function useRollerSweep<K extends string>(
  keys: readonly K[], on: (k: K) => boolean, full: number, height: number,
  /** Markup-built pictures: the `<svg>` to query for the rects and rollers, re-queried whenever `version` changes. */
  query?: { root: RefObject<SVGSVGElement | null>; version: string },
) {
  const rects = useRef<Partial<Record<K, SVGRectElement[]>>>({});
  const rollers = useRef<Partial<Record<K, SVGGElement[]>>>({});
  const frames = useRef<Partial<Record<K, number>>>({});
  const shown = useRef<Partial<Record<K, boolean>> | null>(null);

  const sweep = (k: K, to: number) => {
    const list = rects.current[k] ?? [], rolls = rollers.current[k] ?? [];
    if (!list.length) return;
    const from = Number(list[0].getAttribute("width") ?? (to === full ? 0 : full));
    const ys = list.map((r) => midY(r, height / 2));
    const t0 = performance.now();
    const prev = frames.current[k];
    if (prev) cancelAnimationFrame(prev);
    for (const r of rolls) r?.classList.add("on");
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / SWEEP_MS);
      const e = 1 - Math.pow(1 - t, 3);
      const w = from + (to - from) * e;
      list.forEach((rect, i) => {
        rect.setAttribute("width", String(Math.round(w * 100) / 100));
        rolls[i]?.setAttribute("transform", `translate(${w},${ys[i]})`);
      });
      if (t < 1) frames.current[k] = requestAnimationFrame(step);
      else { for (const r of list) r.setAttribute("width", String(to)); for (const r of rolls) r?.classList.remove("on"); frames.current[k] = undefined; }
    };
    frames.current[k] = requestAnimationFrame(step);
  };

  // A markup-built picture: find the rects and rollers again each time the markup is re-injected (before the effect below decides).
  const version = query?.version ?? "";
  const root = query?.root ?? null;
  useLayoutEffect(() => {
    if (!root?.current) return;
    const svg = root.current;
    for (const k of keys) {
      const groups = Array.from(svg.querySelectorAll(`[data-surf="${k}"]`));
      rects.current[k] = groups.map((g) => g.querySelector("rect.cprect") as SVGRectElement | null).filter((r): r is SVGRectElement => r != null);
      rollers.current[k] = groups.map((g) => g.querySelector("g.roller") as SVGGElement | null).filter((r): r is SVGGElement => r != null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the markup's version is the trigger; `keys` is a constant list
  }, [root, version]);

  // First paint, and any re-render: the rects that are not mid-sweep show their state.
  useLayoutEffect(() => {
    const first = shown.current == null;
    for (const k of keys) {
      const list = rects.current[k] ?? [];
      if (!list.length) continue;
      const want = on(k) ? full : 0;
      const had = shown.current?.[k];
      if (first || had === undefined) { for (const r of list) r.setAttribute("width", String(want)); continue; }
      if (had === on(k)) {
        // a re-injected rect (no width yet) simply shows its state
        for (const r of list) if (r.getAttribute("width") == null) r.setAttribute("width", String(want));
        continue;
      }
      if (reducedMotion()) { for (const r of list) r.setAttribute("width", String(want)); continue; }
      sweep(k, want);
    }
    shown.current = Object.fromEntries(keys.map((k) => [k, on(k)])) as Partial<Record<K, boolean>>;
  });
  useEffect(() => {
    const live = frames.current;
    return () => { for (const f of Object.values(live) as Array<number | undefined>) if (f) cancelAnimationFrame(f); };
  }, []);

  return {
    rectRef: (k: K) => (el: SVGRectElement | null) => { rects.current[k] = el ? [el] : []; },
    rollerRef: (k: K) => (el: SVGGElement | null) => { rollers.current[k] = el ? [el] : []; },
  };
}
