"use client";

import { useState, type ReactNode } from "react";
import type { ExteriorV2 } from "@/lib/wizard/state";
import type { QuickLook } from "@/lib/wizard/quick-look";
import type { ExteriorQuickLook } from "@/lib/wizard/exterior-quick-look";
import { EXTERIOR_SIDE_KEYS, typicalFor, type ExteriorSideKey, type ExteriorTypicalRow } from "@/lib/wizard/exterior-typicals";
import { allSidesChecked, canCheckSide, checkSide, nextUncheckedSide, paintedSides, partsOnSide, setSideCond, setSideCounts, setSideSize } from "@/lib/wizard/exterior-model";
import { EXT_CONDITIONS } from "@/lib/wizard/exterior-quick-look";
import { MOBILE_SIDE_LABEL, MOBILE_SIDE_SHORT, sideStatusLine } from "@/lib/wizard/mobileScreens";
import { elevationCaption, pictureStateFor } from "@/lib/wizard/mobilePicture";
import MobileStrip from "./MobileStrip";

/**
 * EXTERIOR ON MOBILE v5 — session 6 (plan §2 screen 12; prototype `w-*` and
 * `wdone`): TIGHTEN, THE WALK AROUND, on a phone. One screen per painted
 * side, the strip's house turned to it: the window and door counts, the size
 * (Looks right · Adjust it · Not sure — the adjust steppers), how the paint is
 * holding up on this side, and "Check this side", which waits for the size
 * answer (v2 acceptance 11) and moves to the next unchecked side. Every side
 * checked → the done screen and "See my exact price", which is WizardApp's
 * `walkDone` (the whole drawn house re-priced in one action; the gate then
 * reads as the exact-price stage with "change a side"). The answers are the
 * brief's per-side `windows` / `doors` / `size` / `w` / `h` / `cond` /
 * `checked`, written through the desktop walk's own helpers. Desktop keeps
 * its own walk (`ExteriorWalk.tsx`) and the editor; this file renders only
 * under 768px.
 */
export default function MobileWalk({ v2, rows = [], quick, outside, logo, at, onAt, onChange, onDone, onBack, onContactOpen, busy = false, error = null }: {
  v2: ExteriorV2;
  rows?: ReadonlyArray<ExteriorTypicalRow>;
  quick: QuickLook;
  outside: ExteriorQuickLook;
  logo: ReactNode;
  at: ExteriorSideKey;
  onAt: (k: ExteriorSideKey) => void;
  onChange: (next: ExteriorV2) => void;
  /** "See my exact price" — every painted side checked. */
  onDone: () => void;
  /** The back chevron on the first side: back to the range. */
  onBack: () => void;
  onContactOpen: () => void;
  busy?: boolean;
  error?: string | null;
}) {
  const t = typicalFor(v2.propertyType, rows);
  const painted = paintedSides(v2);
  const side: ExteriorSideKey = v2.sides[at]?.paint ? at : painted[0] ?? at;
  const sd = v2.sides[side];
  const all = allSidesChecked(v2);
  const [showDone, setShowDone] = useState(false);
  const done = all && showDone;
  const checked = painted.filter((k) => v2.sides[k]?.checked).length;
  // §2.1: the quote stage carries the bar from 55% to 100%
  const pct = done ? 100 : 55 + Math.round((checked / Math.max(1, painted.length)) * 45);
  const on = new Set(sd ? partsOnSide(v2, side, t) : []);
  // the prototype's rule: Check this side waits for the size AND the paint's condition (the model's gate is the size alone)
  const canCheck = Boolean(sd && canCheckSide(v2, side) && sd.cond != null);
  const COND_WORDS: Record<"good" | "weathered" | "peeling", string> = { good: "Good, just tired", weathered: "Weathered", peeling: "Peeling or flaking" };
  const idx = painted.indexOf(side);

  const check = () => {
    const next = checkSide(v2, side);
    onChange(next);
    const after = nextUncheckedSide(next, side);
    if (after) { onAt(after); window.scrollTo({ top: 0 }); } else setShowDone(true);
  };
  const back = () => {
    if (done) { setShowDone(false); return; }
    if (idx > 0) { onAt(painted[idx - 1]); return; }
    onBack();
  };
  const jump = (k: ExteriorSideKey) => { if (v2.sides[k]?.paint) { setShowDone(false); onAt(k); } };
  const state = (k: ExteriorSideKey) => (!done && k === side ? "now" : v2.sides[k] && !v2.sides[k]!.paint ? "np" : v2.sides[k]?.checked ? "done" : "todo");
  const picture = pictureStateFor(quick, outside, true);
  const stepper = (testId: string, label: string, value: number, set: (n: number) => void, min: number, max: number, step = 1, unit = "") => {
    const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ""));
    const round = (n: number) => Math.round(n / step) * step;
    return (
      <div className="wzm-step" data-testid={testId}>
        <div className="l">{label}{unit && <small>{unit}</small>}</div>
        <div className="stp">
          <button type="button" aria-label={`fewer ${label.toLowerCase()}`} data-testid={`${testId}-minus`} disabled={value - step < min} onClick={() => set(round(Math.max(min, value - step)))}>−</button>
          <b data-testid={`${testId}-n`}>{fmt(value)}</b>
          <button type="button" aria-label={`more ${label.toLowerCase()}`} data-testid={`${testId}-plus`} disabled={value + step > max} onClick={() => set(round(Math.min(max, value + step)))}>+</button>
        </div>
      </div>
    );
  };

  return (
    <div className="wzm wzm-walk" data-testid="ext-walk" data-mobile-screen={done ? "w-done" : `w-${side}`}>
      <header className="wzm-head" data-testid="wzm-head">
        <button type="button" className="wzm-back" aria-label="Back" onClick={back} data-testid="wzm-back">‹</button>
        <span className="wzm-logo">{logo}</span>
        <button type="button" className="wzm-contact" onClick={onContactOpen} data-testid="wzm-contact">Contact</button>
      </header>
      <div className="wzm-bar" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${pct}%` }} data-testid="wzm-bar" /></div>
      <MobileStrip
        state={picture}
        ribbon={{ line1: elevationCaption(v2, rows).split(" · ").slice(0, 2).join(" · "), line2: sideStatusLine(v2, "checked") }}
        chips={null} onToggle={() => {}}
        elevation={{ v2, rows, side, caption: elevationCaption(v2, rows), compass: true }}
      />
      <main className="wzm-main has-bar">
        <section className="wzm-screen" key={done ? "done" : side} data-quick-step="walk">
          {done ? (
            <div className="wzm-walk-done" data-testid="ext-walk-done">
              <span className="wzm-av" aria-hidden="true">✓</span>
              <h1 data-testid="wzm-h1">All {painted.length} side{painted.length === 1 ? "" : "s"} checked</h1>
              <p className="wzm-sub">Your exact price is ready.</p>
            </div>
          ) : sd && (
            <>
              <p className="wzm-stage" data-testid="wzm-stage">Tighten · walk around</p>
              <div className="wzm-sidetabs" data-testid="wzm-sidetabs">
                {EXTERIOR_SIDE_KEYS.map((k) => (
                  <button key={k} type="button" data-state={state(k)} data-testid={`wzm-side-${k}`} disabled={!v2.sides[k]?.paint} onClick={() => jump(k)}>{MOBILE_SIDE_SHORT[k]}</button>
                ))}
              </div>
              <h1 data-testid="wzm-h1">{MOBILE_SIDE_LABEL[side]}</h1>
              <p className="wzm-sub" data-testid="wzm-sub">{sd.w} m across · {sd.h} m high</p>
              {(on.has("windows") || on.has("doors")) && (
                <div className="wzm-steps" data-testid="ext-walk-counts">
                  {on.has("windows") && stepper("ext-win", "Windows", sd.windows, (n) => onChange(setSideCounts(v2, side, { windows: n })), 0, 60)}
                  {on.has("doors") && stepper("ext-door", "Doors", sd.doors, (n) => onChange(setSideCounts(v2, side, { doors: n })), 0, 20)}
                </div>
              )}
              <p className="wzm-qhead" data-testid="ext-size-tag">{sd.adjusted ? "The size — your numbers" : `The size — typical for a ${t.name.toLowerCase()}`}</p>
              <div className="wzm-chips" data-testid="ext-size-answer">
                {([["yes", "Looks right"], ["adj", "Adjust it"], ["ns", "Not sure"]] as const).map(([value, label]) => (
                  <button key={value} type="button" className={`wzm-chip ${sd.size === value ? "on" : ""}`} aria-pressed={sd.size === value} data-testid={`ext-size-${value}`}
                    onClick={() => onChange(setSideSize(v2, side, value, value === "adj" ? { w: sd.w, h: sd.h } : undefined))}>{label}</button>
                ))}
              </div>
              {sd.size === "adj" && (
                <div className="wzm-steps wzm-adjust" data-testid="ext-size-adjust">
                  {stepper("ext-dim-w", "Across", sd.w, (w) => onChange(setSideSize(v2, side, "adj", { w })), 0.5, 60, 0.5, "m")}
                  {stepper("ext-dim-h", "High", sd.h, (h) => onChange(setSideSize(v2, side, "adj", { h })), 1, 12, 0.3, "m, to the gutter")}
                </div>
              )}
              <p className="wzm-qhead">How&rsquo;s the paint on this side?</p>
              <div className="wzm-chips" data-testid="ext-cond">
                {EXT_CONDITIONS.map((o) => (
                  <button key={o.value} type="button" className={`wzm-chip ${sd.cond === o.value ? "on" : ""}`} aria-pressed={sd.cond === o.value} data-testid={`ext-cond-${o.value}`}
                    onClick={() => onChange(setSideCond(v2, side, o.value))}>{COND_WORDS[o.value]}</button>
                ))}
              </div>
              {!canCheck && <p className="wzm-note" data-testid="ext-check-why">{canCheckSide(v2, side) ? "Say how the paint is on this side first." : "Answer the size first — Looks right, Adjust it or Not sure."}</p>}
            </>
          )}
          {error && <div className="wz-err" data-testid="ext-walk-error">{error}</div>}
        </section>
      </main>
      <div className="wzm-foot" data-testid="wzm-foot">
        {done
          ? <button type="button" className="wzm-cta wzm-cta--teal" disabled={busy} onClick={onDone} data-testid="ext-see-range">{busy ? "Working it out…" : "See my exact price"}</button>
          : <button type="button" className="wzm-cta" disabled={!canCheck} onClick={check} data-testid="ext-check-side">{sd?.checked ? "Checked ✓ — next side" : "Check this side"}</button>}
        {!done && <p className="wzm-hint" data-testid="ext-walk-progress">{checked} of {painted.length} sides checked</p>}
      </div>
    </div>
  );
}
