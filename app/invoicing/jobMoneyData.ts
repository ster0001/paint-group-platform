import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobMoneyInput, JobMoneyInvoice, JobMoneyJob } from "@/lib/invoicing/jobMoney";
import type { DerivePayment } from "@/lib/invoicing/derive";
import type { LedgerVariation } from "@/lib/invoicing/ledger";
import { loadFailure, type ReadFailure } from "@/lib/invoicing/loadFailure";
import type { InvoiceStatus } from "@/lib/invoicing/stateMachine";
import type { WoStage } from "@/lib/workorder/stages";
import { fetchAllRows } from "@/lib/supabase/fetchAllRows";
import { reportError } from "@/lib/monitoring/report";
import { INVOICE_SELECT, loadContractorInvoices, type ContractorInvoiceRow, type InvoiceRow } from "./data";

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
type IntakeDb = {
  id: string; status: string; confirmed_at: string | null; resulting_id: string | null; created_at: string; raw_doc_path: string | null;
  from_email: string; extract_status: string; proposed_wo_id: string | null; proposed_vendor_id: string | null; duplicate_of: string | null;
  extracted: { supplier?: string; invoice_no?: string; invoice_date?: string; total_cents?: number | string; order_ref?: string; address_text?: string } | null;
};
type JobCostDb = {
  id: string; work_order_id: string; vendor_id: string | null; category: string; status: string; amount_ex_cents: number; gst_cents: number;
  doc_path: string | null; invoice_no: string; invoice_date: string | null; intake_id: string | null; paid_at: string | null; created_at: string;
};
type VendorDb = { id: string; name: string; sender_domains: string[] | null; default_category: string };
type MaterialCostDb = { id: string; work_order_id: string | null; supplier: string; amount_cents: number; intake_id: string | null; overhead: boolean | null };
type ViewRow = { invoice_id: string };
type ChatRow = { estimate_id: string; created_at: string };

export async function loadJobMoneyInput(supabase: SupabaseClient, now: Date): Promise<{ input: JobMoneyInput | null; failure: ReadFailure | null }> {
  try {
    const [estimates, workOrders, invoices, payments, variations, cis, intake, jobCosts, views, chats, vendors, materialCosts] = await Promise.all([
      fetchAllRows<EstimateRow>((f, t) => supabase.from("estimates")
        .select("id, title, accepted_name, accepted_total_cents, total_cents, job_address:sent_snapshot->>jobAddress")
        .eq("status", "accepted").order("id").range(f, t)),
      fetchAllRows<WorkOrderRow>((f, t) => supabase.from("work_orders")
        .select("id, estimate_id, wo_ref, stage, start_date, contractors(company_name, profiles(name))")
        .order("id").range(f, t)),
      fetchAllRows<InvoiceRow>((f, t) => supabase.from("invoices").select(INVOICE_SELECT).order("created_at").order("id").range(f, t)),
      fetchAllRows<PaymentRow>((f, t) => supabase.from("payments").select("invoice_id, amount_cents, status, paid_on").order("id").range(f, t)),
      fetchAllRows<VariationRow>((f, t) => supabase.from("wo_variations").select("work_order_id, status, price_cents, credit").order("id").range(f, t)),
      // The Payables tab's own read (every unpaid one, the newest settled) — one read for both pages.
      loadContractorInvoices(supabase).then((r) => { if (r.error) throw new Error(r.error.message); return (r.data ?? []) as ContractorInvoiceRow[]; }),
      // Step 6 — the Materials block: every document a person hasn't settled (and the set-aside ones, for Restore).
      fetchAllRows<IntakeDb>((f, t) => supabase.from("cost_intake")
        .select("id, status, confirmed_at, resulting_id, created_at, raw_doc_path, from_email, extract_status, proposed_wo_id, proposed_vendor_id, duplicate_of, extracted")
        .in("status", ["pending", "duplicate", "rejected"]).order("created_at", { ascending: false }).order("id").range(f, t)),
      // Employee labour is a wage, not a payable (fix/payables-no-employee-labour) — never in the Materials block.
      fetchAllRows<JobCostDb>((f, t) => supabase.from("job_costs")
        .select("id, work_order_id, vendor_id, category, status, amount_ex_cents, gst_cents, doc_path, invoice_no, invoice_date, intake_id, paid_at, created_at")
        .neq("category", "labour").order("created_at", { ascending: false }).order("id").range(f, t)),
      // "Invoice opened N times" on the row — customer opens only (staff previews never write one).
      fetchAllRows<ViewRow>((f, t) => supabase.from("invoice_events").select("invoice_id").eq("type", "viewed").order("id").range(f, t)),
      // "Last messaged" (§4.4): staff lines on each job's chat — the thread Payments → Message posts to.
      fetchAllRows<ChatRow>((f, t) => supabase.from("estimate_messages").select("estimate_id, created_at").eq("direction", "staff").order("id").range(f, t)),
      // Vendor memory (one supplier, one name) and who sells materials.
      fetchAllRows<VendorDb>((f, t) => supabase.from("vendors").select("id, name, sender_domains, default_category").order("id").range(f, t)),
      fetchAllRows<MaterialCostDb>((f, t) => supabase.from("material_costs").select("id, work_order_id, supplier, amount_cents, intake_id, overhead").order("id").range(f, t)),
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
        workOrderId: wo?.id ?? null,
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
        contractorInvoices: cis.map((c) => ({
          id: c.id, number: c.number, status: c.status, totalIncCents: c.total_inc_cents, dueOn: c.due_on,
          autoDraftSource: c.auto_draft_source, claimPct: c.claim_pct, rcti: c.rcti, submittedAt: c.submitted_at, termsKind: c.terms_kind ?? null, termsHoldReason: c.terms_hold_reason ?? null,
          contractor: c.contractors?.company_name ?? "Contractor", contractorId: c.contractor_id ?? null,
          workOrderId: c.work_order_id ?? null, woRef: c.work_orders?.wo_ref ?? null, estimateId: c.work_orders?.estimate_id ?? null,
          address: c.work_orders?.job_address ?? null, woStage: (c.work_orders?.stage ?? null) as WoStage | null, hasPdf: !!c.invoice_pdf_path,
        })),
        materials: {
          vendors: vendors.map((v) => ({ id: v.id, name: v.name, senderDomains: v.sender_domains ?? [], defaultCategory: v.default_category })),
          intake: intake.map((r) => {
            const total = r.extracted?.total_cents;
            return {
              id: r.id, status: r.status, confirmedAt: r.confirmed_at, resultingId: r.resulting_id, createdAt: r.created_at, docPath: r.raw_doc_path,
              fromEmail: r.from_email, extractStatus: r.extract_status, supplier: r.extracted?.supplier ?? null, invoiceNo: r.extracted?.invoice_no || null,
              invoiceDate: r.extracted?.invoice_date || null, totalCents: total === undefined || total === null || total === "" ? null : Number(total),
              orderRef: r.extracted?.order_ref || null, addressText: r.extracted?.address_text || null,
              proposedWoId: r.proposed_wo_id, proposedVendorId: r.proposed_vendor_id, duplicateOf: r.duplicate_of,
            };
          }),
          costs: jobCosts.map((c) => ({
            id: c.id, workOrderId: c.work_order_id, vendorId: c.vendor_id, category: c.category, status: c.status,
            amountExCents: c.amount_ex_cents, gstCents: c.gst_cents, docPath: c.doc_path, invoiceNo: c.invoice_no,
            invoiceDate: c.invoice_date, intakeId: c.intake_id, paidAt: c.paid_at, createdAt: c.created_at,
          })),
          materialCosts: materialCosts.map((m) => ({ id: m.id, workOrderId: m.work_order_id, supplier: m.supplier, amountCents: m.amount_cents, intakeId: m.intake_id, overhead: m.overhead })),
        },
        now,
      },
    };
  } catch (e: unknown) {
    reportError(e, { where: "loadJobMoneyInput" });
    return { input: null, failure: loadFailure({ message: e instanceof Error ? e.message : String(e) }) };
  }
}
