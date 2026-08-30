/**
 * Trade portal v2 · Session 2B — the colour_records write path.
 *
 * Three transitions (brief §4.1 + Tom's rulings, 30 Aug), all server-side,
 * all BEST-EFFORT from their hook sites (a colour record must never block a
 * tick — the seedSurfaces precedent):
 *
 *   planned    — the pre-start "Colour schedule finalised" question answered
 *                YES → one planned row per surface group, assembled from
 *                work_orders.colours (the job sheet — on-site truth) merged
 *                over the frozen snapshot. Estimate preferences NEVER write
 *                here; they only ride along inside the snapshot the person
 *                vouched for by answering yes.
 *   applied    — a surface DONE tick → the group's rows flip to applied,
 *                colours RE-READ from work_orders.colours at that moment
 *                (ruling 2), dates stamped from the group's done ticks. A
 *                colour that changed since planning is updated and the change
 *                logged to wo_events.
 *   superseded — a row becoming applied supersedes an older APPLIED row of
 *                the same surface group at the same property from a different
 *                job. Nothing is ever deleted.
 *
 * Grouping/classification is lib/colourRecords/reconstruct.ts — the same
 * rules the backfill used, not a second copy. TBC never becomes a row: a
 *group with no colour name produces nothing (DB CHECK backs this).
 */
import { createServiceClient } from "@/lib/supabase/service";
import {
  classifySurfaceType,
  melbourneDate,
  reconstructRows,
  type LiveColourIn,
  type ReconstructedRow,
  type SnapshotAreaIn,
  type SnapshotMaterialIn,
} from "./reconstruct";

type WoRow = {
  id: string;
  estimate_id: string;
  colours: LiveColourIn;
  wo_snapshot: { areas?: SnapshotAreaIn[]; materials?: SnapshotMaterialIn[] } | null;
};

type Scope = { propertyId: string; accountId: string } | null;

async function scopeFor(svc: NonNullable<ReturnType<typeof createServiceClient>>, estimateId: string): Promise<Scope> {
  const { data } = await svc.from("estimates").select("property_id, account_id").eq("id", estimateId).maybeSingle();
  const e = data as { property_id: string | null; account_id: string | null } | null;
  // A job with no property cannot hold a per-property register row. Honest
  // absence — the estimate links a property the moment the chain knows one.
  return e?.property_id && e.account_id ? { propertyId: e.property_id, accountId: e.account_id } : null;
}

/** The current groups the job sheet + snapshot resolve to, no dates. */
function currentGroups(wo: WoRow): ReconstructedRow[] {
  return reconstructRows({
    areas: wo.wo_snapshot?.areas ?? [],
    materials: wo.wo_snapshot?.materials ?? [],
    liveColours: wo.colours ?? null,
    doneTicks: [],
    signedOn: null,
  });
}

/**
 * The colours question was answered YES: (re)build this job's PLANNED rows.
 * Idempotent — planned rows for the job are replaced wholesale (they carry no
 * history yet); applied/superseded rows are never touched.
 */
export async function syncPlannedColourRecords(workOrderId: string): Promise<void> {
  const svc = createServiceClient();
  if (!svc) return;
  const { data: woData } = await svc.from("work_orders")
    .select("id, estimate_id, colours, wo_snapshot").eq("id", workOrderId).maybeSingle();
  const wo = woData as WoRow | null;
  if (!wo) return;
  const scope = await scopeFor(svc, wo.estimate_id);
  if (!scope) return;

  const groups = currentGroups(wo);

  const { data: existing } = await svc.from("colour_records")
    .select("id, status, area_label, surface_type, colour_name, product")
    .eq("source_job_id", wo.id);
  const rows = (existing ?? []) as Array<{ id: string; status: string; area_label: string; surface_type: string; colour_name: string; product: string }>;
  const appliedKeys = new Set(rows.filter((r) => r.status !== "planned")
    .map((r) => [r.area_label, r.surface_type, r.colour_name, r.product].join(" ")));

  const plannedIds = rows.filter((r) => r.status === "planned").map((r) => r.id);
  if (plannedIds.length) await svc.from("colour_records").delete().in("id", plannedIds);

  const inserts = groups
    .filter((g) => !appliedKeys.has([g.area_label, g.surface_type, g.colour_name, g.product].join(" ")))
    .map((g) => ({
      property_id: scope.propertyId,
      area_label: g.area_label,
      surface_type: g.surface_type,
      brand: g.brand,
      product: g.product,
      colour_name: g.colour_name,
      colour_code: g.colour_code,
      sheen: g.sheen,
      coats: g.coats,
      swatch_hex: g.swatch_hex,
      status: "planned",
      source_job_id: wo.id,
      source: "colour_schedule",
    }));
  if (inserts.length) {
    const { error } = await svc.from("colour_records").insert(inserts);
    if (error) throw new Error(`colour_records planned insert: ${error.message}`);
  }
}

/**
 * Hook for the checklist-answer actions: a YES on the colours question is the
 * person's vouch that the schedule is final — (re)build the planned rows.
 * Any other item, or a NO, does nothing.
 */
export async function onChecklistAnswered(itemId: string, answer: "yes" | "no" | undefined): Promise<void> {
  if (answer !== "yes") return;
  const svc = createServiceClient();
  if (!svc) return;
  const { data } = await svc.from("wo_checklist_items")
    .select("work_order_id, item_key, label").eq("id", itemId).maybeSingle();
  const i = data as { work_order_id: string; item_key: string | null; label: string | null } | null;
  if (!i) return;
  // item_key with the label as fallback for rows created before item_key existed.
  if (i.item_key === "colours" || i.label === "Colour schedule finalised") {
    await syncPlannedColourRecords(i.work_order_id);
  }
}

/**
 * A surface reached DONE: flip its group to applied with the job sheet's
 * colours AS OF NOW, stamp dates from the group's done ticks, log any colour
 * change, and supersede the property's older applied rows for the group.
 */
export async function applyColourRecordsForTick(surfaceId: string, actorId: string | null): Promise<void> {
  const svc = createServiceClient();
  if (!svc) return;
  const { data: sData } = await svc.from("wo_surfaces")
    .select("work_order_id, heading, label, state").eq("id", surfaceId).maybeSingle();
  const s = sData as { work_order_id: string; heading: string; label: string; state: string } | null;
  if (!s || s.state !== "done") return;

  const { data: woData } = await svc.from("work_orders")
    .select("id, estimate_id, colours, wo_snapshot").eq("id", s.work_order_id).maybeSingle();
  const wo = woData as WoRow | null;
  if (!wo) return;
  const scope = await scopeFor(svc, wo.estimate_id);
  if (!scope) return;

  const surfaceType = classifySurfaceType(s.label);
  const groups = currentGroups(wo)
    .filter((g) => g.area_label === s.heading && g.surface_type === surfaceType);
  if (!groups.length) return; // TBC — no colour name resolves, no row (honest)

  // Applied dates: the group's done ticks (per-area heading), Melbourne days.
  const { data: tickData } = await svc.from("wo_surfaces")
    .select("label, state, state_changed_at")
    .eq("work_order_id", wo.id).eq("heading", s.heading).eq("state", "done");
  const days = ((tickData ?? []) as Array<{ state_changed_at: string | null }>)
    .map((t) => (t.state_changed_at ? melbourneDate(t.state_changed_at) : null))
    .filter((d): d is string => Boolean(d))
    .sort();
  const appliedFrom = days[0] ?? null;
  const appliedTo = days[days.length - 1] ?? null;

  const { data: exData } = await svc.from("colour_records")
    .select("id, status, colour_name, product, brand, colour_code, sheen, coats, swatch_hex")
    .eq("source_job_id", wo.id).eq("area_label", s.heading).eq("surface_type", surfaceType)
    .in("status", ["planned", "applied"]);
  const existing = (exData ?? []) as Array<{ id: string; status: string; colour_name: string; product: string }>;

  for (const g of groups) {
    // Match by product first (the planned row for this group), then any row.
    const match = existing.find((r) => r.product === g.product) ?? existing.shift() ?? null;
    let rowId: string;
    if (match) {
      if (match.colour_name !== g.colour_name) {
        // The consult/job sheet changed the colour after planning — the row
        // follows the sheet, and the change is on the record.
        await svc.from("wo_events").insert({
          work_order_id: wo.id, type: "colour_record_update", actor: actorId, actor_kind: "system",
          meta: { area_label: g.area_label, surface_type: g.surface_type, from: match.colour_name, to: g.colour_name },
        });
      }
      const { error } = await svc.from("colour_records").update({
        brand: g.brand, product: g.product, colour_name: g.colour_name,
        colour_code: g.colour_code, sheen: g.sheen, coats: g.coats, swatch_hex: g.swatch_hex,
        status: "applied", applied_from: appliedFrom, applied_to: appliedTo,
        updated_at: new Date().toISOString(),
      }).eq("id", match.id);
      if (error) throw new Error(`colour_records apply: ${error.message}`);
      rowId = match.id;
      existing.splice(existing.indexOf(match), 1);
    } else {
      // Ticked before the schedule was finalised — self-heal with an applied
      // row sourced from the tick itself.
      const { data, error } = await svc.from("colour_records").insert({
        property_id: scope.propertyId,
        area_label: g.area_label, surface_type: g.surface_type,
        brand: g.brand, product: g.product, colour_name: g.colour_name,
        colour_code: g.colour_code, sheen: g.sheen, coats: g.coats, swatch_hex: g.swatch_hex,
        status: "applied", applied_from: appliedFrom, applied_to: appliedTo,
        source_job_id: wo.id, source: "wo_tick",
      }).select("id").single();
      if (error) throw new Error(`colour_records tick insert: ${error.message}`);
      rowId = data.id as string;
    }

    // Supersede the property's older APPLIED rows for this group — other
    // jobs only, never this one, and nothing is deleted.
    const { data: oldData } = await svc.from("colour_records")
      .select("id")
      .eq("property_id", scope.propertyId)
      .eq("area_label", g.area_label).eq("surface_type", g.surface_type)
      .eq("status", "applied").neq("source_job_id", wo.id).neq("id", rowId);
    for (const old of (oldData ?? []) as Array<{ id: string }>) {
      const { error } = await svc.from("colour_records")
        .update({ status: "superseded", superseded_by: rowId, updated_at: new Date().toISOString() })
        .eq("id", old.id);
      if (error) throw new Error(`colour_records supersede: ${error.message}`);
    }
  }
}
