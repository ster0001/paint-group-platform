import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { signPhotos, type WOPhotoRow } from "@/lib/workorder/photos";
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
  estimate_token: string | null;
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

  // Where "see your updated invoice" lands (Tom, 1 Sep #2): the DASHBOARD's
  // invoicing view when this customer has a portal account, the /e changes
  // section as the fallback for pre-portal rows. Resolved through the service
  // client — token possession is the authorisation.
  let dashboardHref: string | null = null;
  const service = createServiceClient();
  if (service) {
    const { data: linkRow } = await service
      .from("wo_variations")
      .select("id, work_orders(estimates(account_id))")
      .eq("id", row.id)
      .maybeSingle();
    const accountId = (linkRow as { work_orders?: { estimates?: { account_id?: string | null } | null } | null } | null)
      ?.work_orders?.estimates?.account_id ?? null;
    if (accountId) dashboardHref = "/account/money";
  }

  // The photos of what was found, signed through the service client — token
  // possession IS the authorisation, the same rule as the /s report page. The
  // anon session rightly has no wo_photos read of its own.
  let photos: { id: string; url: string; caption: string }[] = [];
  if (service && row.photo_count > 0) {
    const { data: photoRows } = await service
      .from("wo_photos")
      .select("id, work_order_id, kind, storage_path, area, caption, created_at, variation_id")
      .eq("variation_id", row.id)
      .order("created_at", { ascending: true })
      .limit(8);
    photos = (await signPhotos(service, (photoRows ?? []) as WOPhotoRow[]))
      .map((p) => ({ id: p.id, url: p.url, caption: p.caption }));
  }

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
          {photos.length > 0 ? (
            <div className="cv-photos" data-testid="variation-photos">
              {photos.map((p) => (
                // Signed URLs, deliberately not next/image (same call as PhotoGrid).
                // eslint-disable-next-line @next/next/no-img-element
                <img key={p.id} src={p.url} alt={p.caption || "Photo taken on site"} loading="lazy" />
              ))}
            </div>
          ) : row.photo_count > 0 ? (
            <p className="cv-fine" data-testid="variation-photos">
              {row.photo_count} photo{row.photo_count === 1 ? "" : "s"} taken on site.
            </p>
          ) : null}
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
          estimateToken={row.estimate_token}
          dashboardHref={dashboardHref}
        />
      </div>
    </main>
  );
}
