import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { staffVisibility, gateStaffArea } from "@/lib/staff/gate";
import { firstVisibleHref } from "@/lib/staff/access";
import { loadLogoUrl } from "@/lib/company/logo";
import HomeMark from "@/app/components/HomeMark";
import CrmTabs from "./CrmTabs";
import Search from "./Search";
import ThemeToggle from "@/app/components/ThemeToggle";
import { THEME_COOKIE, themeFromCookie } from "@/lib/theme/cookie";
import { cachedBadge, rememberBadge } from "@/lib/crm/badgeCache";
import { getWorkQueue } from "./queue";
import "./crm.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "CRM · Paint Group",
  robots: { index: false, follow: false },
};

/**
 * The CRM shell — crm-workflow-simplified-mockup.html's chrome.
 *
 * Four tabs (shell brief §1); everything else is a view of one of them. On a
 * normal morning only Today should need opening — if something regularly
 * reaches a person through another tab first, that's a routing defect, not a
 * preference.
 */
export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role, name").eq("id", user.id).single();
  if (profile?.role !== "staff") redirect("/portal");
  const vis = await staffVisibility(supabase, user.id);
  await gateStaffArea(vis, "crm");
  // Tom, 8 Sep: the logo top-left is the way back to the main platform.
  const logoUrl = await loadLogoUrl(supabase);
  const home = firstVisibleHref(vis);

  const today = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne", weekday: "long", day: "numeric", month: "long",
  }).format(new Date());

  // The badge is overdue + due-today — "waiting on them" is not a number to
  // nag anyone with. Shares this render's queue with the Today page via
  // React cache, then refreshes through /crm/api/badge on navigation.
  // P7 fast path: the tab rail reads the number parked moments ago (the Today
  // page, the badge route, or the last layout render) rather than rebuilding
  // the queue on every CRM page. A miss builds it once and parks it.
  let badge = cachedBadge(user.id);
  if (badge == null) {
    const queue = await getWorkQueue();
    badge = queue.counts.byBucket.overdue + queue.counts.byBucket.today;
    rememberBadge(user.id, badge);
  }

  // P7: dark or light for the whole CRM, chosen once, rendered right first time.
  const theme = themeFromCookie((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <div className="crm" data-theme={theme}>
      <div className="top">
        <div className="topbar">
          <HomeMark href={home} logoUrl={logoUrl} suffix="CRM" />
          <Search />
          <ThemeToggle initial={theme} />
          <span className="who">{profile?.name || user.email}</span>
        </div>
        <CrmTabs initialCount={badge} />
      </div>
      <div className="wrap">
        <p className="eyebrow">{today}</p>
        {children}
      </div>
      <p className="foot">
        Every row here is read from the one event log.<br />
        Stage is worked out from the record; temperature, snooze and follow-up are yours to set.
      </p>
    </div>
  );
}
