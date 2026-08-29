/**
 * How far someone got, and whether they are worth ringing (C15).
 *
 * Two jobs:
 *   · a completeness percentage the customer never sees — it exists so the
 *     office can tell "opened it and left" from "nearly finished".
 *   · the signals behind the call prompt.
 *
 * The signals are deliberately few and concrete, and NOT a weighted score.
 * A score is unfalsifiable: when it is wrong nobody can say why, so within a
 * fortnight nobody trusts the card. Three facts a person can argue with beat
 * one number they cannot.
 *
 * Time-in-tool is deliberately ABSENT. It reads as engagement and mostly is
 * not: a tab left open while making dinner outranks someone decisive.
 */

import type { WizardState } from "./state";

/** Tom, 30 Aug: "$7,500 — at a 30% gross margin that gives us approx $2,000,
 *  so it's worth it at that point." The threshold comes from what an hour of
 *  the office's time is worth, not from a number that felt about right. */
export const CALL_THRESHOLD_CENTS = 750_000;

/** How recently they left for a CALL to make sense. Past this it is an email:
 *  "are you still thinking about it?" is a different conversation from
 *  "need a hand finishing this?". */
export const CALL_WINDOW_HOURS = 72;

export type DraftSignals = {
  progressPct: number;
  /** A floorplan or condition photos. Nobody uploads their own house idly. */
  uploaded: boolean;
  /** Separate visits. Coming BACK is the strongest signal there is. */
  visits: number;
  estValueCents: number | null;
};

/**
 * The percentage.
 *
 * Counts the questions that actually exist on this person's path — an exterior
 * run is not scored against interior questions it was never asked. Otherwise a
 * finished exterior job reads as half-done forever.
 */
export function progressPct(state: Partial<WizardState>): number {
  const asked: boolean[] = [];
  const ask = (answered: boolean) => asked.push(answered);

  const jobType = state.jobType ?? "interior";
  const wantsExterior = jobType === "exterior" || jobType === "both";
  const wantsInterior = jobType === "interior" || jobType === "both";

  // Page 1, on every path.
  ask(Boolean(state.address?.suburb || state.customer?.suburb));
  ask(Boolean(state.jobType));
  ask(Boolean(state.planRunIds?.length || state.noPlan || state.listingUrl?.trim() || state.facadeRunIds?.length));
  ask(Boolean(state.contact?.email?.trim() || state.customer?.email?.trim()));

  if (wantsInterior) {
    ask((state.surfaces?.length ?? 0) > 0);
    ask(Boolean(state.basics) || (state.planRunIds?.length ?? 0) > 0);
    ask(Boolean(state.condition?.tier));
    ask(Boolean(state.details?.ceilingHeight));
    ask(Boolean(state.details?.doorStyle));
    ask((state.details?.damageTier ?? -1) >= 0);
  }

  if (wantsExterior) {
    const ext = state.exterior;
    ask(Boolean(ext));
    ask((ext?.substrates?.length ?? 0) > 0);
    ask(Boolean(ext?.storeys));
    ask(Boolean(ext?.painting && Object.values(ext.painting).some(Boolean)));
    ask(ext?.condition != null);
  }

  // Paint preferences, on every path — the last thing before the reveal.
  ask((state.paint?.brands?.length ?? 0) > 0 || state.paint?.waterBasedOnly === true);

  const answered = asked.filter(Boolean).length;
  return asked.length === 0 ? 0 : Math.round((answered / asked.length) * 100);
}

export function uploadedSomething(state: Partial<WizardState>): boolean {
  return (state.planRunIds?.length ?? 0) > 0
    || (state.facadeRunIds?.length ?? 0) > 0
    || (state.details?.damagePhotoCount ?? 0) > 0;
}

export type CallVerdict = { call: boolean; why: string[] };

/**
 * Should somebody ring them?
 *
 * Three facts, all visible on the card, because the REASON is what makes a
 * person pick up the phone. A card reading "warm: 78" gets ignored inside a
 * fortnight; "uploaded a floorplan · 9 of 11 rooms · ~$14,200 · left 40
 * minutes ago" gets acted on.
 */
export function shouldCall(
  signals: DraftSignals,
  lastSeenAt: string | Date,
  now: Date = new Date(),
  thresholdCents: number = CALL_THRESHOLD_CENTS,
): CallVerdict {
  const hours = (now.getTime() - new Date(lastSeenAt).getTime()) / 3_600_000;
  const why: string[] = [];

  const worthIt = (signals.estValueCents ?? 0) >= thresholdCents;
  const effort = signals.uploaded || signals.progressPct >= 80 || signals.visits > 1;
  const recent = hours <= CALL_WINDOW_HOURS;

  if (signals.uploaded) why.push("Uploaded a plan or photos");
  if (signals.progressPct >= 80) why.push(`${signals.progressPct}% answered`);
  if (signals.visits > 1) why.push(`Came back ${signals.visits} times`);
  if (worthIt && signals.estValueCents) why.push(`~$${Math.round(signals.estValueCents / 100).toLocaleString("en-AU")}`);

  return { call: worthIt && effort && recent, why };
}

/** "left 40 minutes ago" — the line that makes the card urgent. */
export function leftAgo(lastSeenAt: string | Date, now: Date = new Date()): string {
  const mins = Math.max(0, Math.round((now.getTime() - new Date(lastSeenAt).getTime()) / 60_000));
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
