"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sendEstimateInput } from "@/lib/validation/estimate";
import type { ActionResult } from "@/app/(app)/schedule/actions";

/**
 * Estimate lifecycle actions.
 *
 * Sending is a guarded transition, not a column write: the database refuses to
 * send an accepted quote, and refuses if the screen's idea of the current
 * status is out of date.
 */
export async function sendEstimateAction(raw: unknown): Promise<ActionResult> {
  const parsed = sendEstimateInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, kind: "invalid", message: parsed.error.issues[0]?.message ?? "That input isn't valid." };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, kind: "error", message: "You don't have permission to do that." };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "staff") return { ok: false, kind: "error", message: "You don't have permission to do that." };

  const v = parsed.data;
  const { data, error } = await supabase.rpc("send_estimate", {
    p_estimate_id: v.estimateId,
    p_expected_status: v.expectedStatus,
    p_valid_until: v.validUntil ?? null,
  });
  if (error) return { ok: false, kind: "error", message: error.message };

  const s = String(data ?? "");
  if (s.startsWith("ok:")) {
    revalidatePath("/estimates");
    return { ok: true, state: s.slice(3) };
  }
  if (s.startsWith("conflict:")) {
    const actual = s.slice(9);
    return {
      ok: false,
      kind: "conflict",
      actualState: actual,
      message: actual === "accepted"
        ? "This quote has been accepted and is locked — it can't be re-sent."
        : "This estimate has changed since the page loaded — refresh.",
    };
  }
  const reason = s.replace("error:", "");
  const wording: Record<string, string> = {
    not_staff: "You don't have permission to do that.",
    not_saved: "Save the estimate before sending it.",
    nothing_to_send: "There's nothing published yet — save first.",
    not_found: "That estimate no longer exists.",
  };
  return { ok: false, kind: "error", message: wording[reason] ?? `Couldn't send that (${reason}).` };
}
