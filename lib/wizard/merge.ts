import type { DraftArea, DraftResult } from "@/lib/extract/draft";
import { makeDraftSurface } from "@/lib/extract/draft";
import { ARCHITRAVE_CODE, doorCodeFor, doorLineLabel, doorStyleOfCode, windowRateCode } from "@/lib/extract/scope";
import { substrateKeyForRateCode } from "@/lib/estimate/substrates";
import { coatsFor, windowStyleLabel, windowStyleToSchema, type WizardState, type WizardSurfaceKey } from "./state";

/**
 * W2's merge: wizard answers applied over the drafted tree — the one place
 * the wizard is allowed to CHANGE what the plan reader produced, and only in
 * ways the answers justify:
 *
 *   - Page 2's ticks FILTER surfaces (untick ceilings, no ceiling lines).
 *   - Page 3's tier sets COATS (1 / 2 / 3 on the dark-to-light surfaces).
 *   - Page 4's "mostly" door/window styles RESOLVE the reader's deferred
 *     openings into priced lines — a floorplan cannot show a door style, but
 *     the person who lives there can. "Not sure" prices at the DEFAULT rate
 *     (flat door / casement window), tagged ai_assumed with the question kept
 *     open — R1.2's rule: nothing the customer told us exists contributes $0
 *     silently. ("No guessing" governs rates presented as settled, not
 *     whether the door exists.)
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

  // R1.2: an unsure style still PRICES, at the default rate (flat door /
  // casement window), tagged ai_assumed with an amber "style to confirm"
  // trace. A scope element the customer told us exists must never contribute
  // $0 silently — "no guessing" governs the RATE presented as settled, not
  // whether the door is on the estimate at all.
  const doorAnswered = state.details.doorStyle !== "unsure";
  const doorScope = state.details.doorScope ?? "frame";
  const doorFace: "flat" | "panel" = state.details.doorStyle === "panel" ? "panel" : "flat";
  const doorCode = doorCodeFor(doorFace, doorScope)!;
  const doorLabel = doorLineLabel(doorFace, doorScope);
  const answeredWindowCode = windowRateCode(windowStyleToSchema(state.details.windowStyle));
  const windowAnswered = answeredWindowCode != null;
  const windowCode = answeredWindowCode ?? "Awning / Casement Window";
  // The label says what the CUSTOMER chose, not which rate row it landed on
  // — "Winder" answered in the wizard used to reappear in the builder as
  // "Awning / Casement Window" with nothing to connect the two.
  const windowLabel = windowStyleLabel(state.details.windowStyle);

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
      if (kind === "doors") {
        kept.push(makeDraftSurface(
          nextId(), doorCode, doorLabel, d.count,
          doorAnswered ? "ai_derived" : "ai_assumed",
          doorAnswered ? 0.75 : 0.6,
          ["style"],
        ));
        // ("Door, frame & architrave" adds its architrave line below, once
        // per room against the room's whole door count.)
        // Answered = question closed. Unsure = priced provisionally, and the
        // open question stays visible (review gate + accuracy both see it).
        deferred = doorAnswered
          ? deferred.filter((x) => x !== d)
          : deferred.map((x) => (x === d
              ? { ...x, what: "door style to confirm", needs: "priced at the standard flat-door rate — confirm the style before send" }
              : x));
      } else if (kind === "windows") {
        kept.push(makeDraftSurface(
          nextId(), windowCode, windowLabel, d.count,
          windowAnswered ? "ai_derived" : "ai_assumed",
          windowAnswered ? 0.75 : 0.6,
          ["style"],
        ));
        deferred = windowAnswered
          ? deferred.filter((x) => x !== d)
          : deferred.map((x) => (x === d
              ? { ...x, what: "window style to confirm", needs: "priced at the standard casement rate — confirm the style before send" }
              : x));
      } else if (kind === "cornices") {
        // Ticked cornices = the user says the house has them.
        kept.push(makeDraftSurface(nextId(), "Standard Cornices", "Cornices", 1, "ai_derived", 0.8, []));
        deferred = deferred.filter((x) => x !== d);
      }
    }

    // Doors the PLAN READER already priced (their style came off a photo)
    // still have to honour the "what comes with the door" answer — the
    // reader only ever writes the door-and-frame code. Style is preserved:
    // the photo saw it, the customer didn't state it.
    for (const s of kept) {
      const face = doorStyleOfCode(s.code);
      if (face == null) continue;
      const code = doorCodeFor(face, doorScope)!;
      s.code = code;
      // Both labels: clientLabel is what the customer reads on the quote, so
      // a door-only job must not still say "& frame" there.
      s.internalLabel = doorLineLabel(face, doorScope);
      s.clientLabel = doorLineLabel(face, doorScope);
    }
    if (doorScope === "architrave") {
      const doors = kept.filter((s) => doorStyleOfCode(s.code) != null)
        .reduce((n, s) => n + (s.count || 1), 0);
      const already = kept.find((s) => s.code === ARCHITRAVE_CODE);
      if (doors > 0 && !already) {
        kept.push(makeDraftSurface(
          nextId(), ARCHITRAVE_CODE, "Architraves (with the doors)", doors, "customer_stated", 0.8, [],
        ));
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
