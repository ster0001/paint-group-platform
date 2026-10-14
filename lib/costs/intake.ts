/**
 * Cost capture — client-safe core: types, settings defaults, the job code,
 * and the accuracy readout.
 *
 * Brief: docs/briefs/claude-code-brief-cost-capture.md. The source of truth
 * for settings is the `cost_intake` row in `settings` (seeded by migration
 * 20261122); the constants here exist only for a fresh database and tests
 * (same rule as lib/invoicing/settings.ts — no thresholds in components).
 */

export const COST_INTAKE_KEY = "cost_intake";

export const DEFAULT_DUPLICATE_WINDOW_DAYS = 7;
export const DEFAULT_AUTO_CONFIRM_EXACT_REF = false; // ⚑A1/⚑19 — OFF
export const DEFAULT_EXPENSE_THRESHOLD_CENTS = 10000; // ⚑A5/⚑23 (6c)

export type IntakeSource = "email" | "photo" | "contractor" | "airtable" | "manual";
export type IntakeStatus = "pending" | "confirmed" | "rejected" | "duplicate";
export type ExtractStatus = "pending" | "extracted" | "failed";
export type MatchReason = "order_ref" | "address" | "vendor_memory" | "none";

/** What the reader proposed — every figure stays a proposal until confirmed. */
export type ExtractedBill = {
  supplier?: string;
  abn?: string;
  invoice_no?: string;
  invoice_date?: string; // YYYY-MM-DD
  subtotal_ex_cents?: number;
  gst_cents?: number;
  total_cents?: number;
  order_ref?: string;
  address_text?: string;
  job_hints?: string[];
  /** Per-field confidence, 0..1 — honest, never silently guessed. */
  confidence?: Record<string, number>;
  error?: string;
};

export type IntakeRow = {
  id: string;
  source: IntakeSource;
  raw_doc_path: string | null;
  from_email: string;
  subject: string;
  extracted: ExtractedBill;
  extract_status: ExtractStatus;
  proposed_vendor_id: string | null;
  proposed_wo_id: string | null;
  match_reason: MatchReason;
  status: IntakeStatus;
  duplicate_of: string | null;
  confirmed_wo_id: string | null;
  confirmed_vendor_id: string | null;
  confirmed_at: string | null;
  created_at: string;
};

export const SOURCE_LABEL: Record<IntakeSource, string> = {
  email: "bills@",
  photo: "receipt",
  contractor: "contractor",
  airtable: "airtable",
  manual: "manual",
};

/** ⚑A3/⚑21 — the order reference printed on supplier orders: PG-<job number>. */
export function jobCode(jobNo: number | null | undefined): string {
  if (typeof jobNo !== "number" || !Number.isFinite(jobNo) || jobNo <= 0) return "";
  return `PG-${String(Math.trunc(jobNo)).padStart(4, "0")}`;
}

type SettingRow = { key: string; value: unknown };

function intakeValue(rows: readonly SettingRow[] | null | undefined): Record<string, unknown> {
  const row = rows?.find((r) => r.key === COST_INTAKE_KEY);
  return row && typeof row.value === "object" && row.value !== null
    ? (row.value as Record<string, unknown>)
    : {};
}

export function duplicateWindowDays(rows: readonly SettingRow[] | null | undefined): number {
  const v = intakeValue(rows).duplicateWindowDays;
  return typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 90
    ? Math.trunc(v)
    : DEFAULT_DUPLICATE_WINDOW_DAYS;
}

export function autoConfirmExactRef(rows: readonly SettingRow[] | null | undefined): boolean {
  const v = intakeValue(rows).autoConfirmExactRef;
  return typeof v === "boolean" ? v : DEFAULT_AUTO_CONFIRM_EXACT_REF;
}

