/**
 * "Point out a spot" — the customer's flagged defects, priced as repair lines
 * (estimator journey v2 plan §4.3 and §9.4; prototype screen 7).
 *
 * The gap this closes (plan §2.3): condition was ONE global answer for the
 * whole house, and "needs repair" opened a free-text box the engine could not
 * price. Nothing pinned a defect to a room or a surface, so the commonest
 * thing a customer actually knows — "there's a water mark on the hall ceiling
 * and a crack behind the kitchen door" — arrived as prose an estimator had to
 * re-read and re-price by hand, if they noticed it at all.
 *
 * A spot is a photo and a tag. It becomes a repair line pinned to that room,
 * which the estimator sees on the console and the painter sees on the work
 * order before day one.
 *
 * ────────────────────────────────────────────────────────────────────────
 * ONE DEFECT VOCABULARY
 *
 * The tags below are the CUSTOMER'S words for the defect types the platform
 * already has (`lib/extract/photos.ts` defectTypes, priced by
 * `defect_prep_rates`). They are a relabelling, never a second list: the plan
 * reader's "water_damage" and the customer's "Water mark" have to price
 * identically, or the same defect costs two different amounts depending on who
 * spotted it.
 *
 * The repair line uses the SAME shape the plan reader's defects use
 * (lib/extract/draft.ts): its own surface row on the room, hours on `prepHr`,
 * `assumedFields: ["prep"]`. Prep hours are charged at the charge-out rate
 * whether or not the code matches a rate-card row, so this needs no new rate
 * rows and no migration.
 *
 * ⚑6 (Tom, 9 Sep — the plan's own suggestion): a crack or a nail hole
 * auto-prices; everything else is recorded, shown, and left for a person.
 * `AUTO_PRICED` is that boundary and is the only place it is written down.
 */

import { makeDraftSurface } from "@/lib/extract/draft";
import { defectHours, type DefectRate } from "@/lib/capture/commit";
import type { WizardDeferred } from "./view";

/** What the customer taps, and the defect type it IS. */
export type SpotTag = {
  key: string;
  /** The customer's word for it. */
  label: string;
  /** The platform's defect type — `defect_prep_rates.defect_type`. */
  defectType: string;
  /** Interior, exterior, or both — the tag list differs by side (plan §4.3). */
  side: "interior" | "exterior" | "both";
  /** What the painter is told. */
  crewNote: string;
};

export const SPOT_TAGS: SpotTag[] = [
  { key: "crack", label: "Crack", defectType: "plaster_cracks", side: "interior",
    crewNote: "customer flagged a crack — cut out, fill and sand before the topcoats" },
  { key: "hole", label: "Hole or dent", defectType: "holes_dents", side: "interior",
    crewNote: "customer flagged a hole or dent — fill, sand and spot-prime" },
  { key: "flaking", label: "Flaking", defectType: "flaking", side: "both",
    crewNote: "customer flagged flaking — scrape back to sound, feather the edges, spot-prime" },
  { key: "water", label: "Water mark", defectType: "water_damage", side: "both",
    crewNote: "customer flagged a water mark — find the cause, then stain-block before the topcoats" },
  { key: "mould", label: "Mould", defectType: "mould", side: "both",
    crewNote: "customer flagged mould — treat and kill it before any paint goes on" },
  /**
   * The one tag with no row in the platform's defect vocabulary — stripping
   * paper is not a defect, it is work. It is review-only, so it never tries to
   * auto-price, and the unmatched code takes the engine's no-rate-item path:
   * prep hours are charged, nothing else is, and it cannot throw
   * (lib/pricing/estimate.ts). Give it a `defect_prep_rates` row only if you
   * also move it into `AUTO_PRICED`, and only once you are happy pricing a
   * strip you have not seen.
   */
  { key: "wallpaper", label: "Wallpaper", defectType: "wallpaper", side: "interior",
    crewNote: "customer flagged wallpaper — strip, wash off the glue and make good" },
  { key: "rot", label: "Rotten timber", defectType: "timber_rot", side: "exterior",
    crewNote: "customer flagged timber rot — cut out and replace, or fill, before painting" },
  { key: "rust", label: "Rust", defectType: "rust", side: "exterior",
    crewNote: "customer flagged rust — wire back, treat and prime before the topcoats" },
  { key: "render", label: "Cracked render", defectType: "render_cracks", side: "exterior",
    crewNote: "customer flagged cracked render — rake out, patch and let it cure" },
];

/**
 * ⚑6 — the auto-price boundary, and the only place it is written.
 *
 * A crack and a nail hole are the two defects whose repair is genuinely
 * standard: a known number of minutes each, the same in every house. Everything
 * else — flaking, water marks, mould, rot — is priced by how far it has gone,
 * and how far it has gone is exactly what a photo cannot settle. Those are
 * recorded, shown to the customer, and left for a person.
 */
export const AUTO_PRICED: ReadonlySet<string> = new Set(["crack", "hole"]);

/** A spot as the customer left it. */
export type Spot = {
  tag: string;
  /** The uploaded photo's extraction-source id, when they added one. */
  sourceId?: string | null;
  /** Their own words, when they typed any. */
  note?: string;
};

export const tagByKey = (key: string): SpotTag | null => SPOT_TAGS.find((t) => t.key === key) ?? null;

/** The tags offered on a room or a side. */
export function tagsFor(side: "interior" | "exterior"): SpotTag[] {
  return SPOT_TAGS.filter((t) => t.side === side || t.side === "both");
}

export type SpotLine = {
  /** The repair line to push onto the room, in the plan reader's own shape. */
  surface: ReturnType<typeof makeDraftSurface>;
  /** Raised when the spot is real but must not be auto-priced (⚑6). */
  deferred: WizardDeferred | null;
};

/**
 * One spot → one repair line pinned to the room.
 *
 * The line is ALWAYS created, priced or not. That is the point of §4.3: the
 * customer has told us something true about their house, and it has to be
 * visible to them, to the estimator and to the painter. A spot that only
 * became an amber note in a queue would be the free-text box again.
 *
 * Severity is always 1. A customer cannot judge severity and should not be
 * asked to — "how bad, on a scale of one to three" is a question for somebody
 * who prices these for a living. Severity 1 is the honest floor; the estimator
 * raises it on the photo.
 */
export function spotLine(
  spot: Spot,
  room: { id: number; name: string },
  rates: DefectRate[],
  nextId: () => number,
): SpotLine | null {
  const tag = tagByKey(spot.tag);
  if (tag == null) return null;

  const auto = AUTO_PRICED.has(tag.key);
  const hours = auto ? defectHours({ type: tag.defectType, severity: 1, qty: 1 }, rates) : 0;

  const label = auto
    ? `Repair — ${tag.label}`
    : `Repair — ${tag.label} (to price)`;
  const surface = makeDraftSurface(nextId(), tag.defectType, label, 1, "customer_stated", 0.8, ["prep"]);
  surface.prepHr = hours;
  surface.crewNote = [
    tag.crewNote,
    spot.note ? `customer said: "${spot.note.trim().slice(0, 160)}"` : "",
    spot.sourceId ? "photo attached" : "",
  ].filter(Boolean).join(" | ");

  /**
   * Two amber paths, matching the plan reader's (lib/extract/draft.ts): a
   * defect must never vanish silently. An auto-priced tag whose rate row is
   * missing is NOT quietly free — it becomes the same "needs pricing"
   * deferral an unseeded table has always raised.
   */
  const deferred: WizardDeferred | null =
    auto && hours > 0
      ? null
      : {
          room: room.name,
          areaId: room.id,
          what: auto ? `${tag.label} — needs pricing` : `${tag.label} — repair to price`,
          count: 1,
          needs: auto
            ? `the customer flagged a ${tag.label.toLowerCase()} but no prep rate matches it — price it by hand (or seed defect_prep_rates)`
            : `the customer flagged a ${tag.label.toLowerCase()}${spot.sourceId ? " with a photo" : ""} — judge it and price the repair`,
        };

  return { surface, deferred };
}

/**
 * Per-room condition (plan §4.3): "same as the rest / better / worse".
 *
 * It is NOT a second condition band. The job's band (the quick look's
 * good/wear/work) still sets the paint system; this says how THIS room sits
 * against it, which is what a customer can actually judge standing in it. The
 * estimator reads it beside the spots.
 */
export const ROOM_CONDITIONS = ["same", "better", "worse"] as const;
export type RoomCondition = (typeof ROOM_CONDITIONS)[number];

export const ROOM_CONDITION_LABEL: Record<RoomCondition, string> = {
  same: "Same as the rest",
  better: "Better than the rest",
  worse: "Worse than the rest",
};

/** A room the customer called out as worse is a room a person should look at. */
export function roomConditionDeferred(
  room: { id: number; name: string },
  condition: RoomCondition,
): WizardDeferred | null {
  if (condition !== "worse") return null;
  return {
    room: room.name,
    areaId: room.id,
    what: "worse than the rest",
    count: 1,
    needs: "the customer says this room is in worse condition than the others — check the prep allowance",
  };
}
