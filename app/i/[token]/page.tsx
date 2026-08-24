import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { fromIncTotal } from "@/lib/invoicing/gst";
import Toolbar from "./Toolbar";
import "./invoice.css";

export const dynamic = "force-dynamic";

/**
 * The customer's invoice — token-only, the estimate-token pattern: one token
 * resolves ONE invoice's customer-safe payload through a security-definer
 * RPC, an unknown token is a plain 404, and the anon key never gets a table
 * path. The PDF at issue is a Chromium print of THIS page (?print=1), so the
 * screen, the paper and the file can never disagree.
 *
 * View tracking: a real customer visit records `viewed` (and moves
 * sent → viewed). Staff previews and the PDF printer are not customers —
 * they are recognised and skipped.
 */

type TokenLine = {
  description: string;
  amount_ex_cents: number;
  source: "estimate_snapshot" | "variation" | "manual" | "adjustment";
  qty: number | null;
  approved_on: string | null;
};

type TokenPayment = {
  amount_cents: number;
  surcharge_cents: number;
  method: string | null;
  paid_on: string | null;
  receipt_number: string | null;
};

export type TokenPayload = {
  number: string | null;
  kind: string;
  status: string;
  issued_on: string | null;
  due_on: string | null;
  subtotal_ex_cents: number;
  gst_cents: number;
  total_inc_cents: number;
  has_pdf: boolean;
  billed_to: string;
  job_address: string;
  job_title: string;
  lines: TokenLine[];
  payments: TokenPayment[];
  paid_cents: number;
  adjusted_contract_cents: number | null;
  previously_invoiced_cents: number | null;
  previous_numbers: string | null;
  entity: Record<string, string> | null;
  bank: Record<string, string> | null;
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

const KIND_HEADING: Record<string, string> = {
  deposit: "Deposit",
  progress: "Progress claim",
  final: "Final invoice",
  variation: "Variation",
  standalone: "Invoice",
};

export default async function CustomerInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ print?: string; preview?: string }>;
}) {
  const { token } = await params;
  const { print } = await searchParams;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("invoice_by_token", { p_token: token });
  if (error || !data) notFound();
  const doc = data as TokenPayload;

  // Who is looking? Staff previews and the PDF printer never count as views.
  const { data: { user } } = await supabase.auth.getUser();
  let isStaff = false;
  if (user) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    isStaff = (profile as { role?: string } | null)?.role === "staff";
  }
  const printMode = print === "1";
  if (!isStaff && !printMode) {
    await supabase.rpc("invoice_mark_viewed", { p_token: token });
  }

  // The PDF download link, when the file exists (signed server-side — the
  // bucket is private and the browser never sees a storage credential).
  let pdfUrl: string | null = null;
  if (doc.has_pdf && !printMode) {
    const service = createServiceClient();
    if (service) {
      const { data: inv } = await service.from("invoices").select("pdf_path").eq("token", token).maybeSingle();
      const path = (inv as { pdf_path: string | null } | null)?.pdf_path;
      if (path) {
        const { data: signed } = await service.storage.from("invoice-docs").createSignedUrl(path, 600);
        pdfUrl = signed?.signedUrl ?? null;
      }
    }
  }

  const entity = doc.entity ?? {};
  const bank = doc.bank ?? {};
  const balance = doc.total_inc_cents - doc.paid_cents;
  const open = ["issued", "sent", "viewed", "partially_paid"].includes(doc.status);
  const isFinal = doc.kind === "final";
  const contractLines = doc.lines.filter((l) => l.source === "estimate_snapshot");
  const variationLines = doc.lines.filter((l) => l.source === "variation");
  const otherLines = doc.lines.filter((l) => l.source === "manual" || l.source === "adjustment");
  const surchargeGst = doc.payments.reduce(
    (a, p) => a + (p.surcharge_cents > 0 ? fromIncTotal(p.surcharge_cents).gstCents : 0), 0);
  void surchargeGst;

  const line = (l: TokenLine, i: number) => {
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
    <div className={`invoice-view ${printMode ? "print-mode" : ""}`}>
      {!printMode && (
        <div className="chrome">
          <span className="who">{entity.tradingName || "Paint Group"}</span>
          <span>· {KIND_HEADING[doc.kind] ?? "Invoice"} {doc.number}</span>
          <span className="spacer" />
          {pdfUrl && <a href={pdfUrl} target="_blank" rel="noreferrer">Download PDF</a>}
          <Toolbar />
        </div>
      )}

      <div className="sheet-wrap">
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
      </div>
    </div>
  );
}
