import { redirect } from "next/navigation";
import { ticksBySurfaceKey, type SurfaceState } from "@/lib/workorder/surfaces";
import { signPhotos, type WOPhotoRow } from "@/lib/workorder/photos";
import { createClient } from "@/lib/supabase/server";
import QuoteBuilder from "./QuoteBuilder";
import { DEFAULT_COMPANY, type CompanyProfile, type Contact } from "./company";
import { DEFAULT_INCLUSION_TEMPLATES, DEFAULT_EXCLUSION_TEMPLATES, INCLUSION_TEMPLATES_KEY, EXCLUSION_TEMPLATES_KEY, type InclusionTemplate } from "@/lib/estimate/inclusionTemplates";
import { parseBackTo } from "@/lib/navigation/backTo";

export const dynamic = "force-dynamic";

// Staff-only quote builder. Loads the active rate card + reference data on the
// server (staff can read it under RLS), then hands it to the interactive client
// component, which prices live using the pricing engine.
export default async function QuotePage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; template?: string; view?: string; from?: string }>;
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

  const { id, template, view, from } = await searchParams;
  const initialView = view === "workorder" || view === "customer" ? view : undefined;
  // Where the top-left link goes. Validated, because `from` comes off the URL —
  // see lib/navigation/backTo.ts. Null falls back to the estimates list.
  const backTo = parseBackTo(from);

  // Everything below is independent — fetch it all in one round-trip. The single
  // `settings` fetch also carries the company profile and any saved templates, so
  // we don't query settings three separate times.
  const [rateItems, modifiers, products, settings, lineItems, areaNames, contactsRes, estimateRes, workOrderRes, contractorsRes, presentationsRes, typicalRes] = await Promise.all([
    supabase.from("rate_items").select("*").eq("rate_card_id", card?.id ?? "").order("category").order("sub_category"),
    supabase.from("modifiers").select("*").eq("active", true),
    supabase.from("products").select("*"),
    supabase.from("settings").select("*"),
    supabase.from("line_items").select("*").order("type").order("name"),
    supabase.from("area_names").select("area, type").order("type").order("area"),
    supabase.from("contacts").select("*").order("last_name"),
    id ? supabase.from("estimates").select("id, title, builder_state, share_token, status, sent_at, valid_until, presentation_id, sent_snapshot").eq("id", id).single() : Promise.resolve({ data: null }),
    id ? supabase.from("work_orders").select("*").eq("estimate_id", id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("contractors").select("id, profiles(name)").eq("active", true),
    supabase.from("presentations").select("id, name, is_default, presentation_blocks(kind, position, enabled, content)").order("name"),
    // Typical room sizes power the review gate's "what would this unmeasured
    // room cost" estimate. Degrades to {} before the 20260912 migration.
    supabase.from("room_type_defaults").select("room_type, typical_length_m, typical_width_m").eq("version", 3),
  ]);
  const typicalSizes = Object.fromEntries(
    ((typicalRes.data as Array<{ room_type: string; typical_length_m: number; typical_width_m: number }> | null) ?? [])
      .map((r) => [r.room_type, { L: r.typical_length_m, W: r.typical_width_m }]),
  );
  type PresRow = { id: string; name: string; is_default: boolean; presentation_blocks: { kind: string; position: number; enabled: boolean; content: unknown }[] };
  const presentations = ((presentationsRes.data as PresRow[] | null) ?? []).map((p) => ({
    id: p.id, name: p.name,
    blocks: (p.presentation_blocks ?? []).slice().sort((a, b) => a.position - b.position).map((b) => ({ kind: b.kind, position: b.position, enabled: b.enabled, content: b.content })),
  }));
  type ContractorRow = { id: string; profiles: { name: string | null } | null };
  const contractors = ((contractorsRes.data as ContractorRow[] | null) ?? []).map((c) => ({ id: c.id, name: c.profiles?.name || "Contractor" }));

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
  const termsRow = settingsRows.find((s) => s.key === "terms_conditions");
  const terms = typeof termsRow?.value === "string" ? termsRow.value : "";

  // Load an existing saved quote (?id=), or start a NEW estimate pre-filled from
  // a saved template (?template=). A template opens with no id, so saving it
  // creates a fresh estimate rather than overwriting the template.
  type Initial = { id: string | null; title: string | null; builder_state: unknown; share_token?: string | null; status?: string | null; sent_at?: string | null; valid_until?: string | null; presentation_id?: string | null };
  let initial: Initial | null = null;
  if (id) {
    if (estimateRes.data) initial = estimateRes.data as Initial;
  } else if (template) {
    const tRow = settingsRows.find((s) => s.key === "estimate_templates");
    const list = Array.isArray(tRow?.value) ? (tRow!.value as { id: string; name: string; builder_state: unknown }[]) : [];
    const t = list.find((x) => x.id === template);
    if (t) initial = { id: null, title: "", builder_state: t.builder_state };
  }

  // Requested / proposed / confirmed, from the live offer. Derived, not stored.
  const woId = (workOrderRes.data as { id?: string } | null)?.id;
  const [{ data: liveOffer }, { data: tickRows }, { data: photoRows }] = await Promise.all([
    woId
      ? supabase.from("booking_offers").select("state")
          .eq("work_order_id", woId).in("state", ["offered", "proposed", "accepted"])
          .order("offered_at", { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
    // The live ticks and the photos from site. The job sheet is a document, not
    // a status board — but the office reading it needs to see what has actually
    // been done and what came back from the painter's phone.
    woId
      ? supabase.from("wo_surfaces").select("surface_key, state").eq("work_order_id", woId)
      : Promise.resolve({ data: null }),
    woId
      ? supabase.from("wo_photos")
          .select("id, work_order_id, kind, area, caption, storage_path, created_at, variation_id")
          .eq("work_order_id", woId).order("created_at", { ascending: false }).limit(60)
      : Promise.resolve({ data: null }),
  ]);

  const woTicks = ticksBySurfaceKey(
    ((tickRows as { surface_key: string | null; state: SurfaceState }[] | null) ?? []),
  );
  const woPhotos = await signPhotos(supabase, (photoRows as WOPhotoRow[] | null) ?? []);
  const offerState = (liveOffer as { state?: string } | null)?.state;
  const bookingState =
    offerState === "accepted" ? "confirmed"
    : offerState === "proposed" ? "proposed"
    : offerState === "offered" ? "requested"
    : "none";

  return (
    <QuoteBuilder
      initialView={initialView}
      backTo={backTo}
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
      typicalSizes={typicalSizes}
      terms={terms}
      workOrder={workOrderRes.data ?? null}
      woTicks={woTicks}
      woPhotos={woPhotos}
      bookingState={bookingState}
      contractors={contractors}
      presentations={presentations}
    />
  );
}
