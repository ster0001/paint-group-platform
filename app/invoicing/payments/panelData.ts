import type { SupabaseClient } from "@supabase/supabase-js";
import { pctOfContract, type JobMoneyPage, type JobMoneyRow, type ContractorRow } from "@/lib/invoicing/jobMoney";
import type { MatRow } from "@/lib/invoicing/materials";
import { invoiceBalanceCents, invoiceIsOverdue, invoicePaidCents, melbourneToday, daysBetween } from "@/lib/invoicing/derive";
import { jobProfit, type JobProfit } from "@/lib/invoicing/jobProfit";
import { finalDraftIsStale } from "@/lib/invoicing/ledger";
import { contractorVariationsCents } from "@/lib/workorder/contractorPay";
import type { InvoiceStatus } from "@/lib/invoicing/stateMachine";
import { reportError } from "@/lib/monitoring/report";
import { bookedLabour, missingRateNote } from "@/lib/invoicing/bookedLabour";
import { loadBookedLabour, loadJobCosts, loadJobMoney, toDerive, toDerivePayments, type InvoiceRow } from "../data";
import { realOnly } from "@/lib/demo/scope";

/**
 * The job panel's rows (payments-merge brief §4.7, Step 7). The panel reads
 * the SAME page model as the row it opened from (`jobMoneyPage`), so the two
 * can never show different amounts; this adds only what the row doesn't
 * carry: every invoice with its payments, and the costs behind the profit —
 * through the job view's existing loaders (loadJobMoney, loadJobCosts).
 */

export type PanelPayment = { id: string; method: string; paidOn: string | null; amountCents: number; status: string };
export type PanelInvoice = {
  id: string;
  kind: InvoiceRow["kind"];
  status: InvoiceStatus;
  number: string | null;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  dueOn: string | null;
  issuedOn: string | null;
  /** over · need · sent · draft · paid · void — the card's colour, decided here. */
  state: "over" | "need" | "sent" | "draft" | "paid" | "void";
  overdueDays: number | null;
  pctOfContract: number | null;
  views: number;
  voidedReason: string | null;
  chaseHold: string | null;
  /** Paid in cash and never sent to the customer (R14). */
  cashNotSent: boolean;
  /** The deposit slot of the job — the adjuster / Change amount act on it. */
  isDeposit: boolean;
  /** A draft final worked out before an earlier invoice was issued (§6.3) — Redraft. */
  staleFinal: boolean;
  payments: PanelPayment[];
};

/** Tom, 22 Oct 2026: a paint or materials order (a Movements chip) a supplier invoice can sit on. */
export type PanelOrder = { id: string; title: string; kind: string; status: string };
export type PanelJobCost = { id: string; description: string; category: string; amountExCents: number; gstCents: number; status: string };
/** A material cost on the job with the fields its edit form changes (every row, matched or by hand). */
export type PanelMaterialRow = { id: string; supplier: string; amountCents: number; invoiceDate: string | null; orderRef: string | null; movementId: string | null };

export type PanelData = {
  row: JobMoneyRow;
  /** The job's paint and materials orders, for moving a material cost or adding one by hand. */
  orders: PanelOrder[];
  /** material cost id → the order it sits on (null = none yet). */
  materialOrder: Record<string, string | null>;
  /** The recorded job costs with the fields the edit form changes. */
  jobCostRows: PanelJobCost[];
  materialRows: PanelMaterialRow[];
  invoices: PanelInvoice[];
  contractors: ContractorRow[];
  supplierInvoices: MatRow[];
  profit: JobProfit;
  /** Booked days no cost rate can price (bookedLabour.ts) — the profit reads too high until it is set. */
  labourNote: string | null;
  woId: string | null;
  woRef: string | null;
  /** The newest staff line on the job's chat, for the Messages line. */
  lastMessage: string | null;
  loadProblem: string | null;
};

export async function loadJobPanel(supabase: SupabaseClient, page: JobMoneyPage, estimateId: string, now: Date): Promise<PanelData | null> {
  const row = page.rows.find((r) => r.estimateId === estimateId);
  if (!row) return null;
  const job = await loadJobMoney(supabase, estimateId);
  const woId = job.wo?.id ?? null;
  const [costs, booked, chat, ordersRes, matLinksRes] = await Promise.all([
    woId ? loadJobCosts(supabase, woId) : Promise.resolve({ jobCosts: [], materials: [], expenses: [], loadError: null }),
    woId ? loadBookedLabour(supabase, woId) : Promise.resolve(null),
    supabase.from("estimate_messages").select("body").eq("estimate_id", estimateId).eq("direction", "staff").order("created_at", { ascending: false }).limit(1),
    // Tom, 22 Oct 2026: the job's orders and which order each material cost sits on (CostEdit).
    woId ? realOnly(supabase.from("movements").select("id, kind, title, status")).eq("work_order_id", woId).in("kind", ["paint", "materials"]).neq("status", "cancelled").order("created_at") : Promise.resolve({ data: [], error: null }),
    woId ? realOnly(supabase.from("material_costs").select("id, movement_id")).eq("work_order_id", woId) : Promise.resolve({ data: [], error: null }),
  ]);
  if (chat.error) reportError(chat.error, { where: "loadJobPanel.chat", bestEffort: true });

  const today = melbourneToday(now);
  const derivePays = toDerivePayments(job.payments);
  const viewsById = new Map<string, number>();
  for (const e of job.events) if (e.type === "viewed") viewsById.set(e.invoice_id, (viewsById.get(e.invoice_id) ?? 0) + 1);
  const sentIds = new Set(job.events.filter((e) => e.type === "sent").map((e) => e.invoice_id));
  const depositIds = new Set(row.slots.deposit.invoiceIds);
  const invoicedNow = Number(job.ledger?.invoiced_cents ?? 0);
  // Newest first (loadJobMoney): the first `drafted` event per invoice is its latest drafting.
  const invoicedAtDraft = new Map<string, number | null>();
  for (const e of job.events) {
    if (e.type !== "drafted" || invoicedAtDraft.has(e.invoice_id)) continue;
    const v = (e.meta as { previously_invoiced_cents?: unknown }).previously_invoiced_cents;
    invoicedAtDraft.set(e.invoice_id, typeof v === "number" ? v : null);
  }

  const invoices: PanelInvoice[] = job.invoices.map((inv) => {
    const d = toDerive([inv])[0];
    const balance = invoiceBalanceCents(d, derivePays);
    const over = invoiceIsOverdue(d, derivePays, now);
    const isDeposit = depositIds.has(inv.id);
    const pays = job.payments.filter((p) => p.invoice_id === inv.id);
    const state: PanelInvoice["state"] =
      inv.status === "void" || inv.status === "written_off" ? "void"
      : balance <= 0 ? "paid"
      : over ? "over"
      : isDeposit && row.slots.deposit.tone === "need" ? "need"
      : inv.status === "draft" ? "draft" : "sent";
    return {
      id: inv.id, kind: inv.kind, status: inv.status, number: inv.number, totalCents: inv.total_inc_cents,
      paidCents: invoicePaidCents(d, derivePays), balanceCents: Math.max(0, balance), dueOn: inv.due_on, issuedOn: inv.issued_on, state,
      overdueDays: over && inv.due_on ? daysBetween(inv.due_on, today) : null,
      pctOfContract: pctOfContract(inv.total_inc_cents, row.contractCents),
      views: viewsById.get(inv.id) ?? 0, voidedReason: inv.voided_reason || null, chaseHold: inv.chase_hold_reason ?? null,
      cashNotSent: inv.status === "paid" && !sentIds.has(inv.id) && pays.some((p) => p.method === "cash" && p.status === "succeeded"),
      isDeposit,
      staleFinal: inv.kind === "final" && inv.status === "draft" && finalDraftIsStale(invoicedNow, invoicedAtDraft.get(inv.id) ?? null),
      payments: pays.map((p) => ({ id: p.id, method: p.method ?? "other", paidOn: p.paid_on, amountCents: p.amount_cents, status: p.status })),
    };
  });

  const materialsCostIds = new Set(page.materials.costIds);
  // Tom, 15 Oct 2026: every booked day is a work day at hours × the painter's
  // rate, ahead of the day as well — the rule is bookedLabour.ts; this maps.
  const labour = booked
    ? bookedLabour({ ...booked, countedCostIds: new Set(costs.jobCosts.filter((c) => c.category === "labour" && (c.status === "approved" || c.status === "paid")).map((c) => c.id)) })
    : { projected: [], missingRate: [], workingDays: 0 };
  const profit = jobProfit({
    contractIncCents: row.contractCents,
    offerCents: Number(job.wo?.contractor_payment ?? 0) || 0,
    contractorVariationCents: contractorVariationsCents(job.variations),
    costs: costs.jobCosts.map((c) => ({
      id: c.id, category: c.category, status: c.status, amountExCents: c.amount_ex_cents,
      label: [c.vendors?.name || c.description || "Cost", c.invoice_no].filter(Boolean).join(" "),
    })),
    materialsCostIds,
    materialCosts: costs.materials.map((m) => ({ id: m.id, amountIncCents: m.amount_cents, overhead: m.overhead ?? null, label: m.supplier || "Materials" })),
    expenses: costs.expenses.map((e) => ({ id: e.id, amountExCents: e.amount_cents, status: e.status, label: e.category.replaceAll("_", " ") })),
    started: row.underWay || row.lane === "closed",
    projectedLabour: labour.projected.map((d) => ({ id: d.id, label: d.label, cents: d.cents })),
    employeeJob: booked?.employeeJob ?? false,
  });

  const onJob = (r: MatRow) => r.job?.estimateId === estimateId;
  const orders: PanelOrder[] = ordersRes.error ? [] : ((ordersRes.data ?? []) as PanelOrder[]);
  const materialOrder: Record<string, string | null> = {};
  if (!matLinksRes.error) for (const l of (matLinksRes.data ?? []) as { id: string; movement_id: string | null }[]) materialOrder[l.id] = l.movement_id;
  const jobCostRows: PanelJobCost[] = costs.jobCosts.map((c) => ({ id: c.id, description: c.description ?? "", category: c.category, amountExCents: c.amount_ex_cents, gstCents: c.gst_cents ?? 0, status: c.status }));
  const materialRows: PanelMaterialRow[] = costs.materials.map((m) => ({ id: m.id, supplier: m.supplier ?? "", amountCents: m.amount_cents, invoiceDate: m.invoice_date ?? null, orderRef: m.order_ref ?? null, movementId: materialOrder[m.id] ?? null }));
  return {
    row, invoices, orders, materialOrder, jobCostRows, materialRows,
    contractors: page.contractors.filter((c) => c.estimateId === estimateId),
    supplierInvoices: [...page.materials.toApprove, ...page.materials.toPay.flatMap((g) => g.rows), ...page.materials.paid].filter(onJob),
    profit, labourNote: missingRateNote(labour.missingRate), woId, woRef: job.wo?.wo_ref ?? null,
    lastMessage: ((chat.data ?? [])[0] as { body: string } | undefined)?.body ?? null,
    loadProblem: job.loadError?.headline ?? costs.loadError?.headline ?? booked?.loadError?.headline
      ?? (ordersRes.error ? `The job's orders could not be read: ${ordersRes.error.message}` : null)
      ?? (matLinksRes.error ? `Which order each material sits on could not be read: ${matLinksRes.error.message}` : null),
  };
}
