import type { Metadata } from "next";
import Link from "next/link";
import "./portal.css";
import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/contractor/session";
import PortalTabs from "./PortalTabs";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Contractor portal · Paint Group",
  robots: { index: false, follow: false },
};

// Phone-first shell for contractors: sticky header, page content, fixed tab bar.
// Access is gated in requireContractor() — staff and customers are redirected to
// their own side of the app.
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { name, contractor } = await requireContractor();

  // A suspended contractor keeps their login but loses the portal. Showing a
  // plain explanation beats a broken-looking app or a silent redirect loop.
  const suspended = Boolean(contractor && !contractor.active);

  const supabase = await createClient();
  const { data: companyRow } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "company_profile")
    .maybeSingle();
  const logoUrl = (companyRow?.value as { logoUrl?: string } | null)?.logoUrl ?? "";

  return (
    <div className="pt">
      <div className="phone">
        <header className="hd">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="Paint Group" className="brandlogo" />
          ) : (
            <span className="wm">
              PAINT<span>—</span>GROUP
            </span>
          )}
          <Link href="/portal/profile" className="who">
            {contractor?.company_name?.trim() || name}
            <b>Contractor portal</b>
          </Link>
        </header>

        {suspended ? (
          <div className="wrap">
            <div className="card amberish" style={{ marginTop: 24 }}>
              <span className="chip amb">Access paused</span>
              <div style={{ marginTop: 10, fontWeight: 600, fontSize: "14.5px" }}>
                Your portal access is on hold
              </div>
              <div style={{ marginTop: 6, fontSize: "12.5px", color: "var(--muted)" }}>
                Paint Group have paused your account, so jobs and offers aren&rsquo;t
                available at the moment. Give the office a call and they can switch it
                back on.
              </div>
            </div>
          </div>
        ) : (
          children
        )}

        {!suspended && <PortalTabs />}
      </div>
    </div>
  );
}
