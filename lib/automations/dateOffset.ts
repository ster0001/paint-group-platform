import { melbourneInstant } from "@/lib/time/businessHours";

/**
 * The date-offset steps (E9 expiry, W2 deposit, W3 colours, W4 start): due
 * from 9 am Melbourne `daysBefore` days before a calendar day, for one day —
 * never later, so switching a key on does not message everyone already past
 * their moment. PURE.
 */
const DAY = 24 * 3_600_000;

export function morningBeforeDue(ymd: string | null, daysBefore: number, now: Date): boolean {
  if (!ymd) return false;
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return false;
  const day = new Date(Date.UTC(y, m - 1, d - daysBefore));
  const at = melbourneInstant(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), 9).getTime();
  const t = now.getTime();
  return t >= at && t < at + DAY;
}
