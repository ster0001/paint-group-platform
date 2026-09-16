/**
 * The money vocabulary the employee contract forbids (brief §3.3).
 *
 * "Every *_cents field, every margin, every rate, every offer amount … are
 * ABSENT from an employee payload — not zeroed, not nulled, absent." The
 * golden adversarial test walks every employee payload and asserts no key
 * matches this pattern anywhere in the JSON tree. The same pattern guards
 * the zod contract (employeeView.ts) at unit-test time, so a session cannot
 * add a money key to an employee shape without the suite going red.
 *
 * Shared by Server Components, Client Components, vitest and Playwright —
 * plain TypeScript, no imports.
 */

/** A key is money-shaped if it contains any of these, in any case. */
// `rate` only as its own word or segment (rate, hourly_rate, hourlyRate) —
// not inside accurate / separate / moderate / generated.
export const MONEY_KEY_RE =
  /[Cc]ents|[Pp]ric(?:e|ing)|\b[Rr]ates?\b|_rates?\b|[a-z]Rates?\b|[Hh]ourly|[Mm]argin|[Aa]mount|[Oo]ffer|[Ii]nvoice|[Pp]ayment|[Gg]st\b|GST|[Rr]cti|RCTI|[Pp]ayable|[Rr]emittance/;

/**
 * The exact column and prop names this codebase gives money on the painter
 * side (session-0 §4). Listed so a reviewer can see the concrete leaks the
 * regex is standing in for; the regex is what the tests use.
 */
export const KNOWN_MONEY_KEYS = [
  "payment_cents", "contractor_payment_cents", "contractorPaymentCents", "paymentCents",
  "contractor_delta_cents", "contractorDeltaCents", "deduction_cents", "deductionCents",
  "total_inc_cents", "totalIncCents", "offer_cents", "variation_delta_cents", "subtotal_ex_cents",
  "gst_cents", "previously_invoiced_cents", "amount_cents", "est_cents", "cap_cents",
  "adjustedCents", "invoicedCents", "thresholdCents", "price_cents", "priced_lines",
  "marginCents", "margin_cents", "subtotalCents", "subtotal_cents", "marginPct", "total_cents",
] as const;

/**
 * Every key path in `value` whose LAST segment is money-shaped. Walks arrays
 * and nested objects; a value that is not an object contributes nothing.
 * Returns dotted paths so a failing assertion names the leak.
 */
export function findMoneyKeys(value: unknown, path = ""): string[] {
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => findMoneyKeys(v, `${path}[${i}]`));
  }
  const out: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const here = path ? `${path}.${k}` : k;
    if (MONEY_KEY_RE.test(k)) out.push(here);
    out.push(...findMoneyKeys(v, here));
  }
  return out;
}

/** True when nothing in the tree is money-shaped. */
export function isMoneyFree(value: unknown): boolean {
  return findMoneyKeys(value).length === 0;
}
