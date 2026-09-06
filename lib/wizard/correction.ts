/**
 * Why staff corrected a wizard estimate (Phase 3 of the 6 Sep estimator plan).
 *
 * The Proving window says HOW FAR the wizard's first guess was from the
 * price staff settled on (median +$2,489 on 6 Sep) but not WHY. Ten tagged
 * corrections tell us more than another month of guessing — so each
 * Proving row takes a handful of reasons and a line of note, stored on the
 * estimate itself (`builder_state.wizard.correction`), and the page sums
 * them. Pure module: the shape, the reasons, and the breakdown.
 */

export const CORRECTION_REASONS = [
  ["rooms_missed", "Rooms or areas missed"],
  ["sizes", "Room or side sizes"],
  ["surfaces", "Surfaces added or removed"],
  ["prep", "Prep, condition or coats"],
  ["rates", "Rates or modifiers"],
  ["extras", "Extras and items"],
  ["access", "Access or equipment"],
  ["other", "Something else"],
] as const;

export type CorrectionReason = (typeof CORRECTION_REASONS)[number][0];
export const REASON_LABEL: Record<CorrectionReason, string> = Object.fromEntries(CORRECTION_REASONS) as Record<CorrectionReason, string>;

export type Correction = {
  reasons: CorrectionReason[];
  note: string;
  taggedAt: string;
  taggedBy: string | null;
};

const REASON_SET = new Set<string>(CORRECTION_REASONS.map(([k]) => k));

/** The stored value → a Correction, or null when nothing usable is there. */
export function correctionFrom(value: unknown): Correction | null {
  const v = (value && typeof value === "object" ? value : null) as Partial<Correction> | null;
  if (!v || !Array.isArray(v.reasons)) return null;
  const reasons = [...new Set(v.reasons.filter((r): r is CorrectionReason => typeof r === "string" && REASON_SET.has(r)))];
  const note = typeof v.note === "string" ? v.note.trim().slice(0, 600) : "";
  if (reasons.length === 0 && !note) return null;
  return {
    reasons,
    note,
    taggedAt: typeof v.taggedAt === "string" ? v.taggedAt : "",
    taggedBy: typeof v.taggedBy === "string" ? v.taggedBy : null,
  };
}

export type ReasonCount = { reason: CorrectionReason; label: string; count: number; medianAbsCents: number };

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/**
 * Reasons by how often staff picked them, with the median size of the
 * corrections they were part of — so "rooms missed · 6 rows · median $3,100"
 * reads as one line. Untagged rows count separately; they are the backlog.
 */
export function correctionBreakdown(
  rows: ReadonlyArray<{ correction: Correction | null; correctionCents: number }>,
): { tagged: number; untagged: number; reasons: ReasonCount[] } {
  const per = new Map<CorrectionReason, number[]>();
  let tagged = 0;
  let untagged = 0;
  for (const r of rows) {
    if (!r.correction || r.correction.reasons.length === 0) { untagged++; continue; }
    tagged++;
    for (const reason of r.correction.reasons) {
      const list = per.get(reason) ?? [];
      list.push(Math.abs(r.correctionCents));
      per.set(reason, list);
    }
  }
  const reasons: ReasonCount[] = CORRECTION_REASONS
    .map(([reason, label]) => ({ reason, label, count: per.get(reason)?.length ?? 0, medianAbsCents: median(per.get(reason) ?? []) }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count || b.medianAbsCents - a.medianAbsCents);
  return { tagged, untagged, reasons };
}
