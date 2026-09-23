import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { signPhotos, type WOPhotoRow } from "@/lib/workorder/photos";
import { offerRowCents } from "@/lib/workorder/scopeChanges";
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
 * A priced OFFER, as a mini-estimate: every change behind this token (one, or
 * five — Tom, 23 Sep 2026), each with its photos and the engine's lines, then
 * the net figure and the job total before → after, and ONE decision. Same
 * rules as the quote token page: an unknown token is a 404, never a 403, and
 * the page renders only what the SECURITY DEFINER function chooses to return
 * — no job id, no contractor rate, no margin. Approval requires the DRAWN
 * signature (Tom's ruling, 24 Aug 2026); declining stays one tap.
 */
export default async function VariationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();

  const { data } = await supabase.rpc("wo_variation_by_token", { p_token: token });
  const rows = (data as Row[] | null) ?? [];
  if (rows.length === 0) notFound();
  const first = rows[0];

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
      .eq("id", first.id)
      .maybeSingle();
    const accountId = (linkRow as { work_orders?: { estimates?: { account_id?: string | null } | null } | null } | null)
      ?.work_orders?.estimates?.account_id ?? null;
    if (accountId) dashboardHref = "/account/money";
  }

  // The photos of what was found, signed through the service client — token
  // possession IS the authorisation, the same rule as the /s report page. The
  // anon session rightly has no wo_photos read of its own.
  const photosByRow = new Map<string, { id: string; url: string; caption: string }[]>();
  if (service && rows.some((r) => r.photo_count > 0)) {
    const { data: photoRows } = await service
      .from("wo_photos")
      .select("id, work_order_id, kind, storage_path, area, caption, created_at, variation_id")
      .in("variation_id", rows.map((r) => r.id))
      .order("created_at", { ascending: true })
      .limit(8 * rows.length);
    const signed = await signPhotos(service, (photoRows ?? []) as WOPhotoRow[]);
    for (const p of signed) {
      const vid = p.variationId;
      if (!vid) continue;
      const list = photosByRow.get(vid) ?? [];
      if (list.length < 8) list.push({ id: p.id, url: p.url, caption: p.caption });
      photosByRow.set(vid, list);
    }
  }

  // One decision for the whole list: pending while any row still waits;
  // approved once signed; declined only if every row was declined.
  const pending = rows.some((r) => r.status === "priced");
  const status = pending ? "priced"
    : rows.some((r) => r.status === "customer_approved" || r.status === "contractor_accepted") ? "customer_approved"
    : "declined";
  const netCents = rows.reduce((s, r) => s + offerRowCents(r), 0);
  const credit = netCents < 0;
  const count = rows.length;

  // Old → new: for a pending offer the ledger doesn't include it yet; once
  // approved it does, so the arithmetic runs the other way.
  const adjusted = first.adjusted_contract_cents;
  const before = adjusted == null ? null : pending ? adjusted : adjusted - netCents;
  const after = before == null ? null : before + netCents;

  const signedRow = rows.find((r) => r.signed_name) ?? first;

  return (
    <main className="cv">
      <div className="cv-wrap">
        <span className="status">{pending ? "Awaiting your approval" : "Your job"}</span>
        <h1>
          {count > 1
            ? `${count} changes to your job`
            : first.credit ? "A change to your job" : "A bit of extra work on your job"}
        </h1>
        <p className="cv-sub">{first.job_title || first.wo_ref}</p>
        {count > 1 && (
          <p className="cv-sub" data-testid="offer-intro">
            {pending
              ? "Here is everything that has changed since your quote, and what it does to your total. You approve or decline the list as one."
              : "The changes you answered together."}
          </p>
        )}

        <div data-testid="offer-items">
        {rows.map((row) => {
          const photos = photosByRow.get(row.id) ?? [];
          const lines = Array.isArray(row.priced_lines) ? row.priced_lines : [];
          return (
            <div className="cv-card" key={row.id} data-testid="offer-item">
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
                <b data-testid={count > 1 ? "variation-item-price" : "variation-price"}>
                  {(row.credit ? "−" : "") + money(row.price_cents)}
                </b>
              </div>
              {count === 1 && before != null && after != null && (
                <div className="cv-oldnew" data-testid="variation-oldnew">
                  <span>Job total</span>
                  <b>{money(before)}</b>
                  <em aria-hidden="true">→</em>
                  <b className="cv-new">{money(after)}</b>
                  <span className="cv-incgst">incl. GST</span>
                </div>
              )}
            </div>
          );
        })}
        </div>

        {count > 1 && (
          <div className="cv-card cv-total" data-testid="offer-summary">
            <div className="cv-cat">All {count} changes together</div>
            <div className="cv-price">
              <span>{credit ? "Comes off your total" : netCents === 0 ? "Your total" : "Extra cost"}</span>
              <b data-testid="variation-price">{(credit ? "−" : "") + money(netCents)}</b>
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
        )}

        <VariationDecision
          token={token}
          priceCents={Math.abs(netCents)}
          credit={credit}
          status={status}
          count={count}
          signedName={signedRow.signed_name}
          signedAt={signedRow.signed_at}
          estimateToken={first.estimate_token}
          dashboardHref={dashboardHref}
        />
      </div>
    </main>
  );
}
