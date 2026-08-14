import { createClient } from "@/lib/supabase/server";
import { DEFAULT_COMPANY, type CompanyProfile } from "@/app/quote/company";
import SettingsForm from "./SettingsForm";
import LineItemDescriptions, { type LineItemRow } from "./LineItemDescriptions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("settings").select("value").eq("key", "company_profile").maybeSingle();
  const company: CompanyProfile = { ...DEFAULT_COMPANY, ...((data?.value as Partial<CompanyProfile>) ?? {}) };

  const { data: lineItems } = await supabase
    .from("line_items")
    .select("id, name, type, description")
    .order("type")
    .order("name");

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      <SettingsForm initial={company} />
      <LineItemDescriptions initial={(lineItems as LineItemRow[] | null) ?? []} />
    </div>
  );
}
