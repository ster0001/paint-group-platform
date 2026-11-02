import type { SheetDoc, SheetLine } from "@/app/i/[token]/InvoiceSheet";
import { APPROVED_VARIATION_STATUSES } from "@/lib/invoicing/ledger";
import { gstFromIncCents, gstOnExCents } from "@/lib/invoicing/gst";
import { variationLineExCents } from "@/lib/invoicing/variation";

/**
 * The revision builder's INVOICE — one document for the preview tab and the
 * PDF the office downloads for a customer who wants to see the costs (Tom,
 * 2 Nov 2026). Both call this, so the screen and the file cannot disagree.
 *
 * Contract part: the working scope's lines and its ex-GST subtotal, priced by
 * lib/pricing in the builder. GST on it is ONE rule (gstOnExCents — the same
 * Math.round(net × rate) the pricing module uses).
 *
 * Variations: every PRICED or SIGNED row on the job is in, pending ones too.
 *  · A builder-drafted variation (revision_block_ref set) is already inside
 *    the working scope's figures — it is never added again; a pending one is
 *    only NAMED in `pendingInScope` so the customer can see which.
 *  · A quick-priced variation (hours path from PC Command, no block ref) is
 *    NOT in the working scope — it becomes its own line, at the figure the
 *    customer approves (GST-inclusive, Tom's 24 Aug ruling), backed out to ex
 *    the way invoice_draft_final does. Pending lines carry `pending`.
 * Raised (unpriced), declined and cancelled rows never appear.
 */

export type InvoiceVariationRow = {
  id: string;
  status: string;
  price_cents: number | null;
  credit: boolean | null;
  comment: string | null;
  revision_block_ref: string | null;
  signed_at: string | null;
};

export type PendingInScope = { title: string; incCents: number; credit: boolean };

const isApproved = (s: string) => (APPROVED_VARIATION_STATUSES as readonly string[]).includes(s);

/** The Melbourne calendar day an instant fell on (never the UTC slice). */
const melbourneDay = (iso: string | null): string | null =>
  iso ? new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso)) : null;

export function revisionInvoiceDoc(input: {
  header: { billed_to: string; job_address: string; job_title: string };
  /** The working scope's lines, ex GST (discount as a negative adjustment). */
  contractLines: SheetLine[];
  /** The working scope's net ex-GST subtotal, from lib/pricing. */
  contractSubtotalExCents: number;
  variations: readonly InvoiceVariationRow[];
  gstRatePct?: number;
}): { doc: SheetDoc; pendingInScope: PendingInScope[]; pendingCount: number } {
  const rate = input.gstRatePct ?? 10;
  const varLines: SheetLine[] = [];
  let varExCents = 0;
  let varGstCents = 0;
  const pendingInScope: PendingInScope[] = [];
  for (const v of input.variations) {
    if (v.price_cents == null) continue;
    const approved = isApproved(v.status);
    const pending = v.status === "priced";
    if (!approved && !pending) continue;
    const credit = Boolean(v.credit);
    const title = v.comment?.trim() || "Change to the scope";
    if (v.revision_block_ref) {
      if (pending) pendingInScope.push({ title, incCents: v.price_cents, credit });
      continue;
    }
    const sign = credit ? -1 : 1;
    const ex = sign * variationLineExCents(v.price_cents, rate);
    varExCents += ex;
    varGstCents += sign * gstFromIncCents(v.price_cents, rate);
    varLines.push({
      description: `${credit ? "Credit" : "Variation"} — ${title}`,
      amount_ex_cents: ex,
      source: "variation",
      qty: null,
      approved_on: approved ? melbourneDay(v.signed_at) : null,
      pending,
    });
  }
  const contractGst = gstOnExCents(input.contractSubtotalExCents, rate);
  const subtotal = input.contractSubtotalExCents + varExCents;
  const gst = contractGst + varGstCents;
  return {
    doc: {
      number: null, kind: "final", status: "draft",
      issued_on: null, due_on: null,
      subtotal_ex_cents: subtotal,
      gst_cents: gst,
      total_inc_cents: subtotal + gst,
      ...input.header,
      lines: [...input.contractLines, ...varLines],
      payments: [], paid_cents: 0,
      adjusted_contract_cents: null,
      previously_invoiced_cents: null, previous_numbers: null,
    },
    pendingInScope,
    pendingCount: pendingInScope.length + varLines.filter((l) => l.pending).length,
  };
}
