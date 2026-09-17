"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type AssignmentResult = { ok: true; state: string } | { ok: false; message: string };

const WORDING: Record<string, string> = {
  not_yours: "That job isn't yours.",
  released: "You've been taken off this job — the office will have been in touch.",
  not_found: "That assignment no longer exists — pull down to refresh.",
  reason_too_long: "Keep the reason under 300 characters.",
};

async function call(fn: string, args: Record<string, unknown>): Promise<AssignmentResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, message: "Couldn't save that — check your signal and try again." };
  const s = String(data ?? "");
  if (s.startsWith("ok:")) {
    revalidatePath("/portal");
    revalidatePath("/portal/jobs");
    return { ok: true, state: s.slice(3) };
  }
  const reason = s.startsWith("error:") ? s.slice(6) : s;
  return { ok: false, message: WORDING[reason] ?? "Couldn't save that just now." };
}

/**
 * The employee's one-tap Accept (ruling 2): "I've seen it". Idempotent; the
 * RPC refuses anyone but the painter it belongs to. Nothing downstream waits.
 */
export async function acknowledgeAssignmentAction(raw: unknown): Promise<AssignmentResult> {
  const parsed = z.object({ assignmentId: z.string().uuid() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That didn't make sense — pull down to refresh." };
  return call("acknowledge_assignment", { p_assignment_id: parsed.data.assignmentId });
}

/**
 * "Can't make it" (ruling 11): a reason, an event, and a Reassign item for the
 * office. The assignment itself does not change — the office decides.
 */
export async function cantMakeItAction(raw: unknown): Promise<AssignmentResult> {
  const parsed = z.object({
    assignmentId: z.string().uuid(),
    reason: z.string().transform((t) => t.trim()).pipe(z.string().min(1, "Say why, in a few words.").max(300)),
  }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Say why, in a few words." };
  const r = await call("assignment_cant_make_it", { p_assignment_id: parsed.data.assignmentId, p_reason: parsed.data.reason });
  if (r.ok) { revalidatePath("/crm/today"); revalidatePath("/pc"); }
  return r;
}
