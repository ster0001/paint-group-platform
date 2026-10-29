"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

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

export function useRollerSweep<K extends string>(keys: readonly K[], on: (k: K) => boolean, full: number, height: number) {
  const rects = useRef<Partial<Record<K, SVGRectElement | null>>>({});
  const rollers = useRef<Partial<Record<K, SVGGElement | null>>>({});
  const frames = useRef<Partial<Record<K, number>>>({});
  const shown = useRef<Partial<Record<K, boolean>> | null>(null);

  const sweep = (k: K, to: number) => {
    const rect = rects.current[k], roller = rollers.current[k];
    if (!rect) return;
    const from = Number(rect.getAttribute("width") ?? (to === full ? 0 : full));
    const y = midY(rect, height / 2);
    const t0 = performance.now();
    const prev = frames.current[k];
    if (prev) cancelAnimationFrame(prev);
    roller?.classList.add("on");
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / SWEEP_MS);
      const e = 1 - Math.pow(1 - t, 3);
      const w = from + (to - from) * e;
      rect.setAttribute("width", String(Math.round(w * 100) / 100));
      roller?.setAttribute("transform", `translate(${w},${y})`);
      if (t < 1) frames.current[k] = requestAnimationFrame(step);
      else { rect.setAttribute("width", String(to)); roller?.classList.remove("on"); frames.current[k] = undefined; }
    };
    frames.current[k] = requestAnimationFrame(step);
  };

  // First paint, and any re-render: the rects that are not mid-sweep show their state.
  useLayoutEffect(() => {
    const first = shown.current == null;
    for (const k of keys) {
      const rect = rects.current[k];
      if (!rect) continue;
      const want = on(k) ? full : 0;
      const had = shown.current?.[k];
      if (first || had === undefined) { rect.setAttribute("width", String(want)); continue; }
      if (had === on(k)) continue;
      if (reducedMotion()) { rect.setAttribute("width", String(want)); continue; }
      sweep(k, want);
    }
    shown.current = Object.fromEntries(keys.map((k) => [k, on(k)])) as Partial<Record<K, boolean>>;
  });
  useEffect(() => {
    const live = frames.current;
    return () => { for (const f of Object.values(live) as Array<number | undefined>) if (f) cancelAnimationFrame(f); };
  }, []);

  return {
    rectRef: (k: K) => (el: SVGRectElement | null) => { rects.current[k] = el; },
    rollerRef: (k: K) => (el: SVGGElement | null) => { rollers.current[k] = el; },
  };
}
