import type { ExteriorV2 } from "@/lib/wizard/state";
import { EXTERIOR_SIDE_KEYS } from "@/lib/wizard/exterior-typicals";
import { exteriorV2Nodes, paintedSides, SIDE_NODE_NAME } from "@/lib/wizard/exterior-model";
import { SIDE_LABEL } from "./ExteriorSides";

/**
 * The range screen's rows (Exterior wizard v2 brief §7.5, S4): one per painted
 * side — `w × h m · what was counted` — and one for around the house, read off
 * the SAME tree the price was built from (`exteriorV2Nodes`, pure), so the
 * words can never disagree with the number. No money per row: the range is
 * one figure (the envelope); the rows say what is in it. S5 marks a checked
 * side.
 */
export default function ExteriorRangeRows({ v2 }: { v2: ExteriorV2 }) {
  let n = 1;
  const { areas } = exteriorV2Nodes(v2, () => n++);
  const painted = paintedSides(v2);
  const extras = areas.find((a) => a.name === "Exterior - Extras");
  const words = (codes: string[]) => {
    const seen = new Map<string, number>();
    for (const c of codes) seen.set(c, (seen.get(c) ?? 0) + 1);
    return [...seen.entries()].map(([c, k]) => (k > 1 ? `${k} × ${c.toLowerCase()}` : c.toLowerCase())).join(", ");
  };
  return (
    <div className="wz-ext-rows" data-testid="ext-range">
      {painted.map((k) => {
        const s = v2.sides[k]!;
        const a = areas.find((x) => x.name === SIDE_NODE_NAME[k]);
        const counted = a ? a.surfaces.map((x) => (x.count > 1 ? `${x.count} ${x.clientLabel}` : x.clientLabel)) : [];
        return (
          <div className="wz-ext-row" key={k} data-testid={`ext-range-${k}`}>
            <div>
              <b>{SIDE_LABEL[k]}{s.checked && <span className="wz-tag">checked</span>}</b>
              <small>{s.w} × {s.h} m · {counted.length ? words(counted) : "nothing ticked"}{s.cond ? ` · ${s.cond}` : ""}</small>
            </div>
          </div>
        );
      })}
      {extras && (
        <div className="wz-ext-row" data-testid="ext-range-extras">
          <div><b>Around the house</b><small>{words(extras.surfaces.map((x) => x.clientLabel))}</small></div>
        </div>
      )}
    </div>
  );
}

/** What the number does not carry (brief §4): scaffolding or a lift, rotten timber, and shingles until a row exists (⚑ 4). */
export function notInThisNumber(v2: ExteriorV2): string {
  const bits = ["scaffolding or a lift", "rotten timber replacement"];
  if (v2.parts.includes("gable") && v2.gableFill === "shingles") bits.push("the shingles (priced by your estimator)");
  if (EXTERIOR_SIDE_KEYS.some((k) => v2.sides[k]?.add.includes("gable")) && v2.gableFill === "shingles" && !bits.includes("the shingles (priced by your estimator)")) bits.push("the shingles (priced by your estimator)");
  return bits.join(", ");
}
