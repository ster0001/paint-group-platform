/**
 * Variation money — Tom's 24 Aug ruling, made explicit:
 *
 * **The figure the customer approves on /v/[token] is GST-INCLUSIVE.**
 * Customers see inc-GST prices everywhere on this platform; nobody approves
 * $883 and gets billed $971.30. So `wo_variations.price_cents` IS the
 * charged amount, the ledger adds it to the adjusted contract as-is, and the
 * invoice line backs the GST out (ex = approved − approved×r/(100+r)) —
 * never adds 10% on top.
 *
 * The SQL twin is the variations loop in `invoice_draft_final`
 * (20261112000000_invoicing_core.sql §9b):
 *   price_cents − gst_from_inc_cents(price_cents)
 * variation.test.ts pins both to the same expression, and its golden test is
 * the ruling itself: approved figure = invoiced line total, to the cent.
 */

import { gstFromIncCents } from "./gst";

/** The ex-GST amount an approved variation contributes as an invoice line. */
export function variationLineExCents(approvedIncGstCents: number, ratePct = 10): number {
  return approvedIncGstCents - gstFromIncCents(approvedIncGstCents, ratePct);
}

/** What the customer is charged for the variation — the approved figure,
 *  exactly. Exists so call sites read as the rule, not as arithmetic. */
export function variationChargedIncCents(approvedIncGstCents: number, ratePct = 10): number {
  return variationLineExCents(approvedIncGstCents, ratePct)
    + gstFromIncCents(approvedIncGstCents, ratePct);
}
