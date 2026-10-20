"use client";

import type { ExteriorV2 } from "@/lib/wizard/state";
import { EXTERIOR_EXTRAS, type ExteriorExtra, type ExteriorPart } from "@/lib/wizard/state";
import { typicalFor, type ExteriorTypicalRow } from "@/lib/wizard/exterior-typicals";
import { EXTRA_LABEL, PART_GROUPS, PART_LABEL, VERANDAH_PARTS, toggleExtra, togglePart } from "@/lib/wizard/exterior-model";

/**
 * PAINTING — "Tap everything we're painting" (Exterior wizard v2 brief §7.2, S3).
 *
 * The parts the house has, in four groups, and the things around it. Nothing
 * is ticked for the customer (C8b); nothing about materials here — a ticked
 * part lights its piece of the picture, and tapping the picture ticks the
 * same chip (acceptance 9). The verandah's posts, ceiling and handrail are
 * offered once the verandah is ticked. Continue needs at least one part or
 * extra. A brick veneer home gets the "tick the walls only if the brick is
 * being painted" hint.
 */

const PART_HINT: Partial<Record<ExteriorPart, string>> = {
  walls: "The walls themselves",
  gable: "The triangle under the roof",
  gutters: "The channel along the roof edge",
  downpipes: "The pipes down the wall",
  eaves: "The underside of the overhang",
  windows: "Frames and sashes",
  doors: "And their frames",
  shutters: "Beside the windows",
  verandah: "Its roof edge and beams",
  posts: "Timber posts or columns",
  ceiling: "The underside of the verandah roof",
  handrail: "Rails and balusters",
};

export default function ExteriorPaintStep({ v2, rows = [], onChange }: {
  v2: ExteriorV2;
  rows?: ReadonlyArray<ExteriorTypicalRow>;
  onChange: (next: ExteriorV2) => void;
}) {
  const t = typicalFor(v2.propertyType, rows);
  const on = (p: ExteriorPart) => v2.parts.includes(p);
  const verandahOn = on("verandah");
  const chip = (p: ExteriorPart) => (
    <button key={p} type="button" className={`wz-tile ${on(p) ? "on" : ""}`} aria-pressed={on(p)} data-testid={`ext-part-${p}`}
      onClick={() => onChange(togglePart(v2, p))}>
      {PART_LABEL[p]}{PART_HINT[p] && <span className="wz-tilesub">{PART_HINT[p]}</span>}
    </button>
  );
  return (
    <>
      <p className="wz-kick">Painting</p>
      <h1>Tap everything we&rsquo;re painting</h1>
      <p className="wz-sub">
        Each part lights up on the picture as you tick it — tap the picture if you like. Nothing is ticked for you: plenty of jobs are the trims and roofline only. What it&rsquo;s made of comes next.
      </p>

      {PART_GROUPS.map((g) => (
        <div key={g.key} data-testid={`ext-group-${g.key}`}>
          <p className="wz-qhead">{g.key === "verandah" && t.verandah !== "none" ? "The verandah" : g.label}</p>
          {g.key === "house" && !t.wallsPainted && (
            <p className="wz-hint" data-testid="ext-brick-hint">Brick is usually left bare — tick the walls only if the brick is being painted.</p>
          )}
          <div className="wz-chips">
            {g.parts.filter((p) => !VERANDAH_PARTS.includes(p) || verandahOn).map(chip)}
          </div>
          {g.key === "verandah" && !verandahOn && <p className="wz-chint">Tick the verandah and we ask about its posts, ceiling and handrail.</p>}
        </div>
      ))}

      <p className="wz-qhead">Around the house</p>
      <p className="wz-hint">Tick all that apply. Sizes come next.</p>
      <div className="wz-chips" data-testid="ext-extras">
        {EXTERIOR_EXTRAS.map((e: ExteriorExtra) => (
          <button key={e} type="button" className={`wz-tile ${v2.extras.includes(e) ? "on" : ""}`} aria-pressed={v2.extras.includes(e)} data-testid={`ext-extra-${e}`}
            onClick={() => onChange(toggleExtra(v2, e))}>
            {EXTRA_LABEL[e]}
          </button>
        ))}
      </div>
    </>
  );
}
