/**
 * The three guards that make "the assistant never computes a price" a
 * property of the code rather than a hope about the prompt:
 *
 *  1. Every `$` figure in a reply must trace to a number a tool returned in
 *     THIS turn (§2 rule 1, §10). If one does not, the reply is replaced.
 *  2. A refused tool's customer-safe reason must appear in the reply (§7
 *     refusal semantics) — appended if the model left it out.
 *  3. Budgets (§2 rule 9): exhaustion degrades to "let's get a person".
 */

const DOLLAR_RE = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g;

/** Every dollar figure mentioned in the text, as dollars. */
export function dollarMentions(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(DOLLAR_RE)) {
    const whole = Number(m[1].replace(/,/g, ""));
    const frac = m[2] ? Number(`0.${m[2]}`) : 0;
    if (Number.isFinite(whole)) out.push(whole + frac);
  }
  return out;
}

/** Every numeric leaf inside a value (tool results are plain JSON). */
export function numericLeaves(value: unknown, into: Set<number> = new Set()): Set<number> {
  if (typeof value === "number" && Number.isFinite(value)) into.add(value);
  else if (Array.isArray(value)) for (const v of value) numericLeaves(v, into);
  else if (value && typeof value === "object") for (const v of Object.values(value as Record<string, unknown>)) numericLeaves(v, into);
  return into;
}

/**
 * Dollar figures in the text that no tool result backs. A figure is backed
 * when a numeric leaf equals it (dollars) or equals it × 100 (cents), give
 * or take a dollar for the range's outward rounding to whole tens
 * (rangeFromTotal) — the reply may say "$4,100" for 410,000 cents.
 */
export function untraceableDollars(text: string, results: unknown[]): number[] {
  const leaves = numericLeaves(results);
  const backed = (d: number) => {
    for (const n of leaves) {
      if (Math.abs(n - d) <= 1) return true;
      if (Math.abs(n / 100 - d) <= 1) return true;
    }
    return false;
  };
  return dollarMentions(text).filter((d) => !backed(d));
}

/** What the customer sees when a reply tried to carry an unbacked figure. */
export const NUMBER_GUARD_TEXT =
  "I can't give you a figure for that yet — the price comes from the estimate itself once the details are in. Tell me the next thing and I'll keep building it.";

/** Make sure every refusal reason reaches the person, once each. */
export function relayRefusals(text: string, reasons: string[]): string {
  const missing = [...new Set(reasons)].filter((r) => r.trim() && !text.includes(r.trim()));
  if (missing.length === 0) return text;
  const base = text.trim();
  return (base ? `${base}\n\n` : "") + missing.map((r) => r.trim()).join(" ");
}

export type BudgetState =
  | { exhausted: false }
  | { exhausted: true; which: "conversation" | "daily"; text: string };

export const BUDGET_TEXT: Record<"conversation" | "daily", string> = {
  conversation: "We've covered a lot in this chat and I've reached my limit for it. Let's get a person to pick it up from here — I've flagged it for the office, and you can tap \"Talk to a person\" any time.",
  daily: "You've used today's assistant allowance on this account. A person can carry on with you — I've flagged it for the office, and you can tap \"Talk to a person\" any time.",
};

export function budgetState(args: { spent: number; budget: number; accountToday: number | null; dailyCap: number }): BudgetState {
  if (args.spent >= args.budget) return { exhausted: true, which: "conversation", text: BUDGET_TEXT.conversation };
  if (args.accountToday != null && args.accountToday >= args.dailyCap) return { exhausted: true, which: "daily", text: BUDGET_TEXT.daily };
  return { exhausted: false };
}
