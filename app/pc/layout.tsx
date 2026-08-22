import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PcNav from "./PcNav";
import "./pc.css";

export const dynamic = "force-dynamic";

/**
 * The PC Command shell — the mockup's top bar and tab rail, as real routes so
 * every queue action can deep-link to the thing it is about.
 */
export default async function PcLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role, name").eq("id", user.id).single();
  if (profile?.role !== "staff") redirect("/portal");

  const today = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short",
  }).format(new Date());

  return (
    <div className="pc">
      <div className="shell">
        <div className="topbar">
          <span className="brand"><span className="drip" aria-hidden="true" />Paint <b>Group</b></span>
          <span className="meta"><span className="d">Command · {today}</span></span>
          <span className="who">
            <span className="role">Project coordinator<b>PC view</b></span>
            <span className="avatar">PC</span>
          </span>
        </div>

        <PcNav />

        {children}

        <p className="foot">
          PC Command · every number read from the work-order model.<br />
          Contractor and customer render their own views of the same jobs — RLS
          plus an explicit view, never inferred from role.
        </p>
      </div>
    </div>
  );
}
