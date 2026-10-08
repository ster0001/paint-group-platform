/**
 * Staff alerts (Tom, 10 Sep 2026) — the client-safe half.
 *
 * "Which staff member sees each of these": the six office events below are
 * automations (lib/automations/registry.ts, audience "office") and each
 * staff login carries its own routing map, profiles.staff_notify —
 * { eventKey: ["email", "sms"] }, a sibling of staff_access. Missing key =
 * that person is not told. The server half (lib/staff/notify.ts) reads the
 * map and sends through lib/messaging/send.
 */

export const STAFF_NOTIFY_CHANNELS = ["email", "sms"] as const;
export type StaffNotifyChannel = (typeof STAFF_NOTIFY_CHANNELS)[number];

export const STAFF_EVENTS = [
  { key: "office_estimate_accepted",   label: "Contract accepted",        short: "Accepted" },
  { key: "office_job_accepted",        label: "Job accepted by painter",  short: "Job accepted" },
  { key: "office_job_declined",        label: "Job declined by painter",  short: "Job declined" },
  { key: "office_invoice_paid",        label: "Invoice paid",             short: "Invoice paid" },
  { key: "office_variation_raised",    label: "Variation raised",         short: "Variation" },
  { key: "office_contractor_invoice",  label: "Contractor invoice in",    short: "Painter invoice" },
  /** Session 3 (16 Sep 2026): walkthrough done, pack sent, no signature after N hours. */
  { key: "office_signoff_overdue",     label: "Sign-off overdue",         short: "Sign-off" },
  /** Tom, 20 Sep 2026: a customer wrote on their estimate's chat. */
  { key: "office_estimate_chat",       label: "Customer chat message",    short: "Chat" },
  /** Tom, 1 Oct 2026: a customer declines their estimate; a sent estimate lapses past its valid-until. */
  { key: "office_estimate_declined",   label: "Estimate declined",        short: "Declined" },
  { key: "office_estimate_expired",    label: "Estimate expired",         short: "Expired" },
  /** Tom, 7 Oct 2026 (PC Command): the painter declined a change the client approved; a painter's ticks drafted a customer update; a customer is due an update. */
  { key: "office_variation_declined",  label: "Painter declined a change", short: "Change declined" },
  { key: "office_update_drafted",      label: "Customer update drafted",  short: "Update ready" },
  { key: "office_update_due",          label: "Customer update due",      short: "Update due" },
  /** Painter status Step 7 (brief §9 message 9): for the owner — a bonus review is due; a painter dropped to Red. */
  { key: "office_bonus_review",        label: "Painter bonus review due", short: "Bonus review" },
  { key: "office_painter_red",         label: "Painter dropped to Red",   short: "Painter Red" },
  /**
   * Tom, 8 Oct 2026: "schedule it in Felipe's calendar … as a calendar
   * request". Whoever is ticked here gets every quality check and job
   * check-in as a calendar invite (.ics), moved and cancelled with it. A
   * calendar entry is an email thing — there is no text version.
   */
  { key: "office_qa_check_invite",     label: "Quality check calendar invite", short: "QA invite", emailOnly: true },
] as const;

export type StaffEventKey = (typeof STAFF_EVENTS)[number]["key"];

/** An event that only goes by email (a calendar invite) — the matrix offers no text box for it. */
export function emailOnlyEvent(key: StaffEventKey): boolean {
  const e = STAFF_EVENTS.find((x) => x.key === key);
  return Boolean(e && "emailOnly" in e && e.emailOnly);
}
export const STAFF_EVENT_KEYS = STAFF_EVENTS.map((e) => e.key) as StaffEventKey[];

export type StaffNotifyMap = Partial<Record<StaffEventKey, StaffNotifyChannel[]>>;

/** The column is jsonb; anything that is not { knownKey: ["email"|"sms"…] } is dropped. */
export function parseStaffNotify(value: unknown): StaffNotifyMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: StaffNotifyMap = {};
  for (const key of STAFF_EVENT_KEYS) {
    const v = (value as Record<string, unknown>)[key];
    if (!Array.isArray(v)) continue;
    const channels = [...new Set(v.filter((c): c is StaffNotifyChannel => c === "email" || c === "sms"))];
    if (channels.length) out[key] = channels;
  }
  return out;
}

export function wantsChannel(map: StaffNotifyMap, key: StaffEventKey, channel: StaffNotifyChannel): boolean {
  return (map[key] ?? []).includes(channel);
}
