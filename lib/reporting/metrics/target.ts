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

export type TargetMonth = { month: string; label: string; sales_cents: number; target_cents: number | null; accepted: number };
export type TargetCardData = {
  /** The month the range ends in, yyyy-mm. */
  month: string;
  label: string;
  sales_cents: number;
  target_cents: number | null;
  pct_hit: number | null;
  pct_month_gone: number;
  pace: "ahead" | "on pace" | "behind" | null;
  months: TargetMonth[];
};

const monthLabel = (ym: string) => new Intl.DateTimeFormat("en-AU", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${ym}-01T00:00:00Z`));

export function buildTarget(input: MetricInput, range: Range): TargetCardData {
  const month = range.to.slice(0, 7);
  const monthRange: Range = { from: `${month}-01`, to: range.to };
  const accepted = input.estimates.filter((e) => e.status === "accepted" && inRange(e.accepted_at, monthRange));
  const sales = accepted.reduce((s, e) => s + (e.accepted_total_cents ?? e.total_cents), 0);
  const targetRow = (input.sales?.targets ?? []).find((t) => t.month.slice(0, 7) === month);
  const target = targetRow ? targetRow.target_cents : null;
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = melbourneDay(input.now);
  const dayOfMonth = today.slice(0, 7) === month ? Number(today.slice(8, 10)) : today > `${month}-31` ? daysInMonth : 0;
  const pctGone = Math.round((dayOfMonth / daysInMonth) * 100);
  const pctHit = target && target > 0 ? Math.round((sales / target) * 100) : null;
  const pace = pctHit == null ? null : pctHit >= pctGone + 5 ? "ahead" : pctHit + 5 < pctGone ? "behind" : "on pace";

  const hist = new Map((input.sales?.history ?? []).map((h) => [h.month, h]));
  const targets = new Map((input.sales?.targets ?? []).map((t) => [t.month.slice(0, 7), t.target_cents]));
  const months: TargetMonth[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const ym = d.toISOString().slice(0, 7);
    const h = hist.get(ym);
    months.push({ month: ym, label: monthLabel(ym), sales_cents: ym === month ? sales : h?.sales_cents ?? 0, target_cents: targets.get(ym) ?? null, accepted: ym === month ? accepted.length : h?.accepted ?? 0 });
  }
  return { month, label: new Intl.DateTimeFormat("en-AU", { month: "long", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`)), sales_cents: sales, target_cents: target, pct_hit: pctHit, pct_month_gone: pctGone, pace, months };
}
