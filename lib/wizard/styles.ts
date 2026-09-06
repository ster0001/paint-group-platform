import { doorCodeFor, doorLineLabel, doorScopeOfCode, doorStyleOfCode, windowRateCode } from "@/lib/extract/scope";
import { windowStyleLabel, windowStyleToSchema } from "@/lib/wizard/state";

/**
 * Door and window STYLE, answered after the build (Phase 2 of the 6 Sep
 * estimator plan).
 *
 * The wizard's page 4 asks "what type of doors, mostly?" and "Not sure"
 * prices every door at the flat-door rate with an amber "door style to
 * confirm" flag. Until now that flag could only be cleared by staff: the
 * customer saw six amber lines and no control. These two functions are the
 * one place a style is swapped onto a built tree — the wizard-edit route
 * (the customer's editor) and the assistant (lib/agent/scope-doc) both call
 * them, so the two paths cannot drift.
 *
 * Only lines still carrying the `style` assumption move; a door the
 * estimator has already set stays as set. Counts never change.
 */

export type DoorStyle = "flat" | "panel";
export type WindowStyle = "casement" | "sash" | "colonial" | "winder";

export const DOOR_STYLE_DEFERRAL = "door style to confirm";
export const WINDOW_STYLE_DEFERRAL = "window style to confirm";

export type StyleSurface = Record<string, unknown> & { code?: unknown; assumedFields?: unknown };
export type StyleBlock = Record<string, unknown> & { kind?: unknown; type?: unknown; surfaces?: StyleSurface[] };

const WINDOW_CODES = new Set(["Fixed / Picture / Window Reveal", "Awning / Casement Window", "Double Hung Sash", "Colonial / Bay Window"]);

const assumedOf = (s: StyleSurface): string[] => (Array.isArray(s.assumedFields) ? (s.assumedFields as string[]) : []);
const isInterior = (b: StyleBlock) => b.kind === "area" && b.type !== "Exterior";

/** Every assumed-style interior door line → the answered face. */
export function applyDoorStyle<B extends StyleBlock>(blocks: B[], style: DoorStyle, origin = "customer_stated"): { blocks: B[]; changed: number } {
  let changed = 0;
  const out = blocks.map((b) => {
    if (!isInterior(b)) return b;
    return {
      ...b,
      surfaces: (b.surfaces ?? []).map((s) => {
        const code = String(s.code ?? "");
        const assumed = assumedOf(s);
        if (!doorStyleOfCode(code) || !assumed.includes("style")) return s;
        const scope = doorScopeOfCode(code) ?? "frame";
        const nextCode = doorCodeFor(style, scope);
        if (!nextCode) return s;
        changed++;
        return { ...s, code: nextCode, internalLabel: doorLineLabel(style, scope), origin, assumedFields: assumed.filter((f) => f !== "style") };
      }),
    };
  });
  return { blocks: out, changed };
}

/** Every assumed-style interior window line → the answered type. */
export function applyWindowStyle<B extends StyleBlock>(blocks: B[], style: WindowStyle, origin = "customer_stated"): { blocks: B[]; changed: number } | { error: string } {
  const code = windowRateCode(windowStyleToSchema(style));
  if (!code) return { error: "That window type isn't on the rate card." };
  let changed = 0;
  const out = blocks.map((b) => {
    if (!isInterior(b)) return b;
    return {
      ...b,
      surfaces: (b.surfaces ?? []).map((s) => {
        const assumed = assumedOf(s);
        if (!WINDOW_CODES.has(String(s.code ?? "")) || !assumed.includes("style")) return s;
        changed++;
        return { ...s, code, internalLabel: windowStyleLabel(style), origin, assumedFields: assumed.filter((f) => f !== "style") };
      }),
    };
  });
  return { blocks: out, changed };
}

/** Does the tree still carry an unanswered door / window style? */
export function openStyleQuestions(blocks: StyleBlock[]): { doors: boolean; windows: boolean } {
  let doors = false;
  let windows = false;
  for (const b of blocks) {
    if (!isInterior(b)) continue;
    for (const s of b.surfaces ?? []) {
      const code = String(s.code ?? "");
      if (!assumedOf(s).includes("style")) continue;
      if (doorStyleOfCode(code)) doors = true;
      else if (WINDOW_CODES.has(code)) windows = true;
    }
  }
  return { doors, windows };
}
