// SERVER ONLY — Google Calendar sync for contractors.
//
// One idea: there is no "push this one change" path. Every trigger — a
// contractor accepting an offer, staff cancelling or moving a booking, the
// nightly cron — calls the same reconciler, which diffs the contractor's
// ACCEPTED bookings against the events already pushed and inserts / patches /
// deletes the difference. A missed trigger therefore never strands the
// calendar; the next trigger (or the cron) heals it.
//
// Privacy rules inherited from the portal:
//  - Only COMMITTED jobs are pushed (accepted offer, or direct staff
//    assignment with no offer) — `committedIds` in lib/contractor/jobs.ts is
//    the single source of that rule. An offered-but-unaccepted job already
//    carries start_date via the booking trigger, so filtering on dates alone
//    would leak unaccepted offers into a painter's Google Calendar.
//  - Events live in a dedicated "Paint Group Jobs" calendar the app creates
//    (scope calendar.app.created): the app cannot read the painter's own
//    calendars, and disconnecting deletes nothing personal.

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { committedIds, type OfferStateRow, type Row as WoRow } from "@/lib/contractor/jobs";
import { spanOf } from "@/lib/contractor/jobDays";
import type { WorkOrderDoc } from "@/lib/workorder/snapshot";
import type { GcalStatus } from "./config";
import { GcalAuthRevoked, gcalEnv, refreshAccessToken, revokeToken } from "./oauth";
import {
  GcalApiError,
  type GcalEventInput,
  calendarExists,
  createCalendar,
  deleteEvent,
  insertEvent,
  patchEvent,
} from "./client";
import { reportError } from "@/lib/monitoring/report";

export const GCAL_CALENDAR_NAME = "Paint Group Jobs";

export type GcalConnectionRow = {
  contractor_id: string;
  google_email: string | null;
  refresh_token: string;
  calendar_id: string | null;
  sync_error: string | null;
  connected_at: string;
};

type EventMapRow = {
  work_order_id: string;
  contractor_id: string;
  google_event_id: string;
  calendar_id: string;
  content_hash: string;
};

export async function loadGcalConnection(
  admin: SupabaseClient,
  contractorId: string,
): Promise<GcalConnectionRow | null> {
  const { data } = await admin
    .from("contractor_gcal_connections")
    .select("contractor_id, google_email, refresh_token, calendar_id, sync_error, connected_at")
    .eq("contractor_id", contractorId)
    .maybeSingle();
  return (data as GcalConnectionRow | null) ?? null;
}

export async function saveGcalConnection(
  admin: SupabaseClient,
  contractorId: string,
  refreshToken: string,
  googleEmail: string | undefined,
): Promise<void> {
  const { error } = await admin.from("contractor_gcal_connections").upsert(
    {
      contractor_id: contractorId,
      refresh_token: refreshToken,
      google_email: googleEmail ?? null,
      sync_error: null,
      // calendar_id deliberately untouched: a reconnect keeps the existing
      // "Paint Group Jobs" calendar if it still exists.
    },
    { onConflict: "contractor_id" },
  );
  if (error) throw new Error(`gcal save connection: ${error.message}`);
}

/** Disconnect: forget the token our side, and best-effort revoke Google's. */
export async function deleteGcalConnection(admin: SupabaseClient, contractorId: string): Promise<void> {
  const conn = await loadGcalConnection(admin, contractorId);
  if (!conn) return;
  await revokeToken(conn.refresh_token);
  await admin.from("contractor_gcal_events").delete().eq("contractor_id", contractorId);
  await admin.from("contractor_gcal_connections").delete().eq("contractor_id", contractorId);
}

export async function gcalStatus(contractorId: string): Promise<GcalStatus> {
  const admin = createServiceClient();
  if (!admin || !gcalEnv()) return { kind: "unconfigured" };
  const conn = await loadGcalConnection(admin, contractorId).catch(() => null);
  if (!conn) return { kind: "not_connected" };
  if (conn.sync_error) return { kind: "error", email: conn.google_email, message: conn.sync_error };
  return { kind: "connected", email: conn.google_email, connectedAt: conn.connected_at };
}

// ---------------------------------------------------------------------------
// Event building — pure, unit-tested in gcal.test.ts.
// ---------------------------------------------------------------------------

/**
 * Which days a booking occupies: same day count as the portal calendar
 * (spanOf), rendered in Google as `days` consecutive 07:30–15:30 blocks —
 * fixed site hours (Tom, 27 Aug), never all-day banners.
 */
export function daySpan(job: Pick<Parameters<typeof spanOf>[0], "startDate" | "endDate" | "doc">): {
  startDate: string;
  days: number;
} | null {
  if (!job.startDate) return null;
  return { startDate: job.startDate, days: spanOf(job) };
}

export function buildEventInput(row: WoRow, siteUrl: string | null): GcalEventInput | null {
  const snap = row.wo_snapshot as WorkOrderDoc | null;
  const doc = snap && (snap as Partial<WorkOrderDoc>).version === 1 ? snap : null;
  const span = daySpan({ startDate: row.start_date, endDate: row.end_date ?? null, doc });
  if (!span) return null;

  const lines = [`Work order ${row.wo_ref}`];
  if (doc?.contactFirstName) {
    lines.push(`Contact: ${[doc.contactFirstName, doc.contactPhone].filter(Boolean).join(" · ")}`);
  }
  if (siteUrl) lines.push(`${siteUrl}/portal/jobs/${row.id}`);

  return {
    summary: doc?.jobTitle || row.wo_ref,
    location: doc?.jobAddress || undefined,
    description: lines.join("\n"),
    startDate: span.startDate,
    days: span.days,
  };
}

export function eventHash(e: GcalEventInput): string {
  return createHash("sha256").update(JSON.stringify(e)).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// The reconciler.
// ---------------------------------------------------------------------------

export type GcalSyncResult =
  | { status: "synced"; created: number; updated: number; removed: number }
  | { status: "not_connected" }
  | { status: "unconfigured" }
  | { status: "error"; message: string };

export async function reconcileContractorCalendar(contractorId: string): Promise<GcalSyncResult> {
  const admin = createServiceClient();
  if (!admin || !gcalEnv()) return { status: "unconfigured" };

  const conn = await loadGcalConnection(admin, contractorId);
  if (!conn) return { status: "not_connected" };

  const fail = async (message: string): Promise<GcalSyncResult> => {
    await admin
      .from("contractor_gcal_connections")
      .update({ sync_error: message })
      .eq("contractor_id", contractorId);
    return { status: "error", message };
  };

  try {
    const { accessToken } = await refreshAccessToken(conn.refresh_token);

    // The dedicated calendar — create it (or recreate it if the painter
    // deleted it by hand, taking every pushed event with it).
    let calendarId = conn.calendar_id;
    if (!calendarId || !(await calendarExists(accessToken, calendarId))) {
      if (calendarId) {
        await admin.from("contractor_gcal_events").delete().eq("contractor_id", contractorId);
      }
      calendarId = await createCalendar(accessToken, GCAL_CALENDAR_NAME);
      await admin
        .from("contractor_gcal_connections")
        .update({ calendar_id: calendarId })
        .eq("contractor_id", contractorId);
    }

    // Accepted bookings only — same query shape as the portal jobs list, then
    // the same committed rule on top.
    const { data: woData, error: woError } = await admin
      .from("work_orders")
      .select("id, wo_ref, status, start_date, end_date, issued_at, viewed_at, contractor_payment_cents, wo_snapshot")
      .eq("contractor_id", contractorId)
      .not("issued_at", "is", null)
      .not("start_date", "is", null);
    if (woError) throw new Error(`gcal sync work_orders: ${woError.message}`);
    const rows = (woData as WoRow[] | null) ?? [];

    let committed = new Set<string>();
    if (rows.length > 0) {
      const { data: offerData, error: offerError } = await admin
        .from("booking_offers")
        .select("work_order_id, state")
        .in(
          "work_order_id",
          rows.map((r) => r.id),
        );
      if (offerError) throw new Error(`gcal sync offers: ${offerError.message}`);
      committed = committedIds(
        rows.map((r) => r.id),
        (offerData as OfferStateRow[] | null) ?? [],
      );
    }
    const booked = rows.filter((r) => committed.has(r.id));

    const { data: mapData, error: mapError } = await admin
      .from("contractor_gcal_events")
      .select("work_order_id, contractor_id, google_event_id, calendar_id, content_hash")
      .eq("contractor_id", contractorId);
    if (mapError) throw new Error(`gcal sync event map: ${mapError.message}`);
    const mapped = new Map(((mapData as EventMapRow[] | null) ?? []).map((m) => [m.work_order_id, m]));

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? null;
    let created = 0;
    let updated = 0;
    let removed = 0;

    for (const row of booked) {
      const event = buildEventInput(row, siteUrl);
      if (!event) continue;
      const hash = eventHash(event);
      const existing = mapped.get(row.id);

      if (existing && existing.calendar_id === calendarId) {
        if (existing.content_hash === hash) continue;
        try {
          await patchEvent(accessToken, calendarId, existing.google_event_id, event);
        } catch (e) {
          // The painter deleted this one event by hand — put it back.
          if (!(e instanceof GcalApiError && (e.status === 404 || e.status === 410))) throw e;
          const freshId = await insertEvent(accessToken, calendarId, event);
          await admin
            .from("contractor_gcal_events")
            .update({ google_event_id: freshId })
            .eq("work_order_id", row.id);
        }
        await admin.from("contractor_gcal_events").update({ content_hash: hash }).eq("work_order_id", row.id);
        updated++;
      } else {
        // New booking (or a mapping pointing at a dead calendar).
        if (existing) await deleteEvent(accessToken, existing.calendar_id, existing.google_event_id);
        const eventId = await insertEvent(accessToken, calendarId, event);
        const { error } = await admin.from("contractor_gcal_events").upsert(
          {
            work_order_id: row.id,
            contractor_id: contractorId,
            google_event_id: eventId,
            calendar_id: calendarId,
            content_hash: hash,
          },
          { onConflict: "work_order_id" },
        );
        if (error) throw new Error(`gcal sync save map: ${error.message}`);
        created++;
      }
      mapped.delete(row.id);
    }

    // Whatever is left in the map is no longer an accepted booking of this
    // contractor's — cancelled, declined, reassigned, or unbooked.
    for (const stale of mapped.values()) {
      await deleteEvent(accessToken, stale.calendar_id, stale.google_event_id);
      await admin.from("contractor_gcal_events").delete().eq("work_order_id", stale.work_order_id);
      removed++;
    }

    await admin.from("contractor_gcal_connections").update({ sync_error: null }).eq("contractor_id", contractorId);
    return { status: "synced", created, updated, removed };
  } catch (e) {
    if (e instanceof GcalAuthRevoked) {
      return fail("Google access was revoked — reconnect Google Calendar in the portal.");
    }
    reportError(e, { where: "gcal.reconcile" });
    return fail(e instanceof Error ? e.message : "Google Calendar sync failed");
  }
}

/**
 * Reconcile everyone a booking offer touches. Staff actions know the OFFER,
 * not the contractor — and a reassignment involves two contractors (the offer
 * row keeps the old one, work_orders now points at the new one), so both get
 * reconciled.
 */
export async function reconcileForOffer(offerId: string): Promise<void> {
  const admin = createServiceClient();
  if (!admin || !gcalEnv()) return;
  const { data: offer } = await admin
    .from("booking_offers")
    .select("contractor_id, work_order_id")
    .eq("id", offerId)
    .maybeSingle();
  const row = offer as { contractor_id: string | null; work_order_id: string } | null;
  if (!row) return;
  const ids = new Set<string>();
  if (row.contractor_id) ids.add(row.contractor_id);
  const { data: wo } = await admin
    .from("work_orders")
    .select("contractor_id")
    .eq("id", row.work_order_id)
    .maybeSingle();
  const woContractor = (wo as { contractor_id: string | null } | null)?.contractor_id;
  if (woContractor) ids.add(woContractor);
  for (const id of ids) await reconcileContractorCalendar(id);
}

/** Reconcile whoever a work order is currently assigned to. */
export async function reconcileForWorkOrder(workOrderId: string): Promise<void> {
  const admin = createServiceClient();
  if (!admin || !gcalEnv()) return;
  const { data } = await admin.from("work_orders").select("contractor_id").eq("id", workOrderId).maybeSingle();
  const contractorId = (data as { contractor_id: string | null } | null)?.contractor_id;
  if (contractorId) await reconcileContractorCalendar(contractorId);
}

/** Cron safety net: reconcile everyone with a connection, one at a time. */
export async function reconcileAllConnected(): Promise<{ contractors: number; errors: number }> {
  const admin = createServiceClient();
  if (!admin || !gcalEnv()) return { contractors: 0, errors: 0 };
  const { data } = await admin.from("contractor_gcal_connections").select("contractor_id");
  const ids = ((data as { contractor_id: string }[] | null) ?? []).map((r) => r.contractor_id);
  let errors = 0;
  for (const id of ids) {
    const result = await reconcileContractorCalendar(id);
    if (result.status === "error") errors++;
  }
  return { contractors: ids.length, errors };
}
