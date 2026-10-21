"use client";

import { exteriorV2Schema, type ExteriorV2 } from "@/lib/wizard/state";
import { EXTERIOR_SHAPE_KEYS, typicalFor, type ExteriorShapeKey, type ExteriorTypicalRow, type SizeBand } from "@/lib/wizard/exterior-typicals";
import { defaultSides, reseedSides } from "@/lib/wizard/exterior-model";
import { TypeThumb } from "./pictures/Elevation";

/**
 * YOUR HOME — "What kind of home is it?" (Exterior wizard v2 brief §7.1, S2).
 *
 * Nine shape cards with their own silhouette, then the rough size, then — for
 * a shape that usually shares walls — where it is in the row. Tapping a shape
 * draws the full house in the picture card; the size scales it; the row
 * answer draws a dashed "next door" on each shared side and starts those
 * sides as not painting. Nothing here is a material: that is asked for the
 * ticked walls on About it (S3). Continue needs a shape and a size.
 *
 * Presentational: the answers live on `exterior.v2` through the quick look's
 * `onOutside({ v2 })`, so a reload restores them like everything else.
 */

/** The words on the cards — the mockup's; the sizes and shapes themselves are the typicals. */
export const SHAPE_HINT: Record<ExteriorShapeKey, string> = {
  wb: "Single storey, hipped roof",
  cal: "Gables, deep eaves, front verandah",
  brick: "Walls usually left bare",
  ds: "Two levels",
  th: "Two storeys, shares a wall or two",
  unit: "Single storey, shares a wall",
  terrace: "Parapet, iron lace, tall windows",
  modern: "Flat or skillion roof, mixed cladding",
  other: "Or not sure — we draw a plain house",
};

export const SIZE_OPTIONS: ReadonlyArray<{ value: SizeBand; label: string; hint: string }> = [
  { value: "sm", label: "Small", hint: "Up to 120 m² · 2 bedrooms" },
  { value: "md", label: "Medium", hint: "120–200 m² · 3 bedrooms" },
  { value: "lg", label: "Large", hint: "200–300 m² · 4 bedrooms" },
  { value: "xl", label: "Very large", hint: "Over 300 m²" },
  { value: "ns", label: "Not sure", hint: "We size it from the type" },
];

/** A fresh house of this shape, keeping a size already picked. */
export function houseOfShape(shape: ExteriorShapeKey, prev: ExteriorV2 | null | undefined, rows: ReadonlyArray<ExteriorTypicalRow>): ExteriorV2 {
  const t = typicalFor(shape, rows);
  const base = exteriorV2Schema.parse({
    propertyType: shape,
    sizeBand: prev?.sizeBand ?? null,
    rowPosition: t.sharedSides.length ? "mid" : null,
    postKind: t.verandah === "lace" ? "lace" : t.verandah === "columns" ? "columns" : null,
    sides: {},
  });
  return { ...base, sides: defaultSides(base, rows) };
}

export default function ExteriorHomeStep({ v2, rows = [], onChange }: {
  v2: ExteriorV2 | null;
  rows?: ReadonlyArray<ExteriorTypicalRow>;
  onChange: (next: ExteriorV2) => void;
}) {
  const t = v2 ? typicalFor(v2.propertyType, rows) : null;
  const pickShape = (shape: ExteriorShapeKey) => {
    if (v2?.propertyType === shape) return;
    onChange(houseOfShape(shape, v2, rows));
  };
  const pickSize = (sizeBand: SizeBand) => {
    if (!v2) return;
    const next = { ...v2, sizeBand };
    onChange({ ...next, sides: reseedSides(next, rows) });
  };
  const pickRow = (rowPosition: NonNullable<ExteriorV2["rowPosition"]>) => {
    if (!v2) return;
    const next = { ...v2, rowPosition };
    onChange({ ...next, sides: reseedSides(next, rows) });
  };
  const one = t ? t.sharedSides.length === 1 : false;
  return (
    <>
      <p className="wz-kick">Outside</p>
      <h1>What kind of home is it?</h1>
      <p className="wz-sub">Tap the closest shape. We draw it, and you tell us what&rsquo;s being painted and what it&rsquo;s made of next.</p>

      <div className="wz-shapes" data-testid="ql-ext-type">
        {EXTERIOR_SHAPE_KEYS.map((k) => {
          const on = v2?.propertyType === k;
          return (
            <button key={k} type="button" className={`wz-shape ${on ? "on" : ""}`} aria-pressed={on} data-testid={`ql-ext-type-${k}`} onClick={() => pickShape(k)}>
              <TypeThumb shape={k} rows={rows} />
              <b>{typicalFor(k, rows).name}</b>
              <small>{SHAPE_HINT[k]}</small>
            </button>
          );
        })}
      </div>

      {v2 && (
        <div data-testid="ext-size-q">
          <p className="wz-qhead">About how big is it?</p>
          <p className="wz-hint">The floor area, roughly. Bedrooms are a fine guide.</p>
          <div className="wz-chips" data-testid="ql-ext-size">
            {SIZE_OPTIONS.map((o) => (
              <button key={o.value} type="button" className={`wz-tile ${v2.sizeBand === o.value ? "on" : ""}`} aria-pressed={v2.sizeBand === o.value}
                data-testid={`ql-ext-size-${o.value}`} onClick={() => pickSize(o.value)}>
                {o.label}<span className="wz-tilesub">{o.hint}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {v2 && t && t.sharedSides.length > 0 && (
        <div data-testid="ext-endof-q">
          <p className="wz-qhead">Where is it in the row?</p>
          <p className="wz-hint">
            A {t.name.toLowerCase()} usually shares {one ? `a wall on the ${t.sharedSides[0]}` : "both side walls"}. An end one has a side wall we can paint.
          </p>
          <div className="wz-chips" data-testid="ql-ext-row">
            <button type="button" className={`wz-tile ${v2.rowPosition === "mid" ? "on" : ""}`} aria-pressed={v2.rowPosition === "mid"} data-testid="ql-ext-row-mid" onClick={() => pickRow("mid")}>
              {one ? `Shares the ${t.sharedSides[0]} wall` : "In the middle of the row"}{!one && <span className="wz-tilesub">shares both sides</span>}
            </button>
            {t.sharedSides.includes("left") && (
              <button type="button" className={`wz-tile ${v2.rowPosition === "left" ? "on" : ""}`} aria-pressed={v2.rowPosition === "left"} data-testid="ql-ext-row-left" onClick={() => pickRow("left")}>
                End of the row — left side open
              </button>
            )}
            {t.sharedSides.includes("right") && (
              <button type="button" className={`wz-tile ${v2.rowPosition === "right" ? "on" : ""}`} aria-pressed={v2.rowPosition === "right"} data-testid="ql-ext-row-right" onClick={() => pickRow("right")}>
                End of the row — right side open
              </button>
            )}
            <button type="button" className={`wz-tile ${v2.rowPosition === "both" ? "on" : ""}`} aria-pressed={v2.rowPosition === "both"} data-testid="ql-ext-row-both" onClick={() => pickRow("both")}>
              Stands alone<span className="wz-tilesub">all four sides</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
