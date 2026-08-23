/**
 * GST arithmetic — ⚑14: ONE rounding rule, used by every invoice figure.
 *
 * Mirrored exactly by the SQL pair `gst_on_ex_cents` / `gst_from_inc_cents`
 * (supabase/migrations/20261112000000_invoicing_core.sql §1); the schema
 * contract test pins the two so they cannot drift. Postgres `round(numeric)`
 * is half-away-from-zero, so that is the rule here too (half-UP for the
 * positive amounts invoices deal in).
 *
 * Two derivations, chosen by what the invoice promises (§3.2 of the brief):
 *
 *  - line-built (variation / standalone): sum the ex-GST lines, compute GST
 *    ONCE on the subtotal, round half-up. `fromExLines`.
 *  - inc-anchored (deposit / progress / final): the commercial promise is a
 *    GST-inclusive figure computed off the ledger ("10% of the contract",
 *    "the remaining balance"), so the total is the anchor and GST is its tax
 *    component: gst = round(total × r ÷ (100 + r)); subtotal = total − gst.
 *    `fromIncTotal`. (This is how the mockup's $11,870.00 final splits into
 *    $10,790.91 + $1,079.09.)
 */

export type GstSplit = {
  subtotalExCents: number;
  gstCents: number;
  totalIncCents: number;
};

/** Half away from zero — matches Postgres round(numeric). */
export function roundHalfUp(n: number): number {
  return n < 0 ? -Math.round(-n) : Math.round(n);
}

/** GST to add on top of an ex-GST amount. */
export function gstOnExCents(exCents: number, ratePct = 10): number {
  return roundHalfUp((exCents * ratePct) / 100);
}

/** The GST component inside a GST-inclusive amount. */
export function gstFromIncCents(incCents: number, ratePct = 10): number {
  return roundHalfUp((incCents * ratePct) / (100 + ratePct));
}

/** Line-built invoices: sum ex lines, GST once, round half-up. */
export function fromExLines(lineExCents: readonly number[], ratePct = 10): GstSplit {
  const subtotalExCents = lineExCents.reduce((a, b) => a + b, 0);
  const gstCents = gstOnExCents(subtotalExCents, ratePct);
  return { subtotalExCents, gstCents, totalIncCents: subtotalExCents + gstCents };
}

/** Inc-anchored invoices: the total is the promise; GST is its component. */
export function fromIncTotal(totalIncCents: number, ratePct = 10): GstSplit {
  const gstCents = gstFromIncCents(totalIncCents, ratePct);
  return { subtotalExCents: totalIncCents - gstCents, gstCents, totalIncCents };
}
