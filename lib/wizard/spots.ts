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

/**
 * Extent → HOW MUCH, in the rate row's own unit (m², lineal m, or each).
 *
 * ⚑ CORRECTED 9 Sep, from Tom's question: *"if paint is peeling or flaking it
 * says m2 0.3 — is that 0.3 per square metre, or 0.3 hours for everything?"*
 *
 * It is **per square metre** — `defectHours` is `perUnit × qty`. And that
 * exposed a real fault: this module used to pass `qty: 1` and let the extent
 * pick the SEVERITY column instead, so "most of it" on a whole peeling room
 * priced at 0.3 h — eighteen minutes — because one square metre is all it ever
 * asked for.
 *
 * The two are different axes and were being conflated:
 *
 *   severity = how bad it is PER unit   (light flaking vs paint hanging off)
 *   qty      = how much of it there is  ← this is what the customer answers
 *
 * "A couple of spots / patches here and there / most of it" is plainly the
 * second. So extent now sets the quantity, and severity comes from a photo
 * read when there is one (the model judges how bad) or sits at 1 when there
 * is not.
 *
 * ⚑ THE NUMBERS BELOW ARE MINE AND WANT TOM'S. They are a deliberate floor,
 * not an estimate: enough that "most of it" is no longer eighteen minutes,
 * conservative enough that nobody is over-charged while they are unconfirmed.
 * Settings-editable (`spot_extent_qty`), so correcting them is not a deploy.
 */
export const DEFAULT_EXTENT_QTY: Record<SpotExtent, number> = {
  spots: 1,
  patches: 3,
  most: 8,
};

export const SPOT_EXTENT_QTY_KEY = "spot_extent_qty";

/** The settings row → the quantities, per-entry fallback. */
export function extentQtyFrom(value: unknown): Record<SpotExtent, number> {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const one = (k: SpotExtent) => {
    const n = v[k];
    return typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 200 ? n : DEFAULT_EXTENT_QTY[k];
  };
  return { spots: one("spots"), patches: one("patches"), most: one("most") };
}

/** A spot as the customer left it. */
export type Spot = {
  tag: string;
  /** How much of it there is. Absent = a couple of spots, the safe floor. */
  extent?: SpotExtent;
  /**
   * How bad it is per unit — the model's judgement from the photo, when there
   * was one. A customer is never asked: "is this a severity 2" is a question
   * for somebody who prices these for a living.
   */
  severity?: 1 | 2 | 3;
  /** The uploaded photo's extraction-source id, when they added one. */
  sourceId?: string | null;
  /** Their own words, when they typed any. */
  note?: string;
};

export const tagByKey = (key: string): SpotTag | null => SPOT_TAGS.find((t) => t.key === key) ?? null;

/** The tags offered on a room or a side. */

/** The rate row's unit, in a word the painter reads. */
function unitWord(defectType: string, rates: DefectRate[]): string {
  const u = rates.find((r) => r.defect_type === defectType)?.unit ?? "";
  return u === "m2" ? "m²" : u === "lin_m" ? "lineal m" : u === "each" ? "of them" : "units";
}

export function tagsFor(side: "interior" | "exterior"): SpotTag[] {
  return SPOT_TAGS.filter((t) => t.side === side || t.side === "both");
}

export type SpotLine = {
  /** The repair line to push onto the room, in the plan reader's own shape. */
  surface: ReturnType<typeof makeDraftSurface>;
  /** Raised when the spot is real but must not be auto-priced (⚑6). */
  deferred: WizardDeferred | null;
  /**
   * "Most of it" — the range stays broad, a person looks, and we ask for a
   * photo if there is not one. Never blocks: the customer can still finish.
   */
  major: boolean;
  /** True when we should ask for a photo they have not added. */
  wantsPhoto: boolean;
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
/**
 * What we say when someone taps "most of it" (Tom, 9 Sep).
 *
 * Three things at once, because all three are true: a person will look, we
 * are keeping the range wide until they have, and a photo would help. The
 * photo is ASKED FOR and never required — the customer who cannot get one
 * still has to be able to finish, and their answer is evidence either way.
 */
export function majorExtentNotice(hasPhoto: boolean): string {
  return hasPhoto
    ? "Most of the room is a different job from a few patches, so one of our estimators will look at your photo and settle the prep before your price is fixed. Until then we'll keep your range wide."
    : "Most of the room is a different job from a few patches, so one of our estimators will look at this and settle the prep before your price is fixed. Until then we'll keep your range wide. A photo would help them a lot — you don't have to add one.";
}

export function spotLine(
  spot: Spot,
  room: { id: number; name: string },
  rates: DefectRate[],
  nextId: () => number,
  /** Tom's quantities per extent; defaults to the conservative floor above. */
  qtyFor: Record<SpotExtent, number> = DEFAULT_EXTENT_QTY,
): SpotLine | null {
  const tag = tagByKey(spot.tag);
  if (tag == null) return null;

  const extent: SpotExtent = spot.extent ?? "spots";
  const qty = qtyFor[extent];
  // The photo reader judges how bad; without one, the honest floor.
  const severity = spot.severity ?? 1;

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
  /**
   * "Most of it" is a different claim from the other two (Tom, 9 Sep).
   *
   * A couple of spots and a few patches are ordinary. A mostly-peeling ceiling
   * in an 8×8 living room could be a day of scraping or three, and no form can
   * tell which — so it still carries an allowance, but it also keeps the range
   * broad, asks for a photo, and says plainly that a person will look.
   */
  const major = extent === "most";
  const prices = AUTO_PRICED.has(tag.key) || hasPhoto;
  const hours = prices ? defectHours({ type: tag.defectType, severity, qty }, rates) : 0;

  const label = prices
    ? `Repair — ${tag.label} (${EXTENT_LABEL[extent].toLowerCase()})`
    : `Repair — ${tag.label} (to price)`;
  const surface = makeDraftSurface(nextId(), tag.defectType, label, 1, "customer_stated", 0.8, ["prep"]);
  surface.prepHr = hours;
  surface.crewNote = [
    tag.crewNote,
    `extent: ${EXTENT_LABEL[extent].toLowerCase()} — allowed for ${qty} ${unitWord(tag.defectType, rates)}`,
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
  // "Most of it" ALWAYS reaches a person, priced or not — that is the point.
  const deferred: WizardDeferred | null =
    !major && prices && hours > 0 && !hasPhoto
      ? null
      : major
      ? {
          room: room.name,
          areaId: room.id,
          kind: "major_defect",
          what: `${tag.label} — most of it`,
          count: 1,
          needs: hasPhoto
            ? `the customer says most of this room is affected and has sent a photo — judge the real prep before the price is fixed; ${hours}h is a placeholder allowance`
            : `the customer says most of this room is affected, with NO photo — ask for one, then judge the real prep; ${hours}h is a placeholder allowance`,
        }
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

  return { surface, deferred, major, wantsPhoto: major && !hasPhoto };
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
