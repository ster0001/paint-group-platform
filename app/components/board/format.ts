/**
 * Day formatting the board draws with. Calendar-date arithmetic lives in
 * lib/scheduling/dates.ts — see the note there about the timezone bug these
 * helpers exist to prevent: every date is rendered with timeZone UTC so the
 * machine's zone can never move it.
 */

/** Contiguous month runs across the visible days, for the month band. */
export function monthRuns(days: string[]) {
  const out: { label: string; span: number }[] = [];
  for (const d of days) {
    const label = new Date(d + "T00:00:00Z").toLocaleDateString("en-AU", { month: "long", year: "numeric", timeZone: "UTC" });
    const last = out[out.length - 1];
    if (last && last.label === label) last.span += 1;
    else out.push({ label, span: 1 });
  }
  return out;
}

/** "Thu 24 Sep" — the day as a person says it, for the drag pop-up (Tom, 24 Sep). */
export const dayLabel = (s: string) => {
  const d = new Date(s + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
};

/** Render a date cell without letting the timezone move it. */
export const dayParts = (s: string) => {
  const d = new Date(s + "T00:00:00Z");
  return {
    num: d.getUTCDate(),
    dow: d.getUTCDay(),
    short: d.toLocaleDateString("en-AU", { weekday: "short", timeZone: "UTC" }).toUpperCase(),
  };
};

export const isWeekend = (dow: number) => dow === 0 || dow === 6;
