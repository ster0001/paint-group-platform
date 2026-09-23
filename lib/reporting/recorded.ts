/**
 * Recorded sales months (migration 20270186, Tom 20 Sep 2026).
 *
 * The months sold in PaintScout are typed once (Settings → Dashboard →
 * Recorded sales) and REPLACE the platform's accepted estimates for that
 * month wherever a sale is counted: Sales $, Sales (number), the target
 * card, Contracts signed, the spend-vs-sales trend. A month with no row is
 * the platform's own signed jobs, which is every month from the cutover on.
 * Pure functions over `input.sales.recorded`; the loader fills it.
 */
import { addDays, daysBetween, melbourneDay, type MetricInput, type Range } from "./core";

export type RecordedMonth = { month: string; sales_cents: number; accepted: number | null; source: string };

/** yyyy-mm → the recorded month. */
export function recordedMonths(input: MetricInput): Map<string, RecordedMonth> {
  return new Map((input.sales?.recorded ?? []).map((r) => [r.month.slice(0, 7), r]));
}

/** True when the instant falls in a Melbourne month that is recorded — the platform row for it is not counted. */
export function inRecordedMonth(recorded: Map<string, RecordedMonth>, at: string | null | undefined): boolean {
  return Boolean(at) && recorded.size > 0 && recorded.has(melbourneDay(at as string).slice(0, 7));
}

export type RecordedInRange = RecordedMonth & {
  /** The share of the month the range covers, 0–1: a whole month is 1; a custom range over part of it is pro-rated by days. */
  share: number;
  sales_in_range_cents: number;
  accepted_in_range: number | null;
  first_day: string;
};

const monthEnd = (ym: string) => { const [y, m] = ym.split("-").map(Number); return addDays(`${ym}-01`, new Date(Date.UTC(y, m, 0)).getUTCDate() - 1); };

/** The recorded months the range touches, with the part of each that falls inside it. */
export function recordedInRange(input: MetricInput, range: Range): RecordedInRange[] {
  const out: RecordedInRange[] = [];
  for (const r of recordedMonths(input).values()) {
    const ym = r.month.slice(0, 7);
    const from = `${ym}-01`; const to = monthEnd(ym);
    const a = from > range.from ? from : range.from;
    const b = to < range.to ? to : range.to;
    if (a > b) continue;
    const share = daysBetween(a, b) / daysBetween(from, to);
    out.push({
      ...r, month: ym, share, first_day: a,
      sales_in_range_cents: Math.round(r.sales_cents * share),
      accepted_in_range: r.accepted == null ? null : Math.round(r.accepted * share),
    });
  }
  return out.sort((x, y) => x.month.localeCompare(y.month));
}

const monthLong = new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric", timeZone: "UTC" });
/** "PaintScout · May 2026 (recorded)" — the one row a recorded month contributes to a list. */
export function recordedTitle(r: RecordedInRange): string {
  const src = r.source === "paintscout" ? "PaintScout" : r.source;
  return `${src} · ${monthLong.format(new Date(`${r.month}-01T00:00:00Z`))} (recorded${r.share < 1 ? `, ${Math.round(r.share * 100)}% of the month` : ""})`;
}

/** "3 months from PaintScout (recorded)" for a tile's note, or "". */
export function recordedNote(rows: readonly { recorded?: boolean }[]): string {
  const n = rows.filter((r) => r.recorded).length;
  return n ? `${n} month${n === 1 ? "" : "s"} recorded from PaintScout` : "";
}
