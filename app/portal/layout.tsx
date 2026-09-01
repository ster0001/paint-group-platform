import type { Metadata } from "next";
import Link from "next/link";
import "./portal.css";
import { getContractorSession } from "@/lib/contractor/session";
import { getCompanyContact } from "@/lib/portal/data";
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
  const { name, contractor } = await getContractorSession();

  // A suspended contractor keeps their login but loses the portal. Showing a
  // plain explanation beats a broken-looking app or a silent redirect loop.
  const suspended = Boolean(contractor && !contractor.active);

  // Settings is staff-RLS'd, so a contractor session read always came back
  // empty and the logo never showed (Tom, 1 Sep: use Settings logo 1). The
  // customer portal's whitelisted service read is the established door.
  const { logoUrl } = await getCompanyContact();

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

        {!suspended && <PortalTabs />}
      </div>
    </div>
  );
}
