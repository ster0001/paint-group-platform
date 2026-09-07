// SERVER ONLY — Google Calendar sync for STAFF (CRM v2 P6, deep dive §4.6.4–5).
//
// The contractor reconciler's design, reused whole: no "push this one change"
// path — every trigger (a visit booked, moved, done, cancelled; the evening
// sweep) calls `reconcileStaffCalendar`, which diffs what SHOULD be in the
// person's app-created calendar against the mapping rows and inserts /
// patches / deletes the difference. Claim-before-continue, exactly as the
// 28 Aug near-miss taught (see lib/gcal/sync.ts).
//
// What goes in: the estimator's BOOKED visits (from a week ago, so a moved
// one clears), as real timed events with the address, customer and phone,
// and the estimate link. With `push_jobs` on, booked jobs too (07:30–15:30
// day blocks, the contractor rule) so the office calendar shows the week.

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import type { GcalStatus } from "./config";
import { GcalAuthRevoked, gcalEnv, refreshAccessToken, revokeToken, scopesCanRead } from "./oauth";
import {
  GcalApiError, calendarExists, createCalendar, deleteEvent, insertEvent, insertTimedEvent, patchEvent, patchTimedEvent,
  type GcalEventInput, type GcalTimedEventInput,
} from "./client";
import { reportError } from "@/lib/monitoring/report";
import { VISIT_KINDS, type VisitRow } from "@/lib/visits/types";

export const STAFF_CALENDAR_NAME = "Paint Group Visits";

export type StaffGcalConnectionRow = {
  staff_id: string;
  google_email: string | null;
  refresh_token: string;
  calendar_id: string | null;
  sync_error: string | null;
  push_jobs: boolean;
  connected_at: string;
  /** Granted at connect time (8 Sep); null = a connection from before, write-only. */
  scopes: string | null;
};

type MapRow = { id: string; kind: "visit" | "job"; ref_id: string; google_event_id: string; calendar_id: string; content_hash: string };

export async function loadStaffConnection(admin: SupabaseClient, staffId: string): Promise<StaffGcalConnectionRow | null> {
  const { data } = await admin.from("staff_gcal_connections")
    .select("staff_id, google_email, refresh_token, calendar_id, sync_error, push_jobs, connected_at, scopes")
    .eq("staff_id", staffId).maybeSingle();
  return (data as StaffGcalConnectionRow | null) ?? null;
}

export async function saveStaffConnection(admin: SupabaseClient, staffId: string, refreshToken: string, googleEmail: string | undefined, scopes?: string): Promise<void> {
  const { error } = await admin.from("staff_gcal_connections").upsert(
    { staff_id: staffId, refresh_token: refreshToken, google_email: googleEmail ?? null, sync_error: null, scopes: scopes ?? null },
    { onConflict: "staff_id" },
  );
  if (error) throw new Error(`staff gcal save: ${error.message}`);
}

export async function deleteStaffConnection(admin: SupabaseClient, staffId: string): Promise<void> {
  const conn = await loadStaffConnection(admin, staffId);
  if (!conn) return;
  await revokeToken(conn.refresh_token);
  await admin.from("staff_gcal_events").delete().eq("staff_id", staffId);
  await admin.from("staff_gcal_connections").delete().eq("staff_id", staffId);
}

export async function staffGcalStatus(staffId: string): Promise<GcalStatus & { pushJobs?: boolean }> {
  const admin = createServiceClient();
  if (!admin || !gcalEnv()) return { kind: "unconfigured" };
  const conn = await loadStaffConnection(admin, staffId).catch(() => null);
  if (!conn) return { kind: "not_connected" };
  const canRead = scopesCanRead(conn.scopes);
  if (conn.sync_error) return { kind: "error", email: conn.google_email, message: conn.sync_error, pushJobs: conn.push_jobs, canRead };
  return { kind: "connected", email: conn.google_email, connectedAt: conn.connected_at, pushJobs: conn.push_jobs, canRead };
}

// ---- event building — pure, unit-tested ------------------------------------

export function buildVisitEvent(v: VisitRow, siteUrl: string | null): GcalTimedEventInput {
  const kind = VISIT_KINDS.find((k) => k.key === v.kind)?.label ?? "Visit";
  const who = v.customer_name || "Customer";
  const lines = [`${kind} — ${who}`];
  if (v.customer_phone) lines.push(`Phone: ${v.customer_phone}`);
  if (v.note) lines.push(v.note);
  if (v.estimate_id && siteUrl) lines.push(`${siteUrl}/quote/${v.estimate_id}`);
  if (v.account_id && siteUrl) lines.push(`${siteUrl}/crm/customers/${v.account_id}`);
  return {
    summary: `${kind}: ${who}${v.suburb ? ` (${v.suburb})` : ""}`,
    location: v.address || undefined,
    description: lines.join("\n"),
    startsAt: v.starts_at,
    endsAt: v.ends_at,
  };
}

const hashOf = (e: unknown) => createHash("sha256").update(JSON.stringify(e)).digest("hex").slice(0, 16);

export type StaffSyncResult =
  | { status: "synced"; created: number; updated: number; removed: number }
  | { status: "not_connected" }
  | { status: "unconfigured" }
  | { status: "error"; message: string };

export async function reconcileStaffCalendar(staffId: string): Promise<StaffSyncResult> {
  const admin = createServiceClient();
  if (!admin || !gcalEnv()) return { status: "unconfigured" };
  const conn = await loadStaffConnection(admin, staffId);
  if (!conn) return { status: "not_connected" };

  const fail = async (message: string): Promise<StaffSyncResult> => {
    await admin.from("staff_gcal_connections").update({ sync_error: message }).eq("staff_id", staffId);
    return { status: "error", message };
  };

  try {
    const { accessToken } = await refreshAccessToken(conn.refresh_token);
    let calendarId = conn.calendar_id;
    if (!calendarId || !(await calendarExists(accessToken, calendarId))) {
      if (calendarId) await admin.from("staff_gcal_events").delete().eq("staff_id", staffId);
      calendarId = await createCalendar(accessToken, STAFF_CALENDAR_NAME);
      await admin.from("staff_gcal_connections").update({ calendar_id: calendarId }).eq("staff_id", staffId);
    }

    // What should be there.
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { data: visitData, error: vErr } = await admin.from("visits")
      .select("id, account_id, property_id, estimate_id, staff_id, starts_at, ends_at, kind, status, source, address, suburb, customer_name, customer_phone, note, outcome_note, outcome_at, cancelled_at, cancel_reason, confirmation_sent_at, reminder_sent_at")
      .eq("staff_id", staffId).eq("status", "booked").gte("starts_at", weekAgo).limit(1000);
    if (vErr) throw new Error(`staff gcal visits: ${vErr.message}`);
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? null;
    const wanted = new Map<string, { kind: "visit" | "job"; timed?: GcalTimedEventInput; block?: GcalEventInput }>();
    for (const v of (visitData ?? []) as VisitRow[]) wanted.set(`visit:${v.id}`, { kind: "visit", timed: buildVisitEvent(v, siteUrl) });

    if (conn.push_jobs) {
      const { buildEventInput } = await import("./sync");
      const today = new Date().toISOString().slice(0, 10);
      const { data: jobs } = await admin.from("work_orders")
        .select("id, wo_ref, status, start_date, end_date, issued_at, viewed_at, contractor_payment_cents, wo_snapshot")
        .not("issued_at", "is", null).not("start_date", "is", null).gte("start_date", today).neq("stage", "closed").limit(500);
      for (const row of jobs ?? []) {
        const ev = buildEventInput(row as never, siteUrl);
        if (ev) wanted.set(`job:${row.id as string}`, { kind: "job", block: ev });
      }
    }

    const { data: mapData, error: mErr } = await admin.from("staff_gcal_events")
      .select("id, kind, ref_id, google_event_id, calendar_id, content_hash").eq("staff_id", staffId);
    if (mErr) throw new Error(`staff gcal map: ${mErr.message}`);
    const mapped = new Map(((mapData ?? []) as MapRow[]).map((m) => [`${m.kind}:${m.ref_id}`, m]));

    let created = 0, updated = 0, removed = 0;
    for (const [key, w] of wanted) {
      const body = w.timed ?? w.block!;
      const hash = hashOf(body);
      const existing = mapped.get(key);
      // Claim first — everything left in `mapped` after the loop is deleted.
      mapped.delete(key);
      const refId = key.slice(key.indexOf(":") + 1);
      const insert = () => (w.timed ? insertTimedEvent(accessToken, calendarId!, w.timed) : insertEvent(accessToken, calendarId!, w.block!));
      if (existing && existing.calendar_id === calendarId) {
        if (existing.content_hash === hash) continue;
        try {
          if (w.timed) await patchTimedEvent(accessToken, calendarId, existing.google_event_id, w.timed);
          else await patchEvent(accessToken, calendarId, existing.google_event_id, w.block!);
        } catch (e) {
          if (!(e instanceof GcalApiError && (e.status === 404 || e.status === 410))) throw e;
          const freshId = await insert();
          await admin.from("staff_gcal_events").update({ google_event_id: freshId }).eq("id", existing.id);
        }
        await admin.from("staff_gcal_events").update({ content_hash: hash }).eq("id", existing.id);
        updated++;
      } else {
        if (existing) await deleteEvent(accessToken, existing.calendar_id, existing.google_event_id);
        const eventId = await insert();
        const { error } = await admin.from("staff_gcal_events").upsert(
          { staff_id: staffId, kind: w.kind, ref_id: refId, google_event_id: eventId, calendar_id: calendarId, content_hash: hash },
          { onConflict: "staff_id,kind,ref_id" },
        );
        if (error) throw new Error(`staff gcal save map: ${error.message}`);
        created++;
      }
    }
    for (const stale of mapped.values()) {
      await deleteEvent(accessToken, stale.calendar_id, stale.google_event_id);
      await admin.from("staff_gcal_events").delete().eq("id", stale.id);
      removed++;
    }
    await admin.from("staff_gcal_connections").update({ sync_error: null }).eq("staff_id", staffId);
    return { status: "synced", created, updated, removed };
  } catch (e) {
    if (e instanceof GcalAuthRevoked) return fail("Google access was revoked — reconnect Google Calendar on the Diary.");
    reportError(e, { where: "gcal.staff.reconcile" });
    return fail(e instanceof Error ? e.message : "Google Calendar sync failed");
  }
}

/** After any visit write: reconcile the estimator it touches (and the previous one, on a move). */
export async function reconcileForVisit(staffIds: Array<string | null | undefined>): Promise<void> {
  const admin = createServiceClient();
  if (!admin || !gcalEnv()) return;
  for (const id of new Set(staffIds.filter((x): x is string => !!x))) {
    const conn = await loadStaffConnection(admin, id);
    if (conn) await reconcileStaffCalendar(id);
  }
}

/** Cron safety net: everyone connected, one at a time. */
export async function reconcileAllStaff(): Promise<{ staff: number; errors: number }> {
  const admin = createServiceClient();
  if (!admin || !gcalEnv()) return { staff: 0, errors: 0 };
  const { data } = await admin.from("staff_gcal_connections").select("staff_id");
  const ids = ((data ?? []) as { staff_id: string }[]).map((r) => r.staff_id);
  let errors = 0;
  for (const id of ids) {
    const r = await reconcileStaffCalendar(id);
    if (r.status === "error") errors++;
  }
  return { staff: ids.length, errors };
}
