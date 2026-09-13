/**
 * C16 (b) — A PROPOSAL NEVER OVERWRITES A CONFIRMATION.
 *
 * The plan reader, the brief reader and the assistant all PROPOSE values —
 * a room's size from a photo, a side's window count, a length the text
 * stated. A proposal lands as ASSUMED (amber): where nobody has confirmed
 * the value it is applied with its own provenance and the field stays in
 * `assumedFields`; where a person has confirmed it (`human_confirmed` or
 * `customer_stated`, cyan) the block is left exactly as it was and the
 * proposal is recorded beside it as `proposed`, for the screen to offer and
 * the customer to take or leave. Nothing here can turn amber into cyan.
 */

export const CONFIRMED_ORIGINS = new Set(["human_confirmed", "customer_stated"]);
export const PROPOSAL_ORIGINS = ["ai_extracted", "ai_derived", "ai_assumed"] as const;
export type ProposalOrigin = (typeof PROPOSAL_ORIGINS)[number];

export type SizeProposal = { L?: number; W?: number; H?: number };
export type Proposed = SizeProposal & { origin: ProposalOrigin; by: string; at: string };

type LooseBlock = Record<string, unknown> & {
  origin?: unknown; confidence?: unknown; assumedFields?: unknown;
  L?: unknown; W?: unknown; H?: unknown; proposed?: unknown;
};

export function isConfirmed(block: Record<string, unknown>): boolean {
  return CONFIRMED_ORIGINS.has(String(block.origin ?? ""));
}

/**
 * Fold a size proposal into a block.
 *  - confirmed block → untouched, proposal recorded on `proposed` (amber, pending)
 *  - unconfirmed block → the values applied, origin = the proposal's, the
 *    proposed dimensions leave `assumedFields` (they are no longer typicals)
 */
export function foldSizeProposal<T extends LooseBlock>(
  block: T,
  proposal: SizeProposal,
  meta: { origin: ProposalOrigin; by: string; confidence?: number; at?: Date },
): { block: T; applied: boolean } {
  const dims = (["L", "W", "H"] as const).filter((k) => typeof proposal[k] === "number" && (proposal[k] as number) > 0);
  if (!dims.length) return { block, applied: false };
  const at = (meta.at ?? new Date()).toISOString();
  if (isConfirmed(block)) {
    const proposed: Proposed = { origin: meta.origin, by: meta.by, at };
    for (const k of dims) proposed[k] = proposal[k];
    return { block: { ...block, proposed }, applied: false };
  }
  const assumed = Array.isArray(block.assumedFields) ? (block.assumedFields as string[]) : [];
  const next: T = { ...block, origin: meta.origin, confidence: meta.confidence ?? 0.75, assumedFields: assumed.filter((f) => !dims.includes(f as "L" | "W" | "H")) };
  for (const k of dims) (next as LooseBlock)[k] = proposal[k];
  return { block: next, applied: true };
}

/** The pending proposal on a block, if any — for the screen. */
export function proposedOf(block: Record<string, unknown>): Proposed | null {
  const p = block.proposed;
  if (!p || typeof p !== "object") return null;
  const v = p as Partial<Proposed>;
  if (!PROPOSAL_ORIGINS.includes(v.origin as ProposalOrigin)) return null;
  return { origin: v.origin as ProposalOrigin, by: String(v.by ?? ""), at: String(v.at ?? ""), ...(typeof v.L === "number" ? { L: v.L } : {}), ...(typeof v.W === "number" ? { W: v.W } : {}), ...(typeof v.H === "number" ? { H: v.H } : {}) };
}

/** The customer took or left the proposal — either way it is no longer pending. */
export function clearProposed<T extends LooseBlock>(block: T): T {
  if (!("proposed" in block)) return block;
  const { proposed: _p, ...rest } = block;
  void _p;
  return rest as T;
}
