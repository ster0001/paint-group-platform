import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * CRM v2 P4 — the numbers behind the rules, in Settings, not in code
 * (shell brief §7.1, deep dive §4.4.7). One row (`settings.crm`), merged over
 * these defaults so a key added later still has a value. Read by the facts
 * refresher (stage thresholds, repaint intervals) and the work queue
 * (overdue hours). Edited on Settings → CRM.
 */
export type CrmThresholds = {
  /** Sent, never opened: chase after this many days. */
  chaseUnopenedDays: number;
  /** Opened and gone quiet: chase after this many days. */
  chaseOpenedDays: number;
  /** Any lane: this long without movement and the card is going cold. */
  goingColdDays: number;
  /** After a visit with no reply, a second attempt is due. */
  secondAttemptDays: number;
  /** A finished job becomes a past customer this long after completion. */
  pastCustomerDays: number;
  /** A customer's message waits this long before it is overdue. */
  messageOverdueHours: number;
  /** A callback request waits this long before it is overdue. */
  callbackOverdueHours: number;
  /** After-care window after a job completes. */
  afterCareDays: number;
  /** Review-and-referral window after a job completes. */
  reviewWindowMonths: number;
  /** Repaint intervals by job type (decision 8.8: exterior 7, interior 10). */
  repaintExteriorYears: number;
  repaintInteriorYears: number;
  repaintUnknownYears: number;
};

export const DEFAULT_THRESHOLDS: CrmThresholds = {
  chaseUnopenedDays: 3,
  chaseOpenedDays: 5,
  goingColdDays: 14,
  secondAttemptDays: 7,
  pastCustomerDays: 30,
  messageOverdueHours: 4,
  callbackOverdueHours: 4,
  afterCareDays: 30,
  reviewWindowMonths: 12,
  repaintExteriorYears: 7,
  repaintInteriorYears: 10,
  repaintUnknownYears: 8,
};

export const CRM_SETTINGS_KEY = "crm";

/** Every key, with the label and the unit the Settings screen shows. */
export const THRESHOLD_FIELDS: Array<{ key: keyof CrmThresholds; label: string; unit: string; min: number; max: number; group: string }> = [
  { key: "chaseUnopenedDays", label: "Chase an unopened estimate after", unit: "days", min: 1, max: 60, group: "Chasing" },
  { key: "chaseOpenedDays", label: "Chase an opened, silent estimate after", unit: "days", min: 1, max: 60, group: "Chasing" },
  { key: "goingColdDays", label: "A card is going cold after", unit: "days", min: 3, max: 120, group: "Chasing" },
  { key: "secondAttemptDays", label: "Second attempt after a visit with no reply", unit: "days", min: 1, max: 60, group: "Chasing" },
  { key: "pastCustomerDays", label: "A finished job becomes a past customer after", unit: "days", min: 1, max: 365, group: "Chasing" },
  { key: "messageOverdueHours", label: "A customer's message is overdue after", unit: "hours", min: 1, max: 168, group: "Today" },
  { key: "callbackOverdueHours", label: "A callback request is overdue after", unit: "hours", min: 1, max: 168, group: "Today" },
  { key: "afterCareDays", label: "After-care window after a job", unit: "days", min: 7, max: 180, group: "Lifecycle" },
  { key: "reviewWindowMonths", label: "Review and referral window after a job", unit: "months", min: 1, max: 36, group: "Lifecycle" },
  { key: "repaintExteriorYears", label: "Exterior repaint due after", unit: "years", min: 1, max: 30, group: "Lifecycle" },
  { key: "repaintInteriorYears", label: "Interior repaint due after", unit: "years", min: 1, max: 30, group: "Lifecycle" },
  { key: "repaintUnknownYears", label: "Repaint due when the job type is unknown", unit: "years", min: 1, max: 30, group: "Lifecycle" },
];

export function mergeThresholds(raw: unknown): CrmThresholds {
  const out: CrmThresholds = { ...DEFAULT_THRESHOLDS };
  if (!raw || typeof raw !== "object") return out;
  for (const f of THRESHOLD_FIELDS) {
    const v = (raw as Record<string, unknown>)[f.key];
    if (typeof v === "number" && Number.isFinite(v) && v >= f.min && v <= f.max) out[f.key] = v;
  }
  return out;
}

/** Tolerant: a failed read returns the defaults, never throws. */
export async function loadCrmThresholds(db: SupabaseClient): Promise<CrmThresholds> {
  try {
    const { data } = await db.from("settings").select("value").eq("key", CRM_SETTINGS_KEY).maybeSingle();
    return mergeThresholds(data?.value);
  } catch {
    return { ...DEFAULT_THRESHOLDS };
  }
}
