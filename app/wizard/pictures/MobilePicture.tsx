"use client";

import { useId } from "react";
import { useRollerSweep } from "./rollerSweep";
import { WALL_TINT, type MobilePictureState, type PictureSurface } from "@/lib/wizard/mobilePicture";
import { layoutOpenings, type QuoteRoomPicture } from "@/lib/quote/roomDrawing";

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
 *
 * Quote stage v10 §4 (S4): with `quote` the room is drawn from the stage's
 * richer room state — the openings laid out by `layoutOpenings` (windows
 * first, then doors, spilling to the side walls, never overlapping; S / M /
 * L resizes), unticked trims NOT drawn, walls grey when not painting and
 * greyed past their share, the robe on the right wall with its doors and
 * inside, the prep marks, the feature-wall tint. Each opening is its own
 * sweep key, so an added door rolls in on its own (rollerSweep: a new key
 * sweeps). The same component draws the tile, the sheet and (S6) the rail.
 */
const W = 200, H = 120;

const FILL: Record<PictureSurface, string> = {
  walls: "", ceilings: "#fafaf8", skirting: "#ffffff", doors: "#ffffff", windows: "#ffffff", eaves: "#ffffff", gutters: "#f4f4f2", verandah: "#ffffff",
};
const TRIM = new Set<PictureSurface>(["skirting", "doors", "windows", "eaves", "gutters", "verandah"]);


const SKEW_L = "skewY(31)", SKEW_R = "translate(200,0) skewY(-31) translate(-200,0)";
const PREP_COLOUR = { crack: "#9aa4ae", hole: "#b7bfc7", flaking: "#b7bfc7", water: "#d8d2c4", mould: "#8a9a8c", wallpaper: "#b7bfc7" } as const;

export default function MobilePicture({ state, quote = null, testId = "wzm-pic" }: { state: MobilePictureState; quote?: QuoteRoomPicture | null; testId?: string }) {
  const id = useId().replace(/:/g, "");
  const painted = state.painted;
  const openings = quote ? layoutOpenings(quote.doors, quote.windows, quote.winSize, quote.robe != null) : [];
  const quoteKeys: string[] = quote
    ? ["ceilings", "walls", ...(quote.cornices ? ["cornices"] : []), ...(quote.skirting ? ["skirting"] : []), ...(quote.architraves && quote.doors > 0 ? ["architraves"] : []),
      ...(quote.robe ? ["robeinside", "robedoors"] : []), ...openings.map((o) => o.key)]
    : [];
  const quoteOn = (k: string) => {
    if (!quote) return false;
    if (k === "walls") return quote.wallsPct != null;
    if (k === "ceilings") return quote.ceiling;
    if (k === "robeinside") return quote.robe?.inside === true;
    if (k === "robedoors") return quote.robe?.doors === true;
    return true; // a trim or an opening is only in the list when it is painted
  };
  const on = (k: string) => (quote ? quoteOn(k) : Boolean(painted?.[k as PictureSurface]));
  const surfaces: string[] = quote ? quoteKeys : state.kind === "room" ? ["ceilings", "walls", "skirting", "doors", "windows"] : ["walls", "eaves", "gutters", "windows", "doors", ...(state.property === "house" ? ["verandah"] : [])];
  // S6: the sweep is shared with the desktop room (rollerSweep.ts).
  const { rectRef, rollerRef } = useRollerSweep<string>(surfaces, on, W, H);

  const layer = (k: string, shapes: React.ReactNode, trim: boolean, fill: string, extra: Record<string, string> = {}) => (
    <g key={k} data-surf={k} data-on={on(k) ? "true" : "false"} {...extra}>
      <g className={trim ? "trimbase" : "base"}>{shapes}</g>
      <clipPath id={`cp-${id}-${k}`}><rect className="cprect" x="0" y="0" height={H} ref={rectRef(k)} /></clipPath>
      <g clipPath={`url(#cp-${id}-${k})`} fill={fill} stroke="#c4cad0" strokeWidth="1">{shapes}</g>
      <g className="roller" ref={rollerRef(k)}><rect x="-6" y="-3" width="12" height="6" rx="2" fill="#0e7f8a" /><rect x="5" y="-1" width="7" height="2" fill="#6b7580" /></g>
    </g>
  );
  const surf = (k: PictureSurface, shapes: React.ReactNode) => layer(k, shapes, TRIM.has(k), k === "walls" ? WALL_TINT[state.colour] : FILL[k]);

  const common = {
    className: "wzm-pic", viewBox: `0 0 ${W} ${H}`, xmlns: "http://www.w3.org/2000/svg", "aria-hidden": true as const,
    "data-testid": testId, "data-kind": state.kind, "data-property": state.property, "data-two": state.two ? "true" : "false",
    "data-colour": state.colour, "data-condition": state.condition, "data-painted": painted ? "true" : "false",
  };

  if (state.kind === "room" && quote) {
    const walls = <><polygon points="0,0 50,30 50,90 0,120" /><rect x="50" y="30" width="100" height="60" /><polygon points="200,0 150,30 150,90 200,120" /></>;
    const ceil = <polygon points="0,0 200,0 150,30 50,30" />;
    const corn = <><rect x="50" y="29" width="100" height="2.5" /><polygon points="0,0 50,30 50,32.5 0,2.5" /><polygon points="200,0 150,30 150,32.5 200,2.5" /></>;
    const skirt = <><rect x="50" y="86" width="100" height="4" /><polygon points="0,120 50,90 50,86 0,114" /><polygon points="200,120 150,90 150,86 200,114" /></>;
    const tf = (wall: "back" | "left" | "right") => (wall === "left" ? SKEW_L : wall === "right" ? SKEW_R : undefined);
    const pct = quote.wallsPct ?? 0;
    return (
      <svg {...common} data-quote="true" data-doors={quote.doors} data-windows={quote.windows} data-win-size={quote.winSize} data-walls-pct={quote.wallsPct ?? "none"}
        data-robe={quote.robe ? `${quote.robe.doors ? "doors" : ""}${quote.robe.inside ? "inside" : ""}` || "none" : "no"} data-feature={quote.featureWall ? "true" : "false"} data-prep={quote.prep.join(" ")}>
        <rect width={W} height={H} fill="#eef2f5" />
        <polygon points="0,120 50,90 150,90 200,120" fill="#d9c9b2" />
        {layer("ceilings", ceil, false, "#fafaf8")}
        {layer("walls", walls, false, WALL_TINT[state.colour])}
        {quote.featureWall && <polygon data-feature-wall="true" points="0,0 50,30 50,90 0,120" fill="#f5e1dc" opacity=".9" />}
        {quote.wallsPct != null && pct < 100 && <rect data-walls-rest="true" x={50 + pct} y="30" width={100 - pct} height="60" fill="#e4e8ec" stroke="#cfd5db" />}
        <g data-prep-marks="true">
          {quote.prep.map((k, n) => {
            const px = 60 + (n % 3) * 28, py = 40 + Math.floor(n / 3) * 20 + (n % 2) * 6, c = PREP_COLOUR[k];
            if (k === "crack") return <path key={k} data-prep={k} d={`M${px},${py} l4,6 -2,5 3,6`} stroke={c} strokeWidth=".9" fill="none" />;
            if (k === "hole") return <circle key={k} data-prep={k} cx={px} cy={py + 6} r="2.2" fill={c} />;
            if (k === "flaking") return <path key={k} data-prep={k} d={`M${px},${py} l5,2 -3,4 5,2`} stroke={c} fill="none" />;
            if (k === "water") return <ellipse key={k} data-prep={k} cx={px + 3} cy={py + 4} rx="7" ry="4" fill={c} opacity=".8" />;
            if (k === "mould") return <g key={k} data-prep={k} fill={c}><circle cx={px} cy={py} r="1.4" /><circle cx={px + 4} cy={py + 3} r="1.2" /><circle cx={px + 1} cy={py + 5} r="1" /></g>;
            return <path key={k} data-prep={k} d={`M${px},${py} q3,3 0,6 q-3,3 0,6`} stroke={c} fill="none" />;
          })}
        </g>
        {quote.cornices && layer("cornices", corn, true, "#ffffff")}
        {quote.skirting && layer("skirting", skirt, true, "#ffffff")}
        {quote.robe && layer("robeinside", <polygon points="152,34 190,12 190,118 152,88" />, false, "#f3f1ea")}
        {quote.robe && layer("robedoors", <><polygon points="154,36 170,27 170,96 154,87" /><polygon points="172,26 188,17 188,106 172,96" /></>, true, "#ffffff")}
        {quote.architraves && quote.doors > 0 && layer("architraves", <>{openings.filter((o) => o.kind === "door").map((o) => (
          <g key={o.key} transform={tf(o.wall)}><rect x={o.x - 2} y={o.y - 2} width={o.w + 4} height="2" /><rect x={o.x - 2} y={o.y - 2} width="2" height={o.h + 2} /><rect x={o.x + o.w} y={o.y - 2} width="2" height={o.h + 2} /></g>
        ))}</>, true, "#ffffff")}
        {openings.map((o) => o.kind === "door"
          ? layer(o.key, <rect x={o.x} y={o.y} width={o.w} height={o.h} rx="1" transform={tf(o.wall)} />, true, "#ffffff", { "data-kind": "door", "data-wall": o.wall })
          : layer(o.key, <g transform={tf(o.wall)}><rect x={o.x} y={o.y} width={o.w} height={o.h} rx="1" /><rect x={o.x + 2} y={o.y + 2} width={o.w / 2 - 3} height={o.h - 4} fill="#dbeaf0" stroke="none" /><rect x={o.x + o.w / 2 + 1} y={o.y + 2} width={o.w / 2 - 3} height={o.h - 4} fill="#dbeaf0" stroke="none" /></g>, true, "#ffffff", { "data-kind": "win", "data-wall": o.wall }))}
        <g><rect x="60" y="84" width="10" height="8" rx="1" fill="#2fd3df" /><rect x="61" y="82" width="8" height="2" fill="#0e7f8a" /></g>
      </svg>
    );
  }

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

