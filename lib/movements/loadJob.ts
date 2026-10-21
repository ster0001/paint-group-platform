import type { SupabaseClient } from "@supabase/supabase-js";
import { realOnly } from "@/lib/demo/scope";
import { isMissingRpc } from "@/lib/supabase/missingRpc";
import { gates, type Gates, type World } from "./evaluate";
import { DEFAULT_MOVEMENTS_SETTINGS, type BranchRow, type EquipmentItemRow, type LogisticsDecisionRow, type MaterialLineRow, type MovementItemRow, type MovementRow } from "./types";

/**
 * ONE job's movements (Session 7): what the job page's pre-start and Project Progress need
 * — every non-cancelled chip of the job whatever its date (the week loader windows by date,
 * which would make a gate wrong for a chip ordered outside the week), the material lines,
 * the decisions, and the shops and register items the cards name. Every read keeps its
 * error and returns it as a line; `gates()` is the evaluator's, never re-derived here.
 */

const MOVEMENT_COLUMNS = "id, work_order_id, kind, source_key, title, detail, assignee_kind, assignee_table, assignee_id, due_date, half, time, sequence, from_kind, from_branch_id, from_text, to_kind, to_branch_id, to_text, status, ordered_at, client_notice, order_ref, lines, planned_for_start, return_due, blocked_by_movement_id, expected_cost_cents, note, problem_note, painter_confirmed_at, source_changed_at, booked_at, done_at, created_at, updated_at, method_pref, duration_min";

export type JobMovements = {
  movements: MovementRow[];
  lines: MaterialLineRow[];
  decisions: LogisticsDecisionRow[];
  branches: BranchRow[];
  items: EquipmentItemRow[];
  gates: Gates;
  /** Cents the ordered chips of this job expect to cost (hires, manual chips with a cost) — "ordered $X". */
  orderedCents: number;
  failures: string[];
};

/** A world with only what gates() reads, for one or many jobs. */
function gateWorld(movements: MovementRow[], decisions: LogisticsDecisionRow[]): World {
  return {
    from: "", to: "", settings: DEFAULT_MOVEMENTS_SETTINGS, jobs: [], blocks: [], painters: [], staff: [],
    googleBusy: [], googleReads: {}, appointments: [], movements, items: [], branches: [], decisions, suburbs: new Map(), unscheduledCheckins: [],
  };
}

const notAvailable = (e: { message: string }, what: string) =>
  isMissingRpc(e.message, "movements") || /does not exist|schema cache/i.test(e.message) ? `${what} need database migration 20270279 run first.` : `Couldn't read ${what}: ${e.message}`;

export async function loadJobMovements(supabase: SupabaseClient, workOrderId: string): Promise<JobMovements> {
  const failures: string[] = [];
  const [mRes, lRes, dRes, bRes, iRes] = await Promise.all([
    realOnly(supabase.from("movements").select(MOVEMENT_COLUMNS)).eq("work_order_id", workOrderId).neq("status", "cancelled").order("created_at"),
    realOnly(supabase.from("wo_material_lines").select("id, work_order_id, text, source, sort, merged_into, created_at")).eq("work_order_id", workOrderId).order("sort").order("created_at"),
    realOnly(supabase.from("wo_logistics_decisions").select("work_order_id, line, decision")).eq("work_order_id", workOrderId),
    supabase.from("supplier_branches").select("id, brand, branch, kind, address, suburb, phone, lat, lng, delivers_to_site, opens_weekday, favourite, active").eq("active", true),
    supabase.from("equipment_items").select("id, tag, name, category, serial_or_model, status"),
  ]);
  if (mRes.error) failures.push(notAvailable(mRes.error, "the job's movements"));
  if (lRes.error) failures.push(notAvailable(lRes.error, "the materials lines"));
  if (dRes.error) failures.push(notAvailable(dRes.error, "the logistics decisions"));
  if (bRes.error) failures.push(notAvailable(bRes.error, "the supplier branches"));
  if (iRes.error) failures.push(notAvailable(iRes.error, "the equipment register"));

  const raw = (mRes.data ?? []) as Omit<MovementRow, "items">[];
  const ids = raw.map((m) => m.id);
  const links = ids.length
    ? await realOnly(supabase.from("movement_items").select("movement_id, equipment_item_id, label")).in("movement_id", ids)
    : { data: [] as MovementItemRow[], error: null };
  if (links.error) failures.push(notAvailable(links.error, "the gear on the movements"));
  const byMovement = new Map<string, MovementItemRow[]>();
  for (const l of (links.data ?? []) as MovementItemRow[]) byMovement.set(l.movement_id, [...(byMovement.get(l.movement_id) ?? []), l]);
  const movements: MovementRow[] = raw.map((m) => ({ ...m, lines: m.lines ?? null, items: byMovement.get(m.id) ?? [] }));
  const decisions = (dRes.data ?? []) as LogisticsDecisionRow[];
  const orderedCents = movements.filter((m) => m.ordered_at || m.status === "booked" || m.status === "done").reduce((s, m) => s + (m.expected_cost_cents ?? 0), 0);
  return {
    movements, lines: (lRes.data ?? []) as MaterialLineRow[], decisions,
    branches: (bRes.data ?? []) as BranchRow[], items: (iRes.data ?? []) as EquipmentItemRow[],
    gates: gates(gateWorld(movements, decisions), workOrderId), orderedCents, failures,
  };
}

/** The two gate answers for many jobs at once (Project Progress pills), in one round trip per table. */
export async function loadGatesForJobs(supabase: SupabaseClient, workOrderIds: string[]): Promise<{ gates: Map<string, Gates>; failure: string | null }> {
  const out = new Map<string, Gates>();
  if (workOrderIds.length === 0) return { gates: out, failure: null };
  const [mRes, dRes] = await Promise.all([
    realOnly(supabase.from("movements").select(MOVEMENT_COLUMNS)).in("work_order_id", workOrderIds).neq("status", "cancelled"),
    realOnly(supabase.from("wo_logistics_decisions").select("work_order_id, line, decision")).in("work_order_id", workOrderIds),
  ]);
  if (mRes.error) return { gates: out, failure: notAvailable(mRes.error, "the jobs' movements") };
  if (dRes.error) return { gates: out, failure: notAvailable(dRes.error, "the logistics decisions") };
  const movements: MovementRow[] = ((mRes.data ?? []) as Omit<MovementRow, "items">[]).map((m) => ({ ...m, lines: m.lines ?? null, items: [] }));
  const world = gateWorld(movements, (dRes.data ?? []) as LogisticsDecisionRow[]);
  for (const id of workOrderIds) out.set(id, gates(world, id));
  return { gates: out, failure: null };
}
