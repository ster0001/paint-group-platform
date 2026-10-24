import type { SupabaseClient } from "@supabase/supabase-js";
import { composeUpdate, type TickEvent } from "./updates";
import { melbourneDate, melbourneDayStartUtc } from "./console";
import { reportError } from "@/lib/monitoring/report";
import { staffCustomerUpdateDrafted } from "@/lib/staff/notify";
import { loadMessaging } from "@/lib/messaging/load";
import {
  composeEndOfDay, composeMilestone, groupStandings, milestonesNow, newMilestones, parseMilestones, unionMilestones,
  type GroupRowInput, type Milestone,
} from "./milestones";

/**
 * Instant progress-update drafting (Tom, 1 Sep). SERVER ONLY — service client.
 *
 * Every successful tick refreshes TODAY's wo_updates draft for the job, so the
 * composer on the PC job page and the /pc/updates queue carry the day's work
 * the moment it's ticked — not the next morning when the sweep runs. Twin of
 * the per-job block in app/api/cron/wo-sweep (which stays as the backstop for
 * ticks this hook misses); both speak through wo_draft_update, which never
 * overwrites an approved or sent update.
 *
 * Work order UX Step 2 (24 Oct 2026): the same pass also raises a SURFACE
 * MILESTONE draft when a group has just reached 100% prepped or painted across
 * the job (bundled into an open draft of the last few minutes, never raised
 * twice, never after a drop), and the end-of-day draft is rolled up by surface
 * group where the job's rows carry one.
 */
export async function draftUpdateFromTodaysTicks(
  service: SupabaseClient,
  surfaceId: string,
): Promise<void> {
  const { data: surfaceRow } = await service
    .from("wo_surfaces").select("work_order_id").eq("id", surfaceId).maybeSingle();
  const workOrderId = (surfaceRow as { work_order_id?: string } | null)?.work_order_id;
  if (!workOrderId) return;
  await draftUpdateForWorkOrder(service, workOrderId);
}

export const CUSTOMER_UPDATES_KEY = "customer_updates_queue";
export const DEFAULT_BUNDLE_MINUTES = 5;

/** The bundle window the office set on Settings → Automations, else the shipped default. */
export function bundleMinutesOf(messaging: { controls?: Record<string, { timing?: Record<string, number> }> }): number {
  const n = messaging.controls?.[CUSTOMER_UPDATES_KEY]?.timing?.bundle_minutes;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : DEFAULT_BUNDLE_MINUTES;
}

type SurfaceDbRow = {
  id: string; heading: string; label: string; state: "todo" | "prepped" | "done";
  group_code: string | null; removed_from_scope: boolean | null; rectification: boolean | null;
};

/**
 * The same refresh keyed by the JOB — what a bulk tick (work order UX Step 1)
 * calls once for its N rows, and what an undo calls to re-read the day.
 */
export async function draftUpdateForWorkOrder(
  service: SupabaseClient,
  workOrderId: string,
): Promise<{ drafted: boolean }> {
  const now = new Date();
  const since = melbourneDayStartUtc(now); // an ISO string already

  type TickRow = { id: string; meta: { surface_id?: string; heading?: string; label?: string; from?: string; to?: string } | null };
  const { data: ticks, error: ticksError } = await service
    .from("wo_events")
    .select("id, meta")
    .eq("work_order_id", workOrderId)
    .eq("type", "surface_tick")
    .gte("created_at", since);
  if (ticksError) { reportError(ticksError, { where: "tick.draftUpdate.ticks", extra: { workOrderId } }); return { drafted: false }; }
  const rows = (ticks ?? []) as TickRow[];
  if (rows.length === 0) return { drafted: false };

  const { data: wo } = await service
    .from("work_orders").select("estimate_id").eq("id", workOrderId).maybeSingle();
  const { data: estimate } = wo?.estimate_id
    ? await service.from("estimates").select("accepted_name, builder_state, job_kind")
        .eq("id", wo.estimate_id).maybeSingle()
    : { data: null };
  const contact = (estimate?.builder_state as { contact?: { name?: string } } | null)?.contact?.name
    ?? (estimate?.accepted_name as string | null)
    ?? "";
  const firstName = contact.trim().split(/\s+/)[0] ?? "";
  const commercial = (estimate?.job_kind as string | null) === "commercial";

  const [{ count: photoCount }, surfacesRes, { messaging }] = await Promise.all([
    service.from("wo_photos").select("id", { count: "exact", head: true })
      .eq("work_order_id", workOrderId).gte("created_at", since),
    service.from("wo_surfaces")
      .select("id, heading, label, state, group_code, removed_from_scope, rectification")
      .eq("work_order_id", workOrderId).order("sort"),
    loadMessaging(service),
  ]);
  if (surfacesRes.error) reportError(surfacesRes.error, { where: "tick.draftUpdate.surfaces", extra: { workOrderId } });
  const surfaces = ((surfacesRes.data ?? []) as SurfaceDbRow[]).map((r): GroupRowInput => ({
    id: r.id, heading: r.heading, state: r.state, group: r.group_code,
    removed: Boolean(r.removed_from_scope), rectification: Boolean(r.rectification),
  }));
  const standings = groupStandings(surfaces);

  // ---- Trigger D: the end-of-day summary, by surface where the rows carry one ----
  const changedToday = new Set(rows.map((r) => r.meta?.surface_id).filter((x): x is string => typeof x === "string"));
  const composed = composeEndOfDay({
    firstName, standings, changedToday, template: messaging.customerEndOfDayBody, photoCount: photoCount ?? 0,
  }) ?? composeUpdate({
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
  let drafted = false;
  if (composed) {
    const { error } = await service.rpc("wo_draft_update", {
      p_work_order_id: workOrderId,
      p_for_date: melbourneDate(now),
      p_text: composed,
      p_tick_ids: rows.map((r) => r.id),
      p_photo_count: photoCount ?? 0,
    });
    if (error) reportError(error, { where: "tick.draftUpdate", extra: { workOrderId } });
    else {
      drafted = true;
      // Tom, 7 Oct 2026: the office (Felipe) is told the moment the painter's
      // work has drafted an update — email + text per their alert settings, once
      // per job per day; notifyStaff claims the guard before it sends anything.
      await staffCustomerUpdateDrafted(service, workOrderId, melbourneDate(now));
    }
  }

  // ---- Trigger A: a surface milestone, bundled, never twice ----
  if (standings.length > 0) {
    await draftMilestonesForJob(service, {
      workOrderId, firstName, commercial, standings, messaging, now,
      sourceEventIds: rows.map((r) => r.id),
    });
  }
  return { drafted };
}

type MilestoneCtx = {
  workOrderId: string; firstName: string; commercial: boolean;
  standings: ReturnType<typeof groupStandings>;
  messaging: Awaited<ReturnType<typeof loadMessaging>>["messaging"];
  now: Date;
  sourceEventIds: string[];
};

async function draftMilestonesForJob(service: SupabaseClient, ctx: MilestoneCtx): Promise<void> {
  const { workOrderId, standings, messaging, now } = ctx;
  const bundleMinutes = bundleMinutesOf(messaging);
  const windowStart = new Date(now.getTime() - bundleMinutes * 60_000).toISOString();

  // Everything already announced: every milestone row on the job (drafted,
  // approved or sent) and every dropped one (the dismissal event keeps them).
  const [rowsRes, dropsRes] = await Promise.all([
    service.from("wo_updates").select("id, status, created_at, milestones")
      .eq("work_order_id", workOrderId).eq("kind", "surface_milestone"),
    service.from("wo_events").select("meta")
      .eq("work_order_id", workOrderId).eq("type", "update_dismissed"),
  ]);
  if (rowsRes.error) { reportError(rowsRes.error, { where: "tick.milestones.rows", extra: { workOrderId } }); return; }
  if (dropsRes.error) { reportError(dropsRes.error, { where: "tick.milestones.drops", extra: { workOrderId } }); return; }
  type MRow = { id: string; status: string; created_at: string; milestones: unknown };
  const mrows = (rowsRes.data ?? []) as MRow[];
  let announced: Milestone[] = [];
  for (const r of mrows) announced = unionMilestones(announced, parseMilestones(r.milestones));
  for (const e of (dropsRes.data ?? []) as { meta: { milestones?: unknown } | null }[]) {
    announced = unionMilestones(announced, parseMilestones(e.meta?.milestones));
  }

  const fresh = newMilestones(milestonesNow(standings), announced);
  if (fresh.length === 0) return;

  // An open draft inside the window takes the union; the RPC applies the same window.
  const open = mrows
    .filter((r) => r.status === "drafted" && r.created_at > windowStart)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
  const bundle = open ? unionMilestones(parseMilestones(open.milestones), fresh) : fresh;

  const text = composeMilestone({
    firstName: ctx.firstName, milestones: bundle, standings, templates: messaging, commercial: ctx.commercial,
  });
  if (!text) return;

  const { data, error } = await service.rpc("wo_draft_milestone", {
    p_work_order_id: workOrderId,
    p_text: text,
    p_milestones: bundle,
    p_source_event_ids: ctx.sourceEventIds,
    p_bundle_minutes: bundleMinutes,
  });
  if (error) { reportError(error, { where: "tick.milestones.draft", extra: { workOrderId } }); return; }
  const s = String(data ?? "");
  // A job that may not be written to (paused, rectification, signed off, not in
  // progress) is a rule, not a fault: nothing drafted, nothing reported.
  if (!s.startsWith("ok:") && !/^error:(stage:|paused|signed_off|rectification)/.test(s)) {
    reportError(new Error(s), { where: "tick.milestones.draft", extra: { workOrderId } });
  }
}
