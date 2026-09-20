/**
 * Every metric the dashboard can show, export or roll up — one list. A tile
 * that is not here does not exist; a key the export route is asked for that
 * is not here is a 404, not a guess.
 *
 * Sections whose source module is not live yet are listed in `SWITCHES_ON`
 * so the page can say "switches on when X ships" instead of drawing a zero
 * (acceptance 14).
 */
import type { MetricDef } from "./core";
import type { DashboardSection } from "./roles";
import { aovByCategory, bySalesperson, conversion, estimatesSent, salesCents, salesCount } from "./metrics/sales";
import { wizardSessions } from "./metrics/funnel";
import { activity } from "./metrics/activity";
import { INVOICING_METRICS } from "./metrics/invoicing";
import { PL_METRICS } from "./metrics/pl";
import { MARKETING_METRICS } from "./metrics/marketing";
import { PC_METRICS } from "./metrics/pc";
import { CONTRACTOR_METRICS } from "./metrics/contractors";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a heterogeneous registry; every entry is a MetricDef of its own row type
export type AnyMetricDef = MetricDef<any>;

export const METRICS: ReadonlyArray<AnyMetricDef> = [
  estimatesSent, salesCents, salesCount, conversion, aovByCategory, bySalesperson,
  wizardSessions, activity,
  ...PC_METRICS,
  ...CONTRACTOR_METRICS,
  ...INVOICING_METRICS,
  ...PL_METRICS,
  ...MARKETING_METRICS,
];

export function metricByKey(key: string): AnyMetricDef | null {
  return METRICS.find((m) => m.key === key) ?? null;
}

export function metricsForSection(section: DashboardSection): AnyMetricDef[] {
  return METRICS.filter((m) => m.section === section);
}

/** Honest placeholders: what each section waits on, until its session lands. */
export const SWITCHES_ON: Partial<Record<DashboardSection, string>> = {
};

export const SECTION_TITLE: Record<DashboardSection, string> = {
  needs_doing: "Needs doing",
  sales: "Sales",
  funnel: "Where estimates go",
  pc_command: "PC Command",
  contractors: "Contractors",
  invoicing: "Invoicing",
  pl: "P&L",
  marketing: "Marketing",
  activity: "Activity",
};
