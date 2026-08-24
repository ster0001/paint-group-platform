import Link from "next/link";
import { requireContractor } from "@/lib/contractor/session";
import { missingProfileFields } from "@/lib/contractor/model";
import { createClient } from "@/lib/supabase/server";
import { contractorVariationsCents, type PayVariation } from "@/lib/workorder/contractorPay";
import RequestClaim, { type ClaimableJob } from "./RequestClaim";

export const dynamic = "force-dynamic";

const money = (c: number) =>
  "$" + (c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CHIP: Record<string, { cls: string; label: string }> = {
  draft: { cls: "amb", label: "Ready to submit" },
  submitted: { cls: "amb", label: "With the office" },
  approved: { cls: "cyn", label: "Approved — payment coming" },
  paid: { cls: "grn", label: "Paid" },
};

/**
 * The contractor's invoices (Step 5). Every row here was DRAFTED BY THE
 * PLATFORM at sign-off — offer + accepted variations − deductions — and the
 * contractor checks and submits it, rather than typing an invoice from
 * scratch. RLS scopes the list to their own rows.
 */
export default async function MoneyPage() {
  const { contractor } = await requireContractor();
  const missing = missingProfileFields(contractor);
  const supabase = await createClient();

  const [{ data: rows }, { data: woRows }] = await Promise.all([
    supabase
      .from("contractor_invoices")
      .select("id, number, status, total_inc_cents, due_on, created_at, auto_draft_source, claim_pct, work_orders(wo_ref, wo_snapshot)")
      .order("created_at", { ascending: false })
      .limit(50),
    // Their own jobs (RLS-scoped) — what a claim can be raised against.
    supabase
      .from("work_orders")
      .select("id, wo_ref, stage, contractor_payment_cents, wo_snapshot")
      .not("stage", "eq", "closed")
      .order("start_date", { ascending: true }),
  ]);
  const invoices = ((rows ?? []) as unknown as {
    id: string; number: string | null; status: string; total_inc_cents: number;
    due_on: string | null; created_at: string; auto_draft_source: string; claim_pct: number | null;
    work_orders: { wo_ref: string; wo_snapshot: { jobTitle?: string; jobAddress?: string } | null } | null;
  }[]);

  // Adjusted pay per job (the one rule, lib/workorder/contractorPay) minus
  // what's already invoiced — display only; the RPC recomputes and bounds.
  const wos = ((woRows ?? []) as {
    id: string; wo_ref: string; stage: string; contractor_payment_cents: number | null;
    wo_snapshot: { jobTitle?: string; jobAddress?: string } | null;
  }[]).filter((w) => ["pre_start", "in_progress", "completion_prep", "qa", "walkthrough"].includes(w.stage));
  const woIds = wos.map((w) => w.id);
  const [{ data: varRows }, { data: ciTotals }] = await Promise.all([
    woIds.length
      ? supabase.from("wo_variations")
          .select("work_order_id, status, credit, contractor_delta_cents, deduction_cents, needs_manual_deduction")
          .in("work_order_id", woIds)
      : Promise.resolve({ data: [] }),
    woIds.length
      ? supabase.from("contractor_invoices")
          .select("work_order_id, status, total_inc_cents")
          .in("work_order_id", woIds).neq("status", "draft")
      : Promise.resolve({ data: [] }),
  ]);
  const varsByWo = new Map<string, PayVariation[]>();
  for (const v of ((varRows ?? []) as (PayVariation & { work_order_id: string })[])) {
    (varsByWo.get(v.work_order_id) ?? varsByWo.set(v.work_order_id, []).get(v.work_order_id)!).push(v);
  }
  const claimJobs: ClaimableJob[] = wos.map((w) => {
    const vars = varsByWo.get(w.id) ?? [];
    return {
      workOrderId: w.id,
      woRef: w.wo_ref,
      title: w.wo_snapshot?.jobTitle || w.wo_snapshot?.jobAddress || w.wo_ref,
      adjustedCents: Math.max(0, (w.contractor_payment_cents ?? 0) + contractorVariationsCents(vars)),
      invoicedCents: ((ciTotals ?? []) as { work_order_id: string; total_inc_cents: number }[])
        .filter((c) => c.work_order_id === w.id)
        .reduce((s, c) => s + c.total_inc_cents, 0),
      deductionPending: vars.some((v) => v.credit && v.needs_manual_deduction && v.deduction_cents == null),
    };
  });

  return (
    <div className="wrap">
      <h1>Money</h1>
      <p className="slab">Your invoices to Paint Group — drafted for you at sign-off</p>

      {missing.length > 0 && (
        <div className="card amberish">
          <span className="chip amb">Not ready to invoice</span>
          <div style={{ marginTop: 10, fontSize: "12.5px", color: "var(--muted)" }}>
            Your invoices carry your own company details. Still missing {missing.join(", ")} —
            submitting is held until they&rsquo;re in.
          </div>
          <Link href="/portal/profile" className="btn cy">Finish my company profile</Link>
        </div>
      )}

      {missing.length === 0 && <RequestClaim jobs={claimJobs} />}

      {invoices.map((ci) => {
        const chip = CHIP[ci.status] ?? { cls: "amb", label: ci.status };
        const title = ci.work_orders?.wo_snapshot?.jobTitle
          || ci.work_orders?.wo_snapshot?.jobAddress
          || ci.work_orders?.wo_ref || "Job";
        return (
          <div key={ci.id} className="card" data-testid={`ci-${ci.id}`}>
            <Link
              href={`/portal/money/${ci.id}`}
              style={{ display: "block", textDecoration: "none", color: "inherit" }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <b>{title}</b>
                <span className={`chip ${chip.cls}`}>{chip.label}</span>
                <b style={{ marginLeft: "auto", fontFamily: "var(--mono, monospace)" }}>
                  {money(ci.total_inc_cents)}
                </b>
              </div>
              <div style={{ marginTop: 6, fontSize: "12px", color: "var(--muted)" }}>
                {ci.number ?? "Draft — no number until you submit"}
                {ci.auto_draft_source === "claim"
                  ? ` · payment claim${ci.claim_pct ? ` (${Number(ci.claim_pct)}%)` : ""}`
                  : ""}
                {" · "}{ci.work_orders?.wo_ref}
                {ci.due_on ? ` · payment due ${new Date(ci.due_on + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short" })}` : ""}
              </div>
            </Link>
            {ci.status !== "draft" && (
              <a className="btn gh" href={`/portal/money/${ci.id}/pdf`} target="_blank" rel="noreferrer"
                data-testid={`ci-pdf-${ci.id}`} style={{ marginTop: 8 }}>
                Download invoice PDF
              </a>
            )}
          </div>
        );
      })}

      {invoices.length === 0 && (
        <div className="empty">
          <i aria-hidden>$</i>
          <b>No invoices yet</b>
          When a job signs off, your invoice is drafted here automatically —
          the agreed amount plus any approved variations, minus anything the
          office and you have squared off. Check it, submit it in one tap, and
          watch it move through submitted → approved → paid.
        </div>
      )}
    </div>
  );
}
