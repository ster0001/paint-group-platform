import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import CrmTabs from "./CrmTabs";
import "./crm.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "CRM · Paint Group",
  robots: { index: false, follow: false },
};

/**
 * The CRM shell — crm-board-mockup.html's top bar and tab rail.
 *
 * Five tabs, because five is what the mockup has and a customer who appears
 * later shouldn't move. Only the ones whose session has shipped are live; the
 * rest are visibly "soon" rather than dead links, so nobody taps into a blank.
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

  return (
    <div className="crm">
      <div className="top">
        <div className="topbar">
          <span className="mark"><span>PG</span></span>
          <span className="brand">Paint Group <em>· CRM</em></span>
          <span className="who">{profile?.name || user.email}</span>
        </div>
        <CrmTabs />
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
