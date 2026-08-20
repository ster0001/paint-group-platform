/**
 * The accuracy score: the DOLLAR-WEIGHTED share of the estimate that is
 * extracted-or-confirmed data rather than assumption (phase plan W4's model,
 * shown in the W3 editor). Pure — the caller prices the areas first; this
 * never computes money itself.
 *
 * Per-area credit (v1, to be calibrated against the W5 proving window):
 *   human_confirmed 1.0 · ai_extracted 0.92 (0.7 when the reader's own
 *   confidence was low) · ai_derived 0.85 · ai_assumed 0.45.
 *   An assumed ceiling height costs 0.15 — Step 6's finding is that height,
 *   not plan-reading, is the walls error. Assumed L/W caps credit at 0.5.
 *
 * Weighting: an area counts by what it costs — a wrong laundry moves the
 * total less than a wrong open-plan living. Unpriced areas (price 0) carry
 * the mean weight of the priced ones: being unpriced is risk, not safety.
 * Each unresolved deferred item costs 2 points, capped at 12.
 */

export type ScoredArea = {
  priceCents: number;
  origin: string;
  confidence: number;
  assumedFields: string[];
  /**
   * R5: where this area sits in the customer's confirm loop. UNDEFINED means
   * the area is not part of a loop at all (staff estimates, pre-loop drafts)
   * — those score exactly as they always did.
   */
  confirmState?: "pending" | "confirmed";
};

/**
 * R5 (Tom, 20 Aug 2026): the score has to be EARNED.
 *
 * Until the customer has confirmed a room or a side we will not claim more
 * than PENDING_CAP for it, however well the plan read — an unconfirmed
 * reading is a good guess, not a settled fact. Once they have walked it,
 * it is worth nearly a staff confirmation. This is the whole reason the
 * ring climbs as the loop is worked instead of sitting still: before this,
 * confirming a room changed no number the customer could see.
 *
 * Both are applied BEFORE the height and L/W penalties, so a confirmed room
 * with an assumed ceiling is still docked for the ceiling, and a side the
 * customer answered "not sure" to still caps at the assumed-dimension 0.5.
 */
const PENDING_CAP = 0.62;
const CONFIRMED_CREDIT = 0.95;
/** Each whole-job check the customer settles (the doors & windows totals,
 * the "anything we missed" sweep, the exterior condition and extras) is
 * worth 2 points, up to 6 — they retire real questions, but they measure
 * nothing, so they can never carry the score on their own. */
const CHECK_POINTS = 2;
const CHECK_POINTS_MAX = 6;

function credit(a: ScoredArea): number {
  let c: number;
  switch (a.origin) {
    case "human_confirmed": c = 1.0; break;
    case "ai_extracted": c = a.confidence >= 0.7 ? 0.92 : 0.7; break;
    case "ai_derived": c = 0.85; break;
    // The customer typed it: better than an assumption, never as good as a
    // staff confirmation — and always cross-checked in the review queue.
    case "customer_stated": c = 0.75; break;
    case "ai_assumed": c = 0.45; break;
    default: c = 1.0; // absent origin reads as human work (pre-AI estimates)
  }
  if (a.confirmState === "pending") c = Math.min(c, PENDING_CAP);
  else if (a.confirmState === "confirmed") c = Math.max(c, CONFIRMED_CREDIT);
  if (a.assumedFields.includes("H")) c -= 0.15;
  if (a.assumedFields.includes("L") || a.assumedFields.includes("W")) c = Math.min(c, 0.5);
  return Math.max(0.2, c);
}

/**
 * R1.4: the ONE per-room confidence — the same credit() the header uses,
 * as a percentage, docked 2 points per open question the room itself raised
 * (capped at 12, mirroring the header's deferred penalty). There is no other
 * per-room confidence anywhere: header, room cards and the range band all
 * read this module. (The diagnostic's 90%-vs-41% split came from a second
 * fixed lookup that ignored the height penalty and deferred items.)
 */
export function roomConfidencePct(a: ScoredArea, roomDeferredCount = 0): number {
  const penalty = Math.min(roomDeferredCount * 2, 12);
  return Math.max(0, Math.min(100, Math.round(credit(a) * 100 - penalty)));
}

/** R1.4 honesty cap: nothing extracted and nothing human/customer-settled
 * means the estimate is assumptions all the way down — it may not report
 * above 65% no matter how the weights fall. Absent origin (pre-AI builder
 * estimates) counts as human work, as everywhere else in this module. */
const UNVERIFIED_CAP = 65;
const VERIFIED_ORIGINS = new Set(["human_confirmed", "customer_stated", "ai_extracted", ""]);

export function accuracyScore(areas: ScoredArea[], deferredCount = 0, checksDone = 0): number {
  if (areas.length === 0) return 0;

  const positive = areas.filter((a) => a.priceCents > 0);
  const meanWeight = positive.length
    ? positive.reduce((n, a) => n + a.priceCents, 0) / positive.length
    : 1;

  let weightSum = 0;
  let creditSum = 0;
  for (const a of areas) {
    const w = a.priceCents > 0 ? a.priceCents : meanWeight;
    weightSum += w;
    creditSum += w * credit(a);
  }

  const base = (creditSum / weightSum) * 100;
  const deferredPenalty = Math.min(deferredCount * 2, 12);
  const checkCredit = Math.min(checksDone * CHECK_POINTS, CHECK_POINTS_MAX);
  const score = Math.max(0, Math.min(100, Math.round(base - deferredPenalty + checkCredit)));
  // A room the customer walked and confirmed is verification too — the
  // no-plan path is assumptions until they answer, and their answers are
  // exactly what lifts it off the floor.
  const verified = areas.some((a) => VERIFIED_ORIGINS.has(a.origin) || a.confirmState === "confirmed");
  return verified ? score : Math.min(score, UNVERIFIED_CAP);
}
