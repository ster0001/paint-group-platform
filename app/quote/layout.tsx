import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppSidebar from "@/app/(app)/AppSidebar";
import { staffVisibility, gateStaffArea } from "@/lib/staff/gate";
import { visibleAreas } from "@/lib/staff/access";

export const dynamic = "force-dynamic";

// The quote builder lives outside the (app) route group, so it needs the same
// staff shell (left sidebar) applied here to keep navigation consistent.
export default async function QuoteLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, name")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "staff") redirect("/account");

  // Tom, 5 Sep: what this login is allowed to see (Settings → Staff logins).
  const vis = await staffVisibility(supabase, user.id);
  await gateStaffArea(vis);

  const { data: companyRow } = await supabase.from("settings").select("value").eq("key", "company_profile").maybeSingle();
  const logoUrl = (companyRow?.value as { logoUrl?: string } | null)?.logoUrl ?? "";

  return (
    <div className="flex min-h-screen">
      <AppSidebar name={profile?.name || user.email || ""} email={user.email || ""} logoUrl={logoUrl} areas={visibleAreas(vis)} />
      <div className="min-w-0 flex-1 bg-gray-50">{children}</div>
    </div>
  );
}
