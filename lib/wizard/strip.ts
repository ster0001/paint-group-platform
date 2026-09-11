import type { DeskCheckPack } from "./desk-check";
import type { WizardPolicySettings } from "./policy";

/**
 * C7b (brief step 3.1) — the strip under the estimate's header:
 *
 *   9 of 9 rooms confirmed · ±4% · 7 photos · 1 repair to price · under the $12k cap
 *
 * Pure wording over figures the pack already derived. Every number comes in;
 * none is computed here — the accuracy evaluator scored the band, the loop's
 * own flags counted the rooms, the pack counted the spots, and the policy
 * row named the cap. This file only puts them in a sentence.
 */
export type StripInput = {
  loop: { confirmed: number; total: number; unit: "rooms" | "sides" } | null;
  bandPct: number;
  photos: number;
  spotsToPrice: number;
  totalCents: number;
  verdict: DeskCheckPack["verdict"];
  policy: Pick<WizardPolicySettings, "remoteConfirmCapCents">;
};

const n = (v: number, one: string, many = `${one}s`) => `${v} ${v === 1 ? one : many}`;

export function stripParts(i: StripInput): string[] {
  const parts: string[] = [];
  if (i.loop && i.loop.total > 0) parts.push(`${i.loop.confirmed} of ${i.loop.total} ${i.loop.unit} confirmed`);
  parts.push(`±${i.bandPct}%`);
  parts.push(n(i.photos, "photo"));
  if (i.spotsToPrice > 0) parts.push(`${n(i.spotsToPrice, "repair")} to price`);
  const cap = `$${Math.round(i.policy.remoteConfirmCapCents / 100_000)}k`;
  parts.push(i.totalCents > i.policy.remoteConfirmCapCents ? `over the ${cap} cap` : `under the ${cap} cap`);
  return parts;
}

/** The suggestion line beside the buttons. */
export function stripVerdict(i: Pick<StripInput, "verdict">): { headline: string; detail: string } {
  return i.verdict.eligible
    ? { headline: "Confirm remotely", detail: "no visit needed" }
    : { headline: "Needs a visit", detail: i.verdict.reason };
}
