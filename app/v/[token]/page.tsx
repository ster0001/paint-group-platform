import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import VariationDecision from "./VariationDecision";
import "@/app/e/customer.css";
import "./variation.css";

export const dynamic = "force-dynamic";

const money = (c: number) =>
  "$" + (c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Row = {
  id: string; wo_ref: string; category: string; comment: string;
  price_cents: number; status: string; job_title: string; photo_count: number;
};

const CATEGORY_LABEL: Record<string, string> = {
  rot: "Rot / substrate",
  damage: "Damage",
  extra_scope: "Extra scope",
  customer_request: "Your request",
};

/**
 * A priced variation, as a mini-estimate. Same rules as the quote token page:
 * an unknown token is a 404, never a 403, and the page renders only what the
 * SECURITY DEFINER function chooses to return — no job id, no contractor rate,
 * no margin.
 */
export default async function VariationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();

  const { data } = await supabase.rpc("wo_variation_by_token", { p_token: token });
  const row = ((data as Row[] | null) ?? [])[0];
  if (!row) notFound();

  return (
    <main className="cv">
      <div className="cv-wrap">
        <span className="status">Awaiting your approval</span>
        <h1>A bit of extra work on your job</h1>
        <p className="cv-sub">{row.job_title || row.wo_ref}</p>

        <div className="cv-card">
          <div className="cv-cat">{CATEGORY_LABEL[row.category] ?? row.category}</div>
          <p className="cv-comment">&ldquo;{row.comment}&rdquo;</p>
          {row.photo_count > 0 && (
            <p className="cv-fine" data-testid="variation-photos">
              {row.photo_count} photo{row.photo_count === 1 ? "" : "s"} taken on site.
            </p>
          )}
          <div className="cv-price">
            <span>Extra cost</span>
            <b data-testid="variation-price">{money(row.price_cents)}</b>
          </div>
        </div>

        <VariationDecision token={token} priceCents={row.price_cents} status={row.status} />
      </div>
    </main>
  );
}
