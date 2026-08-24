"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
