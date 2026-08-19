import type { DraftArea, DraftResult } from "@/lib/extract/draft";
import { makeDraftSurface } from "@/lib/extract/draft";
import { doorRateCode, windowRateCode } from "@/lib/extract/scope";
import { substrateKeyForRateCode } from "@/lib/estimate/substrates";
import { coatsFor, windowStyleToSchema, type WizardState, type WizardSurfaceKey } from "./state";

/**
 * W2's merge: wizard answers applied over the drafted tree — the one place
 * the wizard is allowed to CHANGE what the plan reader produced, and only in
 * ways the answers justify:
 *
 *   - Page 2's ticks FILTER surfaces (untick ceilings, no ceiling lines).
 *   - Page 3's tier sets COATS (1 / 2 / 3 on the dark-to-light surfaces).
 *   - Page 4's "mostly" door/window styles RESOLVE the reader's deferred
 *     openings into priced lines — a floorplan cannot show a door style, but
 *     the person who lives there can. "Not sure" leaves them deferred
 *     (Tom's rule: a guessed style is a wrong rate on every door).
 *   - Ticking Cornices is the user saying the house HAS cornices, which is
 *     exactly the confirmation scope.ts says only a photo (or a human) can
 *     give. Unticking drops the question entirely.
 *
 * Still no prices, no hours, no invented rooms. Anything the answers cannot
 * settle stays in `deferred`, where the review gate prices the uncertainty.
 */

/** Trim surfaces affected by an oil→water enamel conversion. */
const TRIM_KEYS: WizardSurfaceKey[] = ["doors", "architraves", "skirting", "windows"];

/** Which page-2 tick governs a surface, by its rate code (A2: the substrate
 * registry is the one source of truth — interior and exterior alike). */
export function surfaceKeyForRateCode(code: string): WizardSurfaceKey | null {
  return substrateKeyForRateCode(code);
}

/**
 * A2: exterior nodes (envelope reads, the starter scaffold) are appended
 * AFTER applyWizardAnswers, so the page-2 ticks must be applied to them
 * separately. Surfaces whose substrate is unticked are dropped; an area left
 * with nothing is dropped whole. Codes no tick governs are kept.
 */
export function filterSurfacesByTicks(
  areas: DraftArea[],
  ticked: ReadonlySet<WizardSurfaceKey>,
): DraftArea[] {
  const out: DraftArea[] = [];
  for (const area of areas) {
    const kept = area.surfaces.filter((s) => {
      const key = substrateKeyForRateCode(s.code);
      return key == null || ticked.has(key);
    });
    if (kept.length > 0) out.push({ ...area, surfaces: kept });
  }
  return out;
}

function deferredKind(what: string): "doors" | "windows" | "cornices" | null {
  if (/door/i.test(what)) return "doors";
  if (/window/i.test(what)) return "windows";
  if (/cornice/i.test(what)) return "cornices";
  return null;
}

export function applyWizardAnswers(
  draft: DraftResult,
  state: WizardState,
  nextId: () => number,
): DraftResult {
  const ticked = new Set<WizardSurfaceKey>(state.surfaces);
  const d2l = new Set<WizardSurfaceKey>(
    state.condition.tier === "dark_to_light" ? state.condition.darkToLightSurfaces : [],
  );
  const tier = state.condition.tier;

  const areas: DraftArea[] = [];
  const skipped = [...draft.skipped];
  let deferred = [...draft.deferred];

  const doorCode = state.details.doorStyle === "unsure" ? null : doorRateCode(state.details.doorStyle);
  const windowCode = windowRateCode(windowStyleToSchema(state.details.windowStyle));

  for (const area of draft.areas) {
    const kept = area.surfaces.filter((s) => {
      const key = surfaceKeyForRateCode(s.code);
      return key == null || ticked.has(key);
    });

    // Resolve this room's deferred openings with the "mostly" answers. The
    // style is a whole-house statement, so the new line carries
    // assumedFields: ["style"] — stated, not confirmed per door.
    // Matched by areaId, never by name: two rooms called "Hall" must each
    // keep their own doors.
    const mine = deferred.filter((d) => d.areaId != null && d.areaId === area.id);
    for (const d of mine) {
      const kind = deferredKind(d.what);
      if (kind == null) continue;
      if (!ticked.has(kind)) {
        deferred = deferred.filter((x) => x !== d); // not being painted — question closed
        continue;
      }
      if (kind === "doors" && doorCode) {
        kept.push(makeDraftSurface(
          nextId(), doorCode,
          doorCode.startsWith("Flat") ? "Flat door & frame" : "Panel door & frame",
          d.count, "ai_derived", 0.75, ["style"],
        ));
        deferred = deferred.filter((x) => x !== d);
      } else if (kind === "windows" && windowCode) {
        kept.push(makeDraftSurface(nextId(), windowCode, windowCode, d.count, "ai_derived", 0.75, ["style"]));
        deferred = deferred.filter((x) => x !== d);
      } else if (kind === "cornices") {
        // Ticked cornices = the user says the house has them.
        kept.push(makeDraftSurface(nextId(), "Standard Cornices", "Cornices", 1, "ai_derived", 0.8, []));
        deferred = deferred.filter((x) => x !== d);
      }
    }

    if (kept.length === 0) {
      skipped.push({ name: area.name, reason: "nothing selected for this room on the surfaces page" });
      continue;
    }

    for (const s of kept) {
      const key = surfaceKeyForRateCode(s.code);
      s.coats = coatsFor(tier, key != null && d2l.has(key));
      if (state.paint.waterBasedOnly && state.paint.trimsOilBased === "yes" && key && TRIM_KEYS.includes(key)) {
        s.crewNote = [s.crewNote, "oil-based enamel underneath — adhesion prep before water-based topcoats"]
          .filter(Boolean).join(" | ");
      }
    }

    areas.push({ ...area, surfaces: kept });
  }

  // Deferred entries for rooms that no longer exist (filtered out, or the
  // name never matched) keep riding along for the review gate — except the
  // categories the user unticked, whose question is closed.
  deferred = deferred.filter((d) => {
    const kind = deferredKind(d.what);
    return kind == null || ticked.has(kind);
  });

  if (ticked.has("staircase")) {
    deferred.push({
      room: "Whole job", areaId: null, what: "staircase", count: 1,
      needs: "no per-room rate for stairs — price it in the builder",
    });
  }
  if (state.paint.waterBasedOnly && state.paint.trimsOilBased === "yes") {
    deferred.push({
      room: "Whole job", areaId: null, what: "oil-to-water trim conversion", count: 1,
      needs: "trims are oil-based enamel — allow adhesion prep before the water-based topcoats",
    });
  } else if (state.paint.waterBasedOnly && state.paint.trimsOilBased === "unsure") {
    deferred.push({
      room: "Whole job", areaId: null, what: "trim enamel check", count: 1,
      needs: "water-based only requested — check whether the trims are currently oil enamel",
    });
  }
  if (state.details.damageTier >= 2 && state.details.damagePhotoCount === 0) {
    deferred.push({
      room: "Whole job", areaId: null, what: "damage to price", count: 1,
      needs: state.details.damageNote.trim() !== ""
        ? `stated: "${state.details.damageNote.trim().slice(0, 160)}" — price the prep before send`
        : "significant damage stated with no photos — photos or a site visit before send",
    });
  }
  if (state.jobType !== "interior") {
    deferred.push({
      room: "Exterior", areaId: null, what: "exterior envelope", count: 1,
      needs: "measured from the site plan and facade photos, confirmed on site — never derived from the interior rooms",
    });
  }

  return { areas, skipped, assumedCount: draft.assumedCount, deferred };
}
