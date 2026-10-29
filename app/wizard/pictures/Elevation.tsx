import { useId, useLayoutEffect, useMemo, useRef, type CSSProperties, type MouseEvent } from "react";
import { useRollerSweep } from "./rollerSweep";
import { EXTERIOR_PARTS, type ExteriorPart, type ExteriorV2 } from "@/lib/wizard/state";
import {
  EXTERIOR_SIDE_KEYS, typicalFor, type ExteriorShapeKey, type ExteriorSideKey, type ExteriorTypical, type ExteriorTypicalRow, type WallMaterial,
} from "@/lib/wizard/exterior-typicals";
import { defaultSidesForPart, partExists, partsOnSide, postCount } from "@/lib/wizard/exterior-model";

/**
 * THE ELEVATION — one side of the drawn house (Exterior wizard v2 brief §8,
 * S2), ported from the mockup's `elevation()` and `typeThumb()`, which are
 * deliberately plain JS that builds SVG markup from numbers. This keeps that
 * shape: `elevationMarkup()` returns the inner SVG for a side as a string
 * (every value interpolated is a number, a fixed word or a pattern id —
 * never customer text), and the component injects it into one `<svg>`.
 *
 * Two scales — `sx` across (fits the width) and `sy` up (fits the height, and
 * does not change with the width) — so adjusting a side visibly changes its
 * shape without shrinking the house (Tom, 21 Oct). Every part is `<g class="e e-<part>"
 * data-e data-on>` in the mockup's colour layering (walls light cyan, gable
 * cyan, roofline deep teal, openings teal; stain brown for vertical timber;
 * greys when not painting). Materials are SVG patterns. Roof shapes: hip
 * (trapezoid), gable (triangle + fill on the gable sides), parapet with
 * cornice, dentils, pediment and chimney pots, skillion. `aria-hidden`,
 * decorative; the caption beside it says the same in words.
 */

const C = { stain: "#A4683F", line: "#9AA7B1", roof: "#5E6E79", roof2: "#4A5964", glass: "#CFE3EA", ground: "#C9D6CC", timber: "#B79C78" } as const;
const ON: Record<string, string> = { walls: "#8EE4F0", gable: "#3BD8E9", fascias: "#0E9FB4", gutters: "#0A7C8E", eaves: "#2BBCD0", downpipes: "#0A7C8E", windows: "#0E9FB4", doors: "#0A7C8E", garage: "#3BD8E9", verandah: "#0E9FB4", posts: "#0E9FB4", ceiling: "#8EE4F0", handrail: "#0A7C8E", shutters: "#0A7C8E" };
const OFF: Record<string, string> = { walls: "#E3E8EC", ceiling: "#E3E8EC", gable: "#DCE2E6" };
const col = (k: string, on: boolean) => (on ? ON[k] ?? "#3BD8E9" : OFF[k] ?? "#C9D2D8");

/** The pattern id for a wall material. */
const PAT: Record<WallMaterial, string> = { weatherboards: "boards", render: "render", brick: "brick", stucco: "stucco", cement_sheet: "sheet", colorbond: "colorbond", vertical_timber: "vtimber", concrete: "concrete" };

function pattern(mat: string, id: string): string {
  switch (mat) {
    case "boards": return `<pattern id="${id}" width="8" height="7" patternUnits="userSpaceOnUse"><path d="M0 6.5H8" stroke="#16212A" stroke-opacity=".22"/></pattern>`;
    case "brick": return `<pattern id="${id}" width="14" height="8" patternUnits="userSpaceOnUse"><path d="M0 .5H14M0 4.5H14M4 .5V4.5M11 4.5V8" stroke="#16212A" stroke-opacity=".2" fill="none"/></pattern>`;
    case "render": return `<pattern id="${id}" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".5" fill="#16212A" fill-opacity=".10"/></pattern>`;
    case "stucco": return `<pattern id="${id}" width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r=".9" fill="#16212A" fill-opacity=".16"/><circle cx="3.8" cy="3.6" r=".6" fill="#16212A" fill-opacity=".12"/></pattern>`;
    case "sheet": return `<pattern id="${id}" width="26" height="26" patternUnits="userSpaceOnUse"><path d="M25.5 0V26M0 25.5H26" stroke="#16212A" stroke-opacity=".22"/></pattern>`;
    case "colorbond": return `<pattern id="${id}" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M1.5 0V5" stroke="#16212A" stroke-opacity=".22" stroke-width="1.6"/></pattern>`;
    case "vtimber": return `<pattern id="${id}" width="7" height="7" patternUnits="userSpaceOnUse"><path d="M3.5 0V7" stroke="#16212A" stroke-opacity=".25" stroke-width="2"/></pattern>`;
    case "concrete": return `<pattern id="${id}" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M39.5 0V40" stroke="#16212A" stroke-opacity=".25"/></pattern>`;
    case "shingles": return `<pattern id="${id}" width="10" height="6" patternUnits="userSpaceOnUse"><path d="M0 5.5h10M5 0v5.5" stroke="#16212A" stroke-opacity=".25" fill="none"/></pattern>`;
    case "strap": return `<pattern id="${id}" width="20" height="14" patternUnits="userSpaceOnUse"><path d="M10 0V14" stroke="#16212A" stroke-opacity=".35" stroke-width="2.5"/></pattern>`;
    case "lace": return `<pattern id="${id}" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.6" fill="none" stroke="#16212A" stroke-opacity=".45" stroke-width=".8"/></pattern>`;
    default: return "";
  }
}
const PATTERNS = ["boards", "brick", "render", "stucco", "sheet", "colorbond", "vtimber", "concrete", "shingles", "strap", "lace"];
const DEFS = `<defs>${PATTERNS.map((m) => pattern(m, `p-${m}`)).join("")}</defs>`;

const n2 = (v: number) => Math.round(v * 100) / 100;

export type ElevationOptions = {
  /** Draw the around-the-house extras too (the build view). */
  build?: boolean;
  /** The part just tapped — outlined for a moment. */
  highlight?: string | null;
  rows?: ReadonlyArray<ExteriorTypicalRow>;
  /**
   * Exterior on mobile v5 (S2) — THE ROLLER ON THE DRAWN HOUSE: every part is
   * two layers, its grey base and its painted copy clipped by a `rect.cprect`
   * the sweep (rollerSweep.ts) drives, plus a roller glyph; the value is the
   * clip-path id prefix (unique per rendered copy). The markup then carries
   * no on/off state at all — the component applies `data-on` and the clip
   * widths — so a tick never rebuilds it.
   */
  sweep?: string;
  /** Internal (sweep): draw every part as if on (the painted layer) or off (the base). */
  forceOn?: boolean;
};

/** The sweep's roller glyph, at the leading edge of a painted layer. */
const ROLLER = `<g class="roller"><rect x="-8" y="-4" width="16" height="8" rx="2" fill="#0e7f8a"/><rect x="7" y="-1.5" width="9" height="3" fill="#6b7580"/></g>`;
const SENTINEL = /<!--p:([a-z]+)-->([\s\S]*?)<!--\/p:\1-->/g;

/** Sweep mode: the base (all off) with each part's painted copy (all on) laid over it, clipped — in place, so the drawing order is the base's. */
function layerForSweep(base: string, painted: string, prefix: string): string {
  const ons = Array.from(painted.matchAll(SENTINEL)).map((m) => m[2]);
  let i = 0;
  return base.replace(SENTINEL, (_m, k: string, innerBase: string) => {
    const innerOn = ons[i] ?? innerBase;
    const id = `cp-${prefix}-${k}-${i++}`;
    return `<g class="base">${innerBase}</g><clipPath id="${id}"><rect class="cprect" x="0" y="0" height="240"/></clipPath><g class="paint" clip-path="url(#${id})">${innerOn}</g>${ROLLER}`;
  });
}

function windowGlyph(x: number, y: number, w: number, h: number, on: boolean, type: ExteriorV2["windowType"]): string {
  const frame = on ? (type === "alu" ? C.line : ON.windows) : "#C9D2D8";
  const sw = type === "alu" ? 1.2 : Math.max(2, w * 0.09);
  let bars = "";
  // A winder is a plain square window that winds out — drawn like a casement, one mullion, no louvre bars
  // (Tom, 21 Oct: the louvre bars read as colonial squares).
  if (type === "casement" || type === "winder" || type === "unsure") bars = `<path d="M${n2(x + w / 2)} ${n2(y)}V${n2(y + h)}" stroke="${frame}" stroke-width="${n2(sw)}"/>`;
  if (type === "sash") bars = `<path d="M${n2(x)} ${n2(y + h / 2)}H${n2(x + w)}" stroke="${frame}" stroke-width="${n2(sw * 1.4)}"/>`;
  if (type === "colonial") bars = [1 / 3, 2 / 3].map((f) => `<path d="M${n2(x + w * f)} ${n2(y)}V${n2(y + h)}" stroke="${frame}" stroke-width="${n2(sw * 0.7)}"/>`).join("") + [1 / 3, 2 / 3].map((f) => `<path d="M${n2(x)} ${n2(y + h * f)}H${n2(x + w)}" stroke="${frame}" stroke-width="${n2(sw * 0.7)}"/>`).join("");
  return `<rect x="${n2(x)}" y="${n2(y)}" width="${n2(w)}" height="${n2(h)}" fill="${C.glass}" stroke="${frame}" stroke-width="${n2(sw)}"/>${bars}`;
}

/** The inner markup of one elevation (400 × 240). */
export function elevationMarkup(v2: ExteriorV2, side: ExteriorSideKey, opts: ElevationOptions = {}): string {
  if (opts.sweep) return layerForSweep(buildElevation(v2, side, { ...opts, forceOn: false }), buildElevation(v2, side, { ...opts, forceOn: true }), opts.sweep);
  return buildElevation(v2, side, opts);
}

function buildElevation(v2: ExteriorV2, side: ExteriorSideKey, opts: ElevationOptions): string {
  const t = typicalFor(v2.propertyType, opts.rows ?? []);
  const sd = v2.sides[side];
  const w = sd?.w ?? t.frontM, h = sd?.h ?? t.wallHM;
  const notPainting = sd ? !sd.paint : false;
  const on = new Set(partsOnSide(v2, side, t));
  const partOn = (k: string) => opts.forceOn ?? on.has(k as never);
  const has = (k: string) => partExists(v2, side, k as never, t);
  // sweep mode: no state in the markup — the sentinels let layerForSweep pair each part's base with its painted copy
  const g = (k: string, inner: string) => opts.sweep
    ? `<g class="e e-${k}" data-e="${k}" data-surf="${k}"><!--p:${k}-->${inner}<!--/p:${k}--></g>`
    : `<g class="e e-${k} ${partOn(k) ? "on" : ""} ${opts.highlight === k ? "hl" : ""}" data-e="${k}" data-on="${partOn(k) ? 1 : 0}">${inner}</g>`;
  const long = side === "left" || side === "right";
  const fullGable = t.roof === "gable" && !long;
  const terraceFront = t.roof === "parapet" && !long;
  const riseM = fullGable ? (t.gableRiseM ?? 2.2) : terraceFront ? (t.gableRiseM ?? 0.9) : t.roof === "skillion" ? (t.gableRiseM ?? 1.1) : Math.min(2.2, w * 0.2);
  /**
   * Tom, 21 Oct: ONE scale made a wide house a flat one — a very large or a
   * long side came out 36 px high with windows that could not fit, and the
   * right side looked squashed. Two scales now: `sx` (px per metre across)
   * fits the width into the frame; `sy` (px per metre up) fits the wall and
   * roof into the height and does not change with the width. So a bigger
   * house gets wider, not smaller; every side stands the same height; and
   * the openings keep a readable size. A sketch, not a scale drawing.
   */
  const shared = EXTERIOR_SIDE_KEYS.filter((k) => v2.sides[k]?.shared);
  const neighbours = !long && shared.length > 0;
  // Width: 250 px at 10 m, 5.5 px more per metre, inside [150, 316] (280 with a
  // neighbour drawn) — so a bigger house reads bigger without ever leaving the frame.
  const wMax = neighbours ? 280 : 316;
  const sx = Math.min(Math.max(150, Math.min(wMax, 250 + (w - 10) * 5.5)) / w, 46);
  // Height: the shape's wall and its tallest roof fit the frame — the same on
  // every side and at every size, so a long side is never squashed.
  const riseForScale = Math.max(2.2, t.gableRiseM ?? 0);
  const sy = Math.min(168 / (h + riseForScale + 0.6), 52);
  const W = w * sx, H = h * sy, R = riseM * sy;
  const yG = 216, yE = yG - H, x0 = 200 - W / 2, x1 = 200 + W / 2;
  const ov = 10;
  let o = `<rect x="0" y="${yG}" width="400" height="${240 - yG}" fill="${C.ground}"/>`;

  // around-the-house extras (build view only, drawn behind the house)
  if (opts.build) {
    const ex = (k: string) => (v2.extras as readonly string[]).includes(k);
    if (ex("paling_fence")) o += `<g class="x on" data-x="paling_fence"><rect x="4" y="${yG - 40}" width="${n2(Math.max(10, x0 - 14))}" height="40" fill="${C.timber}"/>${Array.from({ length: Math.max(0, Math.floor((x0 - 18) / 8)) }, (_, i) => `<path d="M${n2(10 + i * 8)} ${yG - 40}V${yG}" stroke="#16212A" stroke-opacity=".18"/>`).join("")}</g>`;
    if (ex("picket_fence")) o += `<g class="x on" data-x="picket_fence"><rect x="${n2(x1 + 12)}" y="${yG - 26}" width="${n2(Math.max(10, 388 - x1 - 12))}" height="26" fill="#fff" stroke="#16212A" stroke-opacity=".25"/>${Array.from({ length: Math.max(0, Math.floor((388 - x1 - 12) / 9)) }, (_, i) => `<path d="M${n2(x1 + 16 + i * 9)} ${yG - 30}l3 -5 3 5V${yG}" fill="#fff" stroke="#16212A" stroke-opacity=".3"/>`).join("")}</g>`;
    if (ex("shed")) o += `<g class="x on" data-x="shed"><polygon points="${n2(x1 + 18)},${yG - 40} ${n2(x1 + 48)},${yG - 58} ${n2(x1 + 78)},${yG - 40}" fill="${C.roof}"/><rect x="${n2(x1 + 20)}" y="${yG - 40}" width="56" height="40" fill="#E9EEF1" stroke="#16212A" stroke-opacity=".2"/><rect x="${n2(x1 + 38)}" y="${yG - 26}" width="18" height="26" fill="#55636E"/></g>`;
    if (ex("pergola")) o += `<g class="x on" data-x="pergola"><path d="M${n2(x0 - 70)} ${yG}V${yG - 52}M${n2(x0 - 14)} ${yG}V${yG - 52}" stroke="${C.roof}" stroke-width="5"/><path d="M${n2(x0 - 80)} ${yG - 52}h76M${n2(x0 - 80)} ${yG - 44}h76" stroke="${C.roof}" stroke-width="4"/>${[0, 1, 2, 3, 4].map((i) => `<path d="M${n2(x0 - 66 + i * 13)} ${yG - 60}v16" stroke="${C.roof}" stroke-width="3"/>`).join("")}</g>`;
    if (ex("deck")) o += `<g class="x on" data-x="deck"><rect x="${n2(x0 + W * 0.1)}" y="${yG - 6}" width="${n2(W * 0.8)}" height="7" fill="#B08A5E" stroke="#16212A" stroke-opacity=".25"/>${Array.from({ length: Math.floor((W * 0.8) / 12) }, (_, i) => `<path d="M${n2(x0 + W * 0.1 + 6 + i * 12)} ${yG - 6}v7" stroke="#16212A" stroke-opacity=".2"/>`).join("")}</g>`;
    if (ex("side_gate")) o += `<g class="x on" data-x="side_gate"><rect x="${n2(x0 - ov - 30)}" y="${yG - 44}" width="22" height="44" fill="#F4F6F7" stroke="#16212A" stroke-opacity=".35"/><path d="M${n2(x0 - ov - 26)} ${yG - 40}v36M${n2(x0 - ov - 19)} ${yG - 40}v36M${n2(x0 - ov - 12)} ${yG - 40}v36" stroke="#16212A" stroke-opacity=".2"/></g>`;
    if (ex("wall")) o += `<g class="x on" data-x="wall"><rect x="${n2(x1 + 12)}" y="${yG - 18}" width="${n2(388 - x1 - 12)}" height="18" fill="#E4DED2" stroke="#16212A" stroke-opacity=".2"/><rect x="${n2(x1 + 10)}" y="${yG - 22}" width="${n2(392 - x1 - 12)}" height="5" fill="#C4BBA8"/></g>`;
  }

  // the neighbours, on a shared side (front and back views)
  if (!long) {
    const nb = (x: number) => `<g data-testid="pic-nextdoor"><rect x="${n2(x)}" y="${n2(yE - 6)}" width="46" height="${n2(H + 6)}" fill="#E8EEF1" stroke="#B4C0C8" stroke-dasharray="3 3"/><text x="${n2(x + 23)}" y="${n2(yE + H / 2 + 4)}" text-anchor="middle" font-size="9" fill="#8A96A0" font-family="system-ui">next door</text></g>`;
    const L = side === "front" ? "left" : "right", Rr = side === "front" ? "right" : "left";
    if (shared.includes(L)) o += nb(x0 - ov - 46);
    if (shared.includes(Rr)) o += nb(x1 + ov);
  }

  // roof
  const fas = partOn("fascias"), gut = partOn("gutters"), eav = partOn("eaves");
  const gOn = partOn("gable"), gHas = has("gable");
  const gfillPat = v2.gableFill === "strap" ? "strap" : v2.gableFill === "boards" ? "boards" : v2.gableFill ?? "stucco";
  if (terraceFront) {
    o += `<rect x="${n2(x1 - W * 0.3 - 6)}" y="${n2(yE - R - 18)}" width="7" height="20" fill="${C.roof2}"/><rect x="${n2(x1 - W * 0.3 + 4)}" y="${n2(yE - R - 18)}" width="7" height="20" fill="${C.roof2}"/>`;
    o += g("walls", `<rect x="${n2(x0 - 3)}" y="${n2(yE - R)}" width="${n2(W + 6)}" height="${n2(R + 4)}" fill="${col("walls", partOn("walls"))}"/><rect x="${n2(x0 - 3)}" y="${n2(yE - R)}" width="${n2(W + 6)}" height="${n2(R + 4)}" fill="url(#p-render)"/>`);
    const ped = `<path d="M${n2(200 - W * 0.18)} ${n2(yE - R)} Q200 ${n2(yE - R - 22)} ${n2(200 + W * 0.18)} ${n2(yE - R)} Z" fill="${col("fascias", fas)}" stroke="#16212A" stroke-opacity=".3"/>`;
    const dent = Array.from({ length: Math.floor((W + 6) / 9) }, (_, i) => `<rect x="${n2(x0 - 2 + i * 9)}" y="${n2(yE - R + 8)}" width="4" height="4" fill="#16212A" fill-opacity=".25"/>`).join("");
    o += g("fascias", `<rect x="${n2(x0 - 7)}" y="${n2(yE - R - 4)}" width="${n2(W + 14)}" height="7" fill="${col("fascias", fas)}" stroke="#16212A" stroke-opacity=".3"/>${ped}${dent}<rect x="${n2(x0 - 5)}" y="${n2(yE - R + 16)}" width="${n2(W + 10)}" height="3" fill="${col("fascias", fas)}"/>`);
    o += g("gutters", `<rect x="${n2(x0 - 3)}" y="${n2(yE + 2)}" width="${n2(W + 6)}" height="3" fill="${col("gutters", gut)}" fill-opacity=".9"/>`);
  } else if (fullGable) {
    const apex = yE - R;
    o += `<polygon points="${n2(x0 - ov)},${n2(yE)} 200,${n2(apex)} ${n2(x1 + ov)},${n2(yE)}" fill="${C.roof}"/>`;
    const inset = 9; const gy = yE - inset * 0.6; const gx0 = x0 - ov + inset * 1.6, gx1 = x1 + ov - inset * 1.6; const gapex = apex + inset * 1.9;
    o += g("gable", `<polygon points="${n2(gx0)},${n2(gy)} 200,${n2(gapex)} ${n2(gx1)},${n2(gy)}" fill="${col("gable", gOn)}"/><polygon points="${n2(gx0)},${n2(gy)} 200,${n2(gapex)} ${n2(gx1)},${n2(gy)}" fill="url(#p-${gfillPat})"/>`);
    o += g("fascias", `<path d="M${n2(x0 - ov)} ${n2(yE)}L200 ${n2(apex)}L${n2(x1 + ov)} ${n2(yE)}" fill="none" stroke="${col("fascias", fas)}" stroke-width="5" stroke-linejoin="round"/>`);
    o += g("eaves", `<path d="M${n2(x0 - ov)} ${n2(yE + 3)}L${n2(x0 + 2)} ${n2(yE + 3)}M${n2(x1 - 2)} ${n2(yE + 3)}L${n2(x1 + ov)} ${n2(yE + 3)}" stroke="${col("eaves", eav)}" stroke-width="5"/>`);
  } else {
    const k = t.roof === "skillion" ? 0.08 : 0.26;
    const top = yE - R; const tx0 = x0 - ov + W * k, tx1 = x1 + ov - W * k;
    if (t.roof === "skillion") o += `<polygon points="${n2(x0 - ov)},${n2(yE)} ${n2(x0 - ov + 6)},${n2(top)} ${n2(x1 + ov - 6)},${n2(top + R * 0.45)} ${n2(x1 + ov)},${n2(yE)}" fill="${C.roof}"/>`;
    else o += `<polygon points="${n2(x0 - ov)},${n2(yE)} ${n2(tx0)},${n2(top)} ${n2(tx1)},${n2(top)} ${n2(x1 + ov)},${n2(yE)}" fill="${C.roof}"/>`;
    if (t.roof === "gable" && long) o += `<path d="M${n2(tx0)} ${n2(top)}H${n2(tx1)}" stroke="${C.roof2}" stroke-width="3"/>`;
    if (gHas && t.roof !== "skillion") {
      const gw = W * 0.5, gx0 = 200 - gw / 2, gx1 = 200 + gw / 2, gR = Math.min(R * 1.05, 1.9 * sy); const apex = yE - gR;
      o += `<polygon points="${n2(gx0 - 6)},${n2(yE)} 200,${n2(apex - 4)} ${n2(gx1 + 6)},${n2(yE)}" fill="${C.roof2}"/>`;
      o += g("gable", `<polygon points="${n2(gx0 + 4)},${n2(yE - 3)} 200,${n2(apex + 8)} ${n2(gx1 - 4)},${n2(yE - 3)}" fill="${col("gable", gOn)}"/><polygon points="${n2(gx0 + 4)},${n2(yE - 3)} 200,${n2(apex + 8)} ${n2(gx1 - 4)},${n2(yE - 3)}" fill="url(#p-${gfillPat})"/>`);
      o += g("fascias", `<path d="M${n2(gx0 - 6)} ${n2(yE)}L200 ${n2(apex - 4)}L${n2(gx1 + 6)} ${n2(yE)}" fill="none" stroke="${col("fascias", fas)}" stroke-width="4" stroke-linejoin="round"/>`);
    }
    o += g("fascias", `<rect x="${n2(x0 - ov - 2)}" y="${n2(yE - 1)}" width="${n2(W + ov * 2 + 4)}" height="6" fill="${col("fascias", fas)}" stroke="#16212A" stroke-opacity=".2"/>`);
    o += g("eaves", `<rect x="${n2(x0 - ov)}" y="${n2(yE + 5)}" width="${n2(W + ov * 2)}" height="4" fill="${col("eaves", eav)}"/>`);
    o += g("gutters", `<rect x="${n2(x0 - ov - 4)}" y="${n2(yE - 6)}" width="${n2(W + ov * 2 + 8)}" height="5" rx="2.5" fill="${col("gutters", gut)}" stroke="#16212A" stroke-opacity=".25"/>`);
  }
  if ((v2.propertyType === "wb" || v2.propertyType === "cal") && side === "front") o += `<rect x="${n2(x1 - W * 0.22)}" y="${n2(yE - R - 14)}" width="12" height="${n2(R * 0.7 + 14)}" fill="${C.roof2}"/>`;

  // walls — this side's material, with an optional second material upstairs
  const wOn = partOn("walls");
  const m1: WallMaterial = sd?.material ?? v2.wall.down ?? t.usualWalls;
  const m2: WallMaterial | null = t.storeys === 2 ? (sd?.materialUp ?? v2.wall.up ?? null) : null;
  const wallTop = yE + (terraceFront ? 0 : 8);
  // Vertical timber draws brown only while it is STAINED; "Painted" on About it turns it the painted blue (Tom, 21 Oct).
  const stained = v2.wall.timberPainted !== "yes";
  const wc = (m: WallMaterial) => (wOn ? (m === "vertical_timber" && stained ? C.stain : ON.walls) : OFF.walls);
  let walls = `<rect x="${n2(x0)}" y="${n2(wallTop)}" width="${n2(W)}" height="${n2(yG - wallTop)}" fill="${wc(m1)}"/><rect x="${n2(x0)}" y="${n2(wallTop)}" width="${n2(W)}" height="${n2(yG - wallTop)}" fill="url(#p-${PAT[m1]})"/>`;
  if (m2 && m2 !== m1) { const upH = yE + H / 2 - wallTop; walls += `<rect x="${n2(x0)}" y="${n2(wallTop)}" width="${n2(W)}" height="${n2(upH)}" fill="${wc(m2)}"/><rect x="${n2(x0)}" y="${n2(wallTop)}" width="${n2(W)}" height="${n2(upH)}" fill="url(#p-${PAT[m2]})"/><path d="M${n2(x0)} ${n2(yE + H / 2)}H${n2(x1)}" stroke="#16212A" stroke-opacity=".3"/>`; }
  o += g("walls", walls);
  o += `<rect x="${n2(x0)}" y="${n2(wallTop)}" width="${n2(W)}" height="${n2(yG - wallTop)}" fill="none" stroke="#16212A" stroke-opacity=".28"/>`;
  if (t.storeys === 2) o += `<path d="M${n2(x0)} ${n2(yE + H / 2)}H${n2(x1)}" stroke="#16212A" stroke-opacity=".12"/>`;

  // downpipes
  const dpN = w > 10 ? 2 : 1;
  const dpOn = partOn("downpipes");
  o += g("downpipes", `<rect x="${n2(x1 + ov - 1)}" y="${n2(yE)}" width="4" height="${n2(H)}" fill="${col("downpipes", dpOn)}" stroke="#16212A" stroke-opacity=".25"/>${dpN > 1 ? `<rect x="${n2(x0 - ov - 3)}" y="${n2(yE)}" width="4" height="${n2(H)}" fill="${col("downpipes", dpOn)}" stroke="#16212A" stroke-opacity=".25"/>` : ""}`);

  // verandah — on whichever side has one
  const verHas = has("verandah"), ver = partOn("verandah");
  const garHere = has("garage");
  const vx0 = x0 + W * 0.06; let vx1 = x1 - W * 0.06; if (garHere) vx1 = x1 - W * 0.42;
  const vyTop = yG - Math.min(H - 10, (t.roof === "parapet" ? 2.9 : 2.5) * sy), vFloor = yG - 0.25 * sy;
  const postKind = v2.postKind ?? (t.verandah === "lace" ? "lace" : t.verandah === "columns" ? "columns" : "posts");
  const lace = postKind === "lace";
  /** Where the posts stand — the windows are laid out in the bays between them (Tom, 21 Oct, items 1 and 3). */
  const postXs: number[] = [];
  if (verHas) {
    const pOn = partOn("posts"), cOn = partOn("ceiling"), hOn = partOn("handrail");
    if (lace) {
      o += g("verandah", `<path d="M${n2(vx0 - 10)} ${n2(vyTop)} Q${n2(vx0 - 10)} ${n2(vyTop - 14)} ${n2(vx0)} ${n2(vyTop - 14)} H${n2(vx1)} Q${n2(vx1 + 10)} ${n2(vyTop - 14)} ${n2(vx1 + 10)} ${n2(vyTop)} Z" fill="${C.roof}"/><rect x="${n2(vx0 - 12)}" y="${n2(vyTop - 2)}" width="${n2(vx1 - vx0 + 24)}" height="5" fill="${col("verandah", ver)}" stroke="#16212A" stroke-opacity=".2"/>`);
      o += g("ceiling", `<rect x="${n2(vx0 - 8)}" y="${n2(vyTop + 3)}" width="${n2(vx1 - vx0 + 16)}" height="10" fill="${col("ceiling", cOn)}"/><rect x="${n2(vx0 - 8)}" y="${n2(vyTop + 3)}" width="${n2(vx1 - vx0 + 16)}" height="10" fill="url(#p-lace)"/>`);
    } else {
      o += g("verandah", `<polygon points="${n2(vx0 - 8)},${n2(vyTop)} ${n2(vx0)},${n2(vyTop - 14)} ${n2(vx1)},${n2(vyTop - 14)} ${n2(vx1 + 8)},${n2(vyTop)}" fill="${C.roof}"/><rect x="${n2(vx0 - 10)}" y="${n2(vyTop - 2)}" width="${n2(vx1 - vx0 + 20)}" height="6" fill="${col("verandah", ver)}" stroke="#16212A" stroke-opacity=".2"/>`);
      o += g("ceiling", `<rect x="${n2(vx0 - 6)}" y="${n2(vyTop + 4)}" width="${n2(vx1 - vx0 + 12)}" height="5" fill="${col("ceiling", cOn)}"/>`);
    }
    const n = postCount((vx1 - vx0) / sx / 0.8);
    let posts = "";
    for (let i = 0; i < n; i++) {
      const px = vx0 + ((vx1 - vx0) * i) / (n - 1);
      postXs.push(px);
      if (postKind === "columns") posts += `<rect x="${n2(px - 5)}" y="${n2(vyTop + 8)}" width="10" height="${n2(vFloor - vyTop - 8)}" rx="2" fill="${col("posts", pOn)}" stroke="#16212A" stroke-opacity=".3"/><rect x="${n2(px - 7)}" y="${n2(vFloor - 16)}" width="14" height="16" fill="${pOn ? "#8EE4F0" : "#C9D2D8"}" stroke="#16212A" stroke-opacity=".3"/>`;
      else if (lace) posts += `<rect x="${n2(px - 1.5)}" y="${n2(vyTop + 12)}" width="3" height="${n2(vFloor - vyTop - 12)}" fill="${col("posts", pOn)}" stroke="#16212A" stroke-opacity=".3"/><path d="M${n2(px - 1.5)} ${n2(vyTop + 13)} l-10 0 l10 12 z M${n2(px + 1.5)} ${n2(vyTop + 13)} l10 0 l-10 12 z" fill="${col("posts", pOn)}" fill-opacity=".8"/>`;
      else posts += `<rect x="${n2(px - 2.5)}" y="${n2(vyTop + 8)}" width="5" height="${n2(vFloor - vyTop - 8)}" fill="${col("posts", pOn)}" stroke="#16212A" stroke-opacity=".3"/>`;
    }
    o += g("posts", posts);
    if (has("handrail")) o += g("handrail", `<path d="M${n2(vx0)} ${n2(vFloor - 22)}H${n2(vx1)}" stroke="${col("handrail", hOn)}" stroke-width="3"/>${Array.from({ length: Math.floor((vx1 - vx0) / 9) }, (_, i) => `<path d="M${n2(vx0 + 6 + i * 9)} ${n2(vFloor - 22)}V${n2(vFloor)}" stroke="${col("handrail", hOn)}" stroke-width="1.5"/>`).join("")}`);
    o += `<rect x="${n2(vx0 - 10)}" y="${n2(vFloor)}" width="${n2(vx1 - vx0 + 20)}" height="4" fill="#B6ADA0"/><rect x="${n2(vx0 + 10)}" y="${n2(vFloor + 4)}" width="26" height="${n2(yG - vFloor - 4)}" fill="#B6ADA0" stroke="#16212A" stroke-opacity=".2"/>`;
  }

  // garage
  const garW = garHere ? (v2.garageCars === 2 ? 4.8 : 2.6) * sx : 0;
  const gx = x1 - garW - W * 0.04;
  if (garHere) {
    const gw = garW, gh = Math.min(H - 14, 2.2 * sy);
    o += g("garage", `<rect x="${n2(gx)}" y="${n2(yG - gh)}" width="${n2(gw)}" height="${n2(gh)}" fill="${col("garage", partOn("garage"))}" stroke="#16212A" stroke-opacity=".3"/>${[1, 2, 3].map((i) => `<path d="M${n2(gx)} ${n2(yG - gh + (gh * i) / 4)}H${n2(gx + gw)}" stroke="#16212A" stroke-opacity=".18"/>`).join("")}`);
  }

  // doors
  const dOn = partOn("doors");
  const doorW = 0.9 * sx, doorH = Math.min(H - 14, (t.roof === "parapet" ? 2.4 : 2.04) * sy);
  const nDoors = sd?.doors ?? (side === "front" ? 1 : 0);
  // The front door: the middle of the verandah, else the middle of the wall — and always clear of a garage.
  const doorX = Math.min(verHas ? vx0 + (vx1 - vx0) * (terraceFront ? 0.25 : 0.5) : x0 + W * 0.5, (garHere ? gx : x1) - doorW);
  let doors = "";
  if (nDoors > 0) {
    const dx = doorX - doorW / 2;
    doors += `<rect x="${n2(dx)}" y="${n2(yG - doorH)}" width="${n2(doorW)}" height="${n2(doorH)}" rx="1.5" fill="${col("doors", dOn)}" stroke="#16212A" stroke-opacity=".35"/><circle cx="${n2(dx + doorW * 0.78)}" cy="${n2(yG - doorH * 0.5)}" r="1.6" fill="#16212A" fill-opacity=".5"/>`;
    if (terraceFront) doors += `<rect x="${n2(dx + doorW + 2)}" y="${n2(yG - doorH)}" width="${n2(doorW * 0.35)}" height="${n2(doorH)}" fill="${C.glass}" stroke="${col("doors", dOn)}" stroke-width="1.5"/>`;
    for (let i = 1; i < nDoors; i++) { const ddx = x0 + W * (0.12 + (0.72 * (i % 3)) / 3); doors += `<rect x="${n2(ddx)}" y="${n2(yG - doorH)}" width="${n2(doorW * 0.9)}" height="${n2(doorH)}" rx="1.5" fill="${col("doors", dOn)}" stroke="#16212A" stroke-opacity=".35"/>`; }
  }
  o += g("doors", doors);

  // windows — on every storey, laid out in the wall EITHER SIDE of the door and
  // clear of the garage, so the count always fits (Tom, 21 Oct: they used to
  // be spread over the whole wall and nudged off the door, and fell outside it).
  const wnOn = partOn("windows");
  const n = sd?.windows ?? 2; let wins = "";
  const tall = terraceFront ? 2.2 : t.roof === "skillion" ? 1.6 : 1.5;
  const wwMax = (t.roof === "skillion" ? 1.8 : terraceFront ? 0.9 : 1.2) * sx;
  let ww = wwMax, wh = Math.min(tall * sy, (t.storeys === 2 ? H / 2 : H) * (terraceFront ? 0.66 : 0.58));
  const winRects: Array<{ x: number; y: number; w: number; h: number }> = [];
  const perStorey = t.storeys === 2 ? [Math.ceil(n / 2), Math.floor(n / 2)] : [n];
  perStorey.forEach((cnt, st) => {
    const isGround = st === perStorey.length - 1;
    const yTop = t.storeys === 2 ? (st === 0 ? yE + 8 : yE + H / 2) : wallTop; const lvlH = t.storeys === 2 ? H / 2 : H;
    wh = Math.min(tall * sy, lvlH * (terraceFront ? 0.66 : 0.58));
    const wy = terraceFront ? yG - doorH : yTop + lvlH * 0.32 - wh / 2;
    const place = (from: number, to: number, k: number) => {
      if (k <= 0 || to <= from) return;
      ww = Math.max(4, Math.min(wwMax, ((to - from) / (k + 1)) * 0.74));
      for (let i = 0; i < k; i++) {
        const cx = from + ((to - from) * (i + 1)) / (k + 1);
        const y = isGround && verHas && !terraceFront ? Math.max(wy, vyTop + 14) : wy;
        winRects.push({ x: cx - ww / 2, y, w: ww, h: wh });
        wins += windowGlyph(cx - ww / 2, y, ww, wh, wnOn, v2.windowType);
      }
    };
    if (terraceFront && verHas) { place(vx0 + (vx1 - vx0) * 0.5, vx1, cnt); return; }
    const L = x0 + W * 0.04, Rr = (isGround && garHere ? gx : x1) - W * 0.04;
    // Under a verandah the windows take the bays between the posts (never the
    // door's bay), so posts and windows are spaced together, not on top of each other.
    if (isGround && postXs.length >= 2) {
      const bays: Array<[number, number]> = [];
      for (let i = 0; i + 1 < postXs.length; i++) {
        const a = postXs[i] + 7, b = postXs[i + 1] - 7;
        if (nDoors > 0 && doorX > postXs[i] && doorX < postXs[i + 1]) continue;
        if (b - a >= 6) bays.push([a, b]);
      }
      if (bays.length) {
        for (let i = 0; i < bays.length; i++) place(bays[i][0], bays[i][1], Math.floor(cnt / bays.length) + (i < cnt % bays.length ? 1 : 0));
        return;
      }
    }
    if (isGround && nDoors > 0) {
      const dL = doorX - doorW * 0.9, dR = doorX + doorW * 0.9;
      const minSlot = 6;
      const roomL = dL - L >= minSlot, roomR = Rr - dR >= minSlot;
      if (!roomL && !roomR) place(L, Rr, cnt); // a very small wall: spread them anyway rather than lose any
      else {
        let leftN = Math.ceil(cnt / 2);
        if (!roomR) leftN = cnt; else if (!roomL) leftN = 0;
        place(L, dL, leftN);
        place(dR, Rr, cnt - leftN);
      }
    } else place(L, Rr, cnt);
  });
  o += g("windows", wins);
  // Shutters sit flush against each window, a pair a window (Tom, 21 Oct, item 4).
  if (has("shutters")) {
    const shOn = partOn("shutters");
    o += g("shutters", winRects.map((r) => {
      const sw = Math.max(3, Math.min(7, r.w * 0.32));
      const one = (x: number) => `<rect x="${n2(x)}" y="${n2(r.y)}" width="${n2(sw)}" height="${n2(r.h)}" fill="${col("shutters", shOn)}" stroke="#16212A" stroke-opacity=".3"/><path d="M${n2(x + 1)} ${n2(r.y + r.h * 0.25)}h${n2(sw - 2)}M${n2(x + 1)} ${n2(r.y + r.h * 0.5)}h${n2(sw - 2)}M${n2(x + 1)} ${n2(r.y + r.h * 0.75)}h${n2(sw - 2)}" stroke="#16212A" stroke-opacity=".25"/>`;
      return one(r.x - sw - 1) + one(r.x + r.w + 1);
    }).join(""));
  }

  if (opts.build && (v2.extras as readonly string[]).includes("meter_box")) o += `<g class="x on" data-x="meter_box"><rect x="${n2(x0 + 6)}" y="${n2(yE + H * 0.45)}" width="12" height="15" fill="#F4F6F7" stroke="#16212A" stroke-opacity=".4"/></g>`;
  if (opts.build && (v2.extras as readonly string[]).includes("security_door") && nDoors > 0 && side === "front") o += `<g class="x on" data-x="security_door"><rect x="${n2(doorX - doorW / 2)}" y="${n2(yG - doorH)}" width="${n2(doorW)}" height="${n2(doorH)}" fill="none" stroke="#16212A" stroke-opacity=".5" stroke-dasharray="2 2"/></g>`;
  if (notPainting) o += `<rect x="0" y="0" width="400" height="240" fill="#F2F5F6" fill-opacity=".55"/><text x="200" y="120" text-anchor="middle" font-family="system-ui,sans-serif" font-size="16" font-weight="600" fill="#54626D">Not painting this side</text>`;
  return DEFS + o;
}

/** One elevation of the drawn house, as the picture card draws it. */
export default function Elevation({ v2, side, build = true, highlight = null, rows = [], style, onPart, sweep = false }: {
  v2: ExteriorV2; side: ExteriorSideKey; build?: boolean; highlight?: string | null; rows?: ReadonlyArray<ExteriorTypicalRow>; style?: CSSProperties;
  /** Acceptance 9: tapping a part on the picture ticks the same chip. */
  onPart?: (part: ExteriorPart) => void;
  /** Exterior on mobile v5 (S2): the roller sweep on every part tick (the strip's thumbnail and sheet). */
  sweep?: boolean;
}) {
  const notPainting = v2.sides[side] ? !v2.sides[side]!.paint : false;
  const id = useId().replace(/:/g, "");
  const t = typicalFor(v2.propertyType, rows);
  const onSet = useMemo(() => new Set<string>(partsOnSide(v2, side, t)), [v2, side, t]);
  // Sweep mode: the markup is STRUCTURAL — it follows the shape, size, sides, materials and WHICH parts exist
  // (a gable on a hip roof exists once ticked), never a tick itself; the ticks are the clip widths and `data-on`.
  const existing = useMemo(() => EXTERIOR_PARTS.filter((p) => partExists(v2, side, p, t)), [v2, side, t]);
  const drawV2: ExteriorV2 = sweep ? { ...v2, parts: existing } : v2;
  const drawKey = sweep ? JSON.stringify(drawV2) : v2;
  // Built once per change of its inputs, not on every render of the picture
  // card (its caption timers re-render it with the same house).
  const markup = useMemo(
    () => elevationMarkup(drawV2, side, { build, highlight, rows, sweep: sweep ? id : undefined }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- drawV2 is keyed by drawKey (the structure in sweep mode, the house otherwise)
    [drawKey, side, build, highlight, rows, sweep, id],
  );
  const svgRef = useRef<SVGSVGElement | null>(null);
  useRollerSweep(EXTERIOR_PARTS, (p) => onSet.has(p), 400, 240, sweep ? { root: svgRef, version: markup } : undefined);
  // sweep mode: the on/off state the specs and the styles read, applied to the injected groups on every render
  useLayoutEffect(() => {
    if (!sweep || !svgRef.current) return;
    svgRef.current.querySelectorAll<SVGGElement>("g.e[data-e]").forEach((g) => {
      const isOn = onSet.has(g.dataset.e ?? "");
      g.dataset.on = isOn ? "1" : "0";
      g.classList.toggle("on", isOn);
    });
  });
  const onClick = onPart
    ? (e: MouseEvent<SVGSVGElement>) => {
      const g = (e.target as Element).closest?.("g.e[data-e]") as HTMLElement | null;
      const part = g?.dataset.e;
      if (part && (EXTERIOR_PARTS as readonly string[]).includes(part)) onPart(part as ExteriorPart);
    }
    : undefined;
  return (
    <svg
      ref={svgRef}
      className={`wz-elev ${notPainting ? "np" : ""} ${onPart ? "tappable" : ""} ${sweep ? "sweep" : ""}`} viewBox="0 0 400 240" aria-hidden="true"
      data-testid="pic-outside" data-side={side} data-shape={v2.propertyType} style={style} onClick={onClick}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

// ---------------------------------------------------------------------------
// The small silhouettes on the shape cards (the mockup's typeThumb).
// ---------------------------------------------------------------------------

export function typeThumbMarkup(t: ExteriorTypical): string {
  const two = t.storeys === 2; const H = two ? 44 : 26; const yE = 60 - H;
  let o = `<rect x="0" y="60" width="100" height="4" fill="#C9D6CC"/>`;
  const x0 = t.frontM < 9 ? 30 : 16, x1 = t.frontM < 9 ? 70 : 84; const W = x1 - x0;
  if (t.roof === "gable") o += `<polygon points="${x0 - 6},${yE} 50,${yE - 22} ${x1 + 6},${yE}" fill="#5E6E79"/><polygon points="${x0 + 4},${yE - 2} 50,${yE - 16} ${x1 - 4},${yE - 2}" fill="#DEE4E8"/>`;
  else if (t.roof === "parapet") o += `<rect x="${x0 - 2}" y="${yE - 12}" width="${W + 4}" height="12" fill="#EEF2F5" stroke="#9AA7B1"/><rect x="${x0 - 4}" y="${yE - 14}" width="${W + 8}" height="4" fill="#9AA7B1"/><path d="M${50 - 8} ${yE - 14} Q50 ${yE - 24} ${50 + 8} ${yE - 14}" fill="#9AA7B1"/><rect x="${n2(x0 + W * 0.62)}" y="${yE - 22}" width="3" height="8" fill="#5E6E79"/><rect x="${n2(x0 + W * 0.62 + 5)}" y="${yE - 22}" width="3" height="8" fill="#5E6E79"/>`;
  else if (t.roof === "skillion") o += `<polygon points="${x0 - 6},${yE} ${x0 - 2},${yE - 14} ${x1 + 2},${yE - 6} ${x1 + 6},${yE}" fill="#5E6E79"/>`;
  else o += `<polygon points="${x0 - 6},${yE} ${n2(x0 + W * 0.25)},${yE - 14} ${n2(x1 - W * 0.25)},${yE - 14} ${x1 + 6},${yE}" fill="#5E6E79"/>`;
  const pat = t.usualWalls === "weatherboards" ? "M0 4H100M0 8H100M0 12H100M0 16H100M0 20H100M0 24H100M0 28H100M0 32H100M0 36H100M0 40H100"
    : t.usualWalls === "brick" ? "M0 5H100M0 10H100M0 15H100M0 20H100M0 25H100M0 30H100M0 35H100M0 40H100"
      : t.usualWalls === "cement_sheet" ? "M40 0V60M62 0V60" : "";
  o += `<rect x="${x0}" y="${yE}" width="${W}" height="${H}" fill="${t.wallsPainted ? "#EEF2F5" : "#E6DED3"}" stroke="#9AA7B1"/>`;
  if (pat) o += `<svg x="${x0}" y="${yE}" width="${W}" height="${H}" viewBox="0 0 100 ${H}" preserveAspectRatio="none"><path d="${pat}" stroke="#16212A" stroke-opacity=".18"/></svg>`;
  for (const sh of t.sharedSides) o += `<rect x="${sh === "left" ? x0 - 14 : x1}" y="${yE + 6}" width="14" height="${H - 6}" fill="#E8EEF1" stroke="#B4C0C8" stroke-dasharray="2 2"/>`;
  if (t.verandah !== "none" && t.roof !== "parapet") o += `<rect x="${x0 + 4}" y="${yE + 8}" width="${n2(W * 0.55)}" height="3" fill="#5E6E79"/><path d="M${x0 + 6} ${yE + 11}V60M${n2(x0 + 4 + W * 0.55 - 2)} ${yE + 11}V60" stroke="#9AA7B1" stroke-width="2"/>`;
  if (t.roof === "parapet") o += `<path d="M${x0 - 2} ${yE + 9} Q${x0 - 2} ${yE + 5} ${x0 + 3} ${yE + 5} H${x1 - 3} Q${x1 + 2} ${yE + 5} ${x1 + 2} ${yE + 9}" fill="none" stroke="#5E6E79" stroke-width="2"/><path d="M${x0 + 2} ${yE + 9}V60M${x0 + W / 2} ${yE + 9}V60M${x1 - 2} ${yE + 9}V60" stroke="#9AA7B1" stroke-width="1.2"/><path d="M${x0 + 2} ${yE + 11}H${x1 - 2}" stroke="#9AA7B1" stroke-width="2" stroke-dasharray="1.5 1.5"/>`;
  o += `<rect x="${n2(x0 + W * 0.5 - 4)}" y="${60 - 14}" width="8" height="14" fill="#B4C0C8"/>`;
  if (t.roof === "parapet") o += `<rect x="${n2(x0 + W * 0.68)}" y="${60 - 22}" width="7" height="20" fill="#CFE3EA" stroke="#9AA7B1"/>`;
  else o += `<rect x="${n2(x0 + W * 0.15)}" y="${n2(yE + H * 0.35)}" width="9" height="8" fill="#CFE3EA" stroke="#9AA7B1"/><rect x="${n2(x1 - W * 0.15 - 9)}" y="${n2(yE + H * 0.35)}" width="9" height="8" fill="#CFE3EA" stroke="#9AA7B1"/>`;
  if (two) o += `<rect x="${n2(x0 + W * 0.15)}" y="${n2(yE + H * 0.72)}" width="9" height="8" fill="#CFE3EA" stroke="#9AA7B1"/><rect x="${n2(x1 - W * 0.15 - 9)}" y="${n2(yE + H * 0.72)}" width="9" height="8" fill="#CFE3EA" stroke="#9AA7B1"/>`;
  if (t.key === "other") o += `<text x="50" y="${n2(yE + H * 0.6)}" text-anchor="middle" font-size="18" font-weight="700" fill="#9AA7B1" font-family="system-ui">?</text>`;
  return o;
}

export function TypeThumb({ shape, rows = [] }: { shape: ExteriorShapeKey; rows?: ReadonlyArray<ExteriorTypicalRow> }) {
  const markup = useMemo(() => typeThumbMarkup(typicalFor(shape, rows)), [shape, rows]);
  return <svg viewBox="0 0 100 64" aria-hidden="true" dangerouslySetInnerHTML={{ __html: markup }} />;
}

/** The parts a whole-house tick would land on this side — exported for the S3 screens. */
export { defaultSidesForPart };
