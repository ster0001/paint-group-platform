/**
 * Session 1 — the server side of the reporting core. SERVER ONLY.
 *
 * Loads the caller's roles (from Postgres, `dashboard_roles()` — the same
 * answer RLS uses) and the rows the metrics read, then hands both to the pure
 * functions. Every read destructures `error`; a failed read is reported and
 * surfaced as `loadFailures`, never drawn as an empty tile (the 16 Sep
 * invoicing lesson).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/monitoring/report";
import { fetchAllRows } from "@/lib/supabase/fetchAllRows";
import { buildWorkQueue, type WorkItem } from "@/lib/crm/work-queue";
import { buildQueue, rankQueue, type QueueCard } from "@/lib/workorder/console";
import { loadConsole } from "@/lib/workorder/consoleData";
import { addDays, previousRange, type EstimateRow, type MetricInput, type Range } from "./core";
import { effectiveRoles, isDashboardRole, type DashboardRole } from "./roles";

export async function loadRoles(supabase: SupabaseClient): Promise<DashboardRole[]> {
  const { data, error } = await supabase.rpc("dashboard_roles");
  if (error) {
    // Pre-20270179 the function does not exist: the caller has no dashboard roles rather than a guessed set.
    reportError(error, { where: "reporting.roles", bestEffort: true });
    return [];
  }
  const roles = Array.isArray(data) ? (data as unknown[]).filter(isDashboardRole) : [];
  return effectiveRoles({ isOwner: false, roles });   // the master already comes back as all five from Postgres
}

export type LoadFailure = { where: string; message: string };

const ESTIMATE_SELECT = "id, title, status, sent_at, accepted_at, declined_at, total_cents, accepted_total_cents, sent_by_user_id, lead_source, presentation_id, account_id, created_at";

/**
 * The estimates a period range can touch: sent OR accepted between the start
 * of the comparison period and the end of the range. Both windows are one
 * query each; the pure functions do the bucketing by Melbourne day.
 */
export async function loadEstimates(supabase: SupabaseClient, range: Range): Promise<{ rows: EstimateRow[]; failures: LoadFailure[] }> {
  const prev = previousRange(range);
  // Query bounds a day wide of the Melbourne window on each side, in UTC —
  // never a written-down offset (+10 / +11 depends on the month). A row a
  // day outside is harmless: the pure function buckets by Melbourne day.
  const fromIso = `${addDays(prev.from, -1)}T00:00:00Z`;
  const toIso = `${addDays(range.to, 1)}T23:59:59Z`;
  const failures: LoadFailure[] = [];
  const byId = new Map<string, EstimateRow>();
  for (const col of ["sent_at", "accepted_at"] as const) {
    try {
      const rows = await fetchAllRows<EstimateRow>((from, to) =>
        supabase.from("estimates").select(ESTIMATE_SELECT).gte(col, fromIso).lte(col, toIso).order(col, { ascending: false }).range(from, to));
      for (const r of rows) byId.set(r.id, r);
    } catch (e) {
      reportError(e, { where: `reporting.estimates.${col}` });
      failures.push({ where: `estimates by ${col}`, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { rows: [...byId.values()], failures };
}

export async function loadMetricInput(supabase: SupabaseClient, range: Range, now = new Date()): Promise<{ input: MetricInput; failures: LoadFailure[] }> {
  const est = await loadEstimates(supabase, range);
  return { input: { now, estimates: est.rows }, failures: est.failures };
}

/** The strip's two sources, as built elsewhere. Each is best-effort and reported; neither hides the other. */
export async function loadStripSources(
  supabase: SupabaseClient, roles: ReadonlyArray<DashboardRole>, now = new Date(),
): Promise<{ workItems: WorkItem[]; consoleCards: QueueCard[]; failures: LoadFailure[] }> {
  const failures: LoadFailure[] = [];
  const wantsQueue = roles.some((r) => r === "owner" || r === "admin" || r === "sales" || r === "finance" || r === "pc");
  const wantsConsole = roles.some((r) => r === "owner" || r === "admin" || r === "pc");
  const [wq, console_] = await Promise.all([
    wantsQueue ? buildWorkQueue(supabase, now).catch((e: unknown) => { reportError(e, { where: "reporting.strip.workQueue" }); failures.push({ where: "work queue", message: e instanceof Error ? e.message : String(e) }); return null; }) : null,
    wantsConsole ? loadConsole(supabase, now).catch((e: unknown) => { reportError(e, { where: "reporting.strip.console" }); failures.push({ where: "PC console", message: e instanceof Error ? e.message : String(e) }); return null; }) : null,
  ]);
  return {
    workItems: wq?.items ?? [],
    consoleCards: console_ ? rankQueue(buildQueue(console_.input)) : [],
    failures,
  };
}
