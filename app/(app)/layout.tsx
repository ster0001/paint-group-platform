import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppSidebar from "./AppSidebar";

export const dynamic = "force-dynamic";

// Shared shell for the staff app: left sidebar (Estimates / Invoices / Contacts /
// Settings) plus the page content. Staff only — customers are sent to their view.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
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
  if (profile?.role === "contractor") redirect("/portal");
  if (profile?.role !== "staff") redirect("/account");

  const { data: companyRow } = await supabase.from("settings").select("value").eq("key", "company_profile").maybeSingle();
  const logoUrl = (companyRow?.value as { logoUrl?: string } | null)?.logoUrl ?? "";

  return (
    <div className="flex min-h-screen">
      <AppSidebar name={profile?.name || user.email || ""} email={user.email || ""} logoUrl={logoUrl} />
      {/* On a phone the sidebar is a fixed off-canvas drawer with a bar across
          the top, so the page starts below that bar. On md+ the sidebar is back
          in the flex row and the padding goes away. */}
      <div className="min-w-0 flex-1 bg-gray-50 pt-[52px] md:pt-0">{children}</div>
    </div>
  );
}
