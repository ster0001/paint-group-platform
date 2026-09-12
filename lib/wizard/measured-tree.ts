import type { DraftArea } from "@/lib/extract/draft";

/**
 * C15 — THE MEASURED TREE (plan of record §8.3, "measured once, ranged
 * forever"; ⚑34, ⚑56).
 *
 * When an estimator fixes a price, the tree stops being a guess: a person
 * has looked at it and put a number on it. That tree goes to the PROPERTY,
 * and every later quote on that address starts from it — a rebook re-types
 * nothing, and a strata block that needed a visit in year one can be ranged
 * from a desk in year two. C6 wrote the bare blocks array; C15 versions it
 * and records when, by whom and from which estimate, and reads both shapes.
 */

export type MeasuredTree = {
  version: 1;
  blocks: DraftArea[];
  measuredAt: string;
  measuredBy: string | null;
  estimateId: string | null;
};

/** The stored value → a tree, whichever shape wrote it. Null when unusable. */
export function parseMeasuredTree(value: unknown, measuredAt?: string | null): MeasuredTree | null {
  if (Array.isArray(value)) {
    // C6's bare blocks array.
    if (!value.length) return null;
    return { version: 1, blocks: value as DraftArea[], measuredAt: measuredAt ?? "", measuredBy: null, estimateId: null };
  }
  if (value && typeof value === "object") {
    const v = value as Partial<MeasuredTree>;
    if (Array.isArray(v.blocks) && v.blocks.length) {
      return {
        version: 1,
        blocks: v.blocks as DraftArea[],
        measuredAt: typeof v.measuredAt === "string" ? v.measuredAt : (measuredAt ?? ""),
        measuredBy: typeof v.measuredBy === "string" ? v.measuredBy : null,
        estimateId: typeof v.estimateId === "string" ? v.estimateId : null,
      };
    }
  }
  return null;
}

export function makeMeasuredTree(blocks: DraftArea[], by: string | null, estimateId: string, at = new Date()): MeasuredTree {
  return { version: 1, blocks, measuredAt: at.toISOString(), measuredBy: by, estimateId };
}

/** Whole days since the tree was measured; null when the date is unusable. */
export function measuredTreeAgeDays(tree: Pick<MeasuredTree, "measuredAt">, now = new Date()): number | null {
  const t = Date.parse(tree.measuredAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

/** ⚑56: the Settings row `measured_tree_max_age_days` → days; the default is a year. */
export const DEFAULT_MEASURED_TREE_MAX_AGE_DAYS = 365;
export function measuredTreeMaxAgeDays(value: unknown): number {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const raw = typeof v.days === "number" ? v.days : typeof value === "number" ? value : null;
  return raw != null && Number.isFinite(raw) && raw > 0 ? Math.round(raw) : DEFAULT_MEASURED_TREE_MAX_AGE_DAYS;
}

export function measuredTreeIsStale(tree: Pick<MeasuredTree, "measuredAt">, maxAgeDays: number, now = new Date()): boolean {
  const age = measuredTreeAgeDays(tree, now);
  return age == null ? true : age > maxAgeDays;
}

/**
 * The tree as the SEED of a new estimate: the same rooms, surfaces and sizes,
 * renumbered so ids never collide with anything the new estimate adds, with
 * the provenance kept on every node (a measured room stays `human_confirmed`
 * — that is the point) and the exterior sides left out: outside is never
 * seeded from a file (⚑53), it is measured again or briefed.
 */
export function seedFromMeasuredTree(tree: MeasuredTree, nextId: () => number): DraftArea[] {
  const out: DraftArea[] = [];
  for (const a of tree.blocks) {
    if (!a || a.kind !== "area") continue;
    if (a.type === "Exterior") continue;
    const id = nextId();
    out.push({
      ...a,
      id,
      isOption: false,
      surfaces: (a.surfaces ?? []).map((s) => ({ ...s, id: nextId() })),
    });
  }
  return out;
}

/** The last-painted line for an area: the tree's date, in the customer's words. */
export function lastPaintedLabel(tree: Pick<MeasuredTree, "measuredAt">): string {
  const t = Date.parse(tree.measuredAt);
  if (!Number.isFinite(t)) return "date unknown";
  return new Date(t).toLocaleDateString("en-AU", { month: "short", year: "numeric", timeZone: "Australia/Melbourne" });
}
