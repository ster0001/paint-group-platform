import type { Colour, Band, Measures } from "./evaluate";

/**
 * The painter's words (brief §7, R18, R19; Step 6). Pure, shared by the
 * Home card, My status and the texts. Short sentences, common words, counts
 * not percentages. Nothing here computes a colour or a count — it only puts
 * words to what painter_status already says.
 */

export const COLOUR_NAME: Record<Colour, string> = { new: "New", green: "Green", yellow: "Yellow", orange: "Orange", red: "Red" };

/** Lamp order in the housing, top to bottom. New lights none and rings the housing blue. */
export const LAMPS: readonly Exclude<Colour, "new">[] = ["red", "orange", "yellow", "green"];

export type Measure = "checks" | "reminders" | "callbacks";

const BAND_RANK: Record<Band, number> = { yellow: 1, orange: 2, red: 3 };

/** The measure holding the painter back — the worst band; call backs, then checks, then reminders on a tie. */
export function weakestMeasure(m: Partial<Measures> | null | undefined): Measure | null {
  if (!m) return null;
  const bands: [Measure, Band | null | undefined][] = [["callbacks", m.callbacks?.band], ["checks", m.checks?.band], ["reminders", m.reminders?.band]];
  let best: { k: Measure; r: number } | null = null;
  for (const [k, b] of bands) {
    if (!b || b === "yellow" && k === "callbacks" && (m.callbacks?.scored ?? 0) === 0) continue;
    const r = BAND_RANK[b];
    if (!best || r > best.r) best = { k, r };
  }
  return best?.k ?? null;
}

/** The Home card's one line on what the colour gets them. */
export function homeSubline(colour: Colour, streak: number, greenRun: number, lead: boolean): string {
  if (colour === "green") return lead ? "Bonus eligible" : "Priority jobs · Paid in 3 business days · Bonus eligible";
  if (colour === "new") return `Clean job ${Math.min(streak, greenRun)} of ${greenRun}`;
  if (colour === "red") return lead ? "Talk with us before you lead another job" : "No new job offers until you talk with us";
  const left = greenRun - Math.min(streak, greenRun);
  return `${left} more clean ${left === 1 ? "job" : "jobs"} in a row to Green`;
}

export type Perk = { state: "on" | "off" | "warn"; text: string };

/** "What you get on <colour>" — the employed lead sees no priority or payment lines (R17). */
export function perksFor(colour: Colour, lead: boolean): Perk[] {
  const locked = " · Unlocks on Green";
  const green = [
    ...(lead ? [] : ["Priority on new jobs", "Paid within 3 business days of sign-off"]),
    "Bonus eligible",
  ];
  if (colour === "green") return green.map((text) => ({ state: "on", text }));
  const off = green.map((t) => ({ state: "off" as const, text: t + locked }));
  if (colour === "yellow" || colour === "new") {
    return [
      { state: "on", text: lead ? "Jobs go in your calendar as normal" : "Normal job offers and normal payment" },
      { state: "on", text: colour === "new" ? "A quality check on your first jobs" : "A quality check on 1 job in 3" },
      ...off,
    ];
  }
  if (colour === "orange") {
    return [
      { state: "warn", text: lead ? "A quality check on every job you lead" : "Job offers come after Green and Yellow painters" },
      ...(lead ? [] : [{ state: "warn" as const, text: "A quality check on every job" }]),
      { state: "warn", text: "Paint Group will call you to help" },
      ...off,
    ];
  }
  return [
    { state: "warn", text: lead ? "Talk with us before you lead another job" : "No new job offers until you have talked with us" },
    { state: "on", text: "Jobs you have started continue as normal" },
    ...off,
  ];
}

/** "What to do next" — three tips keyed by colour and the weakest measure. */
export function tipsFor(colour: Colour, weakest: Measure | null, lead: boolean): string[] {
  if (colour === "new") return [
    "Add your before photos on day 1, when the 7:30 am text arrives.",
    "Update the app the same day you get a reminder text.",
    "Check your own work before every walk-through. Use tape on jobs of 16 hours or more.",
  ];
  if (colour === "green") return [
    "Keep answering each reminder text the same day.",
    "An update on a day with no reminder earns a credit. A credit covers one missed reminder.",
    "One job that is not clean moves you off Green. Four clean jobs in a row win it back.",
  ];
  const byMeasure: Record<Measure, string[]> = {
    callbacks: [
      "Check glass, hardware and floors last, before the walk-through. Use tape to mark what you find.",
      "Walk every room with the customer at the end. Fix what they point at before you leave.",
    ],
    checks: [
      "Open Standards on each job and read the surface at your job's level before you start.",
      "Sand filler flat and check cut lines in daylight before you call the job done.",
    ],
    reminders: [
      "Update the app the same day you get a reminder text. A tick or a photo is enough.",
      "Add a photo at the end of each day, even on a day with no text. It earns a credit.",
    ],
  };
  const lead1 = weakest ? byMeasure[weakest] : ["Keep every reminder answered, every check passed first time, and no call backs."];
  if (colour === "red") return [
    lead ? "Talk with us before you lead another job." : "New job offers are on hold until you have talked with us.",
    "Jobs you have already started continue as normal.",
    "We will agree a plan with you to get back to Yellow, then Green.",
  ];
  if (colour === "orange") return [lead1[0], lead1[1] ?? "Update the app the same day you get a reminder text.", "Paint Group will call you this week to go through it."];
  return [lead1[0], lead1[1] ?? "Check your own work before every walk-through.", "Four clean jobs in a row and you are back on Green."];
}

/** "How the colours work" — one row per colour. */
export function colourKey(lead: boolean): { colour: Colour; rule: string; gets: string }[] {
  return [
    { colour: "green", rule: "Your last 4 jobs were all clean.", gets: lead ? "Bonus eligible." : "Priority on new jobs. Paid within 3 business days of sign-off. Bonus eligible." },
    { colour: "yellow", rule: "8 in 10 or better on checks and reminders, and no more than 1 call back in your last 10 jobs.", gets: lead ? "Jobs as normal." : "Normal job offers and normal payment." },
    { colour: "orange", rule: "Between 5 and 8 in 10 on checks or reminders, or 2 to 3 call backs.", gets: lead ? "A quality check on every job you lead. A call from Paint Group." : "Offers come after Green and Yellow. A quality check on every job. A call from Paint Group." },
    { colour: "red", rule: "Under 5 in 10 on checks or reminders, or 4 or more call backs.", gets: lead ? "Talk with us before you lead another job." : "No new job offers until you have talked with us." },
    { colour: "new", rule: "Your first 4 jobs.", gets: lead ? "Jobs as normal. A quality check on your first jobs." : "Normal job offers and normal payment. A quality check on your first jobs." },
  ];
}

/** The measure lines, plain counts. */
export function measureLines(m: Partial<Measures> | null | undefined): { key: Measure; band: Band | null; title: string; line: string }[] {
  const c = m?.checks, r = m?.reminders, cb = m?.callbacks;
  const credits = r?.creditsApplied ?? 0;
  return [
    { key: "checks", band: c?.band ?? null, title: "Quality checks", line: c && c.done > 0 ? `${c.passedFirstTime} of ${c.done} passed first time` : "No checks yet" },
    { key: "reminders", band: r?.band ?? null, title: "App updates", line: r && r.scored > 0 ? `${r.answered} of ${r.scored} reminders answered${credits ? ` · ${credits} ${credits === 1 ? "credit" : "credits"} used` : ""}` : "No reminders yet" },
    { key: "callbacks", band: cb ? (cb.scored === 0 ? null : cb.band) : null, title: "Call backs", line: !cb || cb.scored === 0 ? "None" : `${cb.scored} ${cb.scored === 1 ? "call back" : "call backs"}` },
  ];
}
