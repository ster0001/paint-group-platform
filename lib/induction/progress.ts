import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import { reportError } from "@/lib/monitoring/report";
import { createClient } from "@/lib/supabase/server";
import { parseInductionStatus, type InductionStatus } from "./status";

/**
 * Who has ticked what — read through the RPCs of 20270270, which hold the ONE
 * rule (induction_status_of / induction_gate_of). Every read keeps its error.
 */

/** The signed-in painter's own position (contractor or worker login), once per request. */
export const loadMyInduction = cache(async (): Promise<{ status: InductionStatus | null; error: string | null }> => {
  const supabase = await createClient();
  return loadInductionStatusFor(supabase, null);
});

/** One login's position: the session's own (null) or, for staff, anyone's. */
export async function loadInductionStatusFor(supabase: SupabaseClient, profileId: string | null): Promise<{ status: InductionStatus | null; error: string | null }> {
  const { data, error } = await supabase.rpc("induction_status", { p_profile_id: profileId });
  if (error) {
    reportError(error, { where: "induction.status", bestEffort: true, extra: { profileId } });
    return { status: null, error: error.code === "42883" ? "migration 20270270 not applied" : error.message };
  }
  return { status: parseInductionStatus(data), error: null };
}

export type InductionStatusRow = {
  contractorId: string; profileId: string; kind: "full" | "refresher";
  ticked: number; total: number; complete: boolean; completedAt: string | null;
  checkPassed: boolean; gate: "ok" | "induction_incomplete" | "check_not_passed" | null;
  invitedAt: string | null; graceUntil: string | null; language: string | null;
};

/** Every contractor at once (staff session or the service client). */
export async function loadInductionStatuses(supabase: SupabaseClient): Promise<{ rows: InductionStatusRow[]; error: string | null }> {
  const { data, error } = await supabase.rpc("induction_statuses");
  if (error) {
    reportError(error, { where: "induction.statuses" });
    return { rows: [], error: error.code === "42883" ? "migration 20270270 not applied" : error.message };
  }
  const rows = ((data ?? []) as {
    contractor_id: string; profile_id: string; kind: string; ticked: number | null; total: number | null; complete: boolean; completed_at: string | null;
    check_passed: boolean; gate: string | null; invited_at: string | null; grace_until: string | null; language: string | null;
  }[]).map((r) => ({
    contractorId: r.contractor_id, profileId: r.profile_id, kind: r.kind === "refresher" ? "refresher" as const : "full" as const,
    ticked: r.ticked ?? 0, total: r.total ?? 0, complete: r.complete, completedAt: r.completed_at, checkPassed: r.check_passed,
    gate: r.gate === "ok" ? "ok" as const : r.gate === "induction_incomplete" ? "induction_incomplete" as const : r.gate === "check_not_passed" ? "check_not_passed" as const : null,
    invitedAt: r.invited_at, graceUntil: r.grace_until, language: r.language,
  }));
  return { rows, error: null };
}

/**
 * The painter's practice job, for the "On your phone" steps on a module: a
 * contractor's own demo work order, or the demo their contractor shared with a
 * worker login. Null when there is none yet.
 */
export async function myDemoWorkOrderId(supabase: SupabaseClient, isWorker: boolean): Promise<string | null> {
  if (isWorker) {
    const { data, error } = await supabase.rpc("worker_jobs", { p_work_order_id: null });
    if (error) { reportError(error, { where: "induction.demoJob.worker", bestEffort: true }); return null; }
    return ((data ?? []) as { work_order_id: string; is_demo: boolean }[]).find((j) => j.is_demo)?.work_order_id ?? null;
  }
  // A read by the demo flag on the painter's own rows: what the demo boundary allows.
  const { data, error } = await supabase.from("work_orders").select("id").eq("is_demo", true).order("created_at", { ascending: false }).limit(1);
  if (error) { reportError(error, { where: "induction.demoJob", bestEffort: true }); return null; }
  return ((data ?? []) as { id: string }[])[0]?.id ?? null;
}
