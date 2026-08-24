"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { VARIATION_CATEGORIES } from "@/lib/workorder/variations";

/**
 * The contractor's side: raising a variation, and one-tapping the adjusted
 * offer once both approvals are in. Hours are a suggestion — the office prices
 * it — and no amount is ever sent from this side.
 */

export type RaiseResult = { ok: true; id: string } | { ok: false; message: string };
export type AcceptResult = { ok: true } | { ok: false; message: string };

const CATEGORY_CODES = VARIATION_CATEGORIES.map((c) => c.code) as [string, ...string[]];

const raiseInput = z.object({
  workOrderId: z.string().uuid(),
  category: z.enum(CATEGORY_CODES),
  comment: z.string().trim().min(4, "Say what you've found.").max(2000),
  photoIds: z.array(z.string().uuid()).min(1, "Add at least one photo."),
  estHours: z.number().positive().max(200).nullish(),
});

const WORDING: Record<string, string> = {
  photos_required: "Add at least one photo — a variation needs evidence.",
  no_comment: "Say what you've found.",
  no_category: "Pick what kind of variation this is.",
  bad_hours: "Those hours don't look right.",
  not_yours: "That job isn't yours.",
  not_found: "That job no longer exists.",
  customer_not_approved: "The customer hasn't approved this yet — we'll let you know.",
  not_released: "The office hasn't sent this over yet.",
};

export async function raiseVariationAction(raw: unknown): Promise<RaiseResult> {
  const parsed = raiseInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check that and try again." };
  const v = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_raise_variation", {
    p_work_order_id: v.workOrderId,
    p_category: v.category,
    p_comment: v.comment,
    p_photo_ids: v.photoIds,
    p_est_hours: v.estHours ?? null,
  });
  if (error) return { ok: false, message: "Couldn't send that just now — check your signal and try again." };

  const s = String(data ?? "");
  if (s.startsWith("ok:")) {
    revalidatePath("/portal/jobs");
    return { ok: true, id: s.slice(3) };
  }
  const reason = s.replace("error:", "");
  return { ok: false, message: WORDING[reason] ?? "Couldn't send that variation." };
}

/**
 * Acknowledge a signed credit (addendum ruling 2): the scope belongs to the
 * customer — no veto — and the deduction figure was either computed from the
 * engine's hours or set by the PC. This records that the contractor has seen it.
 */
export async function acknowledgeVariationAction(raw: unknown): Promise<AcceptResult> {
  const parsed = z.object({ variationId: z.string().uuid() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid input." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_contractor_acknowledge_variation", {
    p_variation_id: parsed.data.variationId,
  });
  if (error) return { ok: false, message: "Couldn't record that just now — try again." };

  const s = String(data ?? "");
  if (s.startsWith("ok:")) {
    revalidatePath("/portal/jobs");
    return { ok: true };
  }
  const reason = s.replace("error:", "").replace(/^already_/, "");
  if (reason === "awaiting_pc_deduction") {
    return { ok: false, message: "The office is still working out the pay adjustment — nothing to do yet." };
  }
  return { ok: false, message: WORDING[reason] ?? "Couldn't record that." };
}

export async function acceptVariationAction(raw: unknown): Promise<AcceptResult> {
  const parsed = z.object({ variationId: z.string().uuid() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid input." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_contractor_accept_variation", {
    p_variation_id: parsed.data.variationId,
  });
  if (error) return { ok: false, message: "Couldn't accept that just now — try again." };

  const s = String(data ?? "");
  if (s.startsWith("ok:")) {
    revalidatePath("/portal/jobs");
    return { ok: true };
  }
  const reason = s.replace("error:", "").replace(/^already_/, "");
  return { ok: false, message: WORDING[reason] ?? "Couldn't accept that." };
}
