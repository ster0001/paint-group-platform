"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureContractorInvoicePdf } from "@/lib/invoicing/pdf";

/**
 * The contractor's one tap (Step 5). Everything money-shaped happens in
 * contractor_invoice_submit — recompute, entity/GST pinning, numbering — this
 * only carries the id and translates refusals into something a painter on a
 * phone can act on.
 */

export type SubmitCiResult = { ok: true } | { ok: false; message: string };

const PROFILE_WORDING: Record<string, string> = {
  company_name: "your company name",
  address: "your business address",
  abn: "a valid 11-digit ABN",
  bank: "your bank details",
};

export async function submitContractorInvoiceAction(raw: unknown): Promise<SubmitCiResult> {
  const parsed = z.object({ id: z.string().uuid() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid input." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("contractor_invoice_submit", { p_id: parsed.data.id });
  if (error) return { ok: false, message: "Couldn't submit just now — check your signal and try again." };

  const s = String(data ?? "");
  if (s === "ok:submitted") {
    revalidatePath("/portal/money");
    // Their invoice document renders behind the response — heal-on-view backs it up.
    after(async () => { await ensureContractorInvoicePdf(parsed.data.id); });
    return { ok: true };
  }
  if (s.startsWith("error:profile_incomplete:")) {
    const field = s.split(":")[2] ?? "";
    return {
      ok: false,
      message: `Your profile still needs ${PROFILE_WORDING[field] ?? field} — finish it under Profile, then submit.`,
    };
  }
  if (s === "error:deduction_pending") {
    return { ok: false, message: "The office is still finalising a pay adjustment on this job — you'll see the figure here before you submit." };
  }
  if (s.startsWith("error:already_")) {
    return { ok: false, message: "This one is already in — nothing more to do." };
  }
  if (s === "error:not_yours") return { ok: false, message: "That invoice isn't yours." };
  return { ok: false, message: "Couldn't submit that invoice." };
}

/**
 * A payment claim (Tom, 24 Aug follow-up #2): the contractor invoices at any
 * time — a percent of their adjusted job pay or a fixed dollar figure. The
 * RPC computes and bounds everything (≤ what remains uninvoiced) and the row
 * is born submitted; the PDF renders behind the response.
 */
export type ClaimResult = { ok: true; id: string } | { ok: false; message: string };

const claimInput = z.object({
  workOrderId: z.string().uuid(),
  mode: z.enum(["percent", "fixed"]),
  // percent 1–100, or DOLLARS for fixed — intent either way; the RPC bounds it.
  value: z.number().positive().max(1_000_000),
  // The contractor's OWN line items + invoice date (Tom, 25 Aug). The RPC
  // verifies the lines sum to the claimed figure and bounds the date.
  lines: z.array(z.object({
    label: z.string().trim().min(1).max(200),
    cents: z.number().int().positive().max(100_000_000),
  })).max(12).optional(),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function requestClaimAction(raw: unknown): Promise<ClaimResult> {
  const parsed = claimInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Check the amount and try again." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("contractor_invoice_request", {
    p_work_order_id: parsed.data.workOrderId,
    p_mode: parsed.data.mode,
    p_value: parsed.data.value,
    p_lines: parsed.data.lines ?? null,
    p_invoice_date: parsed.data.invoiceDate ?? null,
  });
  if (error) return { ok: false, message: "Couldn't send that just now — try again." };

  const s = String(data ?? "");
  if (s.startsWith("ok:")) {
    const id = s.slice(3);
    revalidatePath("/portal/money");
    after(async () => { await ensureContractorInvoicePdf(id); });
    return { ok: true, id };
  }
  if (s.startsWith("error:profile_incomplete:")) {
    const field = s.split(":")[2] ?? "";
    return { ok: false, message: `Your profile still needs ${PROFILE_WORDING[field] ?? field} — finish it under Profile first.` };
  }
  const MESSAGES: Record<string, string> = {
    "error:deduction_pending": "The office is still finalising a pay adjustment on this job — claims open again once it's set.",
    "error:nothing_remaining": "This job is fully invoiced already.",
    "error:exceeds_remaining": "That's more than what's left to invoice on this job.",
    "error:bad_percent": "The percentage needs to be between 1 and 100.",
    "error:bad_amount": "That amount doesn't look right.",
    "error:not_yours": "That job isn't yours.",
  };
  return { ok: false, message: MESSAGES[s] ?? "Couldn't send that claim." };
}
