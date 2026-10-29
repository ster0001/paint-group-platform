"use client";

import { useEffect, useState } from "react";
import { EXTERIOR_SIDE_KEYS, type ExteriorSideKey } from "@/lib/wizard/exterior-typicals";
import { MOBILE_SIDE_SHORT } from "@/lib/wizard/mobileScreens";
import type { MobilePictureState, Ribbon } from "@/lib/wizard/mobilePicture";
import MobilePicture from "./pictures/MobilePicture";
import Elevation from "./pictures/Elevation";
import type { ExteriorPart, ExteriorV2 } from "@/lib/wizard/state";
import type { ExteriorTypicalRow } from "@/lib/wizard/exterior-typicals";

/**
 * Wizard mobile v5, session 3 (brief §3) — the live strip under the
 * progress bar: thumbnail 76 × 52 · ribbon · chevron. Tapping it opens a
 * bottom sheet with the same picture full width (5:3), the caption and the
 * same surface chips as the step (§3.4 — one control, two places). The
 * picture is drawn twice from the ONE state the shell passes; each copy
 * animates on its own (MobilePicture). Hidden on the gate — the gate is a
 * different screen (Reveal), so the shell never draws this there.
 */
export type StripChip = { key: string; label: string; on: boolean };

/** Exterior on mobile v5 (plan §3): the drawn house — the thumbnail IS `Elevation`, drawn again full width in the sheet. */
export type StripElevation = {
  v2: ExteriorV2; rows: ReadonlyArray<ExteriorTypicalRow>; side: "front" | "right" | "back" | "left"; caption: string;
  /** S2: a tap on a part in the sheet's picture ticks it (the thumbnail sits in a button, so it is not tappable). */
  onPart?: (part: ExteriorPart) => void;
  /** S4: on the side screens the sheet carries a compass that turns ITS copy of the house (the thumbnail stays on the screen's side). */
  compass?: boolean;
};

export default function MobileStrip({ state, ribbon, chips, onToggle, elevation = null }: {
  state: MobilePictureState;
  /** An outside job with a shape: the drawn house in place of the session-3 placeholder, from the one `v2` state. */
  elevation?: StripElevation | null;
  ribbon: Ribbon;
  /** The sheet's chips; null before there is anything to tick (the caption says so). */
  chips: StripChip[] | null;
  onToggle: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // the compass's own view, valid only for the screen's side it was turned from (a new side screen, or a reopened sheet, starts on the screen's side)
  const [turned, setTurned] = useState<{ side: ExteriorSideKey; from: ExteriorSideKey } | null>(null);
  const screenSide = elevation?.side ?? "front";
  const viewSide = turned && turned.from === screenSide ? turned.side : null;
  const close = () => { setOpen(false); setTurned(null); };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button type="button" className="wzm-strip" data-testid="wzm-strip" onClick={() => setOpen(true)} aria-label={`${ribbon.line1}. ${ribbon.line2}`}>
        <span className="thumb" data-testid="wzm-thumb">
          {elevation ? <Elevation v2={elevation.v2} side={elevation.side} rows={elevation.rows} sweep /> : <MobilePicture state={state} testId="wzm-pic" />}
        </span>
        <span className="txt"><b data-testid="wzm-ribbon-1">{ribbon.line1}</b><span data-testid="wzm-ribbon-2">{ribbon.line2}</span></span>
        <span className="chev" aria-hidden="true" data-testid="wzm-chev">›</span>
      </button>
      {open && (
        <div className="wz-sheetback wzm-sheetback" role="dialog" aria-modal="true" aria-label="Your place" data-testid="wzm-sheet" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="wz-sheet wzm-sheet">
            <button type="button" className="wz-sheet-x" aria-label="Close" onClick={close} data-testid="wzm-sheet-x">×</button>
            <div className="wzm-grab" aria-hidden="true" />
            <div className="wzm-bigpic" data-testid="wzm-bigpic">
              {elevation ? <Elevation v2={elevation.v2} side={viewSide ?? elevation.side} rows={elevation.rows} sweep onPart={elevation.onPart} /> : <MobilePicture state={state} testId="wzm-bigpic-pic" />}
            </div>
            {elevation?.compass && (
              <div className="wzm-compass" data-testid="wzm-compass">
                {EXTERIOR_SIDE_KEYS.map((k) => {
                  const now = (viewSide ?? elevation.side) === k;
                  const sd = elevation.v2.sides[k];
                  return (
                    <button key={k} type="button" aria-pressed={now} data-state={now ? "now" : sd && !sd.paint ? "np" : "off"} data-testid={`wzm-compass-${k}`} onClick={() => setTurned({ side: k, from: screenSide })}>
                      {MOBILE_SIDE_SHORT[k]}
                    </button>
                  );
                })}
              </div>
            )}
            <p className="wzm-cap" data-testid="wzm-cap">
              {elevation ? `${elevation.caption}.${chips ? " Tap a part to paint it in or out." : ""}` : chips ? "Tap a surface to paint it in or out." : "Updates as you answer."}
            </p>
            {chips && (
              <div className="wzm-chips" data-testid="wzm-sheet-chips">
                {chips.map((c) => (
                  <button key={c.key} type="button" className={`wzm-chip ${c.on ? "on" : ""}`} aria-pressed={c.on} data-testid={`wzm-sheet-chip-${c.key}`} onClick={() => onToggle(c.key)}>{c.label}</button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
