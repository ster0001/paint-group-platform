/**
 * Session 3 — Activity: one timeline for every staff login, role-scoped.
 *
 * The CRM's `crm_events` is already the unified log — estimate views, sends
 * and acceptances, messages in and out, visits, jobs, invoices, wizard
 * sessions — with its own labels in `lib/crm/timeline.ts`. This reads that
 * one table and reuses those labels; it never builds a second timeline from
 * the five source tables. PC sees job events, sales sees estimate and
 * message events, finance money and message events, owner and admin all.
 */
import { buildTimeline } from "@/lib/crm/timeline";
import { inRange, melbourneDay, type ActivityEvent, type MetricDef, type MetricInput, type Range } from "../core";
import type { DashboardRole } from "../roles";

export const FAMILIES = ["estimates", "messages", "jobs", "money", "wizard", "visits", "other"] as const;
export type Family = (typeof FAMILIES)[number];
export const FAMILY_LABEL: Record<Family, string> = { estimates: "Estimates", messages: "Messages", jobs: "Jobs", money: "Money", wizard: "Wizard", visits: "Visits", other: "Other" };

export function familyOf(type: string): Family {
  if (/^estimate_|^confirmation_|^price_fixed|^desk_check/.test(type)) return "estimates";
  if (/^message_|^sms_|^call_|^email_|^website_chat|^callback|^note_added/.test(type)) return "messages";
  if (/^job_|^wo_|^offer_|^booking_|^signoff|^variation|^walkthrough|^qa_/.test(type)) return "jobs";
  if (/^invoice_|^payment_|^deposit_|^remittance/.test(type)) return "money";
  if (/^wizard_|^web_event|^cta_/.test(type)) return "wizard";
  if (/^visit_/.test(type)) return "visits";
  return "other";
}

/** Which families a role's feed carries (brief Part C, Activity). Owner and admin: all. */
export const FAMILIES_FOR_ROLE: Record<DashboardRole, ReadonlyArray<Family>> = {
  owner: FAMILIES, admin: FAMILIES,
  pc: ["jobs", "visits", "messages"],
  sales: ["estimates", "messages", "wizard", "visits"],
  finance: ["money", "messages"],
};

export function familiesFor(roles: ReadonlyArray<DashboardRole>): Family[] {
  const set = new Set<Family>();
  for (const r of roles) for (const f of FAMILIES_FOR_ROLE[r] ?? []) set.add(f);
  return FAMILIES.filter((f) => set.has(f));
}

export type ActivityRow = { at: string; day: string; who: string; family: string; label: string; detail: string; source: string; type: string };

export function activityRows(input: MetricInput, range: Range): ActivityRow[] {
  const a = input.activity; if (!a) return [];
  const allowed = new Set(familiesFor(a.roles));
  const wanted = a.family && (FAMILIES as readonly string[]).includes(a.family) ? (a.family as Family) : null;
  const q = a.q?.trim().toLowerCase() ?? "";
  const events = a.events.filter((e) => inRange(e.occurred_at, range));
  const rows = buildTimeline(events.map((e) => ({ id: e.id, type: e.type, payload: e.payload, occurred_at: e.occurred_at, source: e.source })));
  const byId = new Map(events.map((e) => [e.id, e]));
  return rows
    .map((r) => {
      const e = byId.get(r.id)!;
      const family = familyOf(r.type);
      return { at: r.occurredAt, day: melbourneDay(r.occurredAt), who: e.account_name ?? "", family, label: r.label, detail: r.detail, source: r.source, type: r.type };
    })
    .filter((r) => allowed.has(r.family as Family))
    .filter((r) => !wanted || r.family === wanted)
    .filter((r) => !q || `${r.who} ${r.label} ${r.detail}`.toLowerCase().includes(q));
}

export const activity: MetricDef<ActivityRow> = {
  key: "activity.events",
  kind: "period",
  section: "activity",
  title: "Activity",
  definition: "Every event on the CRM timeline (crm_events) on a day in the range — estimate sends, views and acceptances, messages in and out, visits, job and invoice events, wizard sessions — with the same wording the customer record uses. Scoped to your roles: PC sees jobs, visits and messages; sales sees estimates, wizard, visits and messages; finance sees money and messages; owner and admin see everything. Filters narrow the rows; the export is the filtered rows.",
  unit: "count",
  gst: null,
  roles: ["owner", "admin", "pc", "sales", "finance"],
  aggregate: "count",
  columns: [{ key: "at", label: "When" }, { key: "who", label: "Customer" }, { key: "family", label: "Family" }, { key: "label", label: "What" }, { key: "detail", label: "Detail" }, { key: "source", label: "Source" }, { key: "type", label: "Event type" }],
  href: "/crm",
  display: "rows",
  select: activityRows,
  note: (rows, _v, input) => { const today = melbourneDay(input.now); return rows.length ? `${rows.filter((r) => r.day === today).length} today · ${rows.length}${input.activity?.truncated ? "+ (the newest 5,000 read)" : ""} in range` : "nothing in this range"; },
};

export type { ActivityEvent };
