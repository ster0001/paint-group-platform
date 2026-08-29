/**
 * The board (session 2.3) — crm-board-mockup.html's lanes, counts and tiles.
 *
 * Pure assembly over `stageFor`: give it every customer's facts and it hands
 * back the seven lanes, the header line and the four tiles. The page does the
 * reading; this file does the deciding, so both are testable and neither is
 * a query buried in a component.
 */

import { LANES, needsYouToday, OPEN_LANES, stageFor, type AccountFacts, type LaneKey, type StageResult } from "./stage";

export type BoardInput = {
  accountId: string;
  name: string;
  /** "Northcote · Interior, 2 rooms" — whatever the record can say. */
  meta: string;
  /** The open estimate's value, or the job's. */
  valueCents: number | null;
  /** First-touch source, when one has been recorded. */
  source: string | null;
  /** The most recent note, for the card's quoted line. */
  note: string | null;
  facts: AccountFacts;
};

export type BoardCard = {
  accountId: string;
  name: string;
  meta: string;
  valueCents: number | null;
  source: string | null;
  note: string | null;
  because: string;
  temperature: string | null;
  stage: StageResult["stage"];
  flags: StageResult["flags"];
  needsYou: boolean;
  /** The chips the mockup puts under a card, already worded. */
  chips: string[];
};

export type Board = {
  lanes: Array<{ key: LaneKey; label: string; cards: BoardCard[] }>;
  /** "34 open, 11 need you today". */
  open: number;
  needsYou: number;
  tiles: {
    overdueFollowups: number;
    goingCold: number;
    openValueCents: number;
    /** Null when there is nothing decided in the window — a win rate computed
     *  from two jobs is a lie with a percent sign on it. */
    winRatePct: number | null;
    winRateOf: number;
  };
};

/** The mockup's warning chips, in the order it shows them. */
function chipsFor(r: StageResult, snoozedUntil: string | null, now: Date): string[] {
  const out: string[] = [];
  if (r.flags.followupOverdue) out.push("Follow-up overdue");
  if (r.flags.chaseDue) out.push("Chase due");
  if (r.flags.secondAttemptDue) out.push("Second attempt due");
  if (r.flags.goingCold && !r.flags.chaseDue) out.push("Going cold");
  if (r.flags.snoozed && snoozedUntil) {
    out.push(`Snoozed to ${new Date(snoozedUntil).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}`);
  } else if (snoozedUntil && new Date(snoozedUntil) <= now) {
    // The mockup's "Snoozed until yesterday": the snooze ran out and the card
    // came back, which is exactly when someone needs to see it.
    out.push("Snooze ran out");
  }
  return out;
}

export function buildBoard(input: BoardInput[], now: Date = new Date()): Board {
  const cards: BoardCard[] = input.map((i) => {
    const r = stageFor(i.facts, now);
    return {
      accountId: i.accountId,
      name: i.name,
      meta: i.meta,
      valueCents: i.valueCents,
      source: i.source,
      note: i.note,
      because: r.because,
      temperature: i.facts.temperature,
      stage: r.stage,
      flags: r.flags,
      needsYou: needsYouToday(r),
      chips: chipsFor(r, i.facts.snoozedUntil, now),
    };
  });

  const lanes = LANES.map((l) => ({
    key: l.key,
    label: l.label,
    // Inside a lane: whoever needs you first, then the biggest job. A board
    // sorted by date buries the $46k body corporate under six drop-outs.
    cards: cards.filter((c) => c.stage === l.key).sort((a, b) => {
      if (a.needsYou !== b.needsYou) return a.needsYou ? -1 : 1;
      return (b.valueCents ?? 0) - (a.valueCents ?? 0);
    }),
  }));

  const openCards = cards.filter((c) => OPEN_LANES.includes(c.stage as LaneKey));

  // Win rate over the last 90 days, from what was actually decided in it.
  const since = new Date(now.getTime() - 90 * 86_400_000).toISOString();
  let won = 0, lost = 0;
  for (const i of input) {
    for (const e of i.facts.estimates) {
      if (e.accepted_at && e.accepted_at >= since) won++;
      else if (e.declined_at && e.declined_at >= since) lost++;
    }
  }
  const decided = won + lost;

  return {
    lanes,
    open: openCards.length,
    needsYou: openCards.filter((c) => c.needsYou).length,
    tiles: {
      overdueFollowups: openCards.filter((c) => c.flags.followupOverdue && !c.flags.snoozed).length,
      goingCold: openCards.filter((c) => c.flags.goingCold && !c.flags.snoozed).length,
      openValueCents: openCards.reduce((sum, c) => sum + (c.valueCents ?? 0), 0),
      winRatePct: decided === 0 ? null : Math.round((won / decided) * 100),
      winRateOf: decided,
    },
  };
}
