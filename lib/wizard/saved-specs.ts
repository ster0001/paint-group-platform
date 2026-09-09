/**
 * Trade saved specs — estimator journey v2 §7, §9.8.
 *
 * *"Saved specs as templates: 'end-of-lease repaint', 'vacate touch-up',
 * 'common-area refresh' — scope, systems, condition band and colour policy
 * saved once."*
 *
 * An agent quoting the fortieth end-of-lease repaint this year is answering
 * the same eight questions for the fortieth time. The answers do not change;
 * only the address does. A spec is those answers, named and kept.
 *
 * ────────────────────────────────────────────────────────────────────────
 * WHAT A SPEC IS, AND IS NOT
 *
 * A spec holds ANSWERS, never a tree and never a price. The rooms come from
 * the address — a two-bedroom unit and a four-bedroom house both take the
 * "end-of-lease repaint" spec and produce different trees, which is the whole
 * point. Storing a tree would make the spec a copy of one job rather than a
 * way of working.
 *
 * That also keeps the boundary this codebase has everywhere else: the client
 * posts answers, the server rebuilds the tree and the engine prices it. A spec
 * that carried quantities or money would be a way around it.
 *
 * ────────────────────────────────────────────────────────────────────────
 * WHERE IT LIVES
 *
 * `accounts.flags.savedSpecs` — a jsonb column that already holds small
 * per-account settings (`flags.unlimited`). No migration: a trade account has
 * a handful of specs, not a table's worth, and the plan's §9 sequence puts
 * this well before anything that would justify one. If a licensee ever needs
 * hundreds, that is the moment for a table, not now.
 */

import { z } from "zod";
import { surfaceKeySchema, type WizardState, type WizardSurfaceKey } from "./state";

/** The most any one account may keep. A list longer than this is a filing problem. */
export const MAX_SPECS = 12;

export const savedSpecSchema = z.object({
  /** Stable across renames, so an estimate can say which spec built it. */
  id: z.string().min(1).max(40),
  name: z.string().trim().min(1).max(60),
  /** Page 2's ticks — what is painted. */
  surfaces: z.array(surfaceKeySchema).min(1),
  /** Colour intent (the stored `condition.tier` values). */
  tier: z.enum(["fresh", "change", "dark_to_light"]),
  /** 0 none · 1 minor · 2 a few areas · 3 real need. */
  damageTier: z.number().int().min(0).max(3),
  /** ⚑5's gloss answer, when the account always knows it. */
  trimsOilBased: z.enum(["yes", "no", "unsure"]).nullable().default(null),
  /** ⚑3's ceiling answers. */
  ceilingsMarked: z.boolean().default(false),
  ceilingsChangingColour: z.boolean().default(false),
  /** The site answers that are the same on every job of this sort. */
  siteAccess: z.object({
    cleared: z.enum(["yes", "some", "no"]).optional(),
    floors: z.enum(["carpet", "hard", "mixed"]).optional(),
    stairwell: z.enum(["yes", "no"]).optional(),
    parking: z.enum(["drive", "street", "hard"]).optional(),
    lift: z.enum(["yes", "no"]).optional(),
    pets: z.enum(["yes", "no"]).optional(),
  }).default({}),
  /**
   * The colour policy in words — "match existing", "vacate white throughout".
   * Deliberately free text and deliberately NOT applied to anything: the
   * per-property colour register is the machine-readable answer
   * (`colour_records`, trade portal v2), and a second source for the same
   * question is how two of them come to disagree. This is a note for the
   * estimator, and says so.
   */
  colourPolicy: z.string().trim().max(200).default(""),
  createdAt: z.string().max(40).default(""),
});

export type SavedSpec = z.infer<typeof savedSpecSchema>;

/** The specs on an account. Anything unparseable is dropped, never thrown. */
export function specsFromFlags(flags: unknown): SavedSpec[] {
  const v = (flags && typeof flags === "object" ? flags : {}) as { savedSpecs?: unknown };
  if (!Array.isArray(v.savedSpecs)) return [];
  const out: SavedSpec[] = [];
  for (const raw of v.savedSpecs.slice(0, MAX_SPECS)) {
    const parsed = savedSpecSchema.safeParse(raw);
    // One bad row must not lose the other eleven — a spec list is somebody's
    // way of working, and losing it silently is worse than showing eleven.
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** Write a spec into an account's flags, replacing one of the same id. */
export function flagsWithSpec(flags: unknown, spec: SavedSpec): Record<string, unknown> {
  const base = (flags && typeof flags === "object" ? { ...flags } : {}) as Record<string, unknown>;
  const kept = specsFromFlags(flags).filter((s) => s.id !== spec.id);
  base.savedSpecs = [spec, ...kept].slice(0, MAX_SPECS);
  return base;
}

export function flagsWithoutSpec(flags: unknown, id: string): Record<string, unknown> {
  const base = (flags && typeof flags === "object" ? { ...flags } : {}) as Record<string, unknown>;
  base.savedSpecs = specsFromFlags(flags).filter((s) => s.id !== id);
  return base;
}

/**
 * Capture the answers from a state as a named spec.
 *
 * Only the answers that repeat. The address, the room count, the contact and
 * anything the plan reader produced are all properties of ONE job and would be
 * wrong on the next one.
 */
export function specFromState(
  state: Pick<WizardState, "surfaces" | "condition" | "details" | "paint">,
  name: string,
  opts: { id?: string; colourPolicy?: string; now?: Date } = {},
): SavedSpec {
  return savedSpecSchema.parse({
    id: opts.id ?? `spec_${Math.random().toString(36).slice(2, 10)}`,
    name,
    surfaces: state.surfaces,
    tier: state.condition.tier,
    damageTier: state.details.damageTier,
    trimsOilBased: state.paint.trimsOilBased ?? null,
    ceilingsMarked: state.condition.ceilingsMarked,
    ceilingsChangingColour: state.condition.ceilingsChangingColour,
    siteAccess: state.details.siteAccess ?? {},
    colourPolicy: opts.colourPolicy ?? "",
    createdAt: (opts.now ?? new Date()).toISOString(),
  });
}

/**
 * Apply a spec over a state.
 *
 * Returns a NEW state; the caller decides whether to keep it. Everything the
 * spec does not name is left exactly as it was — a spec is a set of answers,
 * not a reset, and an agent who has already typed the address must not lose it.
 *
 * `surfaces` is REPLACED rather than merged: "walls and ceilings only" has to
 * be able to take the doors off, and a merge could only ever add.
 */
export function applySpec<T extends Pick<WizardState, "surfaces" | "condition" | "details" | "paint">>(
  state: T,
  spec: SavedSpec,
): T {
  return {
    ...state,
    surfaces: [...spec.surfaces] as WizardSurfaceKey[],
    condition: {
      ...state.condition,
      tier: spec.tier,
      ceilingsMarked: spec.ceilingsMarked,
      ceilingsChangingColour: spec.ceilingsChangingColour,
      // The per-surface dark-to-light list belongs to one job's walls, never
      // to a way of working.
      darkToLightSurfaces: [],
    },
    details: {
      ...state.details,
      damageTier: spec.damageTier,
      siteAccess: { ...spec.siteAccess },
    },
    paint: { ...state.paint, trimsOilBased: spec.trimsOilBased },
  };
}

/** What the spec says, in one line, for the list. */
export function specSummary(spec: SavedSpec): string {
  const colour = spec.tier === "fresh" ? "same colours"
    : spec.tier === "dark_to_light" ? "much lighter or bold" : "new colours";
  const condition = spec.damageTier <= 0 ? "good"
    : spec.damageTier === 1 ? "some wear" : "needs work";
  return `${spec.surfaces.length} surface${spec.surfaces.length === 1 ? "" : "s"} · ${colour} · ${condition}`;
}
