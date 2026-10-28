"use client";

import { useId, type ReactNode } from "react";
import { useRollerSweep } from "./rollerSweep";

/**
 * The room, drawn (UI refresh S2, brief §7.2 / §6; components doc §4) — the
 * picture beside the Job and Condition steps. Inline SVG from the mockup's
 * `#room`; no library.
 *
 * Wizard mobile v5, session 6 (brief §6, D14): every surface is now TWO
 * layers — the room as it is today underneath, and the painted surface on
 * top clipped by a rect the roller sweeps in when the surface's chip is
 * ticked and wipes back when it is unticked (`rollerSweep.ts`, the same
 * mechanic as the phone's picture; reduced motion snaps). The painted
 * shapes keep `data-s`, `data-on` and `data-bold`, so a spec reads the state
 * as it always has. On the Condition step the room is shown "today": the
 * marks step up from Good to Needs work and nothing is painted.
 *
 * Decorative: the whole drawing is `aria-hidden`, and every answer it shows
 * is also in the words on the left. The box is a fixed 4:3, so nothing on
 * the page moves when it changes.
 */
export type RoomSurface = "walls" | "ceilings" | "cornices" | "skirting" | "architraves" | "doors" | "windows";
const SURFACES: RoomSurface[] = ["ceilings", "walls", "cornices", "skirting", "architraves", "doors", "windows"];
const W = 400, H = 300;

export default function RoomPicture({ painted, bold = [], today = false, condition = "wear", occupied = false, swatch, highlight = null }: {
  /** The surfaces being painted. */
  painted: readonly string[];
  /** Tom, 25 Oct 2026 (item 2): the surfaces going much lighter or bold — painted DEEP BLUE, so the tick is visible in the picture. */
  bold?: readonly string[];
  /** The Condition step: the room as it is now, marks and all. */
  today?: boolean;
  condition?: "good" | "wear" | "needs_work";
  occupied?: boolean;
  /** ⚑ 1 (off by default): a preview wall colour. */
  swatch?: string | null;
  /** The surface the customer just ticked or unticked — outlined for a moment and named in the caption. */
  highlight?: RoomSurface | null;
}) {
  const id = useId().replace(/:/g, "");
  // Cornices ride with the ceiling when a scope does not name them separately.
  const on = (s: RoomSurface) => !today && (s === "cornices" ? painted.includes("cornices") || painted.includes("ceilings") : painted.includes(s));
  const isBold = (s: RoomSurface) => on(s) && bold.includes(s);
  const short = (s: RoomSurface) => (s === "cornices" ? "cornice" : s === "architraves" ? "arch" : s === "windows" ? "win" : s === "doors" ? "door" : s === "ceilings" ? "ceiling" : s === "walls" ? "wall" : s);
  const { rectRef, rollerRef } = useRollerSweep(SURFACES, on, W, H);

  /** One surface: the base (today) underneath, the painted layer clipped by the roller's rect on top, the glyph. */
  const layer = (s: RoomSurface, shapes: (cls: string, attrs?: Record<string, string>) => ReactNode) => {
    const paintedCls = `s s-${short(s)} on ${isBold(s) ? "bold" : ""} ${highlight === s ? "hl" : ""}`;
    const attrs = { "data-s": s, "data-on": on(s) ? "1" : "0", "data-bold": isBold(s) ? "1" : "0" };
    return (
      <g key={s} data-surf={s} data-on={on(s) ? "true" : "false"}>
        <g className="rl-base">{shapes(`s s-${short(s)} ${highlight === s && !on(s) ? "hl" : ""}`)}</g>
        <clipPath id={`rp-${id}-${s}`}><rect className="cprect" x="0" y="0" height={H} ref={rectRef(s)} /></clipPath>
        <g className="rl-paint" clipPath={`url(#rp-${id}-${s})`}>{shapes(paintedCls, attrs)}</g>
        <g className="roller" ref={rollerRef(s)}>
          <rect x="-7" y="-26" width="14" height="52" rx="4" fill="#3BD8E9" stroke="#03272D" strokeOpacity=".4" />
          <path d="M7 0h10v44" fill="none" stroke="#55636E" strokeWidth="3" strokeLinecap="round" />
        </g>
      </g>
    );
  };

  const marks = today ? (condition === "good" ? 1 : condition === "wear" ? 2 : 3) : 0;
  return (
    <svg className="wz-room" viewBox={`0 0 ${W} ${H}`} aria-hidden="true" data-testid="pic-room" data-today={today ? "1" : "0"} data-bold-count={today ? 0 : SURFACES.filter(isBold).length}
      style={swatch ? ({ ["--swatch" as string]: swatch } as React.CSSProperties) : undefined}>
      <polygon className="floor" points="0,300 400,300 310,220 90,220" />
      {layer("ceilings", (c, a) => <polygon className={c} {...a} points="0,0 400,0 310,70 90,70" />)}
      {layer("walls", (c, a) => (
        <>
          <polygon className={c} {...a} points="0,0 90,70 90,220 0,300" />
          <polygon className={c} {...a} points="400,0 310,70 310,220 400,300" />
          <rect className={c} {...a} x="90" y="70" width="220" height="150" />
        </>
      ))}
      <polygon className="shade" points="0,0 90,70 90,220 0,300" />
      <polygon className="shade" points="400,0 310,70 310,220 400,300" style={{ opacity: 0.11 }} />
      <g className="marks">
        <g className={marks >= 1 ? "show" : ""}><path d="M240 196q10-3 22 1M28 210q8-5 16 0" stroke="#7E6F50" strokeWidth="2" fill="none" opacity=".55" /><circle cx="196" cy="100" r="1.6" fill="#6B5D43" /><circle cx="182" cy="96" r="1.6" fill="#6B5D43" /></g>
        <g className={marks >= 2 ? "show" : ""}><path d="M300 78l-9 22 5 14-7 20" stroke="#6B5D43" strokeWidth="1.4" fill="none" /><ellipse cx="60" cy="150" rx="9" ry="14" fill="#A99A78" opacity=".6" /><path d="M335 200q12-8 24 0" stroke="#7E6F50" strokeWidth="2.5" fill="none" opacity=".55" /></g>
        <g className={marks >= 3 ? "show" : ""}><path d="M236 84l14 8-4 12 12 6-2 12" stroke="#5B4E38" strokeWidth="1.8" fill="none" /><path d="M150 76q20 14 4 30 22 0 30-14-12-4-34-16z" fill="#EFE8D6" stroke="#8B7B5B" strokeWidth="1" /><path d="M356 60q14 30 4 64" stroke="#8C7A52" strokeWidth="7" fill="none" opacity=".35" /></g>
      </g>
      {layer("cornices", (c, a) => (
        <>
          <polygon className={c} {...a} points="0,0 90,70 90,80 0,13" />
          <polygon className={c} {...a} points="400,0 310,70 310,80 400,13" />
          <rect className={c} {...a} x="90" y="70" width="220" height="10" />
        </>
      ))}
      {layer("skirting", (c, a) => (
        <>
          <polygon className={c} {...a} points="0,300 90,220 90,210 0,285" />
          <polygon className={c} {...a} points="400,300 310,220 310,210 400,285" />
          <rect className={c} {...a} x="90" y="210" width="220" height="10" />
        </>
      ))}
      {layer("architraves", (c, a) => <path className={c} {...a} d="M108 220V112h64v108h-8V120h-48v100z" />)}
      {layer("doors", (c, a) => <rect className={c} {...a} x="116" y="120" width="48" height="100" />)}
      <g pointerEvents="none"><rect x="122" y="128" width="36" height="34" fill="none" stroke="#16212A" strokeOpacity=".14" /><rect x="122" y="170" width="36" height="42" fill="none" stroke="#16212A" strokeOpacity=".14" /><circle cx="156" cy="170" r="2.6" fill="#8C97A0" /></g>
      {layer("windows", (c, a) => (
        <>
          <rect className={c} {...a} x="212" y="102" width="82" height="68" />
          <rect x="219" y="109" width="68" height="54" fill="#BFE3F2" />
          <path d="M219 150q20-14 34-4t34-8v25h-68z" fill="#9CCFA8" opacity=".8" />
          <path className={c} {...a} d="M251 109h4v54h-4z" />
        </>
      ))}
      {occupied && today && (
        <g><ellipse cx="282" cy="262" rx="46" ry="8" fill="#0D161C" opacity=".1" /><rect x="244" y="228" width="78" height="26" rx="8" fill="#E9EEF1" stroke="#16212A" strokeOpacity=".25" /><rect x="238" y="238" width="90" height="22" rx="6" fill="#DCE3E7" stroke="#16212A" strokeOpacity=".25" /></g>
      )}
      <g><ellipse cx="72" cy="268" rx="18" ry="5" fill="#0D161C" opacity=".14" /><rect x="58" y="244" width="28" height="24" rx="2" fill="#E9EEF1" stroke="#16212A" strokeOpacity=".3" /><rect x="58" y="244" width="28" height="7" fill="#3BD8E9" /><path d="M60 244q12-14 24 0" fill="none" stroke="#55636E" strokeWidth="1.6" /></g>
    </svg>
  );
}
