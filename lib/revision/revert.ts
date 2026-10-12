/**
 * Undo ONE change in the revision builder (Tom, 12 Oct 2026: "an option in
 * the variation at the top of the page to revise or delete it, which reverses
 * back that section to how it was — separately for each variation").
 *
 * Each row of the "Changes vs the accepted estimate" panel is one blockRef
 * from lib/revision/diff. Reverting it puts THAT section of the working scope
 * back to the accepted baseline and leaves every other change alone, so the
 * row disappears from the diff and nothing else moves.
 *
 * Pure — the builder applies the result to its own state and saves the working
 * scope; no money is computed here (the diff re-prices from what is left).
 */
import type { RevisionState } from "./diff";

/** The estimate-level knobs adjustmentsFrom (lib/pricing/context) reads — the
 * "adjustments" change is exactly these keys differing. */
export const ADJUSTMENT_KEYS = [
  "modSel",
  "materials",
  "discountPct",
  "discountMode",
  "discountFixedCents",
  "hourlyRateOverride",
  "contractorRateOverride",
  "preparationOverrideCents",
  "preparationHours",
  "hourLoading",
  "sizeUpliftDisabled",
] as const;

type IdBlock = { id: number } & Record<string, unknown>;

const blocksOf = (s: RevisionState): IdBlock[] =>
  Array.isArray(s.blocks) ? (s.blocks as IdBlock[]) : [];

export function revertChange(
  accepted: RevisionState,
  working: RevisionState,
  blockRef: string,
): RevisionState {
  if (blockRef === "adjustments") {
    const next: RevisionState = { ...working };
    for (const k of ADJUSTMENT_KEYS) {
      if (k in accepted) next[k] = accepted[k];
      else delete next[k];
    }
    return next;
  }

  const m = /^block:(-?\d+(?:\.\d+)?)$/.exec(blockRef);
  if (!m) return working;
  const id = Number(m[1]);
  const blocksA = blocksOf(accepted);
  const blocksW = blocksOf(working);
  const a = blocksA.find((b) => b.id === id);
  const inWorking = blocksW.some((b) => b.id === id);

  let blocks: IdBlock[];
  if (a && inWorking) {
    // Changed → the accepted copy, in its working position.
    blocks = blocksW.map((b) => (b.id === id ? a : b));
  } else if (!a && inWorking) {
    // Added → gone.
    blocks = blocksW.filter((b) => b.id !== id);
  } else if (a && !inWorking) {
    // Removed → back where the customer remembers it: after the nearest
    // accepted block before it that is still in the working scope.
    const idxA = blocksA.findIndex((b) => b.id === id);
    let insertAt = 0;
    for (let i = idxA - 1; i >= 0; i--) {
      const at = blocksW.findIndex((b) => b.id === blocksA[i].id);
      if (at >= 0) { insertAt = at + 1; break; }
    }
    blocks = [...blocksW.slice(0, insertAt), a, ...blocksW.slice(insertAt)];
  } else {
    return working;
  }
  return { ...working, blocks };
}
