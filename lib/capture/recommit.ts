import type { BuilderAreaNode } from "./commit";
import type { SurfaceTile } from "./presets";

/**
 * A5: capture is a VIEW over the area tree, whoever wrote it — wizard, plan
 * reader, builder or capture itself. A recommit of an existing area used to
 * replace the node wholesale, which was fine for capture-born rooms and
 * destructive for everyone else's: builder-only detail (products, colours,
 * rate overrides, photos) vanished, and any priced line whose code has no
 * tile in the room type's rules (a custom line, a staircase) was silently
 * deleted.
 *
 * This merge makes the recommit non-destructive:
 *
 *   1. A new surface inherits the builder-only fields of the old surface
 *      with the same rate code (first unclaimed match): product, colours,
 *      photos, hidden/display flags, and the per-rate pricing overrides.
 *   2. The ABSOLUTE per-line overrides (priceOverride, paintingHrOverride)
 *      carry over only when capture left that surface's quantity untouched —
 *      a re-measured surface must reprice from the new numbers.
 *   3. Old surfaces whose code no tile can produce are appended verbatim —
 *      capture cannot express them, so capture may not delete them.
 *
 * Surfaces the estimator deliberately DESELECTED in capture still go — that
 * is the edit — but only for codes the tile grid actually offers.
 */

type LooseSurface = Record<string, unknown> & { code?: unknown };
type LooseBlock = Record<string, unknown> & { surfaces?: unknown };

const CARRY_ALWAYS = [
  "productName", "color", "colorHex", "media", "hidden",
  "hideQty", "showCoats", "showPrice",
  "rateOverride", "useCustomRate", "customRate",
  "unitPriceOverride", "coverageOverride", "volumeOverride",
] as const;

const CARRY_IF_UNTOUCHED = ["priceOverride", "paintingHrOverride"] as const;

export function mergeRecommittedNode(
  oldBlock: LooseBlock | null | undefined,
  node: BuilderAreaNode,
  tiles: SurfaceTile[],
): BuilderAreaNode {
  if (!oldBlock) return node;

  const oldSurfaces: LooseSurface[] = Array.isArray(oldBlock.surfaces)
    ? (oldBlock.surfaces as LooseSurface[])
    : [];
  const offeredCodes = new Set(tiles.map((t) => t.rateCode).filter(Boolean));

  const claimed = new Set<number>();
  for (const s of node.surfaces) {
    const idx = oldSurfaces.findIndex((o, i) => !claimed.has(i) && String(o.code ?? "") === s.code);
    if (idx < 0) continue;
    claimed.add(idx);
    const o = oldSurfaces[idx];
    const target = s as unknown as Record<string, unknown>;
    for (const field of CARRY_ALWAYS) {
      if (o[field] !== undefined && o[field] !== null && o[field] !== "" && o[field] !== false) {
        target[field] = o[field];
      }
    }
    const untouched =
      Number(o.count ?? 1) === s.count &&
      (o.qtyOverride == null ? s.qtyOverride == null : Number(o.qtyOverride) === s.qtyOverride) &&
      Number(o.coats ?? 2) === s.coats;
    if (untouched) {
      for (const field of CARRY_IF_UNTOUCHED) {
        if (o[field] !== undefined && o[field] !== null) target[field] = o[field];
      }
    }
  }

  // Old lines capture cannot express survive verbatim, ids and all.
  const kept = oldSurfaces.filter((o, i) => {
    if (claimed.has(i)) return false;
    return !offeredCodes.has(String(o.code ?? ""));
  });
  if (kept.length) {
    node.surfaces = [...node.surfaces, ...(kept as unknown as BuilderAreaNode["surfaces"])];
  }

  // Provenance the node type doesn't model but the tree carries.
  const target = node as unknown as Record<string, unknown>;
  if (oldBlock.extractionSourceId !== undefined && target.extractionSourceId === undefined) {
    target.extractionSourceId = oldBlock.extractionSourceId;
  }
  if (Array.isArray(oldBlock.media) && (oldBlock.media as unknown[]).length) {
    target.media = oldBlock.media;
  }
  if (typeof oldBlock.description === "string" && oldBlock.description && !node.description) {
    target.description = oldBlock.description;
  }
  if (oldBlock.isOption === true) target.isOption = true;

  return node;
}
