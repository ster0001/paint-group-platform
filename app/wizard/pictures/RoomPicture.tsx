"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The room, drawn (UI refresh S2, brief §7.2 / §6; components doc §4) — the
 * picture beside the Job and Condition steps. Inline SVG from the mockup's
 * `#room`; no library.
 *
 * Each surface is its own shape carrying `data-s`; a surface being painted
 * takes the class `on` (its fresh fill) and `data-on="1"`, so a spec can read
 * the state without reading colours. On the Condition step the room is shown
 * "today": the marks step up from Good to Needs work and nothing is painted.
 *
 * Decorative: the whole drawing is `aria-hidden`, and every answer it shows
 * is also in the words on the left. The box is a fixed 4:3, so nothing on
 * the page moves when it changes.
 */
export type RoomSurface = "walls" | "ceilings" | "cornices" | "skirting" | "architraves" | "doors" | "windows";

export default function RoomPicture({ painted, today = false, condition = "wear", occupied = false, swatch, highlight = null }: {
  /** The surfaces being painted. */
  painted: readonly string[];
  /** The Condition step: the room as it is now, marks and all. */
  today?: boolean;
  condition?: "good" | "wear" | "needs_work";
  occupied?: boolean;
  /** ⚑ 1 (off by default): a preview wall colour. */
  swatch?: string | null;
  /** The surface the customer just ticked or unticked — outlined for a moment and named in the caption. */
  highlight?: RoomSurface | null;
}) {
  const on = (s: RoomSurface) => !today && painted.includes(s);
  // Cornices ride with the ceiling when a scope does not name them separately.
  const cornice = !today && (painted.includes("cornices") || painted.includes("ceilings"));
  const cls = (s: RoomSurface, extra = "") => `s s-${s === "cornices" ? "cornice" : s === "architraves" ? "arch" : s === "windows" ? "win" : s === "doors" ? "door" : s === "ceilings" ? "ceiling" : s === "walls" ? "wall" : s} ${(s === "cornices" ? cornice : on(s)) ? "on" : ""} ${highlight === s ? "hl" : ""} ${extra}`;
  const dataOn = (s: RoomSurface) => ((s === "cornices" ? cornice : on(s)) ? "1" : "0");

  // The roller sweeps once when the walls go ON (not on every render).
  const wallsOn = on("walls");
  const was = useRef(wallsOn);
  const [sweep, setSweep] = useState(0);
  useEffect(() => {
    if (wallsOn && !was.current) setSweep((n) => n + 1);
    was.current = wallsOn;
  }, [wallsOn]);

  const marks = today ? (condition === "good" ? 1 : condition === "wear" ? 2 : 3) : 0;
  return (
    <svg className="wz-room" viewBox="0 0 400 300" aria-hidden="true" data-testid="pic-room" data-today={today ? "1" : "0"}
      style={swatch ? ({ ["--swatch" as string]: swatch } as React.CSSProperties) : undefined}>
      <polygon className="floor" points="0,300 400,300 310,220 90,220" />
      <polygon className={cls("ceilings")} data-s="ceilings" data-on={dataOn("ceilings")} points="0,0 400,0 310,70 90,70" />
      <polygon className={cls("walls")} data-s="walls" data-on={dataOn("walls")} points="0,0 90,70 90,220 0,300" />
      <polygon className={cls("walls")} data-s="walls" data-on={dataOn("walls")} points="400,0 310,70 310,220 400,300" />
      <rect className={cls("walls")} data-s="walls" data-on={dataOn("walls")} x="90" y="70" width="220" height="150" />
      <polygon className="shade" points="0,0 90,70 90,220 0,300" />
      <polygon className="shade" points="400,0 310,70 310,220 400,300" style={{ opacity: 0.11 }} />
      <g className="marks">
        <g className={marks >= 1 ? "show" : ""}><path d="M240 196q10-3 22 1M28 210q8-5 16 0" stroke="#7E6F50" strokeWidth="2" fill="none" opacity=".55" /><circle cx="196" cy="100" r="1.6" fill="#6B5D43" /><circle cx="182" cy="96" r="1.6" fill="#6B5D43" /></g>
        <g className={marks >= 2 ? "show" : ""}><path d="M300 78l-9 22 5 14-7 20" stroke="#6B5D43" strokeWidth="1.4" fill="none" /><ellipse cx="60" cy="150" rx="9" ry="14" fill="#A99A78" opacity=".6" /><path d="M335 200q12-8 24 0" stroke="#7E6F50" strokeWidth="2.5" fill="none" opacity=".55" /></g>
        <g className={marks >= 3 ? "show" : ""}><path d="M236 84l14 8-4 12 12 6-2 12" stroke="#5B4E38" strokeWidth="1.8" fill="none" /><path d="M150 76q20 14 4 30 22 0 30-14-12-4-34-16z" fill="#EFE8D6" stroke="#8B7B5B" strokeWidth="1" /><path d="M356 60q14 30 4 64" stroke="#8C7A52" strokeWidth="7" fill="none" opacity=".35" /></g>
      </g>
      <polygon className={cls("cornices")} data-s="cornices" data-on={dataOn("cornices")} points="0,0 90,70 90,80 0,13" />
      <polygon className={cls("cornices")} data-s="cornices" data-on={dataOn("cornices")} points="400,0 310,70 310,80 400,13" />
      <rect className={cls("cornices")} data-s="cornices" data-on={dataOn("cornices")} x="90" y="70" width="220" height="10" />
      <polygon className={cls("skirting")} data-s="skirting" data-on={dataOn("skirting")} points="0,300 90,220 90,210 0,285" />
      <polygon className={cls("skirting")} data-s="skirting" data-on={dataOn("skirting")} points="400,300 310,220 310,210 400,285" />
      <rect className={cls("skirting")} data-s="skirting" data-on={dataOn("skirting")} x="90" y="210" width="220" height="10" />
      <path className={cls("architraves")} data-s="architraves" data-on={dataOn("architraves")} d="M108 220V112h64v108h-8V120h-48v100z" />
      <rect className={cls("doors")} data-s="doors" data-on={dataOn("doors")} x="116" y="120" width="48" height="100" />
      <g pointerEvents="none"><rect x="122" y="128" width="36" height="34" fill="none" stroke="#16212A" strokeOpacity=".14" /><rect x="122" y="170" width="36" height="42" fill="none" stroke="#16212A" strokeOpacity=".14" /><circle cx="156" cy="170" r="2.6" fill="#8C97A0" /></g>
      <rect className={cls("windows")} data-s="windows" data-on={dataOn("windows")} x="212" y="102" width="82" height="68" />
      <rect x="219" y="109" width="68" height="54" fill="#BFE3F2" />
      <path d="M219 150q20-14 34-4t34-8v25h-68z" fill="#9CCFA8" opacity=".8" />
      <path className={cls("windows")} data-s="windows" data-on={dataOn("windows")} d="M251 109h4v54h-4z" />
      {occupied && today && (
        <g><ellipse cx="282" cy="262" rx="46" ry="8" fill="#0D161C" opacity=".1" /><rect x="244" y="228" width="78" height="26" rx="8" fill="#E9EEF1" stroke="#16212A" strokeOpacity=".25" /><rect x="238" y="238" width="90" height="22" rx="6" fill="#DCE3E7" stroke="#16212A" strokeOpacity=".25" /></g>
      )}
      <g><ellipse cx="72" cy="268" rx="18" ry="5" fill="#0D161C" opacity=".14" /><rect x="58" y="244" width="28" height="24" rx="2" fill="#E9EEF1" stroke="#16212A" strokeOpacity=".3" /><rect x="58" y="244" width="28" height="7" fill="#3BD8E9" /><path d="M60 244q12-14 24 0" fill="none" stroke="#55636E" strokeWidth="1.6" /></g>
      <g className={`roller ${sweep ? "go" : ""}`} key={sweep}>
        <rect x="92" y="96" width="16" height="62" rx="5" fill="#3BD8E9" stroke="#03272D" strokeOpacity=".4" />
        <path d="M108 127h12v54" fill="none" stroke="#55636E" strokeWidth="3" strokeLinecap="round" />
      </g>
    </svg>
  );
}
