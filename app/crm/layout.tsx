import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import CrmTabs from "./CrmTabs";
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

  const today = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne", weekday: "long", day: "numeric", month: "long",
  }).format(new Date());

  // The badge is overdue + due-today — "waiting on them" is not a number to
  // nag anyone with. Shares this render's queue with the Today page via
  // React cache, then refreshes through /crm/api/badge on navigation.
  const queue = await getWorkQueue();
  const badge = queue.counts.byBucket.overdue + queue.counts.byBucket.today;

  return (
    <div className="crm">
      <div className="top">
        <div className="topbar">
          <span className="mark"><span>PG</span></span>
          <span className="brand">Paint Group <em>· CRM</em></span>
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
