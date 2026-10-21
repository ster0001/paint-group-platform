"use client";

import { useState } from "react";
import type { ExteriorV2 } from "@/lib/wizard/state";
import { EXTERIOR_SIDE_KEYS, typicalFor, WALL_MATERIALS, type ExteriorSideKey, type ExteriorTypicalRow } from "@/lib/wizard/exterior-typicals";
import {
  confirmSide, paintedSides, partsOnSide, PART_LABEL, setSideCounts, setSideMaterial, setSidePaint,
  sideAddableParts, sideListParts, sideMaterial, toggleSidePart,
} from "@/lib/wizard/exterior-model";
import { WALL_MATERIAL_LABEL } from "./ExteriorAbout";

/**
 * EACH SIDE — "Check each side of the house" (Exterior wizard v2 brief §7.4, S4).
 *
 * Four step tiles (Front · Right · Back · Left) with the picture turned to the
 * current side. Per side: its name and hint; "Not painting this side" (shared
 * sides start that way, with a note, and can be added back); "Painting on this
 * side" — the whole-house parts that land here as chips, each removable, plus
 * "+ Add something on this side" for the rest of the list; "The walls on this
 * side" (downstairs and upstairs on a double storey) with the full material
 * list, tagged Same as the house or Different from the rest; and the window
 * and door counts for the side (Tom, 21 Oct: "+ and − per side" — they were
 * only on the walk-around). Sizes still come after the range (S5).
 *
 * Tom, 21 Oct: there is NO "Looks right — next side" tap. Looking at a side
 * (moving off it) ticks its tile; Continue stands for every painted side
 * (`confirmAllSides` in WizardApp). A side left not painting is not on the
 * estimate at all (Tom, 8 Sep).
 */

export const SIDE_LABEL: Record<ExteriorSideKey, string> = { front: "Front", right: "Right side", back: "Back", left: "Left side" };
export const SIDE_HINT: Record<ExteriorSideKey, string> = { front: "The street side", right: "Looking from the street", back: "The back of the house", left: "Looking from the street" };

/** − n + for a count or a length; shared by Each side (counts) and the walk (counts, metres). */
export function Stepper({ value, onChange, min = 0, max = 60, step = 1, testId, label, unit = "" }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; testId: string; label: string; unit?: string;
}) {
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ""));
  const round = (n: number) => Math.round(n / step) * step;
  return (
    <div className="wz-stepper" data-testid={testId}>
      <button type="button" aria-label={`fewer ${label}`} data-testid={`${testId}-minus`} disabled={value - step < min} onClick={() => onChange(round(Math.max(min, value - step)))}>−</button>
      <span data-testid={`${testId}-n`}>{fmt(value)}{unit}</span>
      <button type="button" aria-label={`more ${label}`} data-testid={`${testId}-plus`} disabled={value + step > max} onClick={() => onChange(round(Math.min(max, value + step)))}>+</button>
    </div>
  );
}

export function sideTileState(v2: ExteriorV2, k: ExteriorSideKey, at: ExteriorSideKey): "cur" | "ok" | "skip" | "todo" {
  const s = v2.sides[k];
  if (s && !s.paint) return "skip";
  if (k === at) return "cur";
  return s?.confirmed ? "ok" : "todo";
}

export default function ExteriorSidesStep({ v2, rows = [], at, onAt, onChange }: {
  v2: ExteriorV2;
  rows?: ReadonlyArray<ExteriorTypicalRow>;
  at: ExteriorSideKey;
  onAt: (k: ExteriorSideKey) => void;
  onChange: (next: ExteriorV2) => void;
}) {
  const t = typicalFor(v2.propertyType, rows);
  const [addOpen, setAddOpen] = useState(false);
  const sd = v2.sides[at];
  const painted = paintedSides(v2);
  // Moving off a side is looking at it: the tile ticks (no separate tap — Tom, 21 Oct).
  const jump = (k: ExteriorSideKey) => {
    setAddOpen(false);
    if (k !== at && sd?.paint && !sd.confirmed) onChange(confirmSide(v2, at));
    onAt(k);
  };

  return (
    <>
      <p className="wz-kick">Each side</p>
      <h1>Check each side of the house</h1>
      <p className="wz-sub">We&rsquo;ve put what you ticked on every side. Tap a side to see it: untick anything that isn&rsquo;t there, add anything that is, count its windows and doors, and say if it&rsquo;s a different material. Then Continue.</p>

      <div className="wz-walk-steps" data-testid="ql-ext-sides">
        {EXTERIOR_SIDE_KEYS.map((k, i) => {
          const st = sideTileState(v2, k, at);
          return (
            <button key={k} type="button" data-state={st} aria-current={k === at ? "step" : undefined} data-testid={`ql-ext-side-${k}`} onClick={() => jump(k)}>
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
              We&rsquo;ll leave the {SIDE_LABEL[at].toLowerCase()} out of the estimate altogether.{sd.shared ? ` It is usually a shared wall on a ${t.name.toLowerCase()}.` : ""}
            </p>
          ) : (
            <>
              <SidePartsAndWalls v2={v2} at={at} rows={rows} onChange={onChange} addOpen={addOpen} onAddOpen={setAddOpen} />
            </>
          )}
        </>
      )}

      {painted.length > 0 && (
        <p className="wz-chint" data-testid="ext-sides-progress" style={{ marginTop: 14 }}>
          {painted.length} side{painted.length === 1 ? "" : "s"} being painted. Sizes come after your range — Continue when the sides look right.
        </p>
      )}
    </>
  );
}

/** "Painting on this side", "The walls on this side" and the window / door counts — shared by Each side (§7.4) and Tighten (§7.6). */
export function SidePartsAndWalls({ v2, at, rows = [], onChange, addOpen, onAddOpen }: {
  v2: ExteriorV2; at: ExteriorSideKey; rows?: ReadonlyArray<ExteriorTypicalRow>; onChange: (next: ExteriorV2) => void;
  addOpen: boolean; onAddOpen: (open: boolean) => void;
}) {
  const t = typicalFor(v2.propertyType, rows);
  const sd = v2.sides[at];
  if (!sd) return null;
  const on = new Set(partsOnSide(v2, at, t));
  const listed = sideListParts(v2, at, t);
  const addable = sideAddableParts(v2, at, t);
  const two = t.storeys === 2;
  const mats = WALL_MATERIALS.map((m) => ({ value: m, label: WALL_MATERIAL_LABEL[m] }));
  const setAddOpen = onAddOpen;
  return (
    <>
              <p className="wz-qhead">Painting on this side<span className="wz-qtag" data-testid="ext-side-count">{listed.filter((p) => on.has(p)).length} of {listed.length}</span></p>
              <div className="wz-chips" data-testid="ext-side-parts">
                {listed.map((p) => (
                  <button key={p} type="button" className={`wz-tile ${on.has(p) ? "on" : "off"}`} aria-pressed={on.has(p)} data-testid={`ext-sidepart-${p}`}
                    onClick={() => onChange(toggleSidePart(v2, at, p, t))}>{PART_LABEL[p]}</button>
                ))}
                <button type="button" className="wz-tile plain" data-testid="ext-side-add-open" aria-expanded={addOpen} onClick={() => setAddOpen(!addOpen)}>
                  {addOpen ? "Done adding" : "+ Add something on this side"}
                </button>
              </div>
              {addOpen && (
                <div className="wz-follow" data-testid="ext-side-add">
                  <p className="wz-q">Add to the {SIDE_LABEL[at].toLowerCase()}</p>
                  <p className="wz-chint" style={{ marginTop: 0 }}>A gable on this side, a porch at the back, a garage round the side — tap to add it; it appears on the picture.</p>
                  <div className="wz-chips">
                    {addable.map((p) => (
                      <button key={p} type="button" className="wz-tile" aria-pressed={false} data-testid={`ext-side-addpart-${p}`}
                        onClick={() => onChange(toggleSidePart(v2, at, p, t))}>{PART_LABEL[p]}</button>
                    ))}
                    {addable.length === 0 && <span className="wz-chint">Everything is already on this side.</span>}
                  </div>
                </div>
              )}

              {on.has("walls") && (
                <div data-testid="ext-side-mat">
                  <p className="wz-qhead">{two ? "Downstairs walls on this side" : "The walls on this side"}
                    <span className="wz-qtag" data-testid="ext-side-mat-tag">{sd.material ? "Different from the rest" : "Same as the house"}</span></p>
                  <div className="wz-chips">
                    {mats.map((o) => {
                      const cur = sideMaterial(v2, at, t) === o.value;
                      return (
                        <button key={o.value} type="button" className={`wz-tile ${cur ? "on" : ""}`} aria-pressed={cur} data-testid={`ext-side-mat-${o.value}`}
                          onClick={() => onChange(setSideMaterial(v2, at, o.value === (v2.wall.down ?? t.usualWalls) ? null : o.value))}>{o.label}</button>
                      );
                    })}
                  </div>
                  {two && (
                    <>
                      <p className="wz-qhead" style={{ marginTop: 12 }}>Upstairs walls on this side
                        <span className="wz-qtag" data-testid="ext-side-matup-tag">{sd.materialUp ? "Different from the rest" : "Same as the house"}</span></p>
                      <div className="wz-chips">
                        {mats.map((o) => {
                          const cur = sideMaterial(v2, at, t, "up") === o.value;
                          const houseUp = v2.wall.up ?? v2.wall.down ?? t.usualWalls;
                          return (
                            <button key={o.value} type="button" className={`wz-tile ${cur ? "on" : ""}`} aria-pressed={cur} data-testid={`ext-side-matup-${o.value}`}
                              onClick={() => onChange(setSideMaterial(v2, at, o.value === houseUp ? null : o.value, "up"))}>{o.label}</button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}

              {(on.has("windows") || on.has("doors")) && (
                <>
                  <p className="wz-qhead">Count them</p>
                  {on.has("windows") && (
                    <div className="wz-countrow" data-testid="ext-win-count">
                      <div className="wz-qtext">Windows on this side<small>Frames and sashes — a rough count is fine</small></div>
                      <Stepper value={sd.windows} onChange={(n) => onChange(setSideCounts(v2, at, { windows: n }))} max={60} testId="ext-win" label="windows" />
                    </div>
                  )}
                  {on.has("doors") && (
                    <div className="wz-countrow" data-testid="ext-door-count">
                      <div className="wz-qtext">Doors on this side<small>{at === "front" ? "Including the front door" : "Any door, painted"}</small></div>
                      <Stepper value={sd.doors} onChange={(n) => onChange(setSideCounts(v2, at, { doors: n }))} max={20} testId="ext-door" label="doors" />
                    </div>
                  )}
                </>
              )}
    </>
  );
}
