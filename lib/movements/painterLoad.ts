import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingRpc } from "@/lib/supabase/missingRpc";
import type { PainterBranch, PainterMovementRow } from "./painterView";

/**
 * The painter's read (Session 5): their movements and the shops they may see, through
 * THEIR session and the two definer functions of migration 20270279/20270281 — never a
 * base-table read (there is no painter policy on movements) and never the service key.
 * A refused or missing read comes back as `error`, which the screen shows; it is never
 * an empty list pretending to be "nothing today" (CLAUDE.md, list reads).
 */
export type PainterMovements = { rows: PainterMovementRow[]; branches: PainterBranch[]; error: string | null };

export async function loadPainterMovements(supabase: SupabaseClient, scope: { workOrderId?: string; day?: string }): Promise<PainterMovements> {
  const [m, b] = await Promise.all([
    supabase.rpc("movements_for_painter", { p_work_order_id: scope.workOrderId ?? null, p_day: scope.day ?? null }),
    supabase.rpc("supplier_branches_for_painter", {}),
  ]);
  if (m.error) {
    // Before 20270281 the function exists with fewer columns; before 20270279 not at all. Both read as "not available yet".
    return { rows: [], branches: [], error: isMissingRpc(m.error.message, "movements_for_painter") ? "Pickups and deliveries are not switched on yet." : `Couldn't read your pickups and deliveries: ${m.error.message}` };
  }
  const rows = ((m.data ?? []) as Partial<PainterMovementRow>[]).map((r) => ({
    ...r, lines: Array.isArray(r.lines) ? r.lines : null, from_branch_id: r.from_branch_id ?? null, to_branch_id: r.to_branch_id ?? null,
    run_plan_sent_at: r.run_plan_sent_at ?? null, note: r.note ?? "", order_ref: r.order_ref ?? "", from_text: r.from_text ?? "", to_text: r.to_text ?? "",
  })) as PainterMovementRow[];
  const branches = b.error ? [] : ((b.data ?? []) as PainterBranch[]);
  return { rows, branches, error: b.error ? `Couldn't read the shops: ${b.error.message}` : null };
}
