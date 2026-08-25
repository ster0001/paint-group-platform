import type { ReactNode } from "react";

/**
 * THE invoice document — the white A4 tax-invoice sheet. One component for
 * every surface that shows it: the customer token page /i/[token] (whose
 * Chromium print IS the PDF), and the revision builder's INVOICE tab, which
 * feeds it live from the working scope. Shared component, never forked
 * (CLAUDE.md) — the screen, the paper, the file and the preview can only
 * agree because they are the same markup.
 */

export type SheetLine = {
  description: string;
  amount_ex_cents: number;
  source: "estimate_snapshot" | "variation" | "manual" | "adjustment";
  qty: number | null;
  approved_on: string | null;
};

export type SheetPayment = {
  amount_cents: number;
  surcharge_cents: number;
  method: string | null;
  paid_on: string | null;
  receipt_number: string | null;
};

export type SheetDoc = {
  number: string | null;
  kind: string;
  status: string;
  issued_on: string | null;
  due_on: string | null;
  subtotal_ex_cents: number;
  gst_cents: number;
  total_inc_cents: number;
  billed_to: string;
  job_address: string;
  job_title: string;
  lines: SheetLine[];
  payments: SheetPayment[];
  paid_cents: number;
  adjusted_contract_cents: number | null;
  previously_invoiced_cents: number | null;
  previous_numbers: string | null;
};

const money = (cents: number) =>
  "$" + (cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const longDay = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
        .format(new Date(iso + "T00:00:00Z"))
    : "—";

const shortDay = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: "UTC" })
        .format(new Date(iso + "T00:00:00Z"))
    : "";

export const KIND_HEADING: Record<string, string> = {
  deposit: "Deposit",
  progress: "Payment request", // Tom, 25 Aug: customer-facing wording
  final: "Final invoice",
  variation: "Variation",
  standalone: "Invoice",
};

export default function InvoiceSheet({
  doc, entity, bank, printMode = false, payPanel = null, extraNote = null,
}: {
  doc: SheetDoc;
  entity: Record<string, string>;
  bank: Record<string, string>;
  printMode?: boolean;
  /** The card-payment panel, when the token page has one to offer. */
  payPanel?: ReactNode;
  /** An extra status line (e.g. the revision preview's live-figures note). */
  extraNote?: ReactNode;
}) {
  const balance = doc.total_inc_cents - doc.paid_cents;
  const open = ["issued", "sent", "viewed", "partially_paid"].includes(doc.status);
  const isFinal = doc.kind === "final";
  const contractLines = doc.lines.filter((l) => l.source === "estimate_snapshot");
  const variationLines = doc.lines.filter((l) => l.source === "variation");
  const otherLines = doc.lines.filter(
    (l) => (l.source === "manual" || l.source === "adjustment")
      && !l.description.startsWith("Less previously invoiced"),
  );

  const line = (l: SheetLine, i: number) => {
    const [title, ...rest] = l.description.split(" — ");
    return (
      <tr key={i}>
        <td>
          <div className="t">{title}</div>
          {rest.length > 0 && <div className="d">{rest.join(" — ")}</div>}
          {l.approved_on && <div className="appr">✓ Approved {shortDay(l.approved_on)}</div>}
        </td>
        <td className="r">{l.amount_ex_cents < 0 ? "−" + money(-l.amount_ex_cents) : money(l.amount_ex_cents)}</td>
      </tr>
    );
  };

  return (
    <div className="sheet" data-testid="invoice-sheet">
      <div className="top">
        <div>
          <div className="wordmark">PAINT<span>GROUP</span></div>
          <div className="tagline">{entity.brandSub || "Painting · Plastering · Restoration"}</div>
          <div className="entity">
            {entity.address}<br />
            ABN {entity.abn}
            {entity.legalLine ? <><br />{entity.legalLine}</> : null}
          </div>
        </div>
        <div className="doctype">
          <h1>TAX INVOICE</h1>
          <div className="num mono" data-testid="invoice-number">{doc.number ?? "DRAFT"}</div>
          <div className="dates">
            {doc.issued_on ? <>Issued <b>{longDay(doc.issued_on)}</b><br /></> : null}
            {open && <>Due <b>{longDay(doc.due_on)}</b></>}
          </div>
        </div>
      </div>

      <div className="parties">
        <div>
          <div className="k">Invoice to</div>
          <div className="v">{doc.billed_to || "—"}<small>{doc.job_address}</small></div>
        </div>
        <div>
          <div className="k">For</div>
          <div className="v">{doc.job_title || "Painting works"}<small>{KIND_HEADING[doc.kind] ?? "Invoice"}</small></div>
        </div>
      </div>

      {doc.status === "draft" && (
        <div className="status-note overdue">Draft preview — this invoice has not been issued yet. The number and dates are allocated at issue.</div>
      )}
      {extraNote}
      {doc.status === "paid" && (
        <div className="status-note paid">Paid in full — thank you. A receipt has been issued for each payment below.</div>
      )}
      {(doc.status === "void" || doc.status === "written_off") && (
        <div className="status-note void">This invoice has been cancelled and is no longer payable. If you were expecting an invoice, please contact us.</div>
      )}

      <table className="lines">
        <thead>
          <tr><th>Description</th><th className="r">Amount (ex GST)</th></tr>
        </thead>
        <tbody>
          {contractLines.length > 0 && variationLines.length + otherLines.length > 0 && (
            <tr className="group-h"><td colSpan={2}>Contract works — from your accepted estimate</td></tr>
          )}
          {contractLines.map(line)}
          {variationLines.length > 0 && (
            <tr className="group-h"><td colSpan={2}>Variations — approved during the job</td></tr>
          )}
          {variationLines.map(line)}
          {otherLines.length > 0 && contractLines.length + variationLines.length > 0 && (
            <tr className="group-h"><td colSpan={2}>This invoice</td></tr>
          )}
          {otherLines.map(line)}
        </tbody>
      </table>

      <div className="bottom">
        {(open || doc.status === "draft") && balance > 0 && (
          <div className="paybox">
            <h3>How to pay — bank transfer</h3>
            <div className="row"><span>Account name</span><b>{bank.accountName}</b></div>
            <div className="row"><span>Bank</span><b>{bank.bank}</b></div>
            {bank.bsb && <div className="row"><span>BSB</span><b>{bank.bsb}</b></div>}
            {bank.acc && <div className="row"><span>Account</span><b>{bank.acc}</b></div>}
            <div className="ref">Please use <b>{doc.number ?? "your invoice number"}</b> as the payment reference.</div>
          </div>
        )}
        {payPanel}
        <div className="totals">
          {isFinal && doc.adjusted_contract_cents != null && (
            <>
              <div className="trow"><span>Contract total (incl. variations)</span><b>{money(Number(doc.adjusted_contract_cents))}</b></div>
              {Number(doc.previously_invoiced_cents ?? 0) > 0 && (
                <div className="trow">
                  <span>Less previously invoiced{doc.previous_numbers ? ` — ${doc.previous_numbers}` : ""}</span>
                  <b>−{money(Number(doc.previously_invoiced_cents))}</b>
                </div>
              )}
            </>
          )}
          <div className="trow"><span>Subtotal (ex GST)</span><b>{money(doc.subtotal_ex_cents)}</b></div>
          <div className="trow"><span>GST</span><b data-testid="gst-amount">{money(doc.gst_cents)}</b></div>
          <div className="trow big"><span>Total (inc GST)</span><b data-testid="total-inc">{money(doc.total_inc_cents)}</b></div>
          {doc.paid_cents > 0 && (
            <>
              <div className="trow received"><span>Received</span><b>−{money(doc.paid_cents)}</b></div>
              <div className="trow big due"><span>Balance due</span><b>{money(Math.max(balance, 0))}</b></div>
            </>
          )}
        </div>
      </div>

      {doc.payments.length > 0 && (
        <div className="terms">
          {doc.payments.map((p, i) => (
            <div key={i}>
              Payment received {longDay(p.paid_on)} — {money(p.amount_cents)}
              {p.receipt_number ? ` (receipt ${p.receipt_number})` : ""}.
            </div>
          ))}
        </div>
      )}

      {open && balance > 0 && (
        <div className="terms">
          Payment is due by <strong>{longDay(doc.due_on)}</strong>. If anything on this
          invoice needs discussing, please reply to the email it arrived with or call us —
          we are happy to help.
        </div>
      )}

      <div className="foot">
        <span>{entity.tradingName || "Paint Group"} · ABN {entity.abn}</span>
        <span className="mono">{doc.number}</span>
      </div>
    </div>
  );
}
