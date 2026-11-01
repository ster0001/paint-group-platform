/**
 * GST on a GST-inclusive figure — the ONE place a customer-facing total is
 * split into its ex-GST part and the tax (quote stage v10 §5: the quote
 * document's Subtotal and GST rows). Cents in, cents out, rounded to the
 * cent; the rate is the Settings "GST" row the engine itself reads
 * (`resolveRates`), 10% when absent.
 */
export function splitGst(incCents: number, rate = 0.1): { exCents: number; gstCents: number } {
  const ex = Math.round(incCents / (1 + rate));
  return { exCents: ex, gstCents: incCents - ex };
}

/** The GST rate from the settings rows, as the engine reads it (a number, or `{ value }`). */
export function gstRateFromSettings(settings: ReadonlyArray<{ key: string; value: unknown }>): number {
  const row = settings.find((s) => s.key.trim().toLowerCase() === "gst");
  const raw = row?.value as { value?: number } | number | null | undefined;
  const v = raw == null ? undefined : typeof raw === "number" ? raw : raw.value;
  return typeof v === "number" && v >= 0 && v < 1 ? v : 0.1;
}
