import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getPortalContext } from "@/lib/portal/data";
import { createServiceClient } from "@/lib/supabase/service";
import { TENANT_ASKS } from "@/lib/portal/tenant-link";
import TenantLinkForm from "./TenantLinkForm";

export const dynamic = "force-dynamic";

/**
 * C15 · walk A · screen A4 — ASK THE TENANT FOR PHOTOS.
 *
 * The agent picks what to ask for and where to send it; the tenant gets a
 * link and no account (⚑61 — it goes to the tenant directly, and the agent
 * sees what was sent below). The message is customer-facing copy tagged
 * copy:new in lib/portal/tenant-link.ts — Tom reads it before it sends.
 */
export default async function TenantLinkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getPortalContext();
  if (!ctx) redirect("/account/login");
  if (!ctx.accounts.some((a) => a.account_type === "trade")) redirect("/account");
  const svc = createServiceClient();
  if (!svc) return <div className="card"><p className="sub">Unavailable right now — try again shortly.</p></div>;

  const { data: est } = await svc.from("estimates").select("id, account_id, property_id, title").eq("id", id).maybeSingle();
  if (!est || !ctx.accounts.some((a) => a.id === est.account_id)) notFound();
  const property = est.property_id ? ctx.properties.find((p) => p.id === est.property_id) ?? null : null;

  const { data: links } = await svc.from("tenant_photo_links")
    .select("id, sent_to, asked_for, status, created_at, uploaded_photo_ids")
    .eq("estimate_id", est.id).order("created_at", { ascending: false }).limit(10);
  const label = (k: string) => TENANT_ASKS.find((a) => a.key === k)?.label ?? k;

  return (
    <div data-testid="tenant-link-page">
      <Link href={`/account/quote/${est.id}/sheet`} className="sub" style={{ display: "inline-block", marginBottom: 8 }}>‹ The sheet</Link>
      <div className="greet">{[property?.address, property?.suburb].filter(Boolean).join(", ") || est.title}</div>
      <h1>Ask the tenant for photos</h1>
      <p className="sub">They get a link, take a few photos on their phone, and the photos land on this property. No account, no app.</p>

      {!est.property_id ? (
        <div className="card"><p className="sub">This quote isn&rsquo;t pinned to a property yet, so there is nowhere for photos to land. Start it from a property on your list.</p></div>
      ) : (
        <TenantLinkForm estimateId={est.id as string} />
      )}

      {(links ?? []).length > 0 && (
        <>
          <h2>Sent so far</h2>
          <div className="card" data-testid="tenant-links-sent">
            {(links ?? []).map((l) => (
              <div key={l.id as string} className="row" style={{ padding: "6px 0", display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div>
                  <div><b>{(l.sent_to as string | null) || "link only"}</b> <span className="sub">· {((l.asked_for as string[] | null) ?? []).map(label).join(", ") || "anything useful"}</span></div>
                </div>
                <span className={`chip ${l.status === "photos_received" ? "emerald" : "mut"} nodot`}>
                  {l.status === "photos_received" ? `${((l.uploaded_photo_ids as string[] | null) ?? []).length} photo(s) in` : l.status === "opened" ? "Opened" : l.status === "expired" ? "Expired" : "Sent"}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
