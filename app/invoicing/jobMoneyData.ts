import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobMoneyInput, JobMoneyInvoice, JobMoneyJob } from "@/lib/invoicing/jobMoney";
import type { DerivePayment } from "@/lib/invoicing/derive";
import type { LedgerVariation } from "@/lib/invoicing/ledger";
import { loadFailure, type ReadFailure } from "@/lib/invoicing/loadFailure";
import type { InvoiceStatus } from "@/lib/invoicing/stateMachine";
import type { WoStage } from "@/lib/workorder/stages";
import { fetchAllRows } from "@/lib/supabase/fetchAllRows";
import { reportError } from "@/lib/monitoring/report";
import { INVOICE_SELECT, type InvoiceRow } from "./data";

/**
 * The rows behind the Payments page (payments-merge brief §4.1). Read-only,
 * one paged read per table, through the staff session's own RLS — the page is
 * staff-only. Every figure is computed by lib/invoicing/jobMoney.ts over what
 * this returns; nothing here adds anything up.
 *
 * A failed read is NOT an empty page: any error returns `failure` and no rows,
 * and the caller shows the reason (CLAUDE.md, the 16 Sep "$0 over a full
 * ledger" lesson).
 */

type EstimateRow = { id: string; accepted_name: string | null; accepted_total_cents: number | null; total_cents: number | null; title: string | null; job_address: string | null };
type WorkOrderRow = {
  estimate_id: string; wo_ref: string; stage: WoStage; start_date: string | null; id: string;
  contractors: { company_name: string | null; profiles: { name: string | null } | null } | null;
};
type PaymentRow = { invoice_id: string; amount_cents: number; status: string; paid_on: string | null };
type VariationRow = { work_order_id: string; status: string; price_cents: number | null; credit: boolean | null };
type CiRow = { status: string; total_inc_cents: number; due_on: string | null };
type IntakeRow = { total: string | null };
type JobCostRow = { status: string; amount_ex_cents: number; gst_cents: number };
type ViewRow = { invoice_id: string };
type ChatRow = { estimate_id: string; created_at: string };

export async function loadJobMoneyInput(supabase: SupabaseClient, now: Date): Promise<{ input: JobMoneyInput | null; failure: ReadFailure | null }> {
  try {
    const [estimates, workOrders, invoices, payments, variations, cis, intake, jobCosts, views, chats] = await Promise.all([
      fetchAllRows<EstimateRow>((f, t) => supabase.from("estimates")
        .select("id, title, accepted_name, accepted_total_cents, total_cents, job_address:sent_snapshot->>jobAddress")
        .eq("status", "accepted").order("id").range(f, t)),
      fetchAllRows<WorkOrderRow>((f, t) => supabase.from("work_orders")
        .select("id, estimate_id, wo_ref, stage, start_date, contractors(company_name, profiles(name))")
        .order("id").range(f, t)),
      fetchAllRows<InvoiceRow>((f, t) => supabase.from("invoices").select(INVOICE_SELECT).order("created_at").order("id").range(f, t)),
      fetchAllRows<PaymentRow>((f, t) => supabase.from("payments").select("invoice_id, amount_cents, status, paid_on").order("id").range(f, t)),
      fetchAllRows<VariationRow>((f, t) => supabase.from("wo_variations").select("work_order_id, status, price_cents, credit").order("id").range(f, t)),
      fetchAllRows<CiRow>((f, t) => supabase.from("contractor_invoices").select("status, total_inc_cents, due_on").neq("status", "paid").order("id").range(f, t)),
      fetchAllRows<IntakeRow>((f, t) => supabase.from("cost_intake").select("total:extracted->>total_cents").eq("status", "pending").order("id").range(f, t)),
      // Employee labour is a wage, not a payable (fix/payables-no-employee-labour) — never in the Materials block.
      fetchAllRows<JobCostRow>((f, t) => supabase.from("job_costs").select("status, amount_ex_cents, gst_cents")
        .neq("category", "labour").in("status", ["recorded", "approved"]).order("id").range(f, t)),
      // "Invoice opened N times" on the row — customer opens only (staff previews never write one).
      fetchAllRows<ViewRow>((f, t) => supabase.from("invoice_events").select("invoice_id").eq("type", "viewed").order("id").range(f, t)),
      // "Last messaged" (§4.4): staff lines on each job's chat — the thread Payments → Message posts to.
      fetchAllRows<ChatRow>((f, t) => supabase.from("estimate_messages").select("estimate_id, created_at").eq("direction", "staff").order("id").range(f, t)),
    ]);
    const lastMessaged = new Map<string, string>();
    for (const m of chats) if ((lastMessaged.get(m.estimate_id) ?? "") < m.created_at) lastMessaged.set(m.estimate_id, m.created_at);
    const viewsByInvoice = new Map<string, number>();
    for (const v of views) viewsByInvoice.set(v.invoice_id, (viewsByInvoice.get(v.invoice_id) ?? 0) + 1);

    const woByEstimate = new Map(workOrders.map((w) => [w.estimate_id, w]));
    const variationsByWo = new Map<string, LedgerVariation[]>();
    for (const v of variations) {
      const list = variationsByWo.get(v.work_order_id) ?? [];
      list.push({ status: v.status, priceCents: v.price_cents, credit: v.credit ?? false });
      variationsByWo.set(v.work_order_id, list);
    }

    const jobs: JobMoneyJob[] = estimates.map((e) => {
      const wo = woByEstimate.get(e.id);
      return {
        estimateId: e.id,
        address: e.job_address || e.title || "Untitled job",
        customer: e.accepted_name,
        woRef: wo?.wo_ref ?? null,
        contractor: wo?.contractors?.company_name || wo?.contractors?.profiles?.name || null,
        woStage: wo?.stage ?? null,
        startDate: wo?.start_date ?? null,
        acceptedTotalCents: e.accepted_total_cents ?? e.total_cents ?? 0,
        variations: wo ? variationsByWo.get(wo.id) ?? [] : [],
        lastMessagedAt: lastMessaged.get(e.id) ?? null,
      };
    });

    const jobInvoices: JobMoneyInvoice[] = invoices.map((r) => ({
      id: r.id, estimateId: r.estimate_id, kind: r.kind, status: r.status as InvoiceStatus,
      totalIncCents: r.total_inc_cents, dueOn: r.due_on, issuedOn: r.issued_on,
      number: r.number, createdAt: r.created_at, views: viewsByInvoice.get(r.id) ?? 0,
    }));
    const derivePayments: DerivePayment[] = payments.map((p) => ({ invoiceId: p.invoice_id, amountCents: p.amount_cents, status: p.status, paidOn: p.paid_on }));

    return {
      failure: null,
      input: {
        jobs, invoices: jobInvoices, payments: derivePayments,
        contractorInvoices: cis.map((c) => ({ status: c.status, totalIncCents: c.total_inc_cents, dueOn: c.due_on })),
        materials: {
          intakePending: intake.map((d) => ({ totalCents: Number(d.total ?? 0) || 0 })),
          jobCosts: jobCosts.map((c) => ({ status: c.status, amountExCents: c.amount_ex_cents, gstCents: c.gst_cents })),
        },
        now,
      },
    };
  } catch (e: unknown) {
    reportError(e, { where: "loadJobMoneyInput" });
    return { input: null, failure: loadFailure({ message: e instanceof Error ? e.message : String(e) }) };
  }
}
