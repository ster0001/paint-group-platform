import Link from "next/link";
import { requireContractor } from "@/lib/contractor/session";
import { missingProfileFields } from "@/lib/contractor/model";
import { createClient } from "@/lib/supabase/server";

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

  const { data: rows } = await supabase
    .from("contractor_invoices")
    .select("id, number, status, total_inc_cents, due_on, created_at, work_orders(wo_ref, wo_snapshot)")
    .order("created_at", { ascending: false })
    .limit(50);
  const invoices = ((rows ?? []) as unknown as {
    id: string; number: string | null; status: string; total_inc_cents: number;
    due_on: string | null; created_at: string;
    work_orders: { wo_ref: string; wo_snapshot: { jobTitle?: string; jobAddress?: string } | null } | null;
  }[]);

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

      {invoices.map((ci) => {
        const chip = CHIP[ci.status] ?? { cls: "amb", label: ci.status };
        const title = ci.work_orders?.wo_snapshot?.jobTitle
          || ci.work_orders?.wo_snapshot?.jobAddress
          || ci.work_orders?.wo_ref || "Job";
        return (
          <Link
            key={ci.id}
            href={`/portal/money/${ci.id}`}
            className="card"
            style={{ display: "block", textDecoration: "none", color: "inherit" }}
            data-testid={`ci-${ci.id}`}
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
              {" · "}{ci.work_orders?.wo_ref}
              {ci.due_on ? ` · payment due ${new Date(ci.due_on + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short" })}` : ""}
            </div>
          </Link>
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
