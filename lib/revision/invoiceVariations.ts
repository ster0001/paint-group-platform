import type { SupabaseClient } from "@supabase/supabase-js";
import { APPROVED_VARIATION_STATUSES } from "@/lib/invoicing/ledger";
import type { InvoiceVariationRow } from "./invoiceDoc";

/**
 * The variations the revision INVOICE carries — read once here for the
 * builder page (the INVOICE tab) and the Download PDF route, so the screen and
 * the file count the same rows. Priced (awaiting the customer) and signed;
 * the document builder decides which become lines (lib/revision/invoiceDoc.ts).
 * A failed read is returned, never turned into "no variations".
 */
export async function loadInvoiceVariations(
  supabase: SupabaseClient,
  workOrderId: string,
): Promise<{ rows: InvoiceVariationRow[]; error: unknown }> {
  const { data, error } = await supabase.from("wo_variations")
    .select("id, status, price_cents, credit, comment, revision_block_ref, signed_at")
    .eq("work_order_id", workOrderId)
    .in("status", ["priced", ...APPROVED_VARIATION_STATUSES])
    .order("created_at", { ascending: true });
  if (error) return { rows: [], error };
  return { rows: (data ?? []) as InvoiceVariationRow[], error: null };
}
