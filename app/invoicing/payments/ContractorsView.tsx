import Link from "next/link";
import {
  contractorGroups, totalCiCents, type CiSection, type ContractorRow,
} from "@/lib/invoicing/jobMoney";
import { CiButtons, CiGroupButtons } from "./ActionsClient";
import { STAGE_NAME, money, plural, shortDate } from "./labels";

/**
 * The Contractors block (§4.5, Step 5), built to the mockup's conHTML / conRow.
 * Every figure is a ContractorRow from lib/invoicing/jobMoney.ts; the customer
 * line is the job panel's own paid / contract. Records only — nothing here
 * moves money. Query opens the painter's message thread on the work order.
 */

const jobPanelHref = (r: ContractorRow) => (r.estimateId ? `/invoicing/job/${r.estimateId}?from=${encodeURIComponent("/invoicing/payments?tab=con")}` : null);
const queryHref = (r: ContractorRow) => (r.workOrderId ? `/pc/wo/${r.workOrderId}${r.contractorId ? `?painter=${r.contractorId}` : ""}#messages` : null);

function CustomerLine({ r }: { r: ContractorRow }) {
  if (!r.customerPaid || !r.lane) return <small>Job is not on the Project Progress board</small>;
  const { paidCents, contractCents } = r.customerPaid;
  const said = paidCents >= contractCents && contractCents > 0
    ? <span className="okc">Customer has paid in full</span>
    : paidCents === 0 ? <span className="hot">Customer has paid nothing yet</span>
    : <>Customer has paid {money(paidCents)} of {money(contractCents)}</>;
  return <small>{STAGE_NAME[r.lane]} · {said}</small>;
}

function Owe({ r }: { r: ContractorRow }) {
  if (r.status === "paid") return <><span className="paidamt">{money(r.totalIncCents)}</span><small>paid</small></>;
  const over = r.section === "past_pay_by";
  const cls = over ? "over" : r.status === "approved" ? "need" : r.status === "submitted" ? "sent" : "draft";
  const line = over ? `${plural(r.overdueDays, "day")} past pay-by`
    : r.status === "approved" ? (r.dueOn ? `pay by ${shortDate(r.dueOn)}` : "pay when ready")
    : r.status === "submitted" ? "waiting for your approval" : "with the contractor";
  return <><span className={`owe ${cls}`}>{money(r.totalIncCents)}</span><small>{line}</small></>;
}

function Row({ r }: { r: ContractorRow }) {
  const panel = jobPanelHref(r);
  const query = queryHref(r);
  const pdf = r.hasPdf ? `/invoicing/ci/${r.id}/pdf` : null;
  const no = r.number ?? "this invoice";
  return (
    <div className={`prow${r.section === "past_pay_by" ? " over" : ""}`} data-ci={r.id}>
      <div className="p1"><b>{r.contractor}</b><small>{r.number ?? "Draft, no number yet"}{r.claimNote ? ` · ${r.claimNote}` : r.status === "draft" ? " · drafted at sign-off" : ""}</small></div>
      <div className="p2">{panel ? <Link className="jl" href={panel}>{r.address}</Link> : r.address}<CustomerLine r={r} /></div>
      <div className="p3"><Owe r={r} /></div>
      <div className="p4">
        <CiButtons id={r.id} status={r.status}
          approveLine={`Approved ${no}, ${money(r.totalIncCents)} to ${r.contractor}.${r.dueOn ? ` Pay by ${shortDate(r.dueOn)}.` : ""}`}
          payLine={`Marked ${no} paid, ${money(r.totalIncCents)} to ${r.contractor}. The remittance goes when Undo closes.`}
          payLabel={`✓ Paid ${money(r.totalIncCents)}`} />
        {r.status === "submitted" && query ? <Link className="b" href={query}>Query</Link> : null}
        {pdf && r.status !== "submitted" ? <a className="b" href={pdf} target="_blank" rel="noreferrer">{r.status === "paid" ? "Invoice PDF" : "PDF"}</a> : null}
      </div>
    </div>
  );
}

const TITLE: Record<CiSection, { title: string; note?: string; cls?: string; collapsed?: boolean }> = {
  past_pay_by: { title: "Past the pay-by date", note: "Approved and still unpaid past the agreed terms. Always first.", cls: "red" },
  to_approve: { title: "To approve", note: "Submitted by the contractor. The line under each job shows whether the customer has paid you yet." },
  to_pay: { title: "Approved, to pay", note: "Pay by bank, then press Paid. The remittance goes to the contractor once the Undo has closed." },
  with_contractor: { title: "With the contractor", note: "Drafted at sign-off, waiting for the contractor to submit." },
  paid: { title: "Paid", collapsed: true },
};

function Sec({ section, rows }: { section: CiSection; rows: ContractorRow[] }) {
  if (!rows.length) return null;
  const t = TITLE[section];
  const head = <div className="sec-h"><h2>{t.title}</h2><span className="tot"><small>{plural(rows.length, "invoice")}</small>{money(totalCiCents(rows))}</span></div>;
  const body = <>{t.note ? <p className="sec-note">{t.note}</p> : null}{rows.map((r) => <Row key={r.id} r={r} />)}</>;
  return t.collapsed
    ? <details className="sec"><summary>{head}</summary>{body}</details>
    : <section className={`sec ${t.cls ?? ""}`}>{head}{body}</section>;
}

export function ContractorsView({ rows, by }: { rows: ContractorRow[]; by: "inv" | "con" }) {
  if (by === "con") {
    const groups = contractorGroups(rows);
    return (
      <>
        {groups.length ? groups.map((g) => (
          <section className="sec" key={g.contractor}>
            <div className="prow grp">
              <div className="p1"><b>{g.contractor}</b><small>{plural(g.rows.length, "open invoice")}</small></div>
              <div className="p2"><small>{g.toApproveIds.length} to approve · {g.toPayIds.length} approved to pay</small></div>
              <div className="p3"><span className={`owe ${g.anyPastPayBy ? "over" : "draft"}`}>{money(g.openCents)}</span></div>
              <div className="p4">
                <CiGroupButtons approveIds={g.toApproveIds} payIds={g.toPayIds}
                  approveLine={`Approved ${plural(g.toApproveIds.length, "invoice")} from ${g.contractor}.`}
                  payLine={`Marked ${plural(g.toPayIds.length, "invoice")} paid to ${g.contractor}, ${money(g.toPayCents)}. Remittances go when Undo closes.`}
                  payLabel={`✓ Paid ${money(g.toPayCents)}`} />
              </div>
            </div>
            {g.rows.map((r) => <Row key={r.id} r={r} />)}
          </section>
        )) : <div className="empty">No open contractor invoices.</div>}
        <Sec section="paid" rows={rows.filter((r) => r.section === "paid")} />
      </>
    );
  }
  const any = rows.length > 0;
  return (
    <>
      {(["past_pay_by", "to_approve", "to_pay", "with_contractor", "paid"] as CiSection[]).map((s) => (
        <Sec key={s} section={s} rows={rows.filter((r) => r.section === s)} />
      ))}
      {!any ? <div className="empty">Nothing matches.</div> : null}
    </>
  );
}
