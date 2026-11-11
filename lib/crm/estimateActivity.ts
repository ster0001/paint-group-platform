import { buildTimeline, type TimelineRow } from "./timeline";

/**
 * Estimates tab session 6 (brief §4.6, R16, ruling E‑L as ruled 11 Nov 2026):
 * the estimate's Activity, read from `crm_events` — every event for the
 * estimate and its wizard session, newest first, in `buildTimeline`'s words.
 *
 * Two things the log does not hold are carried in, so nothing the old panel
 * showed is lost:
 *  · how long each open lasted — `estimate_views.dwell_ms`, matched to the
 *    open's event by its moment (the trigger stamps the event with the
 *    view's created_at);
 *  · OLDER activity — `estimate_events` rows with no event on the log (the
 *    email / text / question rows from before the CRM log, and anything an
 *    accountless estimate did before 20270312), shown in their own fold.
 */
export type ActivityGroup = "messages" | "wizard" | "staff" | "other";
export const ACTIVITY_FILTERS = ["all", "messages", "wizard", "staff"] as const;
export type ActivityFilter = (typeof ACTIVITY_FILTERS)[number];
export const ACTIVITY_FILTER_LABEL: Record<ActivityFilter, string> = { all: "All", messages: "Messages", wizard: "Wizard", staff: "Staff" };
/** Brief §4.6: the log opens on the newest ten, with "show all". */
export const ACTIVITY_COLLAPSED = 10;

export type ActivityEventRow = { id: string; type: string; payload: Record<string, unknown> | null; occurred_at: string; source: string };
export type ActivityViewRow = { created_at: string; dwell_ms: number | null };
export type LegacyEventRow = { type: string; created_at: string };
export type ActivityRow = TimelineRow & { group: ActivityGroup };
export type OlderRow = { at: string; label: string; detail: string };

const MESSAGE_TYPES = new Set(["message_in", "message_out", "customer_message_sent", "sms_reply", "email_logged", "sms_logged", "website_chat",
  "campaign_message_sent", "campaign_message_queued", "campaign_message_approved", "campaign_message_cancelled", "campaign_bounced", "campaign_unsubscribed"]);
const WIZARD_PREFIXES = ["wizard_", "gate_", "quote_", "surface_toggled", "contact_opened", "scope_viewed"];

export function activityGroup(type: string, source: string): ActivityGroup {
  if (MESSAGE_TYPES.has(type)) return "messages";
  if (WIZARD_PREFIXES.some((p) => type.startsWith(p))) return "wizard";
  if (source === "staff") return "staff";
  return "other";
}

/** "under 15 sec" / "40 sec" / "3 min 20 sec" — the old panel's own wording (15-second heartbeats). */
export function dwellText(ms: number | null): string {
  const v = ms ?? 0;
  if (v < 15_000) return "under 15 sec";
  const s = Math.round(v / 1000); const m = Math.floor(s / 60);
  return m === 0 ? `${s} sec` : `${m} min${s % 60 ? ` ${s % 60} sec` : ""}`;
}

/** The old estimate_events types, and the log type each one has (if any). */
const LEGACY: Record<string, { label: string; crm: string | null }> = {
  sent: { label: "Sent to customer", crm: "estimate_sent" },
  viewed: { label: "Viewed by customer", crm: "estimate_viewed" },
  accepted: { label: "Accepted", crm: "estimate_accepted" },
  declined: { label: "Declined", crm: "estimate_declined" },
  question: { label: "Customer message", crm: null },
  email_sent: { label: "Emailed to customer", crm: null },
  email_failed: { label: "Email failed", crm: null },
  sms_sent: { label: "Texted to customer", crm: null },
  sms_failed: { label: "Text failed", crm: null },
};
const NEAR_MS = 10 * 60_000;
const near = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) < NEAR_MS;

export function buildEstimateActivity(input: { events: readonly ActivityEventRow[]; views: readonly ActivityViewRow[]; legacy: readonly LegacyEventRow[] }): { rows: ActivityRow[]; older: OlderRow[] } {
  // One moment can arrive twice: the accountless copy (…:noacct) and the
  // account copy written when an account was attached. Keep it once.
  const seen = new Set<string>();
  const events = input.events.filter((e) => { const k = `${e.type}|${e.occurred_at}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const dwellAt = new Map(input.views.map((v) => [Date.parse(v.created_at), v.dwell_ms]));
  const rows: ActivityRow[] = buildTimeline(events).map((r) => {
    const group = activityGroup(r.type, r.source);
    if (r.type !== "estimate_viewed") return { ...r, group };
    const at = Date.parse(r.occurredAt);
    if (!dwellAt.has(at)) return { ...r, group };
    const stayed = `stayed ${dwellText(dwellAt.get(at) ?? 0)}`;
    return { ...r, group, detail: r.detail ? `${r.detail} · ${stayed}` : stayed };
  });

  const older: OlderRow[] = [];
  for (const l of input.legacy) {
    const def = LEGACY[l.type];
    if (!def) continue;
    if (l.type === "viewed" && input.views.length > 0) continue; // the per-open rows below carry it, as the old panel did
    if (def.crm && events.some((e) => e.type === def.crm && near(e.occurred_at, l.created_at))) continue;
    older.push({ at: l.created_at, label: def.label, detail: "" });
  }
  const viewedAt = new Set(events.filter((e) => e.type === "estimate_viewed").map((e) => Date.parse(e.occurred_at)));
  for (const v of input.views) {
    if (viewedAt.has(Date.parse(v.created_at))) continue;
    older.push({ at: v.created_at, label: "Opened by customer", detail: `stayed ${dwellText(v.dwell_ms)}` });
  }
  older.sort((a, b) => b.at.localeCompare(a.at));
  return { rows, older };
}

export function filterActivity(rows: readonly ActivityRow[], f: ActivityFilter): ActivityRow[] {
  return f === "all" ? [...rows] : rows.filter((r) => r.group === f);
}
