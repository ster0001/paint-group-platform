import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import "./invoicing.css";

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

  return <div className="invx">{children}</div>;
}
