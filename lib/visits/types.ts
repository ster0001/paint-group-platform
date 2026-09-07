/**
 * Visits (CRM v2 P6) — the vocabulary. Client-safe.
 */

export const VISIT_KINDS = [
  { key: "quote", label: "Quote visit", minutes: 60 },
  { key: "remeasure", label: "Re-measure", minutes: 45 },
  { key: "colour_consult", label: "Colour consult", minutes: 60 },
  { key: "walkthrough", label: "Final walkthrough", minutes: 30 },
] as const;
export type VisitKind = (typeof VISIT_KINDS)[number]["key"];

export const VISIT_STATUSES = ["booked", "done", "no_show", "cancelled", "rebook"] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];
export const STATUS_LABEL: Record<VisitStatus, string> = {
  booked: "Booked", done: "Done", no_show: "No show", cancelled: "Cancelled", rebook: "To rebook",
};

export type VisitSource = "wizard" | "staff" | "phone" | "assistant";

export type VisitRow = {
  id: string;
  account_id: string | null;
  property_id: string | null;
  estimate_id: string | null;
  staff_id: string | null;
  starts_at: string;
  ends_at: string;
  kind: VisitKind;
  status: VisitStatus;
  source: VisitSource;
  address: string | null;
  suburb: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  note: string | null;
  outcome_note: string | null;
  outcome_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  confirmation_sent_at: string | null;
  reminder_sent_at: string | null;
};

/** `settings.visits` — the global numbers (migration 20270127 seeds them). */
export type VisitsSettings = {
  /** Business days ahead the wizard offers (V2, default 10). */
  horizonDays: number;
  /** A window closer than this is not offered to a customer (V3, default 24). */
  cutoffHours: number;
  /** The half-day windows, Melbourne wall time (V1: one zone, AM/PM). */
  windows: { am: [string, string]; pm: [string, string] };
  /** Melbourne hour the day-before reminder text goes (the evening sweep). */
  reminderHour: number;
};

export const DEFAULT_VISITS_SETTINGS: VisitsSettings = {
  horizonDays: 10,
  cutoffHours: 24,
  windows: { am: ["09:00", "12:00"], pm: ["13:00", "16:00"] },
  reminderHour: 18,
};

export function mergeVisitsSettings(raw: unknown): VisitsSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<VisitsSettings>;
  const win = (r.windows && typeof r.windows === "object" ? r.windows : {}) as Partial<VisitsSettings["windows"]>;
  const pair = (v: unknown, d: [string, string]): [string, string] =>
    Array.isArray(v) && v.length === 2 && v.every((x) => /^\d{2}:\d{2}$/.test(String(x))) ? [String(v[0]), String(v[1])] : d;
  return {
    horizonDays: Number.isFinite(r.horizonDays) ? Math.max(1, Math.min(60, Number(r.horizonDays))) : DEFAULT_VISITS_SETTINGS.horizonDays,
    cutoffHours: Number.isFinite(r.cutoffHours) ? Math.max(0, Math.min(168, Number(r.cutoffHours))) : DEFAULT_VISITS_SETTINGS.cutoffHours,
    windows: { am: pair(win.am, DEFAULT_VISITS_SETTINGS.windows.am), pm: pair(win.pm, DEFAULT_VISITS_SETTINGS.windows.pm) },
    reminderHour: Number.isFinite(r.reminderHour) ? Math.max(0, Math.min(23, Number(r.reminderHour))) : DEFAULT_VISITS_SETTINGS.reminderHour,
  };
}

/** A staff member's visit availability (staff_availability row + name). */
export type StaffAvailability = {
  staffId: string;
  name: string;
  takesVisits: boolean;
  /** 0 = Sunday … 6 = Saturday. */
  days: number[];
  dayStart: string;   // HH:MM Melbourne
  dayEnd: string;
  visitMinutes: number;
  zone: string;
};
