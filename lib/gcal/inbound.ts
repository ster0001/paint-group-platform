// SERVER ONLY — what comes BACK from Google (visit booking addendum A §4.6, S5).
//
// Two things bring a change in: a push notification on the estimator's primary
// calendar (app/api/gcal/webhook) and the five-minute sweep
// (app/api/cron/gcal-sweep). Both call `syncStaffFromGoogle`, which reads each
// of our visit events and acts on what Google says:
//
//   gone      — Tom deleted it in Google (R27): the visit is cancelled here, the
//               travel block removed, the customer texted.
//   declined  — the guest declined the invitation (R22): the visit is cancelled,
//               both events removed, the slot reopened, the customer texted, a
//               card for staff (derived from visits.cancel_reason).
//   moved     — Tom moved it (R27): NOTHING changes in the platform; the mapping
//               row records what Google said and the queue raises a card asking
//               staff to confirm the new time with the customer.
//
// Idempotent: a notification and a sweep arriving together do the same work once.

import { randomUUID, createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { reportError } from "@/lib/monitoring/report";
import { sendAutomation } from "@/lib/automations/dispatch";
import { loadMessaging } from "@/lib/messaging/load";
import { renderTemplate } from "@/lib/messaging/config";
import { sendVisitCancellation, visitWhen } from "@/lib/visits/notify";
import { GcalAuthRevoked, gcalEnv, refreshAccessToken, scopesCanWritePrimary } from "./oauth";
import { deleteEventNotify, getEvent, stopChannel, watchEvents } from "./client";
import { classifyGoogleEvent } from "./visitEvents";
import { forgetGoogleReads } from "./read";
import { loadStaffConnection, type StaffGcalConnectionRow } from "./staff";

type MapRow = { id: string; kind: "visit" | "job" | "travel"; ref_id: string; google_event_id: string; calendar_id: string; google_start: string | null; moved_seen_at: string | null };
type VisitLite = { id: string; status: string; starts_at: string; ends_at: string; account_id: string | null; estimate_id: string | null; customer_phone: string | null; customer_name: string | null; address: string | null };

export type InboundResult = { status: "ok"; checked: number; cancelled: number; moved: number } | { status: "not_connected" } | { status: "unconfigured" } | { status: "error"; message: string };

/** The channel token Google echoes back (X-Goog-Channel-Token): an HMAC of the channel id, so a forged notification is ignored. */
export function webhookToken(channelId: string): string {
  const secret = process.env.CRON_SECRET ?? "";
  return createHmac("sha256", secret).update(channelId).digest("hex").slice(0, 48);
}

/** Where Google posts: the live host, HTTPS. Set GCAL_WEBHOOK_URL to override. */
export function webhookAddress(): string | null {
  const explicit = process.env.GCAL_WEBHOOK_URL;
  if (explicit) return explicit;
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
  return site.startsWith("https://") ? `${site}/api/gcal/webhook` : null;
}

/** Google's channels live about a week; renew a day early. */
const CHANNEL_TTL_MS = 6 * 86_400_000;
const RENEW_WITHIN_MS = 24 * 3_600_000;

/**
 * Make sure a push channel exists on the primary calendar and is not about to
 * expire. Best effort: without an HTTPS address (localhost, the test stack) the
 * sweep alone carries the changes.
 */
export async function ensureWatch(staffId: string, now = new Date()): Promise<"watching" | "skipped" | "error"> {
  const admin = createServiceClient();
  if (!admin || !gcalEnv() || !process.env.CRON_SECRET) return "skipped";
  const address = webhookAddress();
  if (!address) return "skipped";
  const conn = await loadStaffConnection(admin, staffId);
  if (!conn || !scopesCanWritePrimary(conn.scopes)) return "skipped";
  const c = conn as StaffGcalConnectionRow & { watch_channel_id?: string | null; watch_resource_id?: string | null; watch_expires_at?: string | null };
  if (c.watch_channel_id && c.watch_expires_at && new Date(c.watch_expires_at).getTime() - now.getTime() > RENEW_WITHIN_MS) return "watching";
  try {
    const { accessToken } = await refreshAccessToken(conn.refresh_token);
    if (c.watch_channel_id && c.watch_resource_id) await stopChannel(accessToken, c.watch_channel_id, c.watch_resource_id).catch(() => undefined);
    const id = randomUUID();
    const ch = await watchEvents(accessToken, "primary", { id, address, token: webhookToken(id), expirationMs: now.getTime() + CHANNEL_TTL_MS });
    const { error } = await admin.from("staff_gcal_connections").update({ watch_channel_id: ch.id, watch_resource_id: ch.resourceId, watch_expires_at: new Date(ch.expiration).toISOString() }).eq("staff_id", staffId);
    if (error) throw new Error(error.message);
    return "watching";
  } catch (e) {
    reportError(e, { where: "gcal.inbound.watch", bestEffort: true, extra: { staffId } });
    return "error";
  }
}

/** On disconnect: tell Google to stop, forget the channel. */
export async function stopWatch(admin: SupabaseClient, conn: StaffGcalConnectionRow & { watch_channel_id?: string | null; watch_resource_id?: string | null }): Promise<void> {
  if (!conn.watch_channel_id || !conn.watch_resource_id) return;
  try {
    const { accessToken } = await refreshAccessToken(conn.refresh_token);
    await stopChannel(accessToken, conn.watch_channel_id, conn.watch_resource_id);
  } catch (e) {
    reportError(e, { where: "gcal.inbound.stopWatch", bestEffort: true });
  }
  await admin.from("staff_gcal_connections").update({ watch_channel_id: null, watch_resource_id: null, watch_expires_at: null }).eq("staff_id", conn.staff_id);
}

/** The estimator whose channel this is. */
export async function staffForChannel(channelId: string): Promise<string | null> {
  const admin = createServiceClient();
  if (!admin) return null;
  const { data, error } = await admin.from("staff_gcal_connections").select("staff_id").eq("watch_channel_id", channelId).maybeSingle();
  if (error) { reportError(error, { where: "gcal.inbound.channel", bestEffort: true }); return null; }
  return (data?.staff_id as string | undefined) ?? null;
}

/** Read every visit event we hold for this estimator and act on what Google says. */
export async function syncStaffFromGoogle(staffId: string, now = new Date()): Promise<InboundResult> {
  const admin = createServiceClient();
  if (!admin || !gcalEnv()) return { status: "unconfigured" };
  const conn = await loadStaffConnection(admin, staffId);
  if (!conn) return { status: "not_connected" };
  if (!scopesCanWritePrimary(conn.scopes)) return { status: "ok", checked: 0, cancelled: 0, moved: 0 };
  try {
    const { accessToken } = await refreshAccessToken(conn.refresh_token);
    const { data: maps, error: mErr } = await admin.from("staff_gcal_events")
      .select("id, kind, ref_id, google_event_id, calendar_id, google_start, moved_seen_at").eq("staff_id", staffId).eq("kind", "visit").limit(1000);
    if (mErr) throw new Error(`staff gcal map: ${mErr.message}`);
    const rows = (maps ?? []) as MapRow[];
    if (!rows.length) return { status: "ok", checked: 0, cancelled: 0, moved: 0 };
    const { data: visitData, error: vErr } = await admin.from("visits")
      .select("id, status, starts_at, ends_at, account_id, estimate_id, customer_phone, customer_name, address").in("id", rows.map((r) => r.ref_id));
    if (vErr) throw new Error(`visits: ${vErr.message}`);
    const visits = new Map(((visitData ?? []) as VisitLite[]).map((v) => [v.id, v]));
    const accountIds = [...new Set([...visits.values()].map((v) => v.account_id).filter((x): x is string => !!x))];
    const accRead = accountIds.length ? await admin.from("accounts").select("id, email").in("id", accountIds) : { data: [] as Array<{ id: string; email: string | null }>, error: null };
    if (accRead.error) throw new Error(`accounts: ${accRead.error.message}`);
    const emails = new Map(((accRead.data ?? []) as Array<{ id: string; email: string | null }>).map((a) => [a.id, a.email]));

    let checked = 0, cancelled = 0, moved = 0;
    for (const m of rows) {
      const v = visits.get(m.ref_id);
      if (!v || v.status !== "booked") continue;
      // Past visits are history: a decline after the fact changes nothing.
      if (new Date(v.ends_at).getTime() < now.getTime()) continue;
      checked++;
      const ev = await getEvent(accessToken, m.calendar_id, m.google_event_id);
      const change = classifyGoogleEvent(ev, v.starts_at, v.account_id ? emails.get(v.account_id) ?? null : null);
      await admin.from("staff_gcal_events").update({ last_checked_at: now.toISOString(), google_status: ev?.status ?? "gone" }).eq("id", m.id);
      if (change.kind === "gone" || change.kind === "declined") {
        const reason = change.kind === "gone" ? "deleted_in_google" : "declined_invitation";
        await cancelFromGoogle(admin, accessToken, staffId, v, m, reason);
        cancelled++;
      } else if (change.kind === "moved") {
        if (m.google_start !== change.googleStart) {
          await admin.from("staff_gcal_events").update({ google_start: change.googleStart, moved_seen_at: now.toISOString(), moved_acknowledged_at: null }).eq("id", m.id);
          moved++;
        }
      } else if (m.google_start && m.google_start !== change.googleStart) {
        // Moved back to where the platform has it: the card can go.
        await admin.from("staff_gcal_events").update({ google_start: change.googleStart, moved_seen_at: null, moved_acknowledged_at: now.toISOString() }).eq("id", m.id);
      } else if (!m.google_start) {
        await admin.from("staff_gcal_events").update({ google_start: change.googleStart }).eq("id", m.id);
      }
    }
    await admin.from("staff_gcal_connections").update({ last_synced_at: now.toISOString() }).eq("staff_id", staffId);
    if (cancelled || moved) forgetGoogleReads(staffId);
    return { status: "ok", checked, cancelled, moved };
  } catch (e) {
    if (e instanceof GcalAuthRevoked) {
      await admin.from("staff_gcal_connections").update({ sync_error: "Google access was revoked — reconnect Google Calendar on the Diary." }).eq("staff_id", staffId);
      return { status: "error", message: "revoked" };
    }
    reportError(e, { where: "gcal.inbound.sync", extra: { staffId } });
    return { status: "error", message: e instanceof Error ? e.message : "Google Calendar read failed" };
  }
}

/**
 * The visit is cancelled in the platform (the RPC the Diary uses, so the
 * crm_events trigger writes visit_cancelled), both events are removed from
 * Google without re-notifying the guest, and the customer is texted (section
 * 10 "Visit cancelled"). The invitation's own CANCEL email goes through the
 * existing visit_confirmation path.
 */
async function cancelFromGoogle(admin: SupabaseClient, accessToken: string, staffId: string, v: VisitLite, m: MapRow, reason: "deleted_in_google" | "declined_invitation"): Promise<void> {
  const { error } = await admin.rpc("visit_set_status", { p_id: v.id, p_status: "cancelled", p_note: reason });
  if (error) throw new Error(`visit_set_status: ${error.message}`);
  // Both events: the visit (already gone when Tom deleted it) and its travel block.
  const { data: siblings, error: sibErr } = await admin.from("staff_gcal_events").select("id, kind, google_event_id, calendar_id").eq("staff_id", staffId).eq("ref_id", v.id);
  if (sibErr) throw new Error(`staff gcal map: ${sibErr.message}`);
  for (const s of (siblings ?? []) as Array<{ id: string; kind: string; google_event_id: string; calendar_id: string }>) {
    await deleteEventNotify(accessToken, s.calendar_id, s.google_event_id, "none").catch((e) => reportError(e, { where: "gcal.inbound.deleteSibling", bestEffort: true }));
    await admin.from("staff_gcal_events").delete().eq("id", s.id);
  }
  try { await sendVisitCancellation(admin, v.id); } catch (e) { reportError(e, { where: "gcal.inbound.cancelEmail", bestEffort: true }); }
  if (v.customer_phone) {
    try {
      const { messaging, company } = await loadMessaging(admin);
      await sendAutomation(admin, {
        key: "visit_cancelled",
        to: { phone: v.customer_phone },
        sms: { body: renderTemplate(messaging.visitCancelledSms, { first_name: (v.customer_name ?? "").split(/\s+/)[0] || "there", visit_when: visitWhen(v.starts_at, v.ends_at), company_name: company.name || "Paint Group" }) },
        ctx: { accountId: v.account_id, estimateId: v.estimate_id, kind: "visit_cancelled" },
      });
    } catch (e) {
      reportError(e, { where: "gcal.inbound.cancelText", bestEffort: true });
    }
  }
}

/** The sweep: every connected estimator — inbound changes, the channel, then the write side. */
export async function sweepAllStaff(now = new Date()): Promise<{ staff: number; cancelled: number; moved: number; errors: number }> {
  const admin = createServiceClient();
  if (!admin || !gcalEnv()) return { staff: 0, cancelled: 0, moved: 0, errors: 0 };
  const { data, error } = await admin.from("staff_gcal_connections").select("staff_id");
  if (error) { reportError(error, { where: "gcal.inbound.sweep" }); return { staff: 0, cancelled: 0, moved: 0, errors: 1 }; }
  const { reconcileStaffCalendar } = await import("./staff");
  let cancelled = 0, moved = 0, errors = 0;
  const ids = ((data ?? []) as { staff_id: string }[]).map((r) => r.staff_id);
  for (const id of ids) {
    const r = await syncStaffFromGoogle(id, now);
    if (r.status === "ok") { cancelled += r.cancelled; moved += r.moved; } else if (r.status === "error") errors++;
    if ((await ensureWatch(id, now)) === "error") errors++;
    const w = await reconcileStaffCalendar(id);
    if (w.status === "error") errors++;
    forgetGoogleReads(id);
  }
  return { staff: ids.length, cancelled, moved, errors };
}
