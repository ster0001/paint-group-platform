import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import QuoteBuilder from "./QuoteBuilder";
import { DEFAULT_COMPANY, type CompanyProfile, type Contact } from "./company";

export const dynamic = "force-dynamic";

// Staff-only quote builder. Loads the active rate card + reference data on the
// server (staff can read it under RLS), then hands it to the interactive client
// component, which prices live using the pricing engine.
export default async function QuotePage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; template?: string }>;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "staff") {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="text-xl font-semibold">Staff only</h1>
        <p className="mt-2 text-sm text-gray-500">
          The quote builder is available to staff accounts only.
        </p>
      </main>
    );
  }

  const { data: card } = await supabase
    .from("rate_cards")
    .select("id, version")
    .eq("is_active", true)
    .single();

  const [rateItems, modifiers, products, settings, lineItems, areaNames] = await Promise.all([
    supabase
      .from("rate_items")
      .select("*")
      .eq("rate_card_id", card?.id ?? "")
      .order("category")
      .order("sub_category"),
    supabase.from("modifiers").select("*").eq("active", true),
    supabase.from("products").select("*"),
    supabase.from("settings").select("*"),
    supabase.from("line_items").select("*").order("type").order("name"),
    supabase.from("area_names").select("area, type").order("type").order("area"),
  ]);

  const { data: companyRow } = await supabase.from("settings").select("value").eq("key", "company_profile").maybeSingle();
  const company: CompanyProfile = { ...DEFAULT_COMPANY, ...((companyRow?.value as Partial<CompanyProfile>) ?? {}) };
  const contactsRes = await supabase.from("contacts").select("*").order("last_name");
  const contacts = (contactsRes.data as Contact[] | null) ?? [];

  // Load an existing saved quote (?id=), or start a NEW estimate pre-filled from
  // a saved template (?template=). A template opens with no id, so saving it
  // creates a fresh estimate rather than overwriting the template.
  const { id, template } = await searchParams;
  let initial: { id: string | null; title: string | null; builder_state: unknown } | null = null;
  if (id) {
    const { data } = await supabase
      .from("estimates")
      .select("id, title, builder_state")
      .eq("id", id)
      .single();
    if (data) initial = data;
  } else if (template) {
    const { data: tRow } = await supabase.from("settings").select("value").eq("key", "estimate_templates").maybeSingle();
    const list = Array.isArray(tRow?.value) ? (tRow!.value as { id: string; name: string; builder_state: unknown }[]) : [];
    const t = list.find((x) => x.id === template);
    if (t) initial = { id: null, title: "", builder_state: t.builder_state };
  }

  return (
    <QuoteBuilder
      rateCardId={card?.id ?? null}
      rateCardVersion={card?.version ?? null}
      rateItems={rateItems.data ?? []}
      modifiers={modifiers.data ?? []}
      products={products.data ?? []}
      settings={settings.data ?? []}
      lineItems={lineItems.data ?? []}
      areaNames={areaNames.data ?? []}
      initial={initial}
      company={company}
      contacts={contacts}
    />
  );
}
