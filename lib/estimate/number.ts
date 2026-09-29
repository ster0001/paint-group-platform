/**
 * Tom, 29 Sep 2026: estimate numbers are plain numbers, shown as four digits
 * (0042). The number itself is `estimates.number`, set by trigger on insert
 * (migration 20270204); this is only how it reads. A fifth digit appears on
 * its own past 9999 — nothing is ever truncated.
 */
export function formatEstimateNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "";
  return String(Math.trunc(n)).padStart(4, "0");
}

/** "0042" → 42; anything that is not a run of digits → null. */
export function parseEstimateNumber(raw: string): number | null {
  const m = raw.trim().replace(/^#/, "").match(/^0*(\d{1,9})$/);
  return m ? Number(m[1]) : null;
}
