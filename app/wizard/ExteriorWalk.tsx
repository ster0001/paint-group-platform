"use client";

import { useState } from "react";
import type { ExteriorV2 } from "@/lib/wizard/state";
import { EXTERIOR_SIDE_KEYS, scaledLengths, typicalFor, type ExteriorSideKey, type ExteriorTypicalRow } from "@/lib/wizard/exterior-typicals";
import {
  allSidesChecked, canCheckSide, checkSide, nextUncheckedSide, paintedSides, setSideCond, setSidePaint, setSideSize,
} from "@/lib/wizard/exterior-model";
import { EXT_CONDITIONS } from "@/lib/wizard/exterior-quick-look";
import { SIDE_HINT, SIDE_LABEL, SidePartsAndWalls, Stepper } from "./ExteriorSides";

/**
 * TIGHTEN — the walk around the house (Exterior wizard v2 brief §7.6, S5).
 *
 * After the guide range: the same four tiles and the same per-side lists as
 * Each side (§7.4) — with the window and door counts, now on both — plus whether
 * the typical size looks right (or adjust it, or not sure — ⚑ 13), and how
 * the paint is holding up on this side (⚑ 1). "Check this side" turns the
 * tile and moves to the next unchecked side; it waits for the size answer
 * (acceptance 11). When every painted side is checked, the done card and
 * "See my range" — which re-prices the estimate from the drawn house and
 * returns to the range reading Detailed.
 */

export function walkTileState(v2: ExteriorV2, k: ExteriorSideKey, at: ExteriorSideKey): "cur" | "ok" | "skip" | "todo" {
  const s = v2.sides[k];
  if (s && !s.paint) return "skip";
  if (k === at) return "cur";
  return s?.checked ? "ok" : "todo";
}

export default function ExteriorWalkStep({ v2, rows = [], at, onAt, onChange, onDone, onBack, busy = false }: {
  v2: ExteriorV2;
  rows?: ReadonlyArray<ExteriorTypicalRow>;
  at: ExteriorSideKey;
  onAt: (k: ExteriorSideKey) => void;
  onChange: (next: ExteriorV2) => void;
  /** "See my range" — every painted side checked. */
  onDone: () => void;
  onBack: () => void;
  busy?: boolean;
}) {
  const t = typicalFor(v2.propertyType, rows);
  const [addOpen, setAddOpen] = useState(false);
  const sd = v2.sides[at];
  const painted = paintedSides(v2);
  const done = painted.filter((k) => v2.sides[k]?.checked).length;
  const all = allSidesChecked(v2);
  const typical = scaledLengths(t, v2.sizeBand ?? "ns");
  const typicalW = at === "front" || at === "back" ? typical.frontM : typical.sideM;
  const jump = (k: ExteriorSideKey) => { setAddOpen(false); onAt(k); };
  const check = () => {
    const next = checkSide(v2, at);
    onChange(next);
    setAddOpen(false);
    const after = nextUncheckedSide(next, at);
    if (after) onAt(after);
  };

  return (
    <>
      <p className="wz-kick">Tighten</p>
      <h1>Walk around the house</h1>
      <p className="wz-sub">One side at a time: count the windows and doors, check the size, and say how the paint is holding up. Each side you check turns the range to Detailed.</p>

      <div className="wz-walk-steps" data-testid="ext-walk-steps">
        {EXTERIOR_SIDE_KEYS.map((k, i) => {
          const st = walkTileState(v2, k, at);
          return (
            <button key={k} type="button" data-state={st} aria-current={k === at ? "step" : undefined} data-testid={`ext-side-${k}`} onClick={() => jump(k)}>
              <span className="n">{st === "skip" ? "–" : st === "ok" ? "✓" : i + 1}</span>
              <span className="l">{SIDE_LABEL[k].replace(" side", "")}</span>
            </button>
          );
        })}
      </div>

      {sd && (
        <>
          <div className="wz-sidehead">
            <div>
              <h2 data-testid="ext-side-name">{SIDE_LABEL[at]}</h2>
              <p>{SIDE_HINT[at]}{sd.shared ? " · usually a shared wall" : ""}</p>
            </div>
            <button type="button" className={`wz-notpaint ${!sd.paint ? "on" : ""}`} aria-pressed={!sd.paint} data-testid="ext-side-np"
              onClick={() => onChange(setSidePaint(v2, at, !sd.paint))}>
              {!sd.paint ? "Not painting · tap to add" : "Not painting this side"}
            </button>
          </div>

          {!sd.paint ? (
            <p className="wz-chint" data-testid="ext-side-np-note" style={{ marginTop: 14 }}>
              We&rsquo;ll leave the {SIDE_LABEL[at].toLowerCase()} out of the estimate altogether.
            </p>
          ) : (
            <>
              <SidePartsAndWalls v2={v2} at={at} rows={rows} onChange={onChange} addOpen={addOpen} onAddOpen={setAddOpen} />

              <p className="wz-qhead">The size
                <span className="wz-qtag" data-testid="ext-size-tag">{sd.adjusted ? "Your numbers" : `Typical for a ${t.name.toLowerCase()}`}</span>
              </p>
              <p className="wz-hint" data-testid="ext-size-line"><b>{sd.w} m</b> across × <b>{sd.h} m</b> high{!sd.adjusted && sd.w !== typicalW ? "" : ""}.</p>
              <div className="wz-chips" data-testid="ext-size-answer">
                <button type="button" className={`wz-tile ${sd.size === "yes" ? "on" : ""}`} aria-pressed={sd.size === "yes"} data-testid="ext-size-yes" onClick={() => onChange(setSideSize(v2, at, "yes"))}>Looks right<span className="wz-tilesub">keeps these numbers</span></button>
                <button type="button" className={`wz-tile ${sd.size === "adj" ? "on" : ""}`} aria-pressed={sd.size === "adj"} data-testid="ext-size-adj" onClick={() => onChange(setSideSize(v2, at, "adj", { w: sd.w, h: sd.h }))}>Adjust it<span className="wz-tilesub">type your own, to the half metre</span></button>
                <button type="button" className={`wz-tile ${sd.size === "ns" ? "on" : ""}`} aria-pressed={sd.size === "ns"} data-testid="ext-size-ns" onClick={() => onChange(setSideSize(v2, at, "ns"))}>Not sure<span className="wz-tilesub">keeps the typical, checked on the visit</span></button>
              </div>
              {sd.size === "adj" && (
                <div className="wz-follow" data-testid="ext-size-adjust">
                  <div className="wz-countrow">
                    <div className="wz-qtext">Across<small>metres, to the half metre</small></div>
                    <Stepper value={sd.w} onChange={(w) => onChange(setSideSize(v2, at, "adj", { w }))} min={0.5} max={60} step={0.5} testId="ext-dim-w" label="metres across" unit=" m" />
                  </div>
                  <div className="wz-countrow">
                    <div className="wz-qtext">High<small>to the gutter, metres</small></div>
                    <Stepper value={sd.h} onChange={(h) => onChange(setSideSize(v2, at, "adj", { h }))} min={1} max={12} step={0.3} testId="ext-dim-h" label="metres high" unit=" m" />
                  </div>
                </div>
              )}

              <p className="wz-qhead">How&rsquo;s the paint on this side?</p>
              <div className="wz-chips" data-testid="ext-cond">
                {EXT_CONDITIONS.map((o) => (
                  <button key={o.value} type="button" className={`wz-tile ${sd.cond === o.value ? "on" : ""}`} aria-pressed={sd.cond === o.value} data-testid={`ext-cond-${o.value}`}
                    onClick={() => onChange(setSideCond(v2, at, o.value))}>{o.label}{o.hint && <span className="wz-tilesub">{o.hint}</span>}</button>
                ))}
              </div>

              <div style={{ marginTop: 16 }}>
                <button type="button" className={`wz-btn wz-bs2 ${sd.checked ? "on" : ""}`} data-testid="ext-check-side" disabled={!canCheckSide(v2, at)} onClick={check}>
                  {sd.checked ? "Checked ✓ — next side" : "Check this side"}
                </button>
                {!canCheckSide(v2, at) && <p className="wz-chint" data-testid="ext-check-why">Answer the size first — Looks right, Adjust it or Not sure.</p>}
              </div>
            </>
          )}
        </>
      )}

      {all ? (
        <div className="wz-done-card" data-testid="ext-walk-done">
          <span className="av" aria-hidden="true">✓</span>
          <span>All {painted.length} side{painted.length === 1 ? "" : "s"} checked. See your range — it now reads from what you counted.</span>
        </div>
      ) : painted.length > 0 ? (
        <p className="wz-chint" data-testid="ext-walk-progress" style={{ marginTop: 12 }}>{done} of {painted.length} sides checked.</p>
      ) : null}

      <div className="wz-nav wz-nav--col">
        <button type="button" className="wz-btn wz-btxt" onClick={onBack} data-testid="ext-walk-back">Back to my range</button>
        <button type="button" className="wz-btn wz-bp wz-bpaint" disabled={!all || busy} data-testid="ext-see-range" onClick={onDone}>
          {busy ? "Working it out…" : "See my range"}
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12M11 5l5 5-5 5" /></svg>
        </button>
      </div>
    </>
  );
}
