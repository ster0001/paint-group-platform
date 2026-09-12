/**
 * C11 (v2.4, prototype `.foothuman`) — ONE human line per screen, from ONE
 * evaluator. Tom's ruling (10 Sep): the person is in the screen, not under
 * it; the old footer nagged ("that question still needs an answer"), counted
 * ("2 of 12 confirmed") and buried the human. Now: one line that changes
 * with what is happening, and Book a visit beside it.
 *
 * Five states, in priority order — the first that applies wins:
 *   all done      · everything confirmed → "One visit, one fixed price."
 *   condition work· the whole-house band says work → "Rather <name> measured it?"
 *   not-sures ≥ 2 · two or more open answers → "Not sure? Leave it — <name> checks it."
 *   partly done   · started, not finished → "<name> can walk it with you."
 *   default       · nothing confirmed yet → "Stop whenever you like."
 *
 * Pure. The name is the assigned estimator's first name when there is one;
 * without a record the line says "we", never an invented person.
 */
export type HumanLineInput = {
  /** First name of the assigned estimator, or null. */
  estimator: string | null | undefined;
  /** Open answers a person would otherwise settle on site. */
  notSures: number;
  /** The whole-house condition band. */
  condition: "good" | "wear" | "work";
  /** Loop items confirmed of total (rooms + checks). */
  done: number;
  total: number;
  /** An outside job always ends with a person. */
  exterior?: boolean;
};

export type HumanLineState = "all_done" | "condition_work" | "not_sures" | "partly_done" | "default";

export type HumanLine = { state: HumanLineState; line: string; action: "Book a visit" };

export function humanLine(i: HumanLineInput): HumanLine {
  const who = (i.estimator ?? "").trim().split(/\s+/)[0] || "";
  const name = who || "we";
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const verbs = who ? { checks: "checks", can: "can", measured: "measured" } : { checks: "check", can: "can", measured: "measured" };
  if (i.exterior && i.total > 0 && i.done >= i.total) {
    return { state: "all_done", line: "Outside always ends with a person. One visit, one fixed price.", action: "Book a visit" };
  }
  if (i.total > 0 && i.done >= i.total) {
    return { state: "all_done", line: "One visit, one fixed price.", action: "Book a visit" };
  }
  if (i.condition === "work") {
    return { state: "condition_work", line: who ? `Rather ${who} measured it?` : "Rather we measured it?", action: "Book a visit" };
  }
  if (i.notSures >= 2) {
    return { state: "not_sures", line: `Not sure? Leave it — ${cap(name)} ${verbs.checks} it.`, action: "Book a visit" };
  }
  if (i.done > 0) {
    return { state: "partly_done", line: `${cap(name)} ${verbs.can} walk it with you.`, action: "Book a visit" };
  }
  return { state: "default", line: "Stop whenever you like — a person picks up the rest with you.", action: "Book a visit" };
}

/** The customer-facing tier word over the one ladder — never re-derived from a band number. */
export const TIER_WORD: Record<"guide" | "detailed" | "confirmed", string> = { guide: "Guide", detailed: "Detailed", confirmed: "Confirmed" };
