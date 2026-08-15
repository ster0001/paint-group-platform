import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppSidebar from "@/app/(app)/AppSidebar";

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
  if (profile?.role !== "staff") redirect("/dashboard");

  return (
    <div className="flex min-h-screen">
      <AppSidebar name={profile?.name || user.email || ""} email={user.email || ""} />
      <div className="min-w-0 flex-1 bg-gray-50">{children}</div>
    </div>
  );
}
