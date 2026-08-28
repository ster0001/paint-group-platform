/**
 * THE money formatter. One place, so a figure reads the same everywhere.
 *
 * A2-03 (audit 2026-08-28): there were **36** independent definitions of this
 * across app/ and lib/, and they disagreed. The same contract value rendered as
 * `$12,346` on the PC board and `$12,345.67` on the work order, because one
 * site used `Math.round(c / 100)` and another `minimumFractionDigits: 2`. The
 * brief's own words for that: "how a customer gets quoted one number and
 * invoiced another."
 *
 * Two of the 36 were worse than untidy — `minimumFractionDigits: 2` with **no
 * maximum**. Intl then allows a third decimal, so a cents figure could render
 * as `$1,234.567`. `money()` pins both ends.
 *
 * FORMATTING ONLY. Every figure arrives as integer cents, already computed by
 * lib/pricing or lib/invoicing. Nothing here rounds money into existence — the
 * division by 100 is the last thing that happens to a number before a person
 * reads it. If you find yourself wanting arithmetic in this file, the sum
 * belongs upstream.
 */

const AU = "en-AU";

/**
 * `$1,234.56`, and `−$1,234.56` for a negative. Both ends pinned, so never a
 * third decimal.
 *
 * The sign goes OUTSIDE the dollar sign. All 36 formatters this replaces did
 * `"$" + value.toLocaleString(…)`, which puts it inside — `$-1,234.56` — and
 * that is wrong everywhere money is written down. It shows up on credits,
 * descope variations and contractor deductions, which are exactly the figures
 * a contractor argues about.
 *
 * A real minus (U+2212), not a hyphen: at small sizes a hyphen beside a digit
 * reads as a dash.
 */
export function money(cents: number): string {
  const abs = Math.abs(cents / 100).toLocaleString(AU, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  // -0.4 cents rounds to 0.00; do not print "−$0.00".
  const negative = cents < 0 && abs !== "0.00";
  return (negative ? "−$" : "$") + abs;
}

/** `$1,235` — whole dollars, for dense screens (boards, tiles, pipelines). */
export function money0(cents: number): string {
  const abs = Math.round(Math.abs(cents) / 100).toLocaleString(AU);
  const negative = cents < 0 && abs !== "0";
  return (negative ? "−$" : "$") + abs;
}

/** `1,234.56` — no dollar sign, for a column that carries its own. */
export function amount(cents: number): string {
  return (cents / 100).toLocaleString(AU, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** `$1,234.56` with the sign stripped — where a label already says which way. */
export function moneyAbs(cents: number): string {
  return money(Math.abs(cents));
}

/**
 * ALWAYS carries a sign: `+$1,234.56` / `−$1,234.56`.
 *
 * For deltas, where "no sign" would be ambiguous — a variation column, a
 * margin movement. `money()` already marks negatives; this also marks
 * positives, which is the whole difference.
 */
export function moneySigned(cents: number): string {
  const abs = moneyAbs(cents);
  if (Math.abs(cents) < 1) return abs; // a sub-cent delta is not a direction
  return (cents < 0 ? "−" : "+") + abs;
}

/** `—` when there is genuinely no figure. Never `$0.00` for "unknown". */
export function moneyOrDash(cents: number | null | undefined, dash = "—"): string {
  return cents == null ? dash : money(cents);
}

/** Whole-dollar variant of `moneyOrDash`. */
export function money0OrDash(cents: number | null | undefined, dash = "—"): string {
  return cents == null ? dash : money0(cents);
}
