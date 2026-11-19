/**
 * A signed change taken back out (20 Nov 2026).
 *
 * The revision diff measures the working scope against the ACCEPTED scope.
 * When a block that carries a signed variation is put back to how it was
 * accepted — "Undo change", or the added surface deleted by hand — the block
 * stops differing, so it drops out of the diff entirely. The draft loop only
 * walked the diff, so it never saw that block again: no credit was drafted,
 * the signed variation stayed on the job, and the final invoice kept
 * charging for work that had been removed from the scope.
 *
 * This adds one change per such block: delta 0 against the accepted scope
 * (the block IS the accepted block again, so Σ deltas = working − accepted
 * still holds to the cent), which the draft loop turns into "what this block
 * is now minus what was signed for it" = a credit for exactly the signed
 * amount. Pure — no client, no clock.
 */
import type { RevisionChange, RevisionDiff, RevisionState } from "./diff";

/** The wo_variations fields this reads. */
export type SignedVariationRow = {
  revision_block_ref: string | null;
  status: string;
  price_cents: number | null;
  credit: boolean;
  est_hours: string | number | null;
  /** "Garage — added — …": names a block that is in neither scope any more. */
  comment?: string | null;
  /** priced_inputs — carries the tick rows an addition brought (20270193). Optional: the builder's select has none. */
  priced_inputs?: unknown;
};

export const isSignedVariation = (v: Pick<SignedVariationRow, "status">) =>
  v.status === "customer_approved" || v.status === "contractor_accepted";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Net inc-GST cents and contractor hours the customer has signed for one blockRef. */
export function signedNetFor(rows: SignedVariationRow[], ref: string): { incCents: number; hours: number } {
  let incCents = 0;
  let hours = 0;
  for (const v of rows) {
    if (v.revision_block_ref !== ref || !isSignedVariation(v)) continue;
    const sign = v.credit ? -1 : 1;
    incCents += sign * (v.price_cents ?? 0);
    hours += sign * Number(v.est_hours ?? 0);
  }
  return { incCents, hours: round2(hours) };
}

type IdBlock = { id: number; name?: unknown; kind?: unknown; surfaces?: unknown };
const blocksOf = (s: RevisionState | null | undefined): IdBlock[] =>
  s && Array.isArray(s.blocks) ? (s.blocks as IdBlock[]) : [];

function nameFor(ref: string, rows: SignedVariationRow[], accepted?: RevisionState, working?: RevisionState): string {
  if (ref === "adjustments") return "Pricing adjustments";
  const m = /^block:(-?\d+(?:\.\d+)?)$/.exec(ref);
  const id = m ? Number(m[1]) : NaN;
  const b = blocksOf(working).find((x) => x.id === id) ?? blocksOf(accepted).find((x) => x.id === id);
  if (b && typeof b.name === "string" && b.name.trim()) return b.name.trim();
  const said = rows.find((v) => v.revision_block_ref === ref && v.comment?.includes(" — "))?.comment?.split(" — ")[0].trim();
  if (!b && said) return said;
  return b?.kind === "line" ? "Line item" : "Area";
}

/** Tick-row keys ("areaId:surfaceId") the signed additions on this block brought that the working scope no longer has. */
function keysToStrike(rows: SignedVariationRow[], ref: string, working?: RevisionState): string[] {
  const present = new Set<string>();
  for (const b of blocksOf(working)) {
    if (!Array.isArray(b.surfaces)) continue;
    for (const s of b.surfaces as { id?: unknown }[]) present.add(`${b.id}:${String(s.id)}`);
  }
  const keys = new Set<string>();
  for (const v of rows) {
    if (v.revision_block_ref !== ref || !isSignedVariation(v) || v.credit) continue;
    const surfaces = (v.priced_inputs as { surfaces?: unknown } | null | undefined)?.surfaces;
    if (!Array.isArray(surfaces)) continue;
    for (const s of surfaces as { key?: unknown }[]) {
      if (typeof s.key === "string" && !present.has(s.key)) keys.add(s.key);
    }
  }
  return [...keys];
}

/**
 * The diff plus one "reverted" change for every blockRef that has signed
 * money or hours on it but no longer differs from the accepted scope.
 * Its deltaIncCents / hoursDelta are 0 (vs accepted); what to credit is
 * signedNetFor(ref), which the draft loop already subtracts.
 */
export function withSignedReversals(
  diff: RevisionDiff,
  rows: SignedVariationRow[],
  accepted?: RevisionState,
  working?: RevisionState,
): RevisionDiff {
  const inDiff = new Set(diff.changes.map((c) => c.blockRef));
  const refs: string[] = [];
  for (const v of rows) {
    const ref = v.revision_block_ref;
    if (!ref || inDiff.has(ref) || refs.includes(ref) || !isSignedVariation(v)) continue;
    refs.push(ref);
  }
  const extra: RevisionChange[] = [];
  for (const ref of refs) {
    const net = signedNetFor(rows, ref);
    if (net.incCents === 0 && net.hours === 0) continue;
    const name = nameFor(ref, rows, accepted, working);
    extra.push({
      blockRef: ref,
      kind: "reverted",
      title: `${name} — signed change taken back out`,
      detail: "back to the accepted estimate",
      credit: net.incCents > 0,
      deltaIncCents: 0,
      priceIncCents: Math.abs(net.incCents),
      hours: 0,
      hoursDelta: 0,
      surfaceKeys: keysToStrike(rows, ref, working),
      addedSurfaces: [],
      pricedLines: [{ label: `${name} — credit for the signed change taken back out`, cents: -net.incCents }],
    });
  }
  return extra.length ? { ...diff, changes: [...diff.changes, ...extra] } : diff;
}
