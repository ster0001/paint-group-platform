/**
 * "Staff to receive email if an offered estimate is rejected / expires"
 * (Tom, 1 Oct 2026). SERVER ONLY.
 *
 * Two office alerts on the same path as "Contract accepted": the master
 * switch in Settings → Automations, who gets it (email / text) per login
 * under Staff logins (`profiles.staff_notify`), sent once per estimate by
 * the `staff_notifications` claim inside `notifyStaff`.
 *
 *   office_estimate_declined — the customer's /e page declines through a
 *     browser → Postgres RPC with no server seam, so the page pings
 *     /api/estimates/declined afterwards (the accept pattern) and this runs.
 *     It acts only on an estimate that IS declined.
 *   office_estimate_expired — the daily CRM sweep marks sent estimates past
 *     valid_until as expired (crm_lapse_estimates). The sweep then calls
 *     notifyOfficeOfLapsedEstimates, which reads the lapse events the RPC
 *     wrote and alerts for each. A send that failed one day is retried the
 *     next, because the claim is only written on a run that got that far.
 *
 * Best-effort throughout: a decline or a sweep never fails over an email.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { siteUrl } from "@/lib/invoicing/pdf";
import { reportError } from "@/lib/monitoring/report";
import { notifyStaff, type StaffAlertOutcome } from "@/lib/staff/notify";

const money = (c: number | null | undefined) =>
  "$" + ((c ?? 0) / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A yyyy-mm-dd calendar date in words ("Wed 30 Sept"). No zone is involved:
 *  the date is already a Melbourne calendar day, so it is formatted as UTC
 *  midnight of itself rather than through a written-down offset. */
const dateAU = (d: string | null | undefined) => {
  if (!d) return "—";
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day))
    .toLocaleDateString("en-AU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" })
    .replace(",", "");
};

type Est = {
  id: string; title: string | null; status: string; total_cents: number | null; valid_until: string | null;
  declined_reason: string | null;
  builder_state: { contact?: { name?: string | null; first_name?: string | null } } | null;
  sent_snapshot: { jobAddress?: string; contactName?: string; totalCents?: number } | null;
};

const SELECT = "id, title, status, total_cents, valid_until, declined_reason, builder_state, sent_snapshot";

/** The words every template shares: who, which job, how much, where to go. */
function describe(est: Est) {
  const contact = est.builder_state?.contact ?? {};
  const customer = (est.sent_snapshot?.contactName || contact.name || contact.first_name || "The customer").trim();
  const job = [est.title, est.sent_snapshot?.jobAddress].filter(Boolean).join(" · ") || "an estimate";
  const total = money(est.sent_snapshot?.totalCents ?? est.total_cents ?? 0);
  const link = `${siteUrl()}/quote?id=${est.id}`;
  return { customer, job, total, link };
}

/** The customer declined — tell the staff who ticked "Estimate declined". */
export async function notifyOfficeOfDecline(service: SupabaseClient, estimateId: string): Promise<StaffAlertOutcome | "not_declined"> {
  try {
    const { data, error } = await service.from("estimates").select(SELECT).eq("id", estimateId).maybeSingle();
    if (error) throw error;
    const est = data as Est | null;
    if (!est || est.status !== "declined") return "not_declined";
    const { customer, job, total, link } = describe(est);
    const reason_line = est.declined_reason?.trim() ? `\n\nTheir reason: ${est.declined_reason.trim()}` : "";
    return await notifyStaff(service, {
      key: "office_estimate_declined", entityId: est.id,
      subject: `Estimate declined — ${customer} · ${job}`,
      message: `${customer} has declined the estimate for ${job} (${total}).${reason_line}\n\nOpen the estimate to follow up or close it off.`,
      link,
      templates: { subject: "officeEstimateDeclinedSubject", body: "officeEstimateDeclinedBody" },
      vars: { customer, job, total, reason_line },
    });
  } catch (e) {
    reportError(e, { where: "notifyOfficeOfDecline", extra: { estimateId } });
    return "error";
  }
}

/** The /e page has only its token — resolve it, then notify. */
export async function notifyOfficeOfDeclineByToken(service: SupabaseClient, shareToken: string) {
  const { data, error } = await service.from("estimates").select("id").eq("share_token", shareToken).maybeSingle();
  if (error) {
    reportError(error, { where: "notifyOfficeOfDeclineByToken", extra: { tokenLength: shareToken.length } });
    return "error" as const;
  }
  const id = (data as { id?: string } | null)?.id;
  if (!id) return "not_declined" as const;
  return notifyOfficeOfDecline(service, id);
}

/** A sent estimate lapsed — tell the staff who ticked "Estimate expired". */
export async function notifyOfficeOfExpiry(service: SupabaseClient, estimateId: string): Promise<StaffAlertOutcome | "not_expired"> {
  try {
    const { data, error } = await service.from("estimates").select(SELECT).eq("id", estimateId).maybeSingle();
    if (error) throw error;
    const est = data as Est | null;
    if (!est || est.status !== "expired") return "not_expired";
    const { customer, job, total, link } = describe(est);
    const valid_until = dateAU(est.valid_until);
    return await notifyStaff(service, {
      key: "office_estimate_expired", entityId: est.id,
      subject: `Estimate expired — ${customer} · ${job}`,
      message: `The estimate for ${job} (${total}) sent to ${customer} passed its valid-until date (${valid_until}) without an answer.\n\nIt is on the CRM follow-up list — open it to extend, re-send or close it.`,
      link,
      templates: { subject: "officeEstimateExpiredSubject", body: "officeEstimateExpiredBody" },
      vars: { customer, job, total, valid_until },
    });
  } catch (e) {
    reportError(e, { where: "notifyOfficeOfExpiry", extra: { estimateId } });
    return "error";
  }
}

/** How far back the sweep looks for lapses it has not yet told anyone about. */
export const LAPSE_LOOKBACK_DAYS = 3;

/**
 * After `crm_lapse_estimates`: every estimate the RPC flipped to expired in
 * the last few days gets its alert. The RPC returns only a count, so the
 * ids come from the `status_changed → expired` rows it writes; the claim in
 * notifyStaff makes a re-read a no-op. Returns how many alerts were SENT this
 * run (a claim that reached at least one recipient).
 */
export async function notifyOfficeOfLapsedEstimates(service: SupabaseClient, now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - LAPSE_LOOKBACK_DAYS * 86_400_000).toISOString();
  const { data, error } = await service.from("estimate_events")
    .select("estimate_id, payload")
    .eq("type", "status_changed").gte("created_at", since)
    .order("created_at", { ascending: false }).limit(500);
  if (error) {
    reportError(error, { where: "notifyOfficeOfLapsedEstimates.read" });
    return 0;
  }
  const ids = new Set<string>();
  for (const row of (data ?? []) as { estimate_id: string; payload: { to?: string } | null }[]) {
    if (row.payload?.to === "expired") ids.add(row.estimate_id);
  }
  let sent = 0;
  for (const id of ids) {
    const r = await notifyOfficeOfExpiry(service, id);
    if (r === "sent") sent += 1;
  }
  return sent;
}
