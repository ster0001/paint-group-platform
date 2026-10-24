import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/monitoring/report";
import type { WorkItem } from "./work-queue";

/**
 * Paint Home brief §6 — the brand of each CRM work item, read from the record
 * it is about. Work items are DERIVED facts and never stored (CRM shell
 * brief §1), so the brand is not a field on them: Today reads it alongside,
 * by subject, in four small `.in()` reads, and keys the answer by item key.
 * An account item has no single brand and gets none. A failed read is
 * reported and that table's items simply carry no pill — never a blank page.
 */
const TABLE: Partial<Record<WorkItem["subjectRef"]["type"], string>> = {
  estimate: "estimates", work_order: "work_orders", invoice: "invoices", wizard_session: "wizard_drafts",
};

export async function brandsForItems(db: SupabaseClient, items: ReadonlyArray<Pick<WorkItem, "key" | "subjectRef">>): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const byTable = new Map<string, Array<{ key: string; id: string }>>();
  for (const i of items) {
    const table = TABLE[i.subjectRef.type];
    if (!table) continue;
    const list = byTable.get(table) ?? [];
    list.push({ key: i.key, id: i.subjectRef.id });
    byTable.set(table, list);
  }
  await Promise.all([...byTable.entries()].map(async ([table, refs]) => {
    const ids = [...new Set(refs.map((r) => r.id))].slice(0, 500);
    const { data, error } = await db.from(table).select("id, brand").in("id", ids);
    if (error) { reportError(error, { where: `crm.itemBrands.${table}`, bestEffort: true }); return; }
    const brandOf = new Map(((data ?? []) as Array<{ id: string; brand: string | null }>).map((r) => [r.id, r.brand]));
    for (const r of refs) out.set(r.key, brandOf.get(r.id) ?? null);
  }));
  return out;
}
