"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring/report";

/**
 * Deleting an estimate.
 *
 * The refusals live in the database (`delete_estimate`), not here — a route can
 * be gone around, a function cannot. This action's job is to check the caller
 * is staff, tidy up the files the database cannot reach, and turn the
 * function's answer into a sentence.
 */

const input = z.object({ estimateId: z.string().uuid() });

export type DeleteResult = { ok: true } | { ok: false; message: string };

const WORDING: Record<string, string> = {
  not_staff: "You don't have permission to delete estimates.",
  not_found: "That estimate no longer exists.",
  accepted: "This estimate has been accepted, so it can't be deleted. It's the record of what the customer agreed to.",
  has_invoice: "There's an invoice against this estimate. Deleting it would leave the invoice with nothing behind it — cancel the invoice first.",
  has_work_order: "There's a work order on this estimate, so a contractor may already have been offered the job. Cancel the booking and the work order first.",
};

export async function deleteEstimateAction(raw: unknown): Promise<DeleteResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const { estimateId } = parsed.data;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: WORDING.not_staff };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "staff") return { ok: false, message: WORDING.not_staff };

  // Uploaded plans and photos live in storage; the rows cascade but the FILES
  // do not, so they are cleared first. Best-effort on purpose: a leftover file
  // is not a reason to block a delete the database is happy with.
  const { data: sources } = await supabase
    .from("estimate_sources")
    .select("storage_path")
    .eq("estimate_id", estimateId);
  const paths = (sources ?? []).map((s) => s.storage_path).filter(Boolean);
  if (paths.length) {
    const { error } = await supabase.storage.from("estimate-sources").remove(paths);
    if (error) reportError(error, { where: "estimates.delete.storage", bestEffort: true, extra: { estimateId } });
  }

  const { data, error } = await supabase.rpc("delete_estimate", { p_estimate_id: estimateId });
  if (error) {
    reportError(error, { where: "estimates.delete" });
    return { ok: false, message: error.message };
  }

  const answer = String(data ?? "");
  if (answer === "ok:deleted") {
    revalidatePath("/estimates");
    return { ok: true };
  }

  const reason = answer.replace("error:", "");
  return { ok: false, message: WORDING[reason] ?? `That couldn't be deleted (${reason}).` };
}

/**
 * Tom, 15 Sep: tick rows on "Waiting on you" and take them off THAT list.
 *
 * This is not a dismissal. `dismissWorkItem` (app/crm/actions.ts) silences a
 * key for the whole queue — Today, the badge, every view — and asks for a
 * reason. This hides the key from one screen, the estimates page, and nothing
 * else changes: the evaluator never reads `estimates_waiting_hidden`, so the
 * CRM still shows the item and still counts it.
 *
 * Optimistic on the client; the server answer only matters when it refuses.
 */
const keys = z.array(z.string().regex(/^[a-z_]+:[a-z_]+:[^:]+:[a-zA-Z0-9_-]+$/)).min(1).max(200);

export type HideResult = { ok: true } | { ok: false; message: string };

async function setHidden(raw: unknown, fn: "estimates_hide_waiting" | "estimates_unhide_waiting"): Promise<HideResult> {
  const parsed = keys.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, { p_item_keys: parsed.data });
  if (error) {
    reportError(error, { where: `estimates.waiting.${fn}` });
    return {
      ok: false,
      message: /does not exist|schema cache/i.test(error.message)
        ? "Removing rows from this list needs migration 20270147 run first."
        : error.code === "42501" ? "You don't have permission to change this list." : error.message,
    };
  }
  revalidatePath("/estimates");
  return { ok: true };
}

export async function hideWaitingItemsAction(raw: unknown): Promise<HideResult> {
  return setHidden(raw, "estimates_hide_waiting");
}

export async function unhideWaitingItemsAction(raw: unknown): Promise<HideResult> {
  return setHidden(raw, "estimates_unhide_waiting");
}
