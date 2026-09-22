/**
 * The financial year (Tom, 20 Sep 2026: "adjust our financial year for
 * sales to July–June — when I input sales goals for January, it should
 * update to Jan 2027"). Australia's FY runs 1 July → 30 June and is named by
 * the year it ENDS: 15 Sep 2026 is in FY 2026/27, `fyOf` = 2027. Pure
 * calendar arithmetic on yyyy-mm(-dd) strings — no instants, no offsets.
 */
export const FY_START_MONTH = 7;

const pad = (n: number) => String(n).padStart(2, "0");

/** The FY (its END year) a calendar day or month falls in. */
export function fyOf(day: string): number {
  const [y, m] = day.split("-").map(Number);
  return m >= FY_START_MONTH ? y + 1 : y;
}
/** "FY 2026/27" */
export function fyLabel(fyEnd: number): string {
  return `FY ${fyEnd - 1}/${String(fyEnd).slice(2)}`;
}
/** "FY 26/27" — the tile's few characters. */
export function fyShortLabel(fyEnd: number): string {
  return `FY ${String(fyEnd - 1).slice(2)}/${String(fyEnd).slice(2)}`;
}
export function fyStart(fyEnd: number): string {
  return `${fyEnd - 1}-${pad(FY_START_MONTH)}-01`;
}
export function fyEnd(fyEnd: number): string {
  return `${fyEnd}-${pad(FY_START_MONTH - 1)}-30`;
}
/** The twelve yyyy-mm of a FY, July first. */
export function fyMonths(fyEnd: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const m = FY_START_MONTH + i;
    out.push(m <= 12 ? `${fyEnd - 1}-${pad(m)}` : `${fyEnd}-${pad(m - 12)}`);
  }
  return out;
}
const monthLong = new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric", timeZone: "UTC" });
/** "January 2027" */
export function fyMonthLabel(ym: string): string {
  return monthLong.format(new Date(`${ym}-01T00:00:00Z`));
}
/** True when the range is exactly one whole financial year. */
export function isWholeFy(from: string, to: string): boolean {
  const fy = fyOf(from);
  return from === fyStart(fy) && to === fyEnd(fy);
}
