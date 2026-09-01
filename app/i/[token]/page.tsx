import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { stripeConfigured } from "@/lib/invoicing/stripe";
import { surchargeCents, surchargeFromSettings } from "@/lib/invoicing/surcharge";
import PayPanel from "./PayPanel";
import Toolbar from "./Toolbar";
import InvoiceSheet, { KIND_HEADING } from "./InvoiceSheet";
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




export default async function CustomerInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ print?: string; preview?: string; pay?: string; portal?: string }>;
}) {
  const { token } = await params;
  const { print, pay, portal } = await searchParams;
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

  // Card payments (§5): the surcharge is server-computed and DISCLOSED here,
  // before any checkout. No Stripe key configured → bank transfer only.
  const stripeOn = stripeConfigured() && open && balance > 0 && !printMode;
  let cardSurchargeCents = 0;
  if (stripeOn) {
    const service = createServiceClient();
    const { data: invSetting } = service
      ? await service.from("settings").select("value").eq("key", "invoicing").maybeSingle()
      : { data: null };
    const { pctBps, fixedCents } = surchargeFromSettings(invSetting?.value as Record<string, unknown> | null);
    cardSurchargeCents = surchargeCents(balance, pctBps, fixedCents);
  }
  const payState = pay === "success" ? "success" : pay === "cancelled" ? "cancelled" : null;


  return (
    <div className={`invoice-view ${printMode ? "print-mode" : ""}`}>
      {!printMode && (
        <div className="chrome">
          {/* ?portal=1: reached from the customer's dashboard — the way back
              (Tom, 1 Sep; the /e page's pattern). */}
          {portal === "1" && <a href="/account" data-testid="back-to-account">← My account</a>}
          <span className="who">{entity.tradingName || "Paint Group"}</span>
          <span>· {KIND_HEADING[doc.kind] ?? "Invoice"} {doc.number}</span>
          <span className="spacer" />
          {pdfUrl && <a href={pdfUrl} target="_blank" rel="noreferrer">Download PDF</a>}
          <Toolbar />
        </div>
      )}

      <div className="sheet-wrap">
        <InvoiceSheet
          doc={doc}
          entity={entity}
          bank={bank}
          printMode={printMode}
          payPanel={(stripeOn || payState === "success") && !printMode ? (
            <PayPanel
              token={token}
              balanceCents={balance}
              surchargeCents={cardSurchargeCents}
              payState={payState}
              initialPaidCents={doc.paid_cents}
            />
          ) : null}
        />
      </div>
    </div>
  );
}
