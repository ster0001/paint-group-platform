import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import VariationDecision from "./VariationDecision";
import "@/app/e/customer.css";
import "./variation.css";

export const dynamic = "force-dynamic";

const money = (c: number) =>
  "$" + (Math.abs(c) / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type PricedLine = { label?: string; cents?: number };

type Row = {
  id: string; wo_ref: string; category: string; comment: string;
  price_cents: number; status: string; job_title: string; photo_count: number;
  credit: boolean; priced_lines: PricedLine[] | null;
  signed_name: string | null; signed_at: string | null;
  adjusted_contract_cents: number | null;
};

const CATEGORY_LABEL: Record<string, string> = {
  rot: "Rot / substrate",
  damage: "Damage",
  extra_scope: "Extra scope",
  customer_request: "Your request",
  scope_removed: "Scope reduced",
};

/**
 * A priced variation, as a mini-estimate. Same rules as the quote token page:
 * an unknown token is a 404, never a 403, and the page renders only what the
 * SECURITY DEFINER function chooses to return — no job id, no contractor rate,
 * no margin. Approval requires the DRAWN signature (Tom's ruling, 24 Aug 2026);
 * declining stays one tap.
 */
export default async function VariationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();

  const { data } = await supabase.rpc("wo_variation_by_token", { p_token: token });
  const row = ((data as Row[] | null) ?? [])[0];
  if (!row) notFound();

  const pending = row.status === "priced";
  const signedDelta = row.credit ? -row.price_cents : row.price_cents;
  // Old → new: for a pending variation the ledger doesn't include it yet; once
  // approved it does, so the arithmetic runs the other way.
  const adjusted = row.adjusted_contract_cents;
  const before = adjusted == null ? null : pending ? adjusted : adjusted - signedDelta;
  const after = before == null ? null : before + signedDelta;
  const lines = Array.isArray(row.priced_lines) ? row.priced_lines : [];

  return (
    <main className="cv">
      <div className="cv-wrap">
        <span className="status">{pending ? "Awaiting your approval" : "Your job"}</span>
        <h1>{row.credit ? "A change to your job" : "A bit of extra work on your job"}</h1>
        <p className="cv-sub">{row.job_title || row.wo_ref}</p>

        <div className="cv-card">
          <div className="cv-cat">{CATEGORY_LABEL[row.category] ?? row.category}</div>
          <p className="cv-comment">&ldquo;{row.comment}&rdquo;</p>
          {row.photo_count > 0 && (
            <p className="cv-fine" data-testid="variation-photos">
              {row.photo_count} photo{row.photo_count === 1 ? "" : "s"} taken on site.
            </p>
          )}
          {lines.length > 0 && (
            <ul className="cv-lines" data-testid="variation-lines">
              {lines.map((l, i) => (
                <li key={i}>
                  <span>{l.label ?? ""}</span>
                  {typeof l.cents === "number" && <b>{(l.cents < 0 ? "−" : "") + money(l.cents)}</b>}
                </li>
              ))}
            </ul>
          )}
          <div className="cv-price">
            <span>{row.credit ? "Comes off your total" : "Extra cost"}</span>
            <b data-testid="variation-price">{(row.credit ? "−" : "") + money(row.price_cents)}</b>
          </div>
          {before != null && after != null && (
            <div className="cv-oldnew" data-testid="variation-oldnew">
              <span>Job total</span>
              <b>{money(before)}</b>
              <em aria-hidden="true">→</em>
              <b className="cv-new">{money(after)}</b>
              <span className="cv-incgst">incl. GST</span>
            </div>
          )}
        </div>

        <VariationDecision
          token={token}
          priceCents={row.price_cents}
          credit={row.credit}
          status={row.status}
          signedName={row.signed_name}
          signedAt={row.signed_at}
        />
      </div>
    </main>
  );
}
