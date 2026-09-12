import { createServiceClient } from "@/lib/supabase/service";
import { getCompanyContact } from "@/lib/portal/data";
import { TENANT_ASKS, tenantLinkExpired, tenantPageIntro } from "@/lib/portal/tenant-link";
import TenantUpload from "./TenantUpload";

export const dynamic = "force-dynamic";
export const metadata = { title: "A few photos · Paint Group", robots: { index: false, follow: false } };

/**
 * C15 (A4) — the TENANT's page. Phone-first, no account: the token is the
 * whole identity. It says who we are and that it is nothing to do with the
 * bond (copy:new), lists what was asked for, and takes photos. Opening the
 * page marks the link opened so the agent can see it landed (⚑61).
 */
export default async function TenantPhotoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const company = await getCompanyContact();
  const svc = createServiceClient();
  const shell = (body: React.ReactNode) => (
    <main style={{ maxWidth: 520, margin: "0 auto", padding: "28px 18px 60px", fontFamily: "system-ui, -apple-system, sans-serif", lineHeight: 1.45 }}>
      <div style={{ fontWeight: 800, letterSpacing: ".04em", marginBottom: 18 }}>{company.name.toUpperCase()}</div>
      {body}
    </main>
  );
  if (!svc || !/^[A-Za-z0-9_-]{16,64}$/.test(token)) return shell(<p>That link isn&rsquo;t right — check the message and try again.</p>);

  const { data: link } = await svc.from("tenant_photo_links")
    .select("id, status, expires_at, asked_for, uploaded_photo_ids").eq("token", token).maybeSingle();
  if (!link) return shell(<p>That link isn&rsquo;t right — check the message and try again.</p>);
  if (link.status === "expired" || tenantLinkExpired(link.expires_at as string | null)) {
    return shell(<p>This link has expired. If you were expecting it, ask your property manager to send a fresh one.</p>);
  }
  if (link.status === "sent") await svc.from("tenant_photo_links").update({ status: "opened" }).eq("id", link.id);

  const asks = ((link.asked_for as string[] | null) ?? []).map((k) => TENANT_ASKS.find((a) => a.key === k)?.label ?? k);
  const already = ((link.uploaded_photo_ids as string[] | null) ?? []).length;

  return shell(
    <div data-testid="tenant-page">
      <h1 style={{ fontSize: 24, margin: "0 0 10px" }}>A few photos, please</h1>
      <p style={{ color: "#475569" }}>{tenantPageIntro(company.name)}</p>
      {asks.length > 0 && (
        <div style={{ margin: "16px 0", padding: 14, border: "1px solid #e2e8f0", borderRadius: 12 }}>
          <div style={{ fontSize: 12, letterSpacing: ".04em", textTransform: "uppercase", color: "#64748b", marginBottom: 6 }}>What would help</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{asks.map((a) => <li key={a}>{a}</li>)}</ul>
        </div>
      )}
      <TenantUpload token={token} already={already} />
      {company.phone && <p style={{ marginTop: 22, color: "#475569" }}>Questions? Ring us on <b>{company.phone}</b>.</p>}
    </div>,
  );
}
