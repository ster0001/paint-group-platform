import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/monitoring/report";
import { demoChecklist, demoProgress, type DemoChecklistRow, type DemoFacts } from "./checklist";

/**
 * The facts behind the demo checklist, read for ONE practice job (the
 * painter's banner) or for every practice job in the room (the staff grid).
 * Demo rows are the point: every read here is by the demo work order's id or
 * filters `is_demo = true`, which is what the boundary ratchet allows.
 */

type DemoJob = { id: string; wo_ref: string; contractor_id: string; created_at: string };

export async function loadDemoFacts(service: SupabaseClient, job: DemoJob): Promise<DemoFacts> {
  const [offer, photos, surfaces, moments, msgs, events, variations, signoff, invoices, expenses, blocks, gcal] = await Promise.all([
    service.from("booking_offers").select("state").eq("work_order_id", job.id).eq("state", "accepted").limit(1),
    service.from("wo_photos").select("id").eq("work_order_id", job.id).eq("kind", "before"),
    service.from("wo_surfaces").select("id").eq("work_order_id", job.id).neq("state", "todo"),
    service.from("wo_reminder_moments").select("answered_at").eq("work_order_id", job.id),
    service.from("wo_messages").select("id, author_kind, wo_message_threads!inner(work_order_id)").eq("wo_message_threads.work_order_id", job.id).eq("author_kind", "painter"),
    service.from("wo_events").select("id").eq("work_order_id", job.id).eq("type", "finish_date_changed").limit(1),
    service.from("wo_variations").select("id").eq("work_order_id", job.id).eq("status", "contractor_accepted").limit(1),
    service.from("wo_signoff").select("signed_at").eq("work_order_id", job.id).maybeSingle(),
    service.from("contractor_invoices").select("id").eq("work_order_id", job.id).in("status", ["submitted", "approved", "paid"]).limit(1),
    service.from("contractor_expenses").select("id").eq("work_order_id", job.id).limit(1),
    service.from("contractor_unavailability").select("id").eq("contractor_id", job.contractor_id).eq("source", "contractor").gte("created_at", job.created_at).limit(1),
    service.from("contractor_gcal_connections").select("contractor_id").eq("contractor_id", job.contractor_id).maybeSingle(),
  ]);
  const [materials, noWork] = await Promise.all([
    service.from("wo_material_requests").select("id").eq("work_order_id", job.id).in("status", ["ordered", "declined"]).limit(1),
    service.from("wo_day_flags").select("id").eq("work_order_id", job.id).in("flag", ["no_work", "no_work_requested"]).limit(1),
  ]);
  for (const [label, r] of [["offer", offer], ["photos", photos], ["surfaces", surfaces], ["moments", moments], ["messages", msgs], ["events", events], ["variations", variations], ["signoff", signoff], ["invoices", invoices], ["expenses", expenses], ["blocks", blocks], ["gcal", gcal], ["materials", materials], ["noWork", noWork]] as const) {
    if (r.error) reportError(r.error, { where: `demo.facts.${label}`, bestEffort: true, extra: { workOrderId: job.id } });
  }
  const momentRows = (moments.data ?? []) as { answered_at: string | null }[];
  return {
    offerAccepted: (offer.data?.length ?? 0) > 0,
    beforePhotos: photos.data?.length ?? 0,
    surfacesMoved: surfaces.data?.length ?? 0,
    promptAnswered: momentRows.length === 0 ? null : momentRows.some((m) => m.answered_at),
    questionsAsked: msgs.data?.length ?? 0,
    finishDateChanged: (events.data?.length ?? 0) > 0,
    variationAccepted: (variations.data?.length ?? 0) > 0,
    signedAt: (signoff.data as { signed_at: string | null } | null)?.signed_at ?? null,
    invoiceSubmitted: (invoices.data?.length ?? 0) > 0,
    expenseSubmitted: (expenses.data?.length ?? 0) > 0,
    dayBlocked: (blocks.data?.length ?? 0) > 0,
    gcalLinked: Boolean(gcal.data),
    materialsAnswered: (materials.data?.length ?? 0) > 0,
    noWorkMarked: (noWork.data?.length ?? 0) > 0,
  };
}

/** The painter's own practice job, as rows for the banner. */
export async function loadDemoChecklist(service: SupabaseClient, workOrderId: string): Promise<DemoChecklistRow[] | null> {
  const { data, error } = await service.from("work_orders").select("id, wo_ref, contractor_id, created_at").eq("id", workOrderId).eq("is_demo", true).maybeSingle();
  if (error) { reportError(error, { where: "demo.checklist.job", bestEffort: true, extra: { workOrderId } }); return null; }
  const job = data as DemoJob | null;
  if (!job?.contractor_id) return null;
  return demoChecklist(await loadDemoFacts(service, job));
}

export type DemoGridRow = {
  workOrderId: string; woRef: string; contractorId: string; painter: string; seededAt: string;
  rows: DemoChecklistRow[]; done: number; total: number;
};

/** Every practice job, newest first — the facilitator's live grid (brief §4.2). */
export async function loadDemoGrid(service: SupabaseClient): Promise<{ rows: DemoGridRow[]; error: string | null }> {
  const { data, error } = await service.from("work_orders")
    .select("id, wo_ref, contractor_id, created_at, contractors(company_name, profiles(name))")
    .eq("is_demo", true).not("contractor_id", "is", null).order("created_at", { ascending: false }).limit(100);
  if (error) { reportError(error, { where: "demo.grid" }); return { rows: [], error: error.message }; }
  type Row = DemoJob & { contractors: { company_name: string | null; profiles: { name: string | null } | null } | null };
  const jobs = (data ?? []) as unknown as Row[];
  const rows = await Promise.all(jobs.map(async (j) => {
    const list = demoChecklist(await loadDemoFacts(service, j));
    const p = demoProgress(list);
    return {
      workOrderId: j.id, woRef: j.wo_ref, contractorId: j.contractor_id,
      painter: j.contractors?.profiles?.name?.trim() || j.contractors?.company_name?.trim() || "A painter",
      seededAt: j.created_at, rows: list, done: p.done, total: p.total,
    };
  }));
  return { rows, error: null };
}
