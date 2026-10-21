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

/**
 * "Hi Melissa". The name only — never "Good morning"/"Good evening" (Tom, 14
 * Oct 2026): the draft is composed at the moment of the tick but READ by the
 * customer whenever the office sends it, so a time-of-day greeting was wrong
 * as often as it was right. The email and text carry the greeting from here,
 * not their own (see sendUpdate.ts, `opensWithGreeting`).
 */
export function greeting(_now: Date, firstName: string): string {
  return firstName ? `Hi ${firstName}` : "Hi there";
}

/** True when a draft already greets the customer, so delivery must not add a second "Hello". */
export function opensWithGreeting(text: string): boolean {
  return /^\s*(hi|hello|hey|dear|good (morning|afternoon|evening))\b/i.test(text);
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
 * "Walls — weatherboard and render" → "walls (weatherboard and render)";
 * "Windows × 3" → "3 windows"; "Entry door" → "entry door". The painter's
 * tick labels are a checklist; the customer reads prose.
 */
export function plainSurface(label: string): string {
  let l = label.trim();
  let count = "";
  const m = l.match(/^(.*?)\s*[×x]\s*(\d+)\s*$/i);
  if (m) { l = m[1].trim(); count = m[2]; }
  const [head, ...rest] = l.split(/\s+[—–-]\s+/);
  const detail = rest.join(", ").trim();
  let out = head.trim();
  out = out.charAt(0).toLowerCase() + out.slice(1);
  if (count) out = `${count} ${out}`;
  if (detail) out += ` (${detail.charAt(0).toLowerCase() + detail.slice(1)})`;
  return out;
}

/** "Front of the house" — areaPhrase with a capital, for the start of a bullet. */
function areaHeading(heading: string): string {
  const a = areaPhrase(heading).replace(/^the\s+/i, "");
  return a.charAt(0).toUpperCase() + a.slice(1);
}

/** "Tuesday 14 October" in Melbourne, never the UTC date. */
export function longDateMelbourne(d: Date): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne", weekday: "long", day: "numeric", month: "long",
  }).formatToParts(d).filter((x) => x.type !== "literal").map((x) => x.value).join(" ");
}

/**
 * The draft, or null when the day produced nothing worth sending.
 * Null is a signal, not a failure — the console turns it into a flag.
 *
 * Shape (Tom, 21 Oct 2026 — "the messages still aren't clearer"): short
 * labelled sections a customer can scan, not one long sentence of colons.
 *
 *   Hi Melissa,
 *
 *   Here is today's progress (Tuesday 14 October):
 *
 *   Finished today
 *   • Front of the house: walls (weatherboard and render), 3 windows and entry door
 *
 *   Prepped and ready for paint
 *   • Left-hand side: walls (weatherboard) — we will be back on these tomorrow
 *
 *   6 new photos are on your job page.
 *
 *   Any questions, just reply to this message.
 *   The Paint Group team
 */
export function composeUpdate({ customerFirstName, ticks, photoCount, now }: DraftInput): string | null {
  const groups = groupTicks(ticks);
  if (groups.length === 0) return null;

  const blocks: string[] = [];
  blocks.push(`${greeting(now, customerFirstName)},`);
  blocks.push(`Here is today's progress (${longDateMelbourne(now)}):`);

  const finished = groups.filter((g) => g.done.length > 0);
  if (finished.length > 0) {
    blocks.push(["Finished today",
      ...finished.map((g) => `• ${areaHeading(g.heading)}: ${listPhrase(g.done.map(plainSurface))}`),
    ].join("\n"));
  }

  const prepped = groups.filter((g) => g.prepped.length > 0);
  if (prepped.length > 0) {
    blocks.push(["Prepped and ready for paint",
      ...prepped.map((g) => `• ${areaHeading(g.heading)}: ${listPhrase(g.prepped.map(plainSurface))} — we will be back on these tomorrow`),
    ].join("\n"));
  }

  if (photoCount > 0) {
    blocks.push(photoCount === 1 ? "1 new photo is on your job page." : `${photoCount} new photos are on your job page.`);
  }

  blocks.push("Any questions, just reply to this message.\nThe Paint Group team");
  return blocks.join("\n\n");
}

/**
 * The text-message form of an update: the greeting line, then the first
 * "Finished"/"Prepped" bullet(s), on one line, within one or two segments.
 * A text that starts with a sign-off or a wall of bullets reads as spam.
 */
export function smsSummary(text: string, max = 240): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean)
    .filter((l) => !/^(any questions|the paint group team)/i.test(l));
  const flat = lines.map((l) => l.replace(/^•\s*/, "")).join(" ").replace(/\s+/g, " ");
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}
