import type { SupabaseClient } from "@supabase/supabase-js";
import { composeUpdate, type TickEvent } from "./updates";
import { melbourneDate, melbourneDayStartUtc } from "./console";
import { reportError } from "@/lib/monitoring/report";

/**
 * Instant progress-update drafting (Tom, 1 Sep). SERVER ONLY — service client.
 *
 * Every successful tick refreshes TODAY's wo_updates draft for the job, so the
 * composer on the PC job page and the /pc/updates queue carry the day's work
 * the moment it's ticked — not the next morning when the sweep runs. Twin of
 * the per-job block in app/api/cron/wo-sweep (which stays as the backstop for
 * ticks this hook misses); both speak through wo_draft_update, which never
 * overwrites an approved or sent update.
 */
export async function draftUpdateFromTodaysTicks(
  service: SupabaseClient,
  surfaceId: string,
): Promise<void> {
  const { data: surfaceRow } = await service
    .from("wo_surfaces").select("work_order_id").eq("id", surfaceId).maybeSingle();
  const workOrderId = (surfaceRow as { work_order_id?: string } | null)?.work_order_id;
  if (!workOrderId) return;

  const now = new Date();
  const since = melbourneDayStartUtc(now); // an ISO string already

  type TickRow = { id: string; meta: { heading?: string; label?: string; from?: string; to?: string } | null };
  const { data: ticks } = await service
    .from("wo_events")
    .select("id, meta")
    .eq("work_order_id", workOrderId)
    .eq("type", "surface_tick")
    .gte("created_at", since);
  const rows = (ticks ?? []) as TickRow[];
  if (rows.length === 0) return;

  const { data: wo } = await service
    .from("work_orders").select("estimate_id").eq("id", workOrderId).maybeSingle();
  const { data: estimate } = wo?.estimate_id
    ? await service.from("estimates").select("accepted_name, builder_state")
        .eq("id", wo.estimate_id).maybeSingle()
    : { data: null };
  const contact = (estimate?.builder_state as { contact?: { name?: string } } | null)?.contact?.name
    ?? (estimate?.accepted_name as string | null)
    ?? "";
  const firstName = contact.trim().split(/\s+/)[0] ?? "";

  const { count: photoCount } = await service
    .from("wo_photos")
    .select("id", { count: "exact", head: true })
    .eq("work_order_id", workOrderId)
    .gte("created_at", since);

  const composed = composeUpdate({
    customerFirstName: firstName,
    ticks: rows.map((r): TickEvent => ({
      heading: r.meta?.heading ?? "",
      label: r.meta?.label ?? "",
      from: r.meta?.from ?? "todo",
      to: r.meta?.to ?? "todo",
    })),
    photoCount: photoCount ?? 0,
    now,
  });
  if (!composed) return; // nothing worth saying; no draft, no filler

  const { error } = await service.rpc("wo_draft_update", {
    p_work_order_id: workOrderId,
    p_for_date: melbourneDate(now),
    p_text: composed,
    p_tick_ids: rows.map((r) => r.id),
    p_photo_count: photoCount ?? 0,
  });
  if (error) reportError(error, { where: "tick.draftUpdate", extra: { workOrderId } });
}
