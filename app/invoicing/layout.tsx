import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { staffVisibility, gateStaffArea } from "@/lib/staff/gate";
import { firstVisibleHref } from "@/lib/staff/access";
import { loadLogos } from "@/lib/company/logo";
import HomeMark from "@/app/components/HomeMark";
import ThemeToggle from "@/app/components/ThemeToggle";
import { THEME_COOKIE, themeFromCookie } from "@/lib/theme/cookie";
import "./invoicing.css";
import StaffChatDock from "@/app/components/StaffChatDock";

export const dynamic = "force-dynamic";

/**
 * The invoicing shell (§7) — staff only, phone-first, the mockups' own dark
 * chrome. Customers reach invoices exclusively by token link (Step 3);
 * contractors never see this surface at all.
 */
export default async function InvoicingLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "staff") redirect("/portal");
  const vis = await staffVisibility(supabase, user.id);
  await gateStaffArea(vis, "payments");
  // Tom, 8 Sep: the logo top-left goes home; dark or light follows the CRM's cookie.
  const logos = await loadLogos(supabase);
  const theme = themeFromCookie((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <div className="invx" data-theme={theme}>
      <div className="invtop">
        <HomeMark href={firstVisibleHref(vis)} logos={logos} suffix="Payments" />
        <ThemeToggle initial={theme} rootSelector=".invx" />
      </div>
      {children}
      <StaffChatDock />
    </div>
  );
}
