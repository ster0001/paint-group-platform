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
 * ⚑6 — the tags whose repair is standard enough to price from words alone.
 *
 * A crack and a nail hole take a known number of minutes, the same in every
 * house. Everything else — flaking, water marks, mould, rot — is priced by how
 * far it has gone, and that is what a PHOTO settles and a sentence does not.
 */
export const AUTO_PRICED: ReadonlySet<string> = new Set(["crack", "hole"]);

/**
 * How much of it there is (Tom, 9 Sep).
 *
 * *"On some jobs there may be peeling in 1 or 2 spots, which wouldn't require
 * a 1.8 margin, whereas others are peeling across the whole job — this
 * difference needs to be differentiated."*
 *
 * That is the verdict on a job-wide condition multiplier, and the fix is the
 * `defect_prep_rates` table this codebase already has: it carries
 * `hours_sev1 / sev2 / sev3` per defect type, which IS "a couple of spots /
 * patches here and there / most of it".
 *
 * Phase 4b hard-coded severity 1 on the reasoning that a customer cannot judge
 * severity. That was wrong, and Tom's framing shows why: nobody can answer
 * "is this a severity 2", but anyone standing in the room can answer "a couple
 * of spots, or most of it?". The words are the customer's; the severity is
 * ours.
 */
export const SPOT_EXTENTS = ["spots", "patches", "most"] as const;
export type SpotExtent = (typeof SPOT_EXTENTS)[number];

export const EXTENT_LABEL: Record<SpotExtent, string> = {
  spots: "A couple of spots",
  patches: "Patches here and there",
  most: "Most of it",
};

/** Extent → the severity column in `defect_prep_rates`. */
export const EXTENT_SEVERITY: Record<SpotExtent, 1 | 2 | 3> = {
  spots: 1, patches: 2, most: 3,
};

/** A spot as the customer left it. */
export type Spot = {
  tag: string;
  /** How much of it there is. Absent = a couple of spots, the safe floor. */
  extent?: SpotExtent;
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

  const extent: SpotExtent = spot.extent ?? "spots";
  const severity = EXTENT_SEVERITY[extent];

  /**
   * WHAT PRICES, AND WHY (Tom's framing, 9 Sep).
   *
   *   · A crack or a nail hole prices from words alone — ⚑6, and its repair is
   *     standard whatever the room looks like.
   *   · Anything else prices only WITH A PHOTO. Extent is the whole question
   *     for flaking or rot, and a photo is the only thing that settles it — a
   *     sentence is a claim, a photo is evidence.
   *   · Without a photo it is still recorded, still shown, still on the work
   *     order — it just goes to a person to price.
   *
   * That gives the customer a real reason to take the photo: photos earn a
   * price, words earn an estimator. Nothing is lost either way.
   */
  const hasPhoto = spot.sourceId != null && spot.sourceId !== "";
  const prices = AUTO_PRICED.has(tag.key) || hasPhoto;
  const hours = prices ? defectHours({ type: tag.defectType, severity, qty: 1 }, rates) : 0;

  const label = prices
    ? `Repair — ${tag.label} (${EXTENT_LABEL[extent].toLowerCase()})`
    : `Repair — ${tag.label} (to price)`;
  const surface = makeDraftSurface(nextId(), tag.defectType, label, 1, "customer_stated", 0.8, ["prep"]);
  surface.prepHr = hours;
  surface.crewNote = [
    tag.crewNote,
    `extent: ${EXTENT_LABEL[extent].toLowerCase()}`,
    spot.note ? `customer said: "${spot.note.trim().slice(0, 160)}"` : "",
    hasPhoto ? "photo attached" : "",
  ].filter(Boolean).join(" | ");

  /**
   * Two amber paths, matching the plan reader's (lib/extract/draft.ts): a
   * defect must never vanish silently. An auto-priced tag whose rate row is
   * missing is NOT quietly free — it becomes the same "needs pricing"
   * deferral an unseeded table has always raised.
   */
  /**
   * Three amber paths, because a defect must never vanish silently:
   *   · priced from a PHOTO — a person signs the prep off before the price is
   *     fixed (the photo_review rule, Tom 7 Sep). Priced, but not final.
   *   · priced from words (⚑6's two tags) with no rate row — "needs pricing",
   *     never silently free.
   *   · not priced at all — the estimator judges it.
   * A crack or nail hole that priced cleanly from words raises nothing.
   */
  const deferred: WizardDeferred | null =
    prices && hours > 0 && !hasPhoto
      ? null
      : {
          room: room.name,
          areaId: room.id,
          what: hours > 0 ? `${tag.label} — confirm the prep` : `${tag.label} — repair to price`,
          count: 1,
          needs: hours > 0
            ? `${hours}h allowed from the customer's photo (${EXTENT_LABEL[extent].toLowerCase()}) — sign the prep off before the price is fixed`
            : prices
              ? `the customer flagged a ${tag.label.toLowerCase()} but no prep rate matches it — price it by hand (or seed defect_prep_rates)`
              : `the customer flagged a ${tag.label.toLowerCase()} (${EXTENT_LABEL[extent].toLowerCase()}) with no photo — judge it and price the repair`,
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

/**
 * The per-room prep question, worded by what the customer already told us about
 * colour (Tom, 10 Sep).
 *
 * *"We just need to establish, when going through the room by room: if it's a
 * colour match, are there any areas which look like they need extra prep or
 * coats; if it's a colour change, any areas which need extra prep."*
 *
 * The old prompt — "point out a spot" — described the MECHANISM. This asks the
 * question the estimator actually needs answered, and asks it differently
 * depending on the job, because the thing to look for genuinely differs: on a
 * colour match the risk is a wall that will not cover, on a colour change it is
 * preparation the new paint cannot hide.
 */
export function prepPrompt(tier: "fresh" | "change" | "dark_to_light"): { cta: string; why: string } {
  if (tier === "fresh") {
    return {
      cta: "+ Anything needing extra work in here?",
      why: "Same colour again, so most of this room is a straight repaint. Tell us about anything that "
        + "won't cover in one — a patched wall, a stain coming through, a surface that has been left too long.",
    };
  }
  return {
    cta: "+ Anything needing extra prep in here?",
    why: "New colour, so two coats over sound surfaces. What changes the price is preparation — flaking or "
      + "peeling paint, bare or filled patches, water marks. Point at anything like that here.",
  };
}
