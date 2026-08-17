/**
 * Stage 4: scope mapping. Room type in, surfaces out. No AI.
 *
 * The rules live in the `room_type_scope_rules` and `room_name_aliases` tables
 * (seeded by scripts/seed-extraction-settings.ts from 316 real substrate lines
 * across 11 jobs), not in this file and not in the model. This module is only
 * the machinery that applies them.
 */

export type ScopeRule = {
  room_type: string;
  surface_type: string;
  is_option: boolean;
  requires_confirm: boolean;
  notes: string | null;
};

export type Alias = { alias: string; room_type: string };

/**
 * Our surface names to the ACTIVE RATE CARD's item codes.
 *
 * `Surface.code` in the builder is the rate item's `code`, which on rate card
 * v7 is a human string ("Walls", "Standard Cornices"). Anything not mapped here
 * is not generated: an unpriceable surface in a draft is worse than a missing
 * one, because it looks priced.
 */
export const SURFACE_TO_RATE_CODE: Record<string, string> = {
  "Walls": "Walls",
  "Ceiling": "Ceilings",
  "Cornices": "Standard Cornices",
  "Skirting Boards": "Skirting Boards",
  "Door & Frame": "Flat Door and Frame (1 Side)",
  "Windows": "Awning / Casement Window",
  "Architrave": "Architrave (1 Side)",
};

/** Surfaces priced per item — the count comes from the plan's symbols. */
export const COUNTED_SURFACES = new Set(["Door & Frame", "Windows", "Architrave"]);

/** Normalise a room name to a type, using the alias table. */
export function resolveRoomType(nameOnPlan: string | null, aliases: Alias[]): string {
  const raw = (nameOnPlan ?? "").trim().toLowerCase();
  if (!raw) return "unknown";

  const map = new Map(aliases.map((a) => [a.alias.toLowerCase(), a.room_type]));

  // Exact match first: "dining kitchen" must not be caught by "kitchen".
  const exact = map.get(raw);
  if (exact) return exact;

  // Then strip a trailing number — "Bedroom 3", "Bath 2" — which is how most
  // real names differ from the alias.
  const numberless = raw.replace(/\s*\d+\s*$/, "").trim();
  const byNumberless = map.get(numberless);
  if (byNumberless) return byNumberless;

  // Then the longest alias contained in the name, so "walk in robe" wins over
  // "robe" and "dining kitchen" over "kitchen".
  let best: { alias: string; type: string } | null = null;
  for (const [alias, type] of map) {
    if (raw.includes(alias) && (!best || alias.length > best.alias.length)) best = { alias, type };
  }
  return best?.type ?? "unknown";
}

export type PlannedSurface = {
  surfaceType: string;
  rateCode: string;
  /** Per-item surfaces carry a count from the plan; area surfaces are sized by geometry. */
  count: number;
  isOption: boolean;
  requiresConfirm: boolean;
  reason: string;
};

/**
 * What to generate for one room. Counted surfaces take their count from what
 * the model saw on the plan; a room with no doors drawn gets no door line
 * rather than an assumed one.
 */
export function planSurfaces(
  roomType: string,
  counts: { doors: number; windows: number; openings: number },
  rules: ScopeRule[],
): PlannedSurface[] {
  if (roomType === "unknown" || roomType === "excluded" || roomType === "exterior_excluded") return [];

  const forType = rules.filter((r) => r.room_type === roomType);
  const out: PlannedSurface[] = [];

  for (const rule of forType) {
    const rateCode = SURFACE_TO_RATE_CODE[rule.surface_type];
    if (!rateCode) continue; // options like Cabinets/Shelving have no rate item yet

    let count = 1;
    if (rule.surface_type === "Door & Frame") count = counts.doors;
    else if (rule.surface_type === "Windows") count = counts.windows;
    else if (rule.surface_type === "Architrave") count = counts.openings;

    // Nothing seen on the plan means nothing generated. The alternative is
    // inventing a door, which is a real cost on a per-item rate.
    if (COUNTED_SURFACES.has(rule.surface_type) && count < 1) continue;

    out.push({
      surfaceType: rule.surface_type,
      rateCode,
      count,
      isOption: rule.is_option,
      requiresConfirm: rule.requires_confirm,
      reason: rule.notes ?? "",
    });
  }
  return out;
}
