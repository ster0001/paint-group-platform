"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { chargeOutCents } from "@/lib/pricing/estimate";
import type { RateItem } from "@/lib/pricing/types";

/**
 * Variation pricing — the office's side.
 *
 * The price is computed HERE, on the server, through lib/pricing's own
 * charge-out lookup: hours × the active rate card's charge-out for the job's
 * trade. No component multiplies anything, and the browser sends hours, never
 * money. The engine's inputs go to the database beside its output so the figure
 * can be recomputed and audited later.
 *
 * The CONTRACTOR's side of the same variation is not computed here at all —
 * wo_price_variation derives it in SQL from the "Contractor rate" setting, so
 * it cannot be influenced from this process either.
 *
 * GST — Tom's 24 Aug ruling: the price produced here is **GST-INCLUSIVE**.
 * It is the figure the customer sees and approves on /v/[token], and it is
 * charged exactly as approved — the invoice backs GST out of it
 * (lib/invoicing/variation.ts), never adds 10% on top. The variable names
 * below say IncGst so the rule is visible, not implied.
 */

export type VariationResult =
  | { ok: true; token?: string; state: string }
  | { ok: false; message: string };

const uuid = z.string().uuid();

const priceInput = z.object({
  variationId: uuid,
  hours: z.number().positive().max(200),
  // Optional materials/pass-through, in cents, entered by staff as a figure —
  // not a computation. Labour is the engine's business.
  materialsCents: z.number().int().min(0).max(5_000_000).default(0),
});

const WORDING: Record<string, string> = {
  not_staff: "You don't have permission to price variations.",
  not_found: "That variation no longer exists.",
  bad_price: "That price doesn't look right.",
  bad_hours: "Put in the hours this will take.",
  not_approved: "The customer hasn't approved this yet.",
  customer_not_approved: "The customer hasn't approved this yet.",
  not_released: "This hasn't been released to the contractor yet.",
  not_yours: "That job isn't yours.",
  photos_required: "Add at least one photo — a variation needs evidence.",
  no_comment: "Say what the variation is.",
  no_category: "Pick what kind of variation this is.",
};

function interpret(raw: unknown, okState: string): VariationResult {
  const s = String(raw ?? "");
  if (s.startsWith("ok:")) return { ok: true, state: okState, token: s.slice(3) };
  const reason = s.replace("error:", "").replace(/^already_/, "");
  return { ok: false, message: WORDING[s.replace("error:", "")] ?? WORDING[reason] ?? `Couldn't do that (${reason}).` };
}

export async function priceVariationAction(raw: unknown): Promise<VariationResult> {
  const parsed = priceInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the hours and try again." };
  }
  const { variationId, hours, materialsCents } = parsed.data;

  const supabase = await createClient();

  // Which job, and therefore which trade's charge-out applies.
  const { data: variation } = await supabase
    .from("wo_variations").select("id, work_order_id").eq("id", variationId).maybeSingle();
  if (!variation) return { ok: false, message: WORDING.not_found };

  const { data: wo } = await supabase
    .from("work_orders").select("estimate_id").eq("id", variation.work_order_id).maybeSingle();
  const { data: estimate } = wo?.estimate_id
    ? await supabase.from("estimates")
        .select("rate_card_id, builder_state").eq("id", wo.estimate_id).maybeSingle()
    : { data: null };

  const builder = (estimate?.builder_state ?? {}) as { blocks?: { type?: string }[]; hourlyRateOverride?: number | null };
  // Exterior unless the estimate is plainly interior — the same default the
  // builder uses when a job has no exterior block.
  const type = builder.blocks?.some((b) => b?.type === "exterior") === false ? "Interior" : "Exterior";

  const { data: rateRows } = await supabase
    .from("rate_items")
    .select("*")
    .eq("rate_card_id", estimate?.rate_card_id ?? "")
    .limit(500);

  const rateItems = (rateRows ?? []) as unknown as RateItem[];
  const perHour = chargeOutCents(type, rateItems, builder.hourlyRateOverride ?? null);
  const labourCents = Math.round(hours * perHour);
  // GST-INCLUSIVE (Tom's ruling): this is the whole price the customer
  // approves and pays. wo_variations.price_cents carries it verbatim.
  const priceIncGstCents = labourCents + materialsCents;

  const { data, error } = await supabase.rpc("wo_price_variation", {
    p_variation_id: variationId,
    p_price_cents: priceIncGstCents,
    p_inputs: { hours, chargeOutCents: perHour, type, materialsCents, incGst: true },
    p_priced_lines: [
      { label: `Labour — ${hours} hr at $${(perHour / 100).toFixed(2)}/hr`, cents: labourCents },
      ...(materialsCents > 0 ? [{ label: "Materials & sundries", cents: materialsCents }] : []),
    ],
    p_hours: hours,
  });
  if (error) return { ok: false, message: error.message };

  const result = interpret(data, "priced");
  if (result.ok) { revalidatePath("/quote"); revalidatePath("/portal/jobs"); }
  return result;
}

export async function releaseVariationAction(raw: unknown): Promise<VariationResult> {
  const parsed = z.object({ variationId: uuid }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid input." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_release_variation", {
    p_variation_id: parsed.data.variationId,
  });
  if (error) return { ok: false, message: error.message };
  const result = interpret(data, "released");
  if (result.ok) { revalidatePath("/quote"); revalidatePath("/portal/jobs"); }
  return result;
}
