"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { reportError } from "@/lib/monitoring/report";
import { staffContractorInvoice } from "@/lib/staff/notify";

/**
 * Painter status Step 7 (Tom, 8 Oct 2026): a contractor CLAIMS an approved
 * bonus. The RPC raises a submitted contractor invoice for it through the
 * normal channel; the office hears about it the way it hears about any
 * submitted invoice.
 */
export async function claimBonusAction(raw: unknown): Promise<{ ok: boolean; message: string }> {
  const parsed = z.object({ bonusId: z.string().uuid() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Couldn't read that — try again." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bonus_claim", { p_id: parsed.data.bonusId });
  if (error) { reportError(error, { where: "bonus.claim" }); return { ok: false, message: "Couldn't raise the invoice — it has been reported." }; }
  const r = String(data ?? "");
  if (r.startsWith("error:profile_incomplete:")) return { ok: false, message: "Finish your profile first (company name, ABN and bank details) — then claim it." };
  if (r === "error:already_claimed") return { ok: false, message: "Already claimed — it is on an invoice in your list." };
  if (r === "error:employee_payroll") return { ok: false, message: "Your bonus goes through payroll — nothing to claim here." };
  if (!r.startsWith("ok:")) return { ok: false, message: `Couldn't claim it (${r}).` };
  const service = createServiceClient();
  if (service) await staffContractorInvoice(service, r.slice(3));
  revalidatePath("/portal/money"); revalidatePath("/portal");
  return { ok: true, message: "Claimed. Your bonus invoice is in the list below and is paid like any other." };
}
