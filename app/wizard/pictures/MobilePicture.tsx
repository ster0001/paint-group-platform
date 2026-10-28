"use client";

import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { WALL_TINT, type MobilePictureState, type PictureSurface } from "@/lib/wizard/mobilePicture";

/**
 * Wizard mobile v5, session 3 (brief §3) — the phone's picture: the room
 * (inside) or the house (outside), 200 × 120, drawn from one
 * `MobilePictureState` and rendered twice (the strip's thumbnail and the
 * sheet). The prototype's drawings, as they are.
 *
 * Every surface is a BASE layer (grey) and a PAINTED layer clipped by a
 * rect whose width the roller sweeps 0 → 200 (ease-out cubic, ~520ms) with
 * a teal roller glyph riding the leading edge at the surface's mid-height;
 * unticking wipes it back. Each rendered copy owns its own animation
 * frames (the v4 bug was one shared handle), and the width is written to
 * the rect's attribute from `requestAnimationFrame` — never a CSS
 * transition on a clipPath child, which Safari does not animate (§3.6).
 * Under `prefers-reduced-motion` the width snaps.
 *
 * React never writes the rect's `width`: the component sets it in effects,
 * so a re-render mid-sweep cannot reset the roller.
 */
const W = 200, H = 120, DUR = 520;

const FILL: Record<PictureSurface, string> = {
  walls: "", ceilings: "#fafaf8", skirting: "#ffffff", doors: "#ffffff", windows: "#ffffff", eaves: "#ffffff", gutters: "#f4f4f2", verandah: "#ffffff",
};
const TRIM = new Set<PictureSurface>(["skirting", "doors", "windows", "eaves", "gutters", "verandah"]);

function reducedMotion(): boolean {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

export default function MobilePicture({ state, testId = "wzm-pic" }: { state: MobilePictureState; testId?: string }) {
  const id = useId().replace(/:/g, "");
  const rects = useRef<Partial<Record<PictureSurface, SVGRectElement | null>>>({});
  const rollers = useRef<Partial<Record<PictureSurface, SVGGElement | null>>>({});
  const frames = useRef<Partial<Record<PictureSurface, number>>>({});
  const shown = useRef<Partial<Record<PictureSurface, boolean>> | null>(null);
  const painted = state.painted;
  const on = (k: PictureSurface) => Boolean(painted?.[k]);
  const surfaces: PictureSurface[] = state.kind === "room" ? ["ceilings", "walls", "skirting", "doors", "windows"] : ["walls", "eaves", "gutters", "windows", "doors", ...(state.property === "house" ? ["verandah" as const] : [])];

  const sweep = (k: PictureSurface, to: number) => {
    const rect = rects.current[k], roller = rollers.current[k];
    if (!rect) return;
    const from = Number(rect.getAttribute("width") ?? (to === W ? 0 : W));
    const y = midY(rect);
    const t0 = performance.now();
    const prev = frames.current[k];
    if (prev) cancelAnimationFrame(prev);
    roller?.classList.add("on");
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / DUR);
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
    for (const k of surfaces) {
      const rect = rects.current[k];
      if (!rect) continue;
      const want = on(k) ? W : 0;
      const had = shown.current?.[k];
      if (first || had === undefined) { rect.setAttribute("width", String(want)); continue; }
      if (had === on(k)) continue;
      if (reducedMotion()) { rect.setAttribute("width", String(want)); continue; }
      sweep(k, want);
    }
    shown.current = Object.fromEntries(surfaces.map((k) => [k, on(k)]));
  });
  useEffect(() => () => { for (const f of Object.values(frames.current)) if (f) cancelAnimationFrame(f); }, []);

  const surf = (k: PictureSurface, shapes: React.ReactNode) => (
    <g key={k} data-surf={k} data-on={on(k) ? "true" : "false"}>
      <g className={TRIM.has(k) ? "trimbase" : "base"}>{shapes}</g>
      <clipPath id={`cp-${id}-${k}`}><rect className="cprect" x="0" y="0" height={H} ref={(el) => { rects.current[k] = el; }} /></clipPath>
      <g clipPath={`url(#cp-${id}-${k})`} fill={k === "walls" ? WALL_TINT[state.colour] : FILL[k]} stroke="#c4cad0" strokeWidth="1">{shapes}</g>
      <g className="roller" ref={(el) => { rollers.current[k] = el; }}><rect x="-6" y="-3" width="12" height="6" rx="2" fill="#0e7f8a" /><rect x="5" y="-1" width="7" height="2" fill="#6b7580" /></g>
    </g>
  );

  const common = {
    className: "wzm-pic", viewBox: `0 0 ${W} ${H}`, xmlns: "http://www.w3.org/2000/svg", "aria-hidden": true as const,
    "data-testid": testId, "data-kind": state.kind, "data-property": state.property, "data-two": state.two ? "true" : "false",
    "data-colour": state.colour, "data-condition": state.condition, "data-painted": painted ? "true" : "false",
  };

  if (state.kind === "room") {
    const walls = <><polygon points="0,0 50,30 50,90 0,120" /><rect x="50" y="30" width="100" height="60" /><polygon points="200,0 150,30 150,90 200,120" /></>;
    const ceil = <polygon points="0,0 200,0 150,30 50,30" />;
    const skirt = <><rect x="50" y="86" width="100" height="4" /><polygon points="0,120 50,90 50,86 0,114" /><polygon points="200,120 150,90 150,86 200,114" /></>;
    const door = <rect x="60" y="48" width="18" height="42" rx="1" />;
    const win = <><rect x="104" y="42" width="34" height="26" rx="1" /><rect x="108" y="46" width="12" height="18" fill="#dbeaf0" stroke="none" /><rect x="122" y="46" width="12" height="18" fill="#dbeaf0" stroke="none" /></>;
    return (
      <svg {...common}>
        <rect width={W} height={H} fill="#eef2f5" />
        <polygon points="0,120 50,90 150,90 200,120" fill="#d9c9b2" />
        {surf("ceilings", ceil)}
        {surf("walls", walls)}
        {state.condition === "needs_work" && (
          <g data-marks="needs_work" stroke="#b9bfc5" strokeWidth=".8" fill="none"><path d="M70,40 l4,6 -2,5 3,6" /><path d="M130,70 l5,-4 3,5" /><path d="M20,60 l4,8" /></g>
        )}
        {state.condition === "wear" && (
          <g data-marks="wear" fill="#c3c9cf"><circle cx="90" cy="60" r="1" /><circle cx="140" cy="50" r="1" /><circle cx="30" cy="70" r="1" /></g>
        )}
        {surf("skirting", skirt)}
        {surf("doors", door)}
        {surf("windows", win)}
        <g><rect x="150" y="84" width="10" height="8" rx="1" fill="#2fd3df" /><rect x="151" y="82" width="8" height="2" fill="#0e7f8a" /></g>
      </svg>
    );
  }

  const unit = state.property === "unit_apartment", th = state.property === "townhouse", two = state.two;
  const top = unit ? 20 : two ? 30 : 60;
  const walls = unit ? <rect x="30" y="20" width="140" height="90" /> : <rect x="40" y={top} width="120" height={110 - top} />;
  const row = (y: number, key: string) => <g key={key}><rect x="56" y={y} width="22" height="16" /><rect x="122" y={y} width="22" height="16" /></g>;
  const wins = unit ? <>{row(30, "a")}{row(56, "b")}{row(82, "c")}</> : <>{row(top + 14, "a")}{two && row(top + 50, "b")}</>;
  const eaves = unit ? <rect x="26" y="21" width="148" height="3" /> : <rect x="34" y={top - 1} width="132" height="4" />;
  const gut = unit
    ? <><rect x="30" y="24" width="3" height="86" /><rect x="167" y="24" width="3" height="86" /></>
    : <><rect x="41" y={top + 3} width="3" height={107 - top} /><rect x="156" y={top + 3} width="3" height={107 - top} /></>;
  const door = unit ? <rect x="92" y="86" width="16" height="24" />
    : th ? <><rect x="84" y="86" width="12" height="24" /><rect x="104" y="86" width="12" height="24" /></>
    : <rect x="92" y="84" width="16" height="26" />;
  const ver = <><rect x="70" y="80" width="60" height="3" /><rect x="72" y="83" width="3" height="27" /><rect x="125" y="83" width="3" height="27" /></>;
  return (
    <svg {...common}>
      <rect width={W} height={H} fill="#eef2f5" />
      <rect y="110" width={W} height="10" fill="#cfdccf" />
      {surf("walls", walls)}
      {unit
        ? <rect x="26" y="16" width="148" height="5" fill="#5b6672" />
        : <><polygon points={`34,${top} 100,${top - 28} 166,${top}`} fill="#5b6672" />{th && <line x1="100" y1={top} x2="100" y2="110" stroke="#c9cfd5" />}</>}
      {unit && <g data-balconies="true"><rect x="52" y="48" width="30" height="2" fill="#aab2ba" /><rect x="118" y="48" width="30" height="2" fill="#aab2ba" /></g>}
      {state.condition === "needs_work" && (
        <g data-marks="needs_work" stroke="#b9bfc5" strokeWidth=".8" fill="none"><path d={`M60,${top + 36} l4,6 -2,5 3,6`} /><path d={`M140,${top + 30} l5,-4 3,5`} /></g>
      )}
      {state.condition === "wear" && (
        <g data-marks="wear" fill="#c3c9cf"><circle cx="48" cy={top + 40} r="1" /><circle cx="150" cy={top + 20} r="1" /><circle cx="100" cy={top + 44} r="1" /></g>
      )}
      {surf("eaves", eaves)}
      {surf("gutters", gut)}
      {surf("windows", wins)}
      {surf("doors", door)}
      {!unit && !th && surf("verandah", ver)}
      <circle cx="18" cy="104" r="9" fill="#9fbfa8" /><circle cx="184" cy="106" r="7" fill="#9fbfa8" />
    </svg>
  );
}

/** The surface's mid-height, for the roller glyph: the base layer's box (a browser without getBBox gets the middle). */
function midY(rect: SVGRectElement): number {
  try {
    const base = rect.closest("[data-surf]")?.querySelector(".base, .trimbase") as SVGGraphicsElement | null;
    const b = base?.getBBox();
    return b ? b.y + b.height / 2 : H / 2;
  } catch { return H / 2; }
}
