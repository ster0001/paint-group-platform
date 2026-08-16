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

        {children}

        <PortalTabs />
      </div>
    </div>
  );
}
