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

/**
 * §2.1 — the accuracy readout on the intake-queue header: the last 30 days of
 * decided documents, and how often the proposal survived untouched. This is
 * the evidence that rules ⚑A1 (auto-confirm) on or off — nothing self-trains.
 */
export type AccuracyReadout = {
  decided: number;
  exactRefPct: number | null; // % of decided that matched on order_ref
  unchangedPct: number | null; // % of confirmed whose proposed job was kept
  correctedPct: number | null; // % of confirmed whose job was changed
};

export function accuracyReadout(
  rows: readonly Pick<
    IntakeRow,
    "status" | "match_reason" | "proposed_wo_id" | "confirmed_wo_id" | "confirmed_at"
  >[],
  todayIso: string,
): AccuracyReadout {
  const cutoff = new Date(`${todayIso}T00:00:00Z`).getTime() - 30 * 86400_000;
  const decided = rows.filter(
    (r) => r.confirmed_at !== null && new Date(r.confirmed_at).getTime() >= cutoff,
  );
  const confirmed = decided.filter((r) => r.status === "confirmed");
  const pct = (n: number, of: number) => (of === 0 ? null : Math.round((n / of) * 100));
  const unchanged = confirmed.filter(
    (r) => r.proposed_wo_id !== null && r.proposed_wo_id === r.confirmed_wo_id,
  ).length;
  const corrected = confirmed.filter(
    (r) => r.proposed_wo_id !== null && r.confirmed_wo_id !== null && r.proposed_wo_id !== r.confirmed_wo_id,
  ).length;
  return {
    decided: decided.length,
    exactRefPct: pct(decided.filter((r) => r.match_reason === "order_ref").length, decided.length),
    unchangedPct: pct(unchanged, confirmed.length),
    correctedPct: pct(corrected, confirmed.length),
  };
}

/** The queue: pending cards plus unhandled duplicate flags, oldest first. */
export function queueRows<T extends Pick<IntakeRow, "status" | "confirmed_at" | "created_at">>(
  rows: readonly T[],
): T[] {
  return rows
    .filter(
      (r) => (r.status === "pending" || r.status === "duplicate") && r.confirmed_at === null,
    )
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}
