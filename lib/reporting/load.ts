/**
 * The server side of the reporting core. SERVER ONLY.
 *
 * Loads the caller's roles (from Postgres, `dashboard_roles()` — the same
 * answer RLS uses) and the rows the metrics read, then hands both to the pure
 * functions. Every read destructures `error`; a failed read is reported and
 * surfaced as `loadFailures`, never drawn as an empty tile (the 16 Sep
 * invoicing lesson). The PC console is loaded ONCE per page and shared by
 * the needs-doing strip and the PC / Contractors tiles.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/monitoring/report";
import { fetchAllRows } from "@/lib/supabase/fetchAllRows";
import { inSlices } from "@/lib/supabase/inSlices";
import { buildWorkQueue, type WorkItem } from "@/lib/crm/work-queue";
import { buildQueue, rankQueue, type QueueCard } from "@/lib/workorder/console";
import { loadConsole, type ConsoleData } from "@/lib/workorder/consoleData";
import { materialsBudgetCents, invoicedExGst } from "@/lib/workorder/materialsBudget";
import type { PricingContext } from "@/lib/pricing/estimate";
import { numericSettingValue } from "@/lib/settings/numeric";
import {
  addDays, previousRange, type AwaitingReplyRow, type ConsoleSlice, type ContractorSlice, type EstimateRow, type MaterialsJobRow, type MetricInput, type Range,
} from "./core";
import { effectiveRoles, isDashboardRole, type DashboardRole, type DashboardSection } from "./roles";

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

/** The window a period range can touch: the comparison period through the range, a day wide each side in UTC — never a written-down offset. */
function windowOf(range: Range): { fromIso: string; toIso: string } {
  const prev = previousRange(range);
  return { fromIso: `${addDays(prev.from, -1)}T00:00:00Z`, toIso: `${addDays(range.to, 1)}T23:59:59Z` };
}

const failure = (failures: LoadFailure[], where: string, e: unknown) => {
  reportError(e, { where: `reporting.${where}` });
  failures.push({ where, message: e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e) });
};

// ---- estimates (session 1) ------------------------------------------------------

const ESTIMATE_SELECT = "id, title, status, sent_at, accepted_at, declined_at, total_cents, accepted_total_cents, sent_by_user_id, lead_source, presentation_id, account_id, created_at";

export async function loadEstimates(supabase: SupabaseClient, range: Range): Promise<{ rows: EstimateRow[]; failures: LoadFailure[] }> {
  const { fromIso, toIso } = windowOf(range);
  const failures: LoadFailure[] = [];
  const byId = new Map<string, EstimateRow>();
  for (const col of ["sent_at", "accepted_at"] as const) {
    try {
      const rows = await fetchAllRows<EstimateRow>((from, to) =>
        supabase.from("estimates").select(ESTIMATE_SELECT).gte(col, fromIso).lte(col, toIso).order(col, { ascending: false }).range(from, to));
      for (const r of rows) byId.set(r.id, r);
    } catch (e) { failure(failures, `estimates by ${col}`, e); }
  }
  return { rows: [...byId.values()], failures };
}

// ---- the PC console (session 2) -------------------------------------------------

type WoRefRow = { id: string; wo_ref: string; contractor_id: string | null; estimate_id: string | null; title: string | null; stage: string; stage_entered_at: string | null };

async function loadConsoleSlice(supabase: SupabaseClient, console_: ConsoleData, range: Range, failures: LoadFailure[]): Promise<ConsoleSlice> {
  const cards = rankQueue(buildQueue(console_.input));
  const [awaitingReply, materials] = await Promise.all([loadAwaitingReply(supabase, failures), loadMaterialsJobs(supabase, range, failures)]);
  return { input: console_.input, cards, awaitingReply, materials };
}

async function loadAwaitingReply(supabase: SupabaseClient, failures: LoadFailure[]): Promise<AwaitingReplyRow[]> {
  const { data, error } = await supabase.from("crm_account_facts")
    .select("account_id, name, last_inbound_at, last_staff_reply_at")
    .not("last_inbound_at", "is", null).order("last_inbound_at", { ascending: true }).limit(2000);
  if (error) { failure(failures, "customers awaiting reply", error); return []; }
  return ((data ?? []) as { account_id: string; name: string | null; last_inbound_at: string; last_staff_reply_at: string | null }[])
    .filter((r) => r.last_inbound_at > (r.last_staff_reply_at ?? ""))
    .map((r) => ({ account_id: r.account_id, name: r.name ?? "A customer", last_inbound_at: r.last_inbound_at, last_staff_reply_at: r.last_staff_reply_at }));
}

/**
 * Signed-off jobs in the window with the engine's materials budget and the
 * supplier invoices matched to them — the same two figures the job page's
 * Materials card shows (`materialsBudgetCents`, `material_costs`). The
 * pricing context is loaded once per rate card, not once per job.
 */
async function loadMaterialsJobs(supabase: SupabaseClient, range: Range, failures: LoadFailure[]): Promise<MaterialsJobRow[]> {
  const { fromIso, toIso } = windowOf(range);
  const wos = await supabase.from("work_orders")
    .select("id, wo_ref, estimate_id, stage, stage_entered_at, title:wo_snapshot->>jobTitle")
    .eq("stage", "closed").gte("stage_entered_at", fromIso).lte("stage_entered_at", toIso).order("stage_entered_at", { ascending: false }).limit(300);
  if (wos.error) { failure(failures, "signed-off jobs", wos.error); return []; }
  const jobs = (wos.data ?? []) as WoRefRow[];
  if (jobs.length === 0) return [];
  const ids = jobs.map((j) => j.id);
  const estIds = jobs.map((j) => j.estimate_id).filter((x): x is string => Boolean(x));
  const [costs, ests, products, modifiers, settings] = await Promise.all([
    inSlices(ids, (s) => supabase.from("material_costs").select("work_order_id, amount_cents").in("work_order_id", s)),
    inSlices(estIds, (s) => supabase.from("estimates").select("id, builder_state, rate_card_id").in("id", s)),
    supabase.from("products").select("*"),
    supabase.from("modifiers").select("code, group_name, multiplier").eq("active", true),
    supabase.from("settings").select("key, value"),
  ]);
  for (const [where, r] of [["material costs", costs], ["estimates behind signed-off jobs", ests], ["products", products], ["modifiers", modifiers], ["settings", settings]] as const) {
    if (r.error) { failure(failures, where, r.error); return []; }
  }
  const estById = new Map(((ests.rows ?? []) as { id: string; builder_state: Record<string, unknown> | null; rate_card_id: string | null }[]).map((e) => [e.id, e]));
  const cardIds = [...new Set([...estById.values()].map((e) => e.rate_card_id ?? "active"))];
  const rateItemsByCard = new Map<string, PricingContext["rateItems"]>();
  for (const cardId of cardIds) {
    const r = cardId === "active"
      ? await supabase.from("rate_items").select("*, rate_cards!inner(is_active)").eq("rate_cards.is_active", true)
      : await supabase.from("rate_items").select("*").eq("rate_card_id", cardId);
    if (r.error) { failure(failures, "rate items", r.error); return []; }
    rateItemsByCard.set(cardId, (r.data ?? []) as PricingContext["rateItems"]);
  }
  const invoicedByWo = new Map<string, number>();
  for (const c of (costs.rows ?? []) as { work_order_id: string; amount_cents: number }[]) invoicedByWo.set(c.work_order_id, (invoicedByWo.get(c.work_order_id) ?? 0) + (Number(c.amount_cents) || 0));
  return jobs.map((j) => {
    const est = j.estimate_id ? estById.get(j.estimate_id) : null;
    const ctx: PricingContext = {
      rateItems: rateItemsByCard.get(est?.rate_card_id ?? "active") ?? [],
      products: (products.data ?? []) as PricingContext["products"],
      modifiers: (modifiers.data ?? []) as PricingContext["modifiers"],
      settings: (settings.data ?? []) as PricingContext["settings"],
    };
    let budget: number | null = null;
    try { budget = est ? materialsBudgetCents(est.builder_state, ctx) : null; } catch (e) { reportError(e, { where: "reporting.materials.budget", bestEffort: true, extra: { workOrderId: j.id } }); }
    return { work_order_id: j.id, wo_ref: j.wo_ref, title: j.title ?? "", closed_on: (j.stage_entered_at ?? "").slice(0, 10), budget_cents: budget, invoiced_ex_cents: invoicedExGst(invoicedByWo.get(j.id) ?? 0) };
  });
}

// ---- contractors (session 2, from the 0c capture) ----------------------------------

async function loadContractorSlice(supabase: SupabaseClient, range: Range, failures: LoadFailure[]): Promise<ContractorSlice> {
  const { fromIso, toIso } = windowOf(range);
  const empty: ContractorSlice = { contractors: [], done: [], qaChecks: [], offers: [], variations: [], pendingExpenses: [], silentDays: 3, dayHours: 8 };
  const [contractors, doneEvents, qa, offers, variations, expenses, settings] = await Promise.all([
    supabase.from("contractors").select("id, company_name, works_saturday, works_sunday, profiles(name)").eq("active", true),
    supabase.from("wo_events").select("work_order_id, created_at, work_orders(id, wo_ref, contractor_id, title:wo_snapshot->>jobTitle)")
      .eq("type", "all_surfaces_done").gte("created_at", fromIso).lte("created_at", toIso).limit(1000),
    supabase.from("wo_qa_checks").select("work_order_id, attempt_no, result, checked_at, work_orders(wo_ref, contractor_id)")
      .not("result", "is", null).gte("checked_at", fromIso).lte("checked_at", toIso).limit(1000),
    supabase.from("booking_offers").select("work_order_id, contractor_id, offered_at, accepted_at, work_orders(wo_ref)")
      .eq("state", "accepted").gte("accepted_at", fromIso).lte("accepted_at", toIso).limit(1000),
    supabase.from("wo_variations").select("work_order_id, created_at, status, work_orders(wo_ref, contractor_id)")
      .gte("created_at", fromIso).lte("created_at", toIso).limit(1000),
    supabase.from("contractor_expenses").select("id, work_order_id, contractor_id, amount_cents, created_at, category, work_orders(wo_ref)")
      .eq("status", "submitted").limit(500),
    supabase.from("settings").select("key, value").in("key", ["dashboard_silent_contractor_days", "worked_day_hours"]),
  ]);
  for (const [where, r] of [["contractors", contractors], ["finished jobs", doneEvents], ["quality checks", qa], ["accepted offers", offers], ["variations", variations], ["expense claims", expenses], ["dashboard settings", settings]] as const) {
    if (r.error) { failure(failures, where, r.error); return empty; }
  }
  type WoJoin = { id?: string; wo_ref: string; contractor_id?: string | null; title?: string | null } | null;
  const doneRows = (doneEvents.data ?? []) as unknown as { work_order_id: string; created_at: string; work_orders: WoJoin }[];
  const doneIds = doneRows.map((d) => d.work_order_id);
  const [bookings, worked] = doneIds.length ? await Promise.all([
    inSlices(doneIds, (s) => supabase.from("booking_offers").select("work_order_id, start_date, end_date, hours_allowance, accepted_at").eq("state", "accepted").in("work_order_id", s).order("accepted_at", { ascending: false })),
    inSlices(doneIds, (s) => supabase.from("wo_worked_hours").select("work_order_id, days, hours").in("work_order_id", s)),
  ]) : [{ rows: [], error: null }, { rows: [], error: null }];
  if (bookings.error) { failure(failures, "bookings behind finished jobs", bookings.error); return empty; }
  if (worked.error) { failure(failures, "worked hours", worked.error); return empty; }
  const bookingByWo = new Map<string, { start_date: string | null; end_date: string | null; hours_allowance: number | null }>();
  for (const b of (bookings.rows ?? []) as { work_order_id: string; start_date: string | null; end_date: string | null; hours_allowance: number | string | null }[]) {
    if (!bookingByWo.has(b.work_order_id)) bookingByWo.set(b.work_order_id, { start_date: b.start_date, end_date: b.end_date, hours_allowance: b.hours_allowance == null ? null : Number(b.hours_allowance) });
  }
  const workedByWo = new Map<string, { days: number; hours: number }>();
  for (const w of (worked.rows ?? []) as { work_order_id: string; days: number | string; hours: number | string }[]) workedByWo.set(w.work_order_id, { days: Number(w.days), hours: Number(w.hours) });
  const settingsMap = new Map(((settings.data ?? []) as { key: string; value: unknown }[]).map((s) => [s.key, numericSettingValue(s.value)]));
  return {
    contractors: ((contractors.data ?? []) as { id: string; company_name: string | null; works_saturday: boolean | null; works_sunday: boolean | null; profiles: { name: string | null } | { name: string | null }[] | null }[])
      .map((c) => { const p = Array.isArray(c.profiles) ? c.profiles[0] : c.profiles; return { id: c.id, name: c.company_name || p?.name || "A painter", works_saturday: Boolean(c.works_saturday), works_sunday: Boolean(c.works_sunday) }; }),
    done: doneRows.filter((d) => d.work_orders).map((d) => ({
      work_order_id: d.work_order_id, wo_ref: d.work_orders!.wo_ref, title: d.work_orders!.title ?? "", contractor_id: d.work_orders!.contractor_id ?? null, done_at: d.created_at,
      end_date: bookingByWo.get(d.work_order_id)?.end_date ?? null, start_date: bookingByWo.get(d.work_order_id)?.start_date ?? null,
      hours_allowance: bookingByWo.get(d.work_order_id)?.hours_allowance ?? null, entered: workedByWo.get(d.work_order_id) ?? null,
    })),
    qaChecks: ((qa.data ?? []) as unknown as { work_order_id: string; attempt_no: number; result: string; checked_at: string; work_orders: WoJoin }[])
      .map((c) => ({ work_order_id: c.work_order_id, wo_ref: c.work_orders?.wo_ref ?? "", contractor_id: c.work_orders?.contractor_id ?? null, attempt_no: c.attempt_no, result: c.result, checked_at: c.checked_at })),
    offers: ((offers.data ?? []) as unknown as { work_order_id: string; contractor_id: string; offered_at: string; accepted_at: string; work_orders: WoJoin }[])
      .map((o) => ({ work_order_id: o.work_order_id, wo_ref: o.work_orders?.wo_ref ?? "", contractor_id: o.contractor_id, offered_at: o.offered_at, accepted_at: o.accepted_at })),
    variations: ((variations.data ?? []) as unknown as { work_order_id: string; created_at: string; status: string; work_orders: WoJoin }[])
      .map((v) => ({ work_order_id: v.work_order_id, wo_ref: v.work_orders?.wo_ref ?? "", contractor_id: v.work_orders?.contractor_id ?? null, created_at: v.created_at, status: v.status })),
    pendingExpenses: ((expenses.data ?? []) as unknown as { id: string; work_order_id: string; contractor_id: string; amount_cents: number; created_at: string; category: string; work_orders: WoJoin }[])
      .map((e) => ({ id: e.id, work_order_id: e.work_order_id, wo_ref: e.work_orders?.wo_ref ?? "", contractor_id: e.contractor_id, amount_cents: e.amount_cents, created_at: e.created_at, category: e.category })),
    silentDays: settingsMap.get("dashboard_silent_contractor_days") ?? 3,
    dayHours: settingsMap.get("worked_day_hours") ?? 8,
  };
}

// ---- the page's one load ------------------------------------------------------------

export type DashboardLoad = {
  input: MetricInput;
  strip: { workItems: WorkItem[]; consoleCards: QueueCard[] };
  failures: LoadFailure[];
};

/** Everything /home needs, loaded once for the sections this login sees. */
export async function loadDashboard(
  supabase: SupabaseClient, roles: ReadonlyArray<DashboardRole>, sections: ReadonlyArray<DashboardSection>, range: Range, now = new Date(),
): Promise<DashboardLoad> {
  const failures: LoadFailure[] = [];
  const wantsQueue = roles.length > 0;
  const wantsConsole = sections.includes("pc_command") || sections.includes("contractors");
  const wantsEstimates = sections.includes("sales");
  const [wq, console_, est] = await Promise.all([
    wantsQueue ? buildWorkQueue(supabase, now).catch((e: unknown) => { failure(failures, "work queue", e); return null; }) : null,
    wantsConsole ? loadConsole(supabase, now).catch((e: unknown) => { failure(failures, "PC console", e); return null; }) : null,
    wantsEstimates ? loadEstimates(supabase, range) : Promise.resolve({ rows: [] as EstimateRow[], failures: [] as LoadFailure[] }),
  ]);
  failures.push(...est.failures);
  const [consoleSlice, contractorSlice] = await Promise.all([
    console_ ? loadConsoleSlice(supabase, console_, range, failures) : Promise.resolve(null),
    sections.includes("contractors") ? loadContractorSlice(supabase, range, failures) : Promise.resolve(null),
  ]);
  return {
    input: { now, estimates: est.rows, console: consoleSlice, contractors: contractorSlice },
    strip: { workItems: wq?.items ?? [], consoleCards: consoleSlice?.cards ?? [] },
    failures,
  };
}

/** The export route and the cron: the rows a single metric needs, by section. */
export async function loadMetricInput(
  supabase: SupabaseClient, range: Range, now = new Date(), sections: ReadonlyArray<DashboardSection> = ["sales", "pc_command", "contractors"],
): Promise<{ input: MetricInput; failures: LoadFailure[] }> {
  const d = await loadDashboard(supabase, [], sections, range, now);   // no roles → no work queue; the tiles do not need it
  return { input: d.input, failures: d.failures };
}
