/**
 * Session 1 — the needs-doing strip, from the evaluators that already exist.
 * No new list logic (brief Part C, and the one-work-queue rule): the CRM work
 * queue supplies invoicing money items and sales follow-ups by GROUP, the PC
 * console supplies the job cards. This module only picks per role and shapes
 * a card; the anomaly cards (owner, session 5) will be appended here later.
 */
import type { WorkItem } from "@/lib/crm/work-queue";
import { GROUP_OF_KIND } from "@/lib/crm/work-queue";
import type { QueueCard } from "@/lib/workorder/console";
import type { DashboardRole } from "./roles";
import { compareDelta, type MetricResult } from "./core";

export type StripSeverity = "critical" | "amber" | "info";

export type StripCard = {
  key: string;
  severity: StripSeverity;
  /** "Critical · money", "Amber · job" — the mockup's small line. */
  label: string;
  title: string;
  detail: string;
  action: { label: string; href: string };
  /** Which roles the card is for; the owner sees all. */
  roles: DashboardRole[];
};

const SEV_LABEL: Record<StripSeverity, string> = { critical: "Critical", amber: "Amber", info: "Info" };

function fromWorkItem(item: WorkItem): StripCard | null {
  const group = GROUP_OF_KIND[item.kind];
  const roles: DashboardRole[] =
    group === "money" ? ["owner", "admin", "finance"]
    : group === "followups" ? ["owner", "admin", "sales"]
    : group === "messages" ? ["owner", "admin", "pc", "sales", "finance"]
    : [];
  if (roles.length === 0) return null;   // approvals stay on Today; the strip is the brief's three sources
  const severity: StripSeverity = item.bucket === "overdue" ? "critical" : item.bucket === "today" ? "amber" : "info";
  const what = group === "money" ? "money" : group === "followups" ? "sales" : "customer";
  return {
    key: `wq:${item.key}`,
    severity,
    label: `${SEV_LABEL[severity]} · ${what}`,
    title: item.title,
    detail: item.detail,
    action: { label: item.action?.label ?? "Open", href: item.action?.href ?? "/crm" },
    roles,
  };
}

function fromConsoleCard(card: QueueCard): StripCard {
  const severity: StripSeverity = card.severity === "critical" ? "critical" : card.severity === "warning" ? "amber" : "info";
  return {
    key: `pc:${card.key}`,
    severity,
    label: `${SEV_LABEL[severity]} · job`,
    title: card.title,
    detail: [card.ref, card.detail].filter(Boolean).join(" · "),
    action: { label: card.action.label, href: card.action.href ?? `/pc/wo/${card.workOrderId}` },
    roles: ["owner", "admin", "pc"],
  };
}

/**
 * Session 5 (owner, admin): a period tile at least `thresholdPct` off its
 * comparison is an "Amber · trend" card — "Conversion down 18% vs August".
 * Money-bearing tiles stay with the money roles (the strip is picked per
 * role like every other card). The threshold is Settings dashboard_anomaly_threshold_pct.
 */
export function anomalyCards(results: ReadonlyArray<MetricResult>, thresholdPct: number, compareLabel: (r: MetricResult) => string): StripCard[] {
  const out: StripCard[] = [];
  for (const r of results) {
    if (r.kind !== "period" || r.compare == null || r.compare === 0) continue;
    const d = compareDelta(r.value, r.compare);
    if (!d || d.dir === "flat" || d.pct < thresholdPct) continue;
    out.push({
      key: `anomaly:${r.key}`, severity: "amber", label: "Amber · trend",
      title: `${r.title} ${d.dir === "up" ? "up" : "down"} ${d.pct}% vs ${compareLabel(r)}`,
      detail: r.note ?? `${r.rows.length} row${r.rows.length === 1 ? "" : "s"} in the range`,
      action: { label: "See the tile", href: `/home#section-${r.key.split(".")[0] === "pc" ? "pc_command" : r.key.split(".")[0] === "inv" ? "invoicing" : r.key.split(".")[0] === "mk" ? "marketing" : r.key.split(".")[0]}` },
      roles: ["owner", "admin"],
    });
  }
  return out;
}

const RANK: Record<StripSeverity, number> = { critical: 0, amber: 1, info: 2 };

/** Pick the strip for a login. Owner and admin see every card; the rest their own. */
export function buildStrip(
  input: { workItems: WorkItem[]; consoleCards: QueueCard[]; extra?: StripCard[] },
  roles: ReadonlyArray<DashboardRole>,
  limit = 12,
): StripCard[] {
  const all: StripCard[] = [...(input.extra ?? [])];
  for (const i of input.workItems) { const c = fromWorkItem(i); if (c) all.push(c); }
  for (const c of input.consoleCards) all.push(fromConsoleCard(c));
  const mine = all.filter((c) => c.roles.some((r) => roles.includes(r)));
  mine.sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.title.localeCompare(b.title));
  return mine.slice(0, limit);
}
