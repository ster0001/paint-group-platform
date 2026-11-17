/**
 * Lead L9 / L10 / L13 — the staff alerts for help, visit and call requests
 * (R4, automations brief; 17 Nov 2026). SERVER ONLY, service client.
 *
 * `logRequestEvent` is how these requests are written — the wizard's help
 * bar, a visit request, a call back from the holding page or the range
 * editor, the assistant's call back: the CRM event, then the alert. A
 * boundary test (requestAlerts.boundary.test.ts) fails any `logCrmEvent`
 * call in app/ or lib/ that writes one of these types directly. (The live
 * website chat's "asked a question" is the one exception: its hand-off is
 * already its own alert and its own pop-up row.)
 *
 * R4: in office hours (Mon–Fri 8–5, the Settings → Booking rules holidays
 * out — lib/time/businessHours) the alert is an email to everyone whose
 * routing has Email ticked, and the staff chat pop-up shows it (the dock reads
 * the staff_notifications row this writes). Out of hours everyone with Text
 * ticked is texted the Appendix A line as well, and Email still gets it as
 * the summary. Who is told is each login's own routing
 * (lib/staff/notifyEvents.ts); the once-only guard and the sends are
 * notifyStaff's (lib/staff/notify.ts), keyed on the CRM event.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { mergeBookingRules, BOOKING_RULES_KEY } from "@/lib/visits/schedule";
import { ZONE_WORDS } from "@/lib/visits/zoneWords";
import { parseLeadSnapshot } from "@/lib/estimate/leadSnapshot";
import { leadRangeWords, streetOf } from "@/lib/automations/leadSequence";
import { siteUrl } from "@/lib/invoicing/pdf";
import { reportError } from "@/lib/monitoring/report";
import { loadMessaging } from "@/lib/messaging/load";
import { automationOn } from "@/lib/messaging/config";
import { logCrmEvent, type CrmEventInput } from "@/lib/crm/events";
import { notifyStaff, type StaffAlertOutcome } from "./notify";
import { dueWords, requestAlertKey, requestAlertRoute } from "./requestAlertRules";

export { REQUEST_ALERT_TYPES, dueWords, requestAlertKey, requestAlertRoute } from "./requestAlertRules";

/** Write a request's CRM event, then tell staff (L9 / L10 / L13). Returns the event id, as logCrmEvent does. */
export async function logRequestEvent(db: Parameters<typeof logCrmEvent>[0], input: CrmEventInput): Promise<string | null> {
  const id = await logCrmEvent(db, input);
  // Once per event id: a repeat dedupe key returns the same id, and notifyStaff's guard row is keyed on it.
  if (id && requestAlertKey(input.type, input.payload)) await alertStaffForRequest(id, input);
  return id;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Tell staff about one request event. Best effort: a request is never undone
 * by its alert, so every failure is reported and returns "error".
 */
export async function alertStaffForRequest(eventId: string, input: CrmEventInput, now = new Date(), db?: SupabaseClient): Promise<StaffAlertOutcome> {
  const key = requestAlertKey(input.type, input.payload);
  if (!key) return "nobody";
  const svc = db ?? createServiceClient();
  if (!svc) return "off";
  try {
    // Shipped off (A‑D): a switched-off alert costs one settings read, not five.
    const { messaging } = await loadMessaging(svc);
    if (!automationOn(messaging, key)) return "off";
    const p = (input.payload ?? {}) as { requestId?: unknown; phone?: unknown; note?: unknown; page?: unknown; zone?: unknown };
    const requestId = str(p.requestId);
    const [rules, est, acct, req] = await Promise.all([
      svc.from("settings").select("value").eq("key", BOOKING_RULES_KEY).maybeSingle(),
      input.estimateId
        ? svc.from("estimates").select("id, title, lead_snapshot, contact_name:builder_state->contact->>name, contact_phone:builder_state->contact->>phone").eq("id", input.estimateId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      input.accountId
        ? svc.from("accounts").select("id, name, phone").eq("id", input.accountId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      requestId
        ? svc.from("visit_requests").select("id, name, mobile, suburb, zone, due_at").eq("id", requestId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    // A refused read is never "no holidays" or "no customer": the alert still goes, and the reason is reported.
    for (const [where, r] of [["holidays", rules], ["estimate", est], ["account", acct], ["visit request", req]] as const) {
      if (r.error) reportError(new Error(`${where}: ${r.error.message}`), { where: "staff.requestAlert.read", bestEffort: true, extra: { eventId } });
    }
    const holidays = new Set(rules.error ? [] : mergeBookingRules(rules.data?.value).publicHolidays);
    const route = requestAlertRoute(now, holidays);

    const e = est.data as { id: string; title: string | null; lead_snapshot: unknown; contact_name: string | null; contact_phone: string | null } | null;
    const a = acct.data as { id: string; name: string | null; phone: string | null } | null;
    const r = req.data as { id: string; name: string | null; mobile: string | null; suburb: string | null; zone: string | null; due_at: string | null } | null;
    const snap = e ? parseLeadSnapshot(e.lead_snapshot) : null;
    const fullName = snap?.firstName || r?.name || e?.contact_name || a?.name || "";
    const firstName = fullName.trim().split(/\s+/)[0] || "A customer";
    const address = (snap?.address && streetOf(snap.address)) || e?.title || r?.suburb || "their place";
    const phone = str(p.phone) || r?.mobile || e?.contact_phone || a?.phone || "not given";
    const zone = r ? [r.suburb, ZONE_WORDS[r.zone ?? ""] ?? r.zone].filter(Boolean).join(", ") : str(p.zone) || "zone not known";

    const base = siteUrl();
    const link = r ? `${base}/crm/visit-requests/${r.id}`
      : e ? `${base}/quote?id=${e.id}`
      : a ? `${base}/crm/customers/${a.id}`
      : `${base}/crm/today`;
    const vars = {
      first_name: firstName, address, phone, zone,
      range: snap ? leadRangeWords(snap.rangeLoCents, snap.rangeHiCents) : "no range yet",
      step: str(p.page) || "the wizard",
      message: str(p.note) || "no message",
      due: r?.due_at ? dueWords(r.due_at) : "the end of the next working day",
      hours_tag: route.inHours ? "" : " (after hours)",
    };
    const templates = key === "office_lead_help"
      ? { subject: "officeLeadHelpSubject" as const, body: "officeLeadHelpBody" as const }
      : key === "office_visit_request"
        ? { subject: "officeVisitRequestSubject" as const, body: "officeVisitRequestBody" as const }
        : { subject: "officeCallRequestSubject" as const, body: "officeCallRequestBody" as const };
    const fallback = key === "office_lead_help" ? `${firstName} needs help — ${address}` : key === "office_visit_request" ? `Visit request — ${firstName}, ${address}` : `Call request — ${firstName}, ${address}`;
    return await notifyStaff(svc, {
      key, entityId: eventId, link,
      subject: `${fallback}${vars.hours_tag}`,
      message: fallback,
      templates, vars,
      channels: route.channels,
      smsFromMessage: true,
      estimateId: e?.id ?? null,
    });
  } catch (err) {
    reportError(err, { where: "staff.requestAlert", extra: { eventId, type: input.type } });
    return "error";
  }
}
