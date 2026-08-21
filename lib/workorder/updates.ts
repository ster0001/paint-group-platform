/**
 * The daily customer update, written from the day's ticks.
 *
 * Two rules shape everything here:
 *
 * 1. THE TEXT DERIVES ONLY FROM REAL TICK EVENTS. No tick, no sentence. If a
 *    day produced nothing, this returns null and the console gets a flag —
 *    it never writes "work continued today" to fill the silence.
 *
 * 2. IT IS A DRAFT. Nothing composed here reaches a customer until a human has
 *    approved it, which is enforced in the database, not here.
 *
 * Tone is plain English rather than Australian: "we have prepped the left-hand
 * wall", not "we've knocked that over". These go to customers who are spending
 * five figures, and warmth reads better than mateyness in writing.
 */

export type TickEvent = {
  heading: string;
  label: string;
  from: string;
  to: string;
};

export type DraftInput = {
  customerFirstName: string;
  ticks: TickEvent[];
  photoCount: number;
  /** Melbourne local time of composition — passed in so this stays pure. */
  now: Date;
};

/** Morning before 12, afternoon to 6, evening after. */
export function greeting(now: Date, firstName: string): string {
  const hour = now.getHours();
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return firstName ? `${part} ${firstName}` : part;
}

/** "the walls, the windows and the entry door" */
export function listPhrase(items: string[]): string {
  const clean = items.map((i) => i.trim()).filter(Boolean);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")} and ${clean[clean.length - 1]}`;
}

/** "the front", "the left-hand side" — how a person says an elevation. */
export function areaPhrase(heading: string): string {
  const h = heading.trim().toLowerCase();
  if (h === "front") return "the front of the house";
  if (h === "back" || h === "rear") return "the back of the house";
  if (h === "left") return "the left-hand side";
  if (h === "right") return "the right-hand side";
  return heading.trim();
}

type Grouped = { heading: string; done: string[]; prepped: string[] };

/** Latest state per surface wins, so a surface ticked twice is counted once. */
export function groupTicks(ticks: TickEvent[]): Grouped[] {
  const latest = new Map<string, TickEvent>();
  for (const t of ticks) latest.set(`${t.heading}|${t.label}`, t);

  const byHeading = new Map<string, Grouped>();
  for (const t of latest.values()) {
    const g = byHeading.get(t.heading) ?? { heading: t.heading, done: [], prepped: [] };
    if (t.to === "done") g.done.push(t.label);
    else if (t.to === "prepped") g.prepped.push(t.label);
    byHeading.set(t.heading, g);
  }
  // Drop headings where the only movement was backwards (an undone mis-tap).
  return [...byHeading.values()].filter((g) => g.done.length > 0 || g.prepped.length > 0);
}

/**
 * The draft, or null when the day produced nothing worth sending.
 * Null is a signal, not a failure — the console turns it into a flag.
 */
export function composeUpdate({ customerFirstName, ticks, photoCount, now }: DraftInput): string | null {
  const groups = groupTicks(ticks);
  if (groups.length === 0) return null;

  const sentences: string[] = [];

  const finished = groups.filter((g) => g.done.length > 0);
  if (finished.length > 0) {
    const parts = finished.map((g) => {
      // A colon, not a dash: surface labels carry their own em-dashes
      // ("Walls — weatherboard"), and two in one clause reads like a stutter.
      const what = listPhrase(g.done);
      return `${areaPhrase(g.heading)}: ${what}`;
    });
    sentences.push(
      finished.length === 1
        ? `today we completed ${parts[0]}`
        : `today we completed ${listPhrase(parts)}`,
    );
  }

  const prepped = groups.filter((g) => g.prepped.length > 0);
  if (prepped.length > 0) {
    const parts = prepped.map((g) => `${areaPhrase(g.heading)} (${listPhrase(g.prepped)})`);
    sentences.push(
      `we have prepped ${listPhrase(parts)} and will be back on that tomorrow`,
    );
  }

  const body = sentences.join(", and ");
  const opening = `${greeting(now, customerFirstName)} — ${body}.`;

  return photoCount > 0
    ? `${opening} Photos attached (${photoCount}).`
    : opening;
}
