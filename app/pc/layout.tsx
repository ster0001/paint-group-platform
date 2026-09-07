import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { staffVisibility, gateStaffArea } from "@/lib/staff/gate";
import { firstVisibleHref } from "@/lib/staff/access";
import { loadLogoUrl } from "@/lib/company/logo";
import HomeMark from "@/app/components/HomeMark";
import ThemeToggle from "@/app/components/ThemeToggle";
import { THEME_COOKIE, themeFromCookie } from "@/lib/theme/cookie";
import PcNav from "./PcNav";
import "./pc.css";

export const dynamic = "force-dynamic";

/**
 * The PC Dashboard shell — the mockup's top bar and tab rail, as real routes so
 * every queue action can deep-link to the thing it is about.
 */
export default async function PcLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role, name").eq("id", user.id).single();
  if (profile?.role !== "staff") redirect("/portal");
  const vis = await staffVisibility(supabase, user.id);
  await gateStaffArea(vis, "projects");
  // Tom, 8 Sep: the logo top-left goes home; dark or light follows the one
  // cookie the CRM set (same toggle, same palette names).
  const logoUrl = await loadLogoUrl(supabase);
  const theme = themeFromCookie((await cookies()).get(THEME_COOKIE)?.value);

  const today = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short",
  }).format(new Date());

  return (
    <div className="pc" data-theme={theme}>
      <div className="shell">
        <div className="topbar">
          <HomeMark href={firstVisibleHref(vis)} logoUrl={logoUrl} suffix="Projects" />
          <span className="meta"><span className="d">Dashboard · {today}</span></span>
          <ThemeToggle initial={theme} rootSelector=".pc" />
          <span className="who">
            <span className="role">Project coordinator<b>PC view</b></span>
            <span className="avatar">PC</span>
          </span>
        </div>

        <PcNav />

        {children}

        <p className="foot">
          PC Dashboard · every number read from the work-order model.<br />
          Contractor and customer render their own views of the same jobs — RLS
          plus an explicit view, never inferred from role.
        </p>
      </div>
    </div>
  );
}
