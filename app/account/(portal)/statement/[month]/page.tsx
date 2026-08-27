import { redirect, notFound } from "next/navigation";
import { getPortalContext, getPortalMoney } from "@/lib/portal/data";
import { fmtDay, moneyFmt } from "@/lib/portal/money";
import PrintButton from "../../PrintButton";

export const dynamic = "force-dynamic";

const VISIBLE = new Set(["issued", "sent", "viewed", "partially_paid", "paid"]);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * 3a-7 · The monthly statement (§6 W5): every invoice across every property
 * for one month, on paper terms a trust account can file. Print = the PDF
 * (the portal print stylesheet). ⚑5: "14-day terms" is a DISPLAY default —
 * no payment behaviour is invented here.
 */
export default async function StatementPage({
  params,
}: {
  params: Promise<{ month: string }>;
}) {
  const { month } = await params;
  if (!/^\d{4}-\d{2}$/.test(month)) notFound();

  const ctx = await getPortalContext();
  if (!ctx) redirect("/account/login");
  const trade = ctx.accounts.find((a) => a.account_type === "trade");
  if (!trade) redirect("/account/money");

  const { estimates, invoices, payments } = await getPortalMoney(ctx.accounts.map((a) => a.id));
  const titleByEstimate = new Map(estimates.map((e) => [e.id, e.title?.trim() || "Property"]));
  const rows = invoices
    .filter((i) => VISIBLE.has(i.status) && (i.issued_on ?? "").startsWith(month))
    .sort((a, b) => (a.issued_on ?? "").localeCompare(b.issued_on ?? ""));
  const paidFor = (invoiceId: string) =>
    payments.filter((p) => p.invoice_id === invoiceId && p.status === "succeeded").reduce((s, p) => s + p.amount_cents, 0);

  const totalInc = rows.reduce((s, i) => s + i.total_inc_cents, 0);
  const totalGst = rows.reduce((s, i) => s + i.gst_cents, 0);
  const totalPaid = rows.reduce((s, i) => s + paidFor(i.id), 0);
  const monthName = `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

  return (
    <div>
      <div className="greet">{trade.name || "Your account"}</div>
      <h1>Statement — {monthName}</h1>

      <div className="card">
        {rows.length === 0 && <p className="sub">No invoices were issued in {monthName}.</p>}
        {rows.map((i) => (
          <div className="row" key={i.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
            <div style={{ minWidth: 0 }}>
              <div className="note">{i.number ?? "INVOICE"} · {fmtDay(i.issued_on)}</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{titleByEstimate.get(i.estimate_id) ?? "Property"}</div>
              <div className="note">GST {moneyFmt(i.gst_cents)}</div>
            </div>
            <div style={{ textAlign: "right", flex: "none" }}>
              <div className="money" style={{ fontSize: 15 }}>{moneyFmt(i.total_inc_cents)}</div>
              <div style={{ marginTop: 4 }}>
                <span className={`chip ${i.status === "paid" ? "emerald" : "amber"}`}>
                  {i.status === "paid" ? "Paid" : "Outstanding"}
                </span>
              </div>
            </div>
          </div>
        ))}
        {rows.length > 0 && (
          <div style={{ paddingTop: 14 }}>
            <div className="row"><span className="sub">Invoiced, inc GST</span><span className="money">{moneyFmt(totalInc)}</span></div>
            <div className="row" style={{ marginTop: 6 }}><span className="sub">GST included</span><span className="money">{moneyFmt(totalGst)}</span></div>
            <div className="row" style={{ marginTop: 6 }}><span className="sub">Received against these invoices</span><span className="money">{moneyFmt(totalPaid)}</span></div>
          </div>
        )}
      </div>

      <p className="note">All amounts AUD, inclusive of GST · 14-day terms ⚑</p>

      <div className="btn-row">
        <PrintButton label="Download as PDF" />
      </div>
    </div>
  );
}
