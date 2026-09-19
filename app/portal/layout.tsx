import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import "./portal.css";
import { getContractorSession } from "@/lib/contractor/session";
import { getCompanyContact } from "@/lib/portal/data";
import { createClient } from "@/lib/supabase/server";
import { loadTour } from "@/lib/help/content";
import ThemeToggle from "@/app/components/ThemeToggle";
import { THEME_COOKIE, themeFromCookie } from "@/lib/theme/cookie";
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
  const { name, contractor, capabilities } = await getContractorSession();

  // A suspended contractor keeps their login but loses the portal. Showing a
  // plain explanation beats a broken-looking app or a silent redirect loop.
  const suspended = Boolean(contractor && !contractor.active);

  // Settings is staff-RLS'd, so a contractor session read always came back
  // empty and the logo never showed (Tom, 1 Sep: use Settings logo 1). The
  // customer portal's whitelisted service read is the established door.
  const { logoUrl, logoUrlLight } = await getCompanyContact();

  // Dark or light, the same switch the CRM, Projects and Payments carry
  // (Tom, 19 Sep) — one cookie, so a painter chooses once. Read on the SERVER
  // so the first paint is already the right palette: a class flipped in the
  // browser would show the old one first, which on a phone reads as a flash.
  const theme = themeFromCookie((await cookies()).get(THEME_COOKIE)?.value);

  // The guided tour (help brief Phase C, C3): once, on a fresh account —
  // nothing seen yet, not suspended, and no offer or job on the books, because
  // a painter with work waiting came to act, not to browse. Help replays it.
  let tourCards: Awaited<ReturnType<typeof loadTour>> = [];
  // The tour is written for contractors (offers, your price, invoices); the
  // employee tour is Session 7's — until then an employee gets no tour.
  if (contractor && !suspended && !contractor.tour_seen_at && capabilities.acceptsOffers) {
    const supabase = await createClient();
    const [{ count: offers }, { count: jobs }] = await Promise.all([
      supabase.from("booking_offers").select("id", { count: "exact", head: true })
        .eq("contractor_id", contractor.id).in("state", ["offered", "proposed", "accepted"]),
      supabase.from("work_orders").select("id", { count: "exact", head: true }).eq("contractor_id", contractor.id),
    ]);
    if (!offers && !jobs) tourCards = loadTour("contractor");
  }

  return (
    <div className="pt" data-theme={theme}>
      <div className="phone">
        <header className="hd">
          {logoUrl || logoUrlLight ? (
            // Both marks ride in the page and `[data-theme]` decides which
            // shows, so the switch swaps them with no round trip — the white
            // lettering would be invisible on the light header.
            <span className="brandmark">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoUrl || logoUrlLight} alt="Paint Group" className="brandlogo brandlogo-dark" data-testid="portal-logo-dark" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoUrlLight || logoUrl} alt="Paint Group" className="brandlogo brandlogo-light" data-testid="portal-logo-light" />
            </span>
          ) : (
            <span className="wm">
              PAINT<span>—</span>GROUP
            </span>
          )}
          <ThemeToggle initial={theme} rootSelector=".pt" />
          <Link href="/portal/profile" className="who">
            {contractor?.company_name?.trim() || name}
            <b>{capabilities.canSelfInvoice ? "Contractor portal" : "Painter portal"}</b>
          </Link>
        </header>

        {children}

        {!suspended && <PortalTabs capabilities={capabilities} />}
        {tourCards.length > 0 && <PortalTour cards={tourCards} />}
      </div>
    </div>
  );
}
