/**
 * The ⚑4 card surcharge — pass-through of Stripe's domestic rate, never more
 * than the cost of acceptance (RBA/ACCC), always disclosed before payment.
 *
 * Settings-driven: `invoicing.surchargePctBps` (basis points, 170 = 1.70%)
 * and `invoicing.surchargeFixedCents` (30 = 30¢). The figure is a price the
 * customer pays, so it is GST-inclusive (⚑5 — its GST component reports via
 * gstFromIncCents on the receipt). Rounding is the one ⚑14 rule.
 */

import { roundHalfUp } from "./gst";

export const DEFAULT_SURCHARGE_PCT_BPS = 170;
export const DEFAULT_SURCHARGE_FIXED_CENTS = 30;

export function surchargeCents(
  amountCents: number,
  pctBps: number = DEFAULT_SURCHARGE_PCT_BPS,
  fixedCents: number = DEFAULT_SURCHARGE_FIXED_CENTS,
): number {
  if (amountCents <= 0) return 0;
  return roundHalfUp((amountCents * pctBps) / 10_000) + fixedCents;
}

export function surchargeFromSettings(value: Record<string, unknown> | null | undefined): {
  pctBps: number;
  fixedCents: number;
} {
  const pctBps = typeof value?.surchargePctBps === "number" ? value.surchargePctBps : DEFAULT_SURCHARGE_PCT_BPS;
  const fixedCents =
    typeof value?.surchargeFixedCents === "number" ? value.surchargeFixedCents : DEFAULT_SURCHARGE_FIXED_CENTS;
  return { pctBps, fixedCents };
}
