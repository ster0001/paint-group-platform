/**
 * Typed money on the Payments page (Tom, 22 Oct 2026, the cost edit forms): dollars text
 * ⇄ integer cents, and the GST a typed ex-GST figure implies. The page files format and
 * parse through these; the arithmetic lives here with the other money rules.
 */
export function dollarsText(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** "1,234.50" → 123450; null when it is not a non-negative number. */
export function centsOf(text: string): number | null {
  const clean = String(text).replace(/[^0-9.\-]/g, "");
  if (clean === "") return null;
  const n = Number(clean);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

/** The GST on an ex-GST figure: 10%, rounded to the cent. */
export function gstOnExCents(exCents: number): number {
  return Math.round(exCents / 10);
}
