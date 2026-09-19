import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { CustomerSnapshot } from "@/lib/customer/snapshot";
import { ACL_LINE, warrantyClauses, warrantyLimit, warrantyPromise, WARRANTY_TERMS_VERSION } from "@/lib/warranty/terms";
import PrintButton from "@/app/account/(portal)/PrintButton";

export const dynamic = "force-dynamic";

/**
 * The workmanship warranty AS AN ATTACHMENT to one estimate.
 *
 * Tom, 19 Sep 2026: "please have workmanship warranty as an attachment with
 * this information, rather than written directly on the estimate." So the
 * estimate carries a card that opens this document — the same shape as the
 * SWMS attachment beside it — and the quote itself stays a quote.
 *
 * Token-scoped, not a global /warranty page, for two reasons: the warrantor's
 * details come from the SNAPSHOT, so an estimate sent months ago shows the
 * details it was sent with; and an unknown token 404s here exactly as it does
 * on the estimate. The words come from lib/warranty/terms.ts — the customer's
 * portal renders the same source.
 */
export default async function WarrantyAttachmentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_estimate_by_token", { p_token: token });
  const row = (Array.isArray(data) ? data[0] : data) as { snapshot?: CustomerSnapshot } | undefined;
  if (error || !row || !row.snapshot) notFound();
  const snap = row.snapshot as Partial<CustomerSnapshot>;
  if (snap.version !== 1) notFound();

  const c = snap.company!;
  const clauses = warrantyClauses({
    companyName: c.name,
    abn: c.abn,
    address: [c.addressLine1, c.addressLine2].filter(Boolean).join(", "),
    phone: c.phone,
    email: c.email,
  });

  return (
    <div className="docpage" data-testid="warranty-attachment">
      <div className="btn-row print-hide">
        <a className="btn btn-ghost" href={`/e/${token}`}>← Back to your estimate</a>
        <PrintButton label="Download as PDF" />
      </div>

      <header className="dochead">
        <div className="brandline">{c.name || "Paint Group"}</div>
        <h1>Two-year workmanship warranty</h1>
        <p className="docmeta">
          Attached to {snap.estRef ? `estimate ${snap.estRef}` : "your estimate"}
          {snap.jobAddress ? ` · ${snap.jobAddress}` : ""} · terms version {WARRANTY_TERMS_VERSION}
        </p>
      </header>

      <p className="docintro">{warrantyPromise()}</p>
      <p className="docintro">{warrantyLimit()}</p>

      <div data-testid="warranty-terms">
        {clauses.map((cl) => (
          <div className="wclause" key={cl.n}>
            <h2>{cl.n} · {cl.heading}</h2>
            <p>{cl.body}</p>
          </div>
        ))}
      </div>

      <p className="wacl">{ACL_LINE}</p>

      <div className="btn-row print-hide">
        <a className="btn btn-ghost" href={`/e/${token}`}>← Back to your estimate</a>
        <PrintButton label="Download as PDF" />
      </div>
    </div>
  );
}
