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
