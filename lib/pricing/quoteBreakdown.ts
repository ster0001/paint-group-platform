import { splitGst } from "./gst";

/**
 * Go-live brief H1 (18 Nov 2026) — THE QUOTE ADDS UP.
 *
 * The customer's quote document shows one line per room plus the dollars that
 * are not in any room — set-up and preparation (the sundries and the prep
 * hours), cleaning, specialist work, a job-size allowance, a discount — and a
 * Subtotal, GST and total. Before this the room lines were the engine's
 * ex-GST room prices worn as if they were inc-GST ranges, and the prep and
 * cleaning dollars had no line at all, so the lines never added to the
 * Subtotal.
 *
 * This is the one place those lines are split: every part of the engine's
 * subtotal gets its share of the customer's range (low and high), in WHOLE
 * DOLLARS, by the largest-remainder method, so that
 *
 *     sum of the lines  =  Subtotal (ex GST)          to the dollar
 *     Subtotal + GST    =  the range the customer sees  to the dollar
 *
 * Nothing outside `lib/pricing` does arithmetic on money (CLAUDE.md); the
 * quote model (`lib/quote/quote.ts`) only formats what comes out of here.
 */
export type BreakdownPart = {
  /** `room:<areaId>` for a room or side; `prep`, `cleaning`, `specialist`, `size`, `discount` for the rest. */
  key: string;
  /** The engine's ex-GST cents for this part — negative only for a discount. */
  cents: number;
};
export type BreakdownLine = { key: string; loCents: number; hiCents: number };
export type QuoteBreakdown = {
  lines: BreakdownLine[];
  subtotalLoCents: number; subtotalHiCents: number;
  gstLoCents: number; gstHiCents: number;
  totalLoCents: number; totalHiCents: number;
};

const dollars = (cents: number) => Math.round(cents / 100);

/** Whole dollars shared by weight, largest remainder; the sum is exactly `total`. */
export function shareDollars(total: number, weights: readonly number[]): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const raw = weights.map((w) => (total * w) / sum);
  const base = raw.map((r) => Math.trunc(r));
  let left = total - base.reduce((a, b) => a + b, 0);
  // The parts whose fraction was cut the most take the leftover dollars, one each, in the direction of their own sign.
  const order = raw.map((r, i) => ({ i, frac: Math.abs(r - base[i]), sign: Math.sign(r) || 1 })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; left !== 0 && k < order.length; k++) {
    const step = Math.sign(left);
    base[order[k].i] += step;
    left -= step;
  }
  // A leftover the fractions could not absorb (all weights whole) lands on the largest part.
  if (left !== 0) base[order[0].i] += left;
  return base;
}

/**
 * The lines, for the range the customer sees (inc GST, low and high). The GST
 * rows are the range's own split (`splitGst`); the Subtotal is what is left;
 * the lines share the Subtotal by their engine weights.
 */
export function quoteBreakdown(parts: readonly BreakdownPart[], rangeLoCents: number, rangeHiCents: number, gstRate = 0.1): QuoteBreakdown {
  const totalLo = dollars(rangeLoCents), totalHi = dollars(rangeHiCents);
  const gstLo = dollars(splitGst(rangeLoCents, gstRate).gstCents), gstHi = dollars(splitGst(rangeHiCents, gstRate).gstCents);
  const subLo = totalLo - gstLo, subHi = totalHi - gstHi;
  const weights = parts.map((p) => p.cents);
  const lo = shareDollars(subLo, weights), hi = shareDollars(subHi, weights);
  return {
    lines: parts.map((p, i) => ({ key: p.key, loCents: lo[i] * 100, hiCents: hi[i] * 100 })),
    subtotalLoCents: subLo * 100, subtotalHiCents: subHi * 100,
    gstLoCents: gstLo * 100, gstHiCents: gstHi * 100,
    totalLoCents: totalLo * 100, totalHiCents: totalHi * 100,
  };
}
