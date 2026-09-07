import type { Metadata } from "next";
import Link from "next/link";
import "./portal.css";
import { getContractorSession } from "@/lib/contractor/session";
import { getCompanyContact } from "@/lib/portal/data";
import { createClient } from "@/lib/supabase/server";
import { loadTour } from "@/lib/help/content";
import PortalTabs from "./PortalTabs";
import PortalTour from "./PortalTour";

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

  // The guided tour (help brief Phase C, C3): once, on a fresh account —
  // nothing seen yet, not suspended, and no offer or job on the books, because
  // a painter with work waiting came to act, not to browse. Help replays it.
  let tourCards: Awaited<ReturnType<typeof loadTour>> = [];
  if (contractor && !suspended && !contractor.tour_seen_at) {
    const supabase = await createClient();
    const [{ count: offers }, { count: jobs }] = await Promise.all([
      supabase.from("booking_offers").select("id", { count: "exact", head: true })
        .eq("contractor_id", contractor.id).in("state", ["offered", "proposed", "accepted"]),
      supabase.from("work_orders").select("id", { count: "exact", head: true }).eq("contractor_id", contractor.id),
    ]);
    if (!offers && !jobs) tourCards = loadTour("contractor");
  }

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
        {tourCards.length > 0 && <PortalTour cards={tourCards} />}
      </div>
    </div>
  );
}
