"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type ColourMatchResult = { ok: true } | { ok: false; message: string };

/**
 * The painter (or the office) supplies a colour-match code for a product on a
 * job (Tom, 23 Aug). The RPC holds the rule (assigned contractor or staff);
 * it lands on work_orders.colours → product → match and clears the gate.
 */
export async function supplyColourMatch(raw: unknown): Promise<ColourMatchResult> {
  const parsed = z.object({
    workOrderId: z.string().uuid(),
    product: z.string().trim().min(1).max(200),
    code: z.string().trim().min(1).max(120),
    brand: z.string().trim().max(120).default(""),
    canSize: z.string().trim().max(60).default(""),
  }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "The colour code is needed." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_set_colour_match", {
    p_work_order_id: parsed.data.workOrderId, p_product: parsed.data.product,
    p_code: parsed.data.code, p_brand: parsed.data.brand, p_can_size: parsed.data.canSize,
  });
  if (error) return { ok: false, message: "Couldn't save that — check your signal and try again." };
  const s = String(data ?? "");
  if (s === "ok") {
    revalidatePath("/portal/jobs"); revalidatePath("/pc");
    return { ok: true };
  }
  if (s === "error:not_yours") return { ok: false, message: "That job isn't yours." };
  return { ok: false, message: s.replace("error:", "").replace(/_/g, " ") || "Couldn't save that just now." };
}
