/**
 * Invoicing settings — the one code-side home for their fallback values.
 *
 * The source of truth is the `invoicing` row in the `settings` table (seeded
 * by migration 20261112 with every §2 default). Tom's 24 Aug ruling: NO
 * percentage or money literals in components — the builder, the customer
 * document and the SQL (`invoice_setting_num`) all read the same value, and
 * the constants below exist only for when the settings row is absent
 * (fresh database, tests). Change a default → change it here AND reseed the
 * settings row, never in a component.
 */

export const DEFAULT_DEPOSIT_PCT = 10; // ⚑1 — mirrors settings.invoicing.depositPct
export const DEFAULT_GST_RATE_PCT = 10;
export const DEFAULT_PAYMENT_TERMS_DAYS = 7; // ⚑3

type SettingRow = { key: string; value: unknown };

function invoicingValue(rows: readonly SettingRow[] | null | undefined): Record<string, unknown> {
  const row = rows?.find((r) => r.key === "invoicing");
  return row && typeof row.value === "object" && row.value !== null
    ? (row.value as Record<string, unknown>)
    : {};
}

/** The default deposit % for a NEW estimate (an estimate's own saved value
 *  always wins — the accepted document is never silently re-priced). */
export function depositPctFromSettings(rows: readonly SettingRow[] | null | undefined): number {
  const v = invoicingValue(rows).depositPct;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100
    ? v
    : DEFAULT_DEPOSIT_PCT;
}

// ---- Payments merge (brief §7 flags) — Settings values with the stated defaults ----
/** ⚑P5 the deposit buttons. Tom, 12 Oct: 50% is standard and adjustable. */
export const DEFAULT_DEPOSIT_OPTIONS_PCT: readonly number[] = [10, 20, 30, 50];
/** ⚑P2 the one-press Undo window; the receipt email goes when it closes (Tom, 13 Oct). */
export const DEFAULT_UNDO_SECONDS = 8;
/** ⚑P4 "Send notification of payment" starts on. */
export const DEFAULT_NOTIFY_PAYMENT = true;

export type PaymentsSettings = {
  depositOptionsPct: number[];
  undoSeconds: number;
  notifyPaymentDefault: boolean;
  paymentTermsDays: number;
};

/** The Payments page's settings, from the `invoicing` row, each with its fallback. */
export function paymentsSettings(rows: readonly SettingRow[] | null | undefined): PaymentsSettings {
  const v = invoicingValue(rows);
  const opts = Array.isArray(v.depositOptionsPct)
    ? v.depositOptionsPct.filter((n): n is number => typeof n === "number" && n > 0 && n <= 100)
    : [];
  const undo = typeof v.undoSeconds === "number" && v.undoSeconds >= 3 && v.undoSeconds <= 60 ? v.undoSeconds : DEFAULT_UNDO_SECONDS;
  const terms = typeof v.paymentTermsDays === "number" && v.paymentTermsDays >= 0 ? v.paymentTermsDays : DEFAULT_PAYMENT_TERMS_DAYS;
  return {
    depositOptionsPct: opts.length ? opts : [...DEFAULT_DEPOSIT_OPTIONS_PCT],
    undoSeconds: undo,
    notifyPaymentDefault: typeof v.notifyPaymentDefault === "boolean" ? v.notifyPaymentDefault : DEFAULT_NOTIFY_PAYMENT,
    paymentTermsDays: terms,
  };
}
