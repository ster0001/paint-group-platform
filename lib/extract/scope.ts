/**
 * Stage 4: scope mapping. Room type in, surfaces out. No AI.
 *
 * The rules live in the `room_type_scope_rules` and `room_name_aliases` tables
 * (seeded by scripts/seed-extraction-settings.ts from 316 real substrate lines
 * across 11 jobs), not in this file and not in the model. This module is only
 * the machinery that applies them.
 */

/** The Settings version the app reads. Bumped with the seed script. */
export const SCOPE_VERSION = 3;

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
  "Architrave": "Architrave (1 Side)",
  // Doors and windows are NOT here: their rate depends on the type, and the
  // type is only known from a photograph. See doorRateCode / windowRateCode.
};

/**
 * Flat and panel doors are different rates, so the type decides the code.
 * Unknown returns null and NOTHING IS GENERATED — Tom's rule, and the right one:
 * a guessed door style is a wrong rate on every door in the house.
 */
export function doorRateCode(style: string): string | null {
  return doorCodeFor(style, "frame");
}

/**
 * WHAT COMES WITH THE DOOR (Tom, 21 Aug: "it only lists doors, without frames
 * in the estimator — should we offer doors only, door and frame, and
 * architrave?").
 *
 * The rate card has carried all three shapes since v7 — a door-only rate, a
 * door-and-frame rate, and a per-item architrave — but the estimator only
 * ever wrote the "and Frame" codes and never the architrave, so a customer
 * could not say what they actually wanted painted. This is the one place
 * that decides which code a door answer lands on.
 *
 *   door        just the leaf (a frame already painted, or a sliding door)
 *   frame       leaf + frame — the default, and what every existing
 *               estimate already means
 *   architrave  leaf + frame, PLUS an Architrave (1 Side) line at the same
 *               count. The architrave rides as its OWN visible line rather
 *               than a hidden loading: it is a separate rate and it shows on
 *               the Architraves tile, so nothing is priced invisibly.
 */
export type DoorScope = "door" | "frame" | "architrave";

export const DOOR_SCOPES: DoorScope[] = ["door", "frame", "architrave"];

export const ARCHITRAVE_CODE = "Architrave (1 Side)";

const DOOR_CODES: Record<"flat" | "panel", Record<"door" | "frame", string>> = {
  flat: { door: "Flat Door (1 Side)", frame: "Flat Door and Frame (1 Side)" },
  panel: { door: "4-6 Panel Door (1 Side)", frame: "4-6 Panel Door and Frame (1 Side)" },
};

/** The door code for a style + scope. "architrave" rides the frame code —
 * the architrave itself is a second line, not a different door rate. */
export function doorCodeFor(style: string, scope: DoorScope): string | null {
  const family = style === "flat" ? DOOR_CODES.flat : style === "panel" ? DOOR_CODES.panel : null;
  if (!family) return null;
  return scope === "door" ? family.door : family.frame;
}

/** Read a door line's style back off its code. */
export function doorStyleOfCode(code: string): "flat" | "panel" | null {
  if (DOOR_CODES.flat.door === code || DOOR_CODES.flat.frame === code) return "flat";
  if (DOOR_CODES.panel.door === code || DOOR_CODES.panel.frame === code) return "panel";
  return null;
}

/** Read a door line's scope back off its code (architrave is a separate
 * line, so a code alone can only say door or frame). */
export function doorScopeOfCode(code: string): "door" | "frame" | null {
  if (DOOR_CODES.flat.door === code || DOOR_CODES.panel.door === code) return "door";
  if (DOOR_CODES.flat.frame === code || DOOR_CODES.panel.frame === code) return "frame";
  return null;
}

/** The staff-facing label for a door line — says the style AND what it
 * includes, because "Doors" alone was exactly the complaint. */
export function doorLineLabel(style: "flat" | "panel", scope: DoorScope): string {
  const face = style === "flat" ? "Flat door" : "Panel door";
  if (scope === "door") return `${face} only`;
  if (scope === "architrave") return `${face}, frame & architrave`;
  return `${face} & frame`;
}

/** Same rule for windows: no type, no line. */
export function windowRateCode(style: string): string | null {
  switch (style) {
    case "fixed_picture": return "Fixed / Picture / Window Reveal";
    case "awning_casement": return "Awning / Casement Window";
    case "double_hung_sash": return "Double Hung Sash";
    case "colonial_bay": return "Colonial / Bay Window";
    default: return null;
  }
}

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
  /** Per-item surfaces carry a count; area surfaces are sized by geometry. */
  count: number;
  isOption: boolean;
  requiresConfirm: boolean;
  reason: string;
};

/** Something seen but deliberately NOT priced, because its type is unknown. */
export type Deferred = {
  what: string;
  count: number;
  needs: string;
};

export type RoomPlan = { surfaces: PlannedSurface[]; deferred: Deferred[] };

export type RoomObservations = {
  doors: Array<{ style: string }>;
  windows: Array<{ style: string }>;
  openings: number;
  /** 'present' | 'absent' | 'unknown' — only a photo can settle this. */
  cornice: string;
};

/**
 * What to generate for one room.
 *
 * THE RULE THROUGHOUT: if the type is not known, nothing is generated. A door
 * of unknown style, a window of unknown style and a cornice nobody has seen are
 * all recorded as DEFERRED — the estimator is told they exist and picks the
 * type — rather than being priced at a guessed rate. Under-scoping is a
 * conversation; over-scoping is a wrong quote.
 */
export function planSurfaces(
  roomType: string,
  obs: RoomObservations,
  rules: ScopeRule[],
): RoomPlan {
  if (roomType === "unknown" || roomType === "excluded" || roomType === "exterior_excluded") {
    return { surfaces: [], deferred: [] };
  }

  const forType = rules.filter((r) => r.room_type === roomType);
  const surfaces: PlannedSurface[] = [];
  const deferred: Deferred[] = [];

  for (const rule of forType) {
    // ---- doors: one line per STYLE, and none for unknown styles ------------
    if (rule.surface_type === "Door & Frame") {
      const byStyle = new Map<string, number>();
      let unknown = 0;
      for (const d of obs.doors) {
        const code = doorRateCode(d.style);
        if (!code) unknown++;
        else byStyle.set(code, (byStyle.get(code) ?? 0) + 1);
      }
      for (const [code, count] of byStyle) {
        surfaces.push({
          surfaceType: code.startsWith("Flat") ? "Flat door & frame" : "Panel door & frame",
          rateCode: code, count, isOption: false, requiresConfirm: false,
          reason: "style identified from a photo",
        });
      }
      if (unknown > 0) {
        deferred.push({
          what: unknown === 1 ? "1 door" : `${unknown} doors`,
          count: unknown,
          needs: "flat or panel? A floorplan cannot show it — add a photo, or pick the type.",
        });
      }
      continue;
    }

    // ---- windows: same rule --------------------------------------------------
    if (rule.surface_type === "Windows") {
      const byStyle = new Map<string, number>();
      let unknown = 0;
      for (const w of obs.windows) {
        const code = windowRateCode(w.style);
        if (!code) unknown++;
        else byStyle.set(code, (byStyle.get(code) ?? 0) + 1);
      }
      for (const [code, count] of byStyle) {
        surfaces.push({
          surfaceType: code, rateCode: code, count,
          isOption: false, requiresConfirm: false, reason: "style identified from a photo",
        });
      }
      if (unknown > 0) {
        deferred.push({
          what: unknown === 1 ? "1 window" : `${unknown} windows`,
          count: unknown,
          needs: "what type? Add a photo, or pick the type.",
        });
      }
      continue;
    }

    // ---- cornices: never standard -------------------------------------------
    if (rule.surface_type === "Cornices") {
      if (obs.cornice === "present") {
        surfaces.push({
          surfaceType: "Cornices", rateCode: "Standard Cornices", count: 1,
          isOption: false, requiresConfirm: false, reason: "a photo shows a cornice",
        });
      } else if (obs.cornice === "unknown") {
        deferred.push({
          what: "cornice",
          count: 1,
          needs: "does this room have one? Plenty of these houses are square-set, so it is never assumed.",
        });
      }
      continue;
    }

    // ---- everything else: area-based, sized by the room's own geometry -------
    const rateCode = SURFACE_TO_RATE_CODE[rule.surface_type];
    if (!rateCode) continue; // options like Cabinets/Shelving have no rate item

    let count = 1;
    if (rule.surface_type === "Architrave") {
      count = obs.openings;
      if (count < 1) continue;
    }

    surfaces.push({
      surfaceType: rule.surface_type, rateCode, count,
      isOption: rule.is_option, requiresConfirm: rule.requires_confirm,
      reason: rule.notes ?? "",
    });
  }

  return { surfaces, deferred };
}
