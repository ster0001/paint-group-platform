/**
 * What the plan-reader sees in a customer's room or side photo —
 * estimator journey v2 §8, §9.9.
 *
 * The gap this closes: `/api/extract/photos` has always KEPT the customer's
 * condition photos and never READ them. Its own comment says so — *"no AI
 * analysis, no silent drop"* — because the analysed path needed a floorplan
 * run to fold findings into, and the no-plan path has none. So the commonest
 * case (three taps, no floorplan, two photos of a damp patch) stored evidence
 * nobody looked at until an estimator opened it by hand.
 *
 * Tom, 9 Sep, asked for exactly this: *"do they add photos which AI reads and
 * it automatically adds prep hours for these things?"* — yes, with a person
 * signing it off.
 *
 * ────────────────────────────────────────────────────────────────────────
 * WHAT THIS MODULE IS FOR
 *
 * The model already answers the question (`readPropertyPhoto` with the
 * `damage` purpose returns typed defects with a severity and a confidence).
 * What was missing is the translation between ITS vocabulary and the
 * CUSTOMER'S: the model says `water_damage, severity 2`; the customer's screen
 * says "Water mark — patches here and there". One is the other, and this is
 * the one place that mapping is written.
 *
 * Nothing here calls the model or touches a database. It decides what a
 * reading MEANS, so that decision is testable without an API key.
 */

import { SPOT_TAGS, type SpotExtent } from "./spots";

/** One defect as the model reported it. */
export type ObservedDefect = {
  type: string;
  severity: 1 | 2 | 3;
  qty: number;
  confidence: number;
};

/** The same defect in the customer's words, ready to pre-select on the card. */
export type SuggestedSpot = {
  /** The spot tag key — what the customer would have tapped themselves. */
  tag: string;
  /** How much of it, as the customer would say it — a quantity. */
  extent: SpotExtent;
  /**
   * How BAD it is per unit, as the model judged it. A different axis from
   * extent, and the one a customer is never asked: "is this a severity 2" is
   * a question for somebody who prices these for a living.
   */
  severity: 1 | 2 | 3;
  confidence: number;
};

/**
 * How sure the model has to be before we put words in the customer's mouth.
 *
 * The same 0.7 the plan reader uses to accept a door style (`mergePhotoFindings`)
 * — and the consequence here is gentler, because a suggestion is shown to the
 * customer for confirmation rather than applied behind them. Below the bar we
 * simply say nothing and let them tag it.
 */
export const MIN_CONFIDENCE = 0.7;

/**
 * The model's observed quantity → the customer's words for it.
 *
 * Bands chosen to match `DEFAULT_EXTENT_QTY` (1 / 3 / 8), so a photo the model
 * measured at four square metres pre-selects the answer that prices four
 * square metres, rather than one that quietly means something else.
 */
function qtyExtent(qty: number): SpotExtent {
  if (qty >= 6) return "most";
  if (qty >= 2) return "patches";
  return "spots";
}

/** The model's defect type → the customer's tag. Built from the one tag list. */
const TAG_BY_DEFECT = new Map(SPOT_TAGS.map((t) => [t.defectType, t.key]));

/**
 * The strongest thing the model saw, as something the customer can confirm.
 *
 * ONE suggestion, not a list. A customer who photographed a damp patch is
 * telling us about that patch; handing back four checkboxes turns a helpful
 * gesture into a form. The rest of what the model saw is not thrown away —
 * it rides to the estimator on the photo, which is where a second opinion
 * belongs.
 *
 * "Strongest" is by SEVERITY first, then confidence: a confident scuff matters
 * less than a probable case of rot, and the estimator would rather be pointed
 * at the worse thing.
 */
export function suggestFromDefects(defects: readonly ObservedDefect[]): SuggestedSpot | null {
  const usable = defects
    .filter((d) => d.confidence >= MIN_CONFIDENCE && d.qty > 0 && TAG_BY_DEFECT.has(d.type))
    .sort((a, b) => (b.severity - a.severity) || (b.confidence - a.confidence));
  const best = usable[0];
  if (!best) return null;
  return {
    tag: TAG_BY_DEFECT.get(best.type)!,
    // The model reports both, so both are carried: qty → the customer's words
    // about how much, severity → its own judgement of how bad.
    extent: qtyExtent(best.qty),
    severity: best.severity,
    confidence: best.confidence,
  };
}

/**
 * What the customer reads above the pre-selected chips.
 *
 * Phrased as something to CONFIRM, never as a finding. The model is good at
 * this and still wrong sometimes, and a customer who is told "we found
 * flaking" will not argue with it — where one who is asked "does that look
 * right?" will happily say no. The difference matters because their answer is
 * what we price.
 */
export function suggestionLine(suggestion: SuggestedSpot): string {
  const tag = SPOT_TAGS.find((t) => t.key === suggestion.tag);
  const label = (tag?.label ?? "something").toLowerCase();
  const extent = suggestion.extent === "most" ? "across most of it"
    : suggestion.extent === "patches" ? "in patches here and there"
    : "in a couple of spots";
  return `From your photo that looks like ${label} ${extent} — does that look right?`;
}
