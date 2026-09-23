/**
 * Session 3 — the target card (owner/admin: targets are money, ⚑2).
 *
 * "$118,400 of $190,000 · 62% hit · 63% of month gone · on pace". Sales $ is
 * the same figure as the Sales $ tile (accepted totals inc GST on the
 * acceptance date); the target is the Settings → Dashboard row for the
 * month; pace is the share of the month's days that have passed. A month
 * with no target says "no target set", never 0% (acceptance 7). Twelve
 * months of history and targets feed the chart, one bar per month.
 */
import { inRange, melbourneDay, type MetricInput, type Range } from "../core";
import { fyLabel, fyMonths, fyOf } from "../financialYear";
import { recordedMonths } from "../recorded";

export type TargetMonth = {
  month: string; label: string; sales_cents: number; target_cents: number | null; accepted: number;
  /** True for a month recorded from PaintScout (20270186) — the bar is the recorded figure. */
  recorded?: boolean;
  /** True for a month of the financial year still ahead: a target bar only, no actual. */
  future?: boolean;
};
export type TargetCardData = {
  /** The month the range ends in, yyyy-mm. */
  month: string;
  label: string;
  sales_cents: number;
  target_cents: number | null;
  pct_hit: number | null;
  pct_month_gone: number;
  pace: "ahead" | "on pace" | "behind" | null;
  /** The financial year the month is in (July → June), one bar per month. */
  fy: number;
  fy_label: string;
  /** The FY so far: sales through this month, and the sum of the targets set for those months. */
  fy_sales_cents: number;
  fy_target_cents: number | null;
  fy_months_with_target: number;
  months: TargetMonth[];
};

const monthLabel = (ym: string) => new Intl.DateTimeFormat("en-AU", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${ym}-01T00:00:00Z`));

/**
 * The target card: this month against its Settings target, and the FINANCIAL
 * YEAR the month sits in (Tom, 20 Sep 2026: sales run July → June), one bar
 * per month — recorded months from PaintScout, the platform's own acceptances
 * from the cutover on, targets only for the months still ahead.
 */
export function buildTarget(input: MetricInput, range: Range): TargetCardData {
  const month = range.to.slice(0, 7);
  const recorded = recordedMonths(input);
  const monthRange: Range = { from: `${month}-01`, to: range.to };
  const platformAccepted = input.estimates.filter((e) => e.status === "accepted" && inRange(e.accepted_at, monthRange));
  const rec = recorded.get(month);
  const sales = rec ? rec.sales_cents : platformAccepted.reduce((s, e) => s + (e.accepted_total_cents ?? e.total_cents), 0);
  const acceptedCount = rec ? rec.accepted ?? 0 : platformAccepted.length;
  const targetRow = (input.sales?.targets ?? []).find((t) => t.month.slice(0, 7) === month);
  const target = targetRow ? targetRow.target_cents : null;
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = melbourneDay(input.now);
  // A past month: the days the range covers of it, not the whole month (20 Sep audit — a 1–15 Aug range is half a month, not "behind").
  const dayOfMonth = today.slice(0, 7) === month ? Number(today.slice(8, 10)) : today > `${month}-31` ? Number(range.to.slice(8, 10)) : 0;
  const pctGone = Math.round((dayOfMonth / daysInMonth) * 100);
  const pctHit = target && target > 0 ? Math.round((sales / target) * 100) : null;
  const pace = pctHit == null ? null : pctHit >= pctGone + 5 ? "ahead" : pctHit + 5 < pctGone ? "behind" : "on pace";

  const hist = new Map((input.sales?.history ?? []).map((h) => [h.month, h]));
  const targets = new Map((input.sales?.targets ?? []).map((t) => [t.month.slice(0, 7), t.target_cents]));
  const fy = fyOf(month);
  const months: TargetMonth[] = fyMonths(fy).map((ym) => {
    const r = recorded.get(ym);
    const h = hist.get(ym);
    const future = ym > month;
    const salesCents = future ? 0 : ym === month ? sales : r ? r.sales_cents : h?.sales_cents ?? 0;
    const accepted = future ? 0 : ym === month ? acceptedCount : r ? r.accepted ?? 0 : h?.accepted ?? 0;
    return { month: ym, label: monthLabel(ym), sales_cents: salesCents, target_cents: targets.get(ym) ?? null, accepted, recorded: Boolean(r), future };
  });
  const soFar = months.filter((x) => !x.future);
  const withTarget = soFar.filter((x) => x.target_cents != null);
  return {
    month, label: new Intl.DateTimeFormat("en-AU", { month: "long", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`)),
    sales_cents: sales, target_cents: target, pct_hit: pctHit, pct_month_gone: pctGone, pace,
    fy, fy_label: fyLabel(fy),
    fy_sales_cents: soFar.reduce((s, x) => s + x.sales_cents, 0),
    fy_target_cents: withTarget.length ? withTarget.reduce((s, x) => s + (x.target_cents ?? 0), 0) : null,
    fy_months_with_target: withTarget.length,
    months,
  };
}
