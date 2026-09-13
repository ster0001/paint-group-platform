import type { ModifierRef } from "./estimate";

/**
 * C17 (⚑A) — THE LEVEL-OF-FINISH SPLIT, recorded.
 *
 * The build plan's engine (the deleted `priceEstimate`) refused to price
 * without a level of finish: "mandatory — no default, no fallback
 * (non-negotiable #4)". The production path (`jobModifier` in estimate.ts)
 * has always defaulted a missing "Level of Finish" modifier to ×1, and every
 * estimate the business has priced went through that path. Moving the guard
 * onto it would refuse to price any estimate whose modSel never chose a
 * finish — including old ones opened again — so it is Tom's ruling, not a
 * hardening change. Until he rules, this helper SAYS whether a finish level
 * was chosen, so a screen or a report can flag it, and nothing throws.
 */
export function finishLevelChosen(modifiers: ModifierRef[], modSel: Record<string, string>): boolean {
  const code = modSel["Level of Finish"];
  return Boolean(code) && modifiers.some((m) => m.code === code && m.multiplier > 0);
}
