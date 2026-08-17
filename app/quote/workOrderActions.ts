"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/(app)/schedule/actions";

/**
 * Work-order actions.
 *
 * Issuing takes no document and no amount: the server reads both from the
 * estimate's saved work-order document, so this route cannot be used to inject
 * a contractor payment.
 */

const uuid = z.string().uuid("expected an id");

const issueInput = z.object({ workOrderId: uuid });
const scheduleInput = z.object({
  workOrderId: uuid,
  contractorId: uuid.nullish(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

async function staffClient() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  return profile?.role === "staff" ? supabase : null;
}

const WORDING: Record<string, string> = {
  not_staff: "You don't have permission to do that.",
  nothing_to_issue: "Save the estimate first — there's no work order document yet.",
  not_found: "That work order no longer exists.",
  live_offer: "There's a live offer on this job. Withdraw it before reassigning.",
};

function interpret(raw: unknown): ActionResult {
  const s = String(raw ?? "");
  if (s.startsWith("ok:")) return { ok: true, state: s.slice(3) };
  if (s.startsWith("conflict:")) {
    const actual = s.slice(9);
    return { ok: false, kind: "conflict", actualState: actual, message: WORDING[actual] ?? "This has changed — refresh." };
  }
  const reason = s.replace("error:", "");
  return { ok: false, kind: "error", message: WORDING[reason] ?? `Couldn't complete that (${reason}).` };
}

export async function issueWorkOrderAction(raw: unknown): Promise<ActionResult> {
  const parsed = issueInput.safeParse(raw);
  if (!parsed.success) return { ok: false, kind: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  const supabase = await staffClient();
  if (!supabase) return { ok: false, kind: "error", message: WORDING.not_staff };

  const { data, error } = await supabase.rpc("issue_work_order", { p_work_order_id: parsed.data.workOrderId });
  if (error) return { ok: false, kind: "error", message: error.message };
  const r = interpret(data);
  if (r.ok) { revalidatePath("/schedule"); revalidatePath("/quote"); }
  return r;
}

export async function setWorkOrderScheduleAction(raw: unknown): Promise<ActionResult> {
  const parsed = scheduleInput.safeParse(raw);
  if (!parsed.success) return { ok: false, kind: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  const supabase = await staffClient();
  if (!supabase) return { ok: false, kind: "error", message: WORDING.not_staff };
  const v = parsed.data;

  // A null contractor means "unassign", which coalesce-based updates can't express.
  if (v.contractorId === null) {
    const { data, error } = await supabase.rpc("clear_work_order_contractor", { p_work_order_id: v.workOrderId });
    if (error) return { ok: false, kind: "error", message: error.message };
    const r = interpret(data);
    if (r.ok) revalidatePath("/schedule");
    return r;
  }

  const { data, error } = await supabase.rpc("set_work_order_schedule", {
    p_work_order_id: v.workOrderId,
    p_contractor_id: v.contractorId ?? null,
    p_start_date: v.startDate ?? null,
  });
  if (error) return { ok: false, kind: "error", message: error.message };
  const r = interpret(data);
  if (r.ok) revalidatePath("/schedule");
  return r;
}
