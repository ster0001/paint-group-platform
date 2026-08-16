import Link from "next/link";
import { requireContractor } from "@/lib/contractor/session";
import { missingProfileFields } from "@/lib/contractor/model";

export const dynamic = "force-dynamic";

export default async function MoneyPage() {
  const { contractor } = await requireContractor();
  const missing = missingProfileFields(contractor);

  return (
    <div className="wrap">
      <h1>Money</h1>
      <p className="slab">Invoice Paint Group directly from here</p>

      {/* Invoicing needs the company profile finished, so the state of that is the
          one useful thing this tab can show today. */}
      <div className={`card ${missing.length ? "amberish" : "greenish"}`}>
        <span className={`chip ${missing.length ? "amb" : "grn"}`}>
          {missing.length ? "Not ready to invoice" : "Ready to invoice"}
        </span>
        <div style={{ marginTop: 10, fontSize: "12.5px", color: "var(--muted)" }}>
          {missing.length
            ? `Your tax invoices are generated from your own company details. Still missing ${missing.join(", ")}.`
            : "Your company details are complete — invoices will carry your own branding, ABN and bank details."}
        </div>
        <Link href="/portal/profile" className={`btn ${missing.length ? "cy" : "gh"}`}>
          {missing.length ? "Finish my company profile" : "Review my company profile"}
        </Link>
      </div>

      <div className="empty">
        <i aria-hidden>$</i>
        <b>No invoices yet</b>
        Once you complete a job, raise your tax invoice here — deposit and final
        against agreed payment terms, plus any approved variations and expenses.
        You&rsquo;ll watch it move through submitted → approved → paid.
        <div>
          <span className="soon">Arrives with invoicing</span>
        </div>
      </div>
    </div>
  );
}
