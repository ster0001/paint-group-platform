import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/monitoring/report";
import { loadStandardsStatuses } from "@/lib/standards/status";
import { buildContractorsView, type ContractorsInputs, type ContractorsView } from "./contractorsView";

/**
 * The inputs of the Contractors view, in one round of reads, for a staff
 * session (RLS: staff read everything here; the bonus table only owner / admin
 * / PC — a refusal there leaves the bonus column empty and is reported, not
 * hidden). Shared by PC Command → Contractors and the home dashboard.
 */
export async function loadContractorsView(db: SupabaseClient, now = new Date()): Promise<{ view: ContractorsView; error: string | null }> {
  const since = new Date(now.getTime() - 400 * 86_400_000).toISOString();
  const [painters, statuses, changes, bonuses, callbacks, standards, results, jobs] = await Promise.all([
    db.from("contractors").select("id, company_name, employment_type, active, profiles(name)").order("company_name"),
    db.from("painter_status").select("painter_id, colour, line, streak, best_streak, bonus_counter, measures, offers_cleared_at, computed_at"),
    db.from("contractor_events").select("contractor_id, created_at, detail").eq("type", "status_changed").gte("created_at", since).order("created_at", { ascending: false }).limit(1000),
    db.from("painter_bonuses").select("id, painter_id, status, amount_cents, decided_at, triggered_at"),
    db.from("wo_callbacks").select("id, painter_id, work_order_id, status, work_orders(wo_ref)").in("status", ["open", "booked", "fixed"]),
    loadStandardsStatuses(db),
    db.from("painter_job_results").select("painter_id, work_order_id, result, reasons, hours, signed_on, work_orders(wo_ref, wo_snapshot)").neq("result", "pending").order("signed_on", { ascending: false }).limit(2000),
    db.from("work_orders").select("id, wo_ref, stage, contractor_id, wo_snapshot").not("contractor_id", "is", null).in("stage", ["booked", "pre_start", "in_progress", "qa", "walkthrough", "completion_prep", "closed"]).order("created_at", { ascending: false }).limit(600),
  ]);
  const failures: string[] = [];
  for (const [label, r] of [["painters", painters], ["painter status", statuses], ["status history", changes], ["call backs", callbacks], ["job results", results], ["jobs", jobs]] as const) {
    if (r.error) { reportError(r.error, { where: `contractorsView.${label}` }); failures.push(label); }
  }
  if (bonuses.error && !/permission|policy|42501/i.test(bonuses.error.message)) { reportError(bonuses.error, { where: "contractorsView.bonuses" }); failures.push("bonus reviews"); }
  if (standards.error) failures.push("standards");

  type CRow = { id: string; company_name: string | null; employment_type: string | null; active: boolean; profiles: { name: string | null } | null };
  type Snap = { jobAddress?: string; jobTitle?: string } | null;
  const titleOf = (ref: string | null | undefined, snap: Snap) => snap?.jobAddress || snap?.jobTitle || ref || "A job";
  const inputs: ContractorsInputs = {
    painters: ((painters.data ?? []) as unknown as CRow[]).map((c) => ({ id: c.id, name: c.profiles?.name?.trim() || c.company_name?.trim() || "A painter", employmentType: c.employment_type === "employee" ? "employee" : "contractor", active: c.active })),
    statuses: ((statuses.data ?? []) as { painter_id: string; colour: ContractorsInputs["statuses"][number]["colour"]; line: string; streak: number; best_streak: number; bonus_counter: number; measures: ContractorsInputs["statuses"][number]["measures"]; offers_cleared_at: string | null; computed_at: string }[])
      .map((s) => ({ painterId: s.painter_id, colour: s.colour, line: s.line, streak: s.streak, bestStreak: s.best_streak, bonusCounter: s.bonus_counter, measures: s.measures ?? {}, offersClearedAt: s.offers_cleared_at, computedAt: s.computed_at })),
    changes: ((changes.data ?? []) as { contractor_id: string; created_at: string; detail: { to?: string } | null }[])
      .filter((c) => c.detail?.to).map((c) => ({ painterId: c.contractor_id, at: c.created_at, to: c.detail!.to as ContractorsInputs["changes"][number]["to"] })),
    bonuses: bonuses.error ? [] : ((bonuses.data ?? []) as { id: string; painter_id: string; status: string; amount_cents: number | null; decided_at: string | null; triggered_at: string }[])
      .map((b) => ({ id: b.id, painterId: b.painter_id, status: b.status, amountCents: b.amount_cents, decidedAt: b.decided_at, triggeredAt: b.triggered_at })),
    callbacks: ((callbacks.data ?? []) as unknown as { id: string; painter_id: string; work_order_id: string; status: string; work_orders: { wo_ref: string | null } | null }[])
      .map((c) => ({ id: c.id, painterId: c.painter_id, workOrderId: c.work_order_id, status: c.status, woRef: c.work_orders?.wo_ref ?? null })),
    standards: standards.rows.map((s) => ({ painterId: s.contractorId, status: s.status })),
    results: ((results.data ?? []) as unknown as { painter_id: string; work_order_id: string; result: "clean" | "not_clean"; reasons: string[] | null; hours: number; signed_on: string | null; work_orders: { wo_ref: string | null; wo_snapshot: Snap } | null }[])
      .map((r) => ({ painterId: r.painter_id, workOrderId: r.work_order_id, result: r.result, reasons: r.reasons ?? [], hours: Number(r.hours), signedOn: r.signed_on, title: titleOf(r.work_orders?.wo_ref, r.work_orders?.wo_snapshot ?? null) })),
    jobs: ((jobs.data ?? []) as { id: string; wo_ref: string; stage: string; contractor_id: string; wo_snapshot: Snap }[])
      .map((j) => ({ painterId: j.contractor_id, workOrderId: j.id, woRef: j.wo_ref, title: titleOf(j.wo_ref, j.wo_snapshot), stage: j.stage })),
  };
  return { view: buildContractorsView(inputs, now), error: failures.length ? `Couldn't read ${failures.join(", ")}` : null };
}
