"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { WO_STAGES } from "@/lib/workorder/stages";
import { seedRowsFromDoc } from "@/lib/workorder/surfaces";
import type { WorkOrderDoc } from "@/lib/workorder/snapshot";
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
const stageInput = z.object({
  workOrderId: uuid,
  to: z.enum(WO_STAGES),
  // Free-form context for the event row (which offer, which QA check). Never
  // money, never the actor — the RPC establishes who is asking from the session.
  meta: z.record(z.string(), z.unknown()).optional(),
});
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
  not_yours: "That job isn't yours to move.",
};

/** "illegal_transition:qa>closed" and "gate:…" carry their detail after the colon. */
function stageWording(reason: string): string | null {
  if (reason.startsWith("illegal_transition:")) {
    const [from, to] = reason.slice("illegal_transition:".length).split(">");
    return `A job can't go from ${from.replace(/_/g, " ")} to ${to.replace(/_/g, " ")}.`;
  }
  if (reason.startsWith("gate:")) return reason.slice("gate:".length);
  if (reason.startsWith("actor_not_allowed:")) return "You don't have permission to make that move.";
  return null;
}

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
  if (r.ok) {
    // Issuing is the moment the job sheet becomes real, so it is also the moment
    // the tick list should exist. Seeding is idempotent and never resets state,
    // so re-issuing refreshes wording and order without wiping a painter's day.
    await seedSurfaces(supabase, parsed.data.workOrderId);
    revalidatePath("/schedule");
    revalidatePath("/quote");
  }
  return r;
}

/**
 * Build the tick list from the estimate's saved work-order document — the same
 * document `issue_work_order` freezes. Best-effort: a work order that issues but
 * fails to seed is still issued, and the next issue (or a staff re-issue) will
 * seed it. Never blocks the issue itself.
 */
async function seedSurfaces(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workOrderId: string,
): Promise<void> {
  try {
    const { data: wo } = await supabase
      .from("work_orders").select("estimate_id").eq("id", workOrderId).maybeSingle();
    if (!wo?.estimate_id) return;

    const { data: est } = await supabase
      .from("estimates").select("builder_state").eq("id", wo.estimate_id).maybeSingle();
    const doc = (est?.builder_state as { woDoc?: WorkOrderDoc } | null)?.woDoc;
    if (!doc?.areas?.length) return;

    await supabase.rpc("wo_seed_surfaces", {
      p_work_order_id: workOrderId,
      p_rows: seedRowsFromDoc(doc),
    });
  } catch {
    // Seeding is a convenience, not a gate. Silence here is deliberate: the
    // issue succeeded, and a missing tick list is visible and re-seedable.
  }
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

/**
 * Move a work order along the seven-stage loop.
 *
 * Deliberately NOT staff-gated at this layer: a contractor reports the work
 * finished and a customer signs off, and each is allowed a different set of
 * moves. wo_advance_stage works out which of the three the caller is from the
 * session and checks the move against the transition table — so this action's
 * only jobs are to validate the shape and to translate the result into English.
 */
export async function advanceStageAction(raw: unknown): Promise<ActionResult> {
  const parsed = stageInput.safeParse(raw);
  if (!parsed.success) return { ok: false, kind: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid input." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, kind: "error", message: "Sign in to do that." };

  const { data, error } = await supabase.rpc("wo_advance_stage", {
    p_work_order_id: parsed.data.workOrderId,
    p_to: parsed.data.to,
    p_meta: parsed.data.meta ?? {},
  });
  if (error) return { ok: false, kind: "error", message: error.message };

  const raw_s = String(data ?? "");
  if (raw_s.startsWith("ok:")) {
    revalidatePath("/schedule");
    revalidatePath("/quote");
    revalidatePath("/portal/jobs");
    return { ok: true, state: raw_s.slice(3) };
  }

  const reason = raw_s.replace("error:", "");
  const message = stageWording(reason) ?? WORDING[reason] ?? `Couldn't move that job (${reason}).`;
  return { ok: false, kind: "error", message };
}
