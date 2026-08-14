import { createClient } from "@/lib/supabase/server";
import { DEFAULT_COMPANY, type CompanyProfile } from "@/app/quote/company";
import SettingsForm from "./SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("settings").select("value").eq("key", "company_profile").maybeSingle();
  const company: CompanyProfile = { ...DEFAULT_COMPANY, ...((data?.value as Partial<CompanyProfile>) ?? {}) };

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      <SettingsForm initial={company} />
    </div>
  );
}
