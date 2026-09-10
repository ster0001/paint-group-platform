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
] as const;

export type StaffEventKey = (typeof STAFF_EVENTS)[number]["key"];
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
