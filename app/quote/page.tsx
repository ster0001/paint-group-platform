import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import QuoteBuilder from "./QuoteBuilder";
import { DEFAULT_COMPANY, type CompanyProfile, type Contact } from "./company";
import { DEFAULT_INCLUSION_TEMPLATES, DEFAULT_EXCLUSION_TEMPLATES, INCLUSION_TEMPLATES_KEY, EXCLUSION_TEMPLATES_KEY, type InclusionTemplate } from "@/lib/estimate/inclusionTemplates";

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

  const { id, template } = await searchParams;

  // Everything below is independent — fetch it all in one round-trip. The single
  // `settings` fetch also carries the company profile and any saved templates, so
  // we don't query settings three separate times.
  const [rateItems, modifiers, products, settings, lineItems, areaNames, contactsRes, estimateRes] = await Promise.all([
    supabase.from("rate_items").select("*").eq("rate_card_id", card?.id ?? "").order("category").order("sub_category"),
    supabase.from("modifiers").select("*").eq("active", true),
    supabase.from("products").select("*"),
    supabase.from("settings").select("*"),
    supabase.from("line_items").select("*").order("type").order("name"),
    supabase.from("area_names").select("area, type").order("type").order("area"),
    supabase.from("contacts").select("*").order("last_name"),
    id ? supabase.from("estimates").select("id, title, builder_state, share_token, status, sent_at, valid_until").eq("id", id).single() : Promise.resolve({ data: null }),
  ]);

  const settingsRows = (settings.data as { key: string; value: unknown }[] | null) ?? [];
  const companyRow = settingsRows.find((s) => s.key === "company_profile");
  const company: CompanyProfile = { ...DEFAULT_COMPANY, ...((companyRow?.value as Partial<CompanyProfile>) ?? {}) };
  const contacts = (contactsRes.data as Contact[] | null) ?? [];
  // "What's included" templates — fall back to built-in defaults until customised.
  const inclusionRow = settingsRows.find((s) => s.key === INCLUSION_TEMPLATES_KEY);
  const inclusionTemplates: InclusionTemplate[] = Array.isArray(inclusionRow?.value) && (inclusionRow!.value as unknown[]).length
    ? (inclusionRow!.value as InclusionTemplate[])
    : DEFAULT_INCLUSION_TEMPLATES;
  const exclusionRow = settingsRows.find((s) => s.key === EXCLUSION_TEMPLATES_KEY);
  const exclusionTemplates: InclusionTemplate[] = Array.isArray(exclusionRow?.value) && (exclusionRow!.value as unknown[]).length
    ? (exclusionRow!.value as InclusionTemplate[])
    : DEFAULT_EXCLUSION_TEMPLATES;

  // Load an existing saved quote (?id=), or start a NEW estimate pre-filled from
  // a saved template (?template=). A template opens with no id, so saving it
  // creates a fresh estimate rather than overwriting the template.
  type Initial = { id: string | null; title: string | null; builder_state: unknown; share_token?: string | null; status?: string | null; sent_at?: string | null; valid_until?: string | null };
  let initial: Initial | null = null;
  if (id) {
    if (estimateRes.data) initial = estimateRes.data as Initial;
  } else if (template) {
    const tRow = settingsRows.find((s) => s.key === "estimate_templates");
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
      inclusionTemplates={inclusionTemplates}
      exclusionTemplates={exclusionTemplates}
    />
  );
}
