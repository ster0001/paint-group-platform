import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/monitoring/report";
import type { Colour, Measures } from "./evaluate";

/**
 * The painter's own status, read through THEIR session (Step 6). RLS does the
 * gating: a painter reads only their own row, and no row at all while the
 * office keeps status staff-only (painter_status_visible(), ⚑21) — so "null"
 * here means "show nothing", whichever reason. An employed painter who never
 * led a job has no row either (R17). Nothing is computed here.
 */

export type MyStatus = {
  colour: Colour;
  streak: number;
  bestStreak: number;
  stepsToGreen: number;
  bonusCounter: number;
  measures: Partial<Measures>;
  line: string;
  computedAt: string;
};

export type MyJobResult = {
  workOrderId: string;
  title: string;
  result: "pending" | "clean" | "not_clean";
  reasons: string[];
  hours: number;
  countsForBonus: boolean;
  signedOn: string | null;
};

type StatusRow = { colour: Colour; streak: number; best_streak: number; bonus_counter: number; measures: Partial<Measures> & { stepsToGreen?: number }; line: string; computed_at: string };
type ResultRow = {
  work_order_id: string; result: MyJobResult["result"]; reasons: string[] | null; hours: number; counts_for_bonus: boolean; signed_on: string | null;
  work_orders: { wo_ref: string | null; wo_snapshot: { jobTitle?: string; jobAddress?: string } | null } | null;
};

export async function loadMyStatus(supabase: SupabaseClient, contractorId: string, lookback = 10): Promise<{ status: MyStatus | null; jobs: MyJobResult[]; error: string | null }> {
  const { data, error } = await supabase.from("painter_status").select("colour, streak, best_streak, bonus_counter, measures, line, computed_at").eq("painter_id", contractorId).maybeSingle();
  if (error) { reportError(error, { where: "painterStatus.mine", extra: { contractorId } }); return { status: null, jobs: [], error: error.message }; }
  const row = data as StatusRow | null;
  if (!row) return { status: null, jobs: [], error: null };
  const status: MyStatus = {
    colour: row.colour, streak: row.streak, bestStreak: row.best_streak, bonusCounter: row.bonus_counter,
    stepsToGreen: row.measures?.stepsToGreen ?? 0, measures: row.measures ?? {}, line: row.line, computedAt: row.computed_at,
  };
  const res = await supabase.from("painter_job_results")
    .select("work_order_id, result, reasons, hours, counts_for_bonus, signed_on, work_orders(wo_ref, wo_snapshot)")
    .eq("painter_id", contractorId).neq("result", "pending").order("signed_on", { ascending: false }).limit(lookback);
  if (res.error) { reportError(res.error, { where: "painterStatus.mine.jobs", extra: { contractorId } }); return { status, jobs: [], error: res.error.message }; }
  const jobs = ((res.data ?? []) as unknown as ResultRow[]).map((r) => ({
    workOrderId: r.work_order_id,
    title: r.work_orders?.wo_snapshot?.jobAddress || r.work_orders?.wo_snapshot?.jobTitle || r.work_orders?.wo_ref || "A job",
    result: r.result, reasons: r.reasons ?? [], hours: r.hours, countsForBonus: r.counts_for_bonus, signedOn: r.signed_on,
  })).reverse(); // oldest on the left
  return { status, jobs, error: null };
}
