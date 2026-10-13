import Link from "next/link";
import { totalMatCents, type MaterialsView as MaterialsRows, type MatRow } from "@/lib/invoicing/materials";
import { MatBulkButton, MatButtons, SnapReceiptButton, SupplierPaidButton, type MatSpec } from "./ActionsClient";
import { money, plural, shortDate } from "./labels";

/**
 * The Materials block (§4.6, Step 6), built to the mockup's matHTML / matRow.
 * Every list and total is lib/invoicing/materials.ts; this file words it.
 * Delete keeps the row and its document (Deleted, collapsed, with Restore).
 */

const spec = (r: MatRow): MatSpec => ({
  kind: r.kind, id: r.id, state: r.state, supplier: r.supplier, invoiceNo: r.invoiceNo,
  invoiceDate: r.invoiceDate ? shortDate(r.invoiceDate) : null, reference: r.reference,
  jobAddress: r.job?.address ?? null, amountLabel: money(r.amountCents), unread: r.unread, hasDoc: !!r.docPath,
});
const LABEL: Record<MatRow["state"], string> = { check: "to check", dup: "", rec: "to approve", appr: "approved, to pay", paid: "paid", del: "deleted" };

function Row({ r }: { r: MatRow }) {
  if (r.state === "dup") {
    return (
      <div className="prow mat" data-mat={r.key}>
        <div className="p1"><b>{r.supplier}</b><small>Possible duplicate</small></div>
        <div className="p2">Looks like an invoice already recorded. No cost was written.</div>
        <div className="p3" />
        <div className="p4"><MatButtons row={spec(r)} /></div>
      </div>
    );
  }
  const where = r.overhead ? "Not for a job (overhead)"
    : r.job ? <Link className="jl" href={`/invoicing/job/${r.job.estimateId}?from=${encodeURIComponent("/invoicing/payments?tab=mat")}`}>{r.job.address}</Link>
    : <span className="hot">No job found</span>;
  const ref = r.reference ? <small>Supplier wrote <q>{r.reference}</q></small> : r.kind === "intake" && r.state === "check" ? <small>No reference on the invoice</small> : null;
  const owe = r.state === "paid" || r.state === "del"
    ? <span className="paidamt" style={r.state === "del" ? { color: "var(--mute)", textDecoration: "line-through" } : undefined}>{money(r.amountCents)}</span>
    : <span className={`owe ${r.state === "check" ? (r.job ? "sent" : "uninv") : r.state === "rec" ? "draft" : "need"}`}>{r.unread ? "Not read" : money(r.amountCents)}</span>;
  return (
    <div className={`prow mat${r.state === "del" ? " gone" : ""}`} data-mat={r.key}>
      <div className="p1"><b>{r.supplier}</b><small>{r.invoiceNo || "No invoice number"}{r.invoiceDate ? ` · ${shortDate(r.invoiceDate)}` : ""}</small></div>
      <div className="p2">{where}{ref}</div>
      <div className="p3">{owe}<small>{LABEL[r.state]}</small></div>
      <div className="p4"><MatButtons row={spec(r)} /></div>
    </div>
  );
}

function Head({ title, rows, button }: { title: string; rows: MatRow[]; button?: React.ReactNode }) {
  const counted = rows.filter((r) => r.state !== "dup");
  return <div className="sec-h"><h2>{title}</h2><span className="tot">{button}<small style={{ marginLeft: 10 }}>{plural(counted.length, "invoice")}</small>{money(totalMatCents(counted))}</span></div>;
}

export function MaterialsView({ m }: { m: MaterialsRows }) {
  const found = m.toCheck.filter((r) => r.state === "check" && r.job && !r.unread);
  const nothingOpen = !m.toCheck.length && !m.toApprove.length && !m.toPay.length;
  return (
    <>
      <div className="suprow" data-testid="pm-suppliers">
        {m.supplierTotals.map((s) => <span key={s.supplier}>{s.supplier}<b>{money(s.openCents)}</b></span>)}
        <span style={{ color: "var(--mute)" }}>{m.supplierTotals.length ? "open with each supplier" : "Nothing open with any supplier"}</span>
        <SnapReceiptButton />
      </div>

      {m.toCheck.length ? (
        <section className="sec">
          <Head title="To check" rows={m.toCheck}
            button={found.length > 1 ? <MatBulkButton kind="confirm" ids={found.map((r) => r.id)} label={`Confirm the ${found.length} with a job found`} line={`${plural(found.length, "invoice")} confirmed to their jobs, ${money(totalMatCents(found))}.`} /> : null} />
          <p className="sec-note">Arrived at bills@ or snapped as a receipt. Where the address was found the job is suggested, so one press confirms it. The rest need a job picked, marked as not for a job, or deleted if they are not relevant. View opens the original document.</p>
          {m.toCheck.map((r) => <Row key={r.key} r={r} />)}
        </section>
      ) : null}

      {m.toApprove.length ? (
        <section className="sec">
          <Head title="On a job, to approve" rows={m.toApprove}
            button={m.toApprove.length > 1 ? <MatBulkButton kind="approve" ids={m.toApprove.map((r) => r.id)} label={`Approve all ${m.toApprove.length}`} line={`${plural(m.toApprove.length, "invoice")} approved, ${money(totalMatCents(m.toApprove))}.`} /> : null} />
          {m.toApprove.map((r) => <Row key={r.key} r={r} />)}
        </section>
      ) : null}

      {m.toPay.length ? (
        <section className="sec">
          <Head title="Approved, to pay" rows={m.toPay.flatMap((g) => g.rows)} />
          <p className="sec-note">Grouped by supplier so one bank payment clears one line.</p>
          {m.toPay.map((g) => (
            <div className="prow grp" key={g.supplier}>
              <div className="p1"><b>{g.supplier}</b><small>{plural(g.rows.length, "invoice")}</small></div>
              <div className="p2"><small>{g.jobs.slice(0, 4).join(" · ")}</small></div>
              <div className="p3"><span className="owe need">{money(g.totalCents)}</span><small>to pay</small></div>
              <div className="p4"><SupplierPaidButton ids={g.rows.map((r) => r.id)} label={`✓ Paid ${money(g.totalCents)}`}
                line={`${g.supplier} marked paid, ${money(g.totalCents)} across ${plural(g.rows.length, "invoice")}.`} /></div>
            </div>
          ))}
        </section>
      ) : null}

      {m.paid.length ? <details className="sec"><summary><Head title="Paid" rows={m.paid} /></summary>{m.paid.slice(0, 50).map((r) => <Row key={r.key} r={r} />)}</details> : null}
      {m.deleted.length ? (
        <details className="sec" data-testid="pm-deleted">
          <summary><Head title="Deleted" rows={m.deleted} /></summary>
          <p className="sec-note">Not counted anywhere. The original document is kept, so anything deleted by mistake can be restored.</p>
          {m.deleted.map((r) => <Row key={r.key} r={r} />)}
        </details>
      ) : null}
      {nothingOpen ? <div className="empty">Every supplier invoice is checked, approved and paid.</div> : null}
    </>
  );
}
