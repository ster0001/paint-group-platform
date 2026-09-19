import { warrantyClauses } from "@/lib/warranty/terms";

/**
 * The workmanship warranty terms in the customer's portal. The words are NOT
 * here — they come from `lib/warranty/terms.ts`, the one source the estimate
 * renders from too (Tom, 19 Sep 2026: the customer should read the same
 * warranty when deciding as they do after the job).
 *
 * `approved` still drives the DRAFT watermark; Tom approved the terms on
 * 19 Sep 2026 (migration 20270174000000), so in practice it is on.
 */
export default function WarrantyTerms({
  approved,
  companyName,
  abn,
  address,
  phone,
  email,
}: {
  approved: boolean;
  companyName: string;
  abn: string;
  address: string;
  phone: string;
  email: string;
}) {
  const clauses = warrantyClauses({ companyName, abn, address, phone, email });
  return (
    <div className={approved ? "" : "draftwrap"} data-testid="warranty-terms">
      <div className="card">
        <h3>{companyName} Workmanship Warranty</h3>
        {clauses.map((c) => (
          <div key={c.n}>
            <h2>{c.n} · {c.heading}</h2>
            <p className="sub">{c.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
