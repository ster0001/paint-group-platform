import { createClient } from "@/lib/supabase/server";
import { DEFAULT_COMPANY, type CompanyProfile } from "@/app/quote/company";
import SettingsForm from "./SettingsForm";
import SettingsFolder from "./SettingsFolder";
import EditableTable from "./EditableTable";
import LineItemsManager, { type LineItemRow } from "./LineItemsManager";
import PricingSettings, { type SettingRow } from "./PricingSettings";
import TemplatesManager, { type TemplateMeta } from "./TemplatesManager";
import InclusionTemplatesManager from "./InclusionTemplatesManager";
import TermsEditor, { TERMS_KEY } from "./TermsEditor";
import MessagingSettings from "./MessagingSettings";
import { MESSAGING_KEY, type MessagingSettings as MessagingValues } from "@/lib/messaging/config";
import ProductsManager, { type ProductRow } from "./ProductsManager";
import ColoursManager, { type ColourRow } from "./ColoursManager";
import PresentationsManager, { type PresentationRow } from "./PresentationsManager";
import { DEFAULT_INCLUSION_TEMPLATES, DEFAULT_EXCLUSION_TEMPLATES, INCLUSION_TEMPLATES_KEY, EXCLUSION_TEMPLATES_KEY, type InclusionTemplate } from "@/lib/estimate/inclusionTemplates";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();

  const [companyRes, lineItemsRes, areasRes, cardRes, productsRes, modifiersRes, settingsRes, coloursRes, presentationsRes, estPresRes] = await Promise.all([
    supabase.from("settings").select("value").eq("key", "company_profile").maybeSingle(),
    supabase.from("line_items").select("id, name, type, pricing_method, description").order("type").order("name"),
    supabase.from("area_names").select("id, area, type").order("type").order("area"),
    supabase.from("rate_cards").select("id, version").eq("is_active", true).maybeSingle(),
    // select("*") returns whatever columns exist, so the list never breaks even
    // if the product-details migration hasn't been applied yet.
    supabase.from("products").select("*").order("category").order("name"),
    supabase.from("modifiers").select("id, group_name, code, label, multiplier, active").order("group_name"),
    supabase.from("settings").select("key, value").order("key"),
    supabase.from("colours").select("id, brand, name, hex, collection").order("brand").order("name"),
    supabase.from("presentations").select("id, name, description, is_default, presentation_blocks(id, kind, position, enabled, content)").order("created_at"),
    // Only used to count how many estimates use each presentation, so ask for
    // the ones that actually have one rather than every estimate ever written
    // (audit S6). Capped too — the count is advisory, and the cap is stated in
    // the UI rather than silently truncating.
    supabase.from("estimates").select("presentation_id").not("presentation_id", "is", null).limit(2000),
  ]);

  const company: CompanyProfile = { ...DEFAULT_COMPANY, ...((companyRes.data?.value as Partial<CompanyProfile>) ?? {}) };
  const lineItems = (lineItemsRes.data as LineItemRow[] | null) ?? [];
  const areas = areasRes.data ?? [];
  const products = productsRes.data ?? [];
  const colours = (coloursRes.data as ColourRow[] | null) ?? [];
  const presentations = (presentationsRes.data as PresentationRow[] | null) ?? [];
  const usage: Record<string, number> = {};
  for (const e of ((estPresRes.data as { presentation_id: string | null }[] | null) ?? [])) if (e.presentation_id) usage[e.presentation_id] = (usage[e.presentation_id] ?? 0) + 1;
  const modifiers = modifiersRes.data ?? [];
  const cardId = cardRes.data?.id ?? "";

  const rateItemsRes = cardId
    ? await supabase
        .from("rate_items")
        .select("id, code, category, sub_category, unit, rate_1_coat, rate_2_coat, rate_3_coat, default_coats, charge_out_cents, default_product")
        .eq("rate_card_id", cardId)
        .order("category")
        .order("sub_category")
        .order("code")
    : { data: [] };
  const rateItems = rateItemsRes.data ?? [];

  const allSettings = (settingsRes.data as SettingRow[] | null) ?? [];
  const pricingRows = allSettings.filter((r) => r.key !== "company_profile" && r.key !== "estimate_templates" && r.key !== INCLUSION_TEMPLATES_KEY && r.key !== EXCLUSION_TEMPLATES_KEY && r.key !== TERMS_KEY && r.key !== MESSAGING_KEY);
  const messaging = (allSettings.find((r) => r.key === MESSAGING_KEY)?.value as Partial<MessagingValues> | undefined) ?? null;
  const terms = typeof allSettings.find((r) => r.key === TERMS_KEY)?.value === "string" ? (allSettings.find((r) => r.key === TERMS_KEY)!.value as string) : "";
  const templatesRow = allSettings.find((r) => r.key === "estimate_templates");
  const templates: TemplateMeta[] = (Array.isArray(templatesRow?.value) ? (templatesRow!.value as TemplateMeta[]) : [])
    .map((t) => ({ id: t.id, name: t.name, createdAt: t.createdAt }));
  // "What's included" templates — fall back to the built-in defaults until saved.
  const inclusionRow = allSettings.find((r) => r.key === INCLUSION_TEMPLATES_KEY);
  const inclusionTemplates: InclusionTemplate[] = Array.isArray(inclusionRow?.value) && inclusionRow!.value.length
    ? (inclusionRow!.value as InclusionTemplate[])
    : DEFAULT_INCLUSION_TEMPLATES;
  const exclusionRow = allSettings.find((r) => r.key === EXCLUSION_TEMPLATES_KEY);
  const exclusionTemplates: InclusionTemplate[] = Array.isArray(exclusionRow?.value) && exclusionRow!.value.length
    ? (exclusionRow!.value as InclusionTemplate[])
    : DEFAULT_EXCLUSION_TEMPLATES;

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-gray-500">Everything below is editable. Open a folder to manage that data.</p>

      <SettingsFolder title="Company details" subtitle="Company info + logo — shown on the header of every estimate" defaultOpen>
        <SettingsForm initial={company} />
      </SettingsFolder>

      <SettingsFolder title="Estimate templates" subtitle="Reusable starting points for new estimates" count={templates.length}>
        <TemplatesManager initial={templates} />
      </SettingsFolder>

      <SettingsFolder title="What's included templates" subtitle="Reusable inclusion lists applied from the estimate builder" count={inclusionTemplates.length}>
        <InclusionTemplatesManager initial={inclusionTemplates} settingsKey={INCLUSION_TEMPLATES_KEY} boxLabel="What's included" />
      </SettingsFolder>

      <SettingsFolder title="What's excluded templates" subtitle="Reusable exclusion lists applied from the estimate builder" count={exclusionTemplates.length}>
        <InclusionTemplatesManager initial={exclusionTemplates} settingsKey={EXCLUSION_TEMPLATES_KEY} boxLabel="Not included" />
      </SettingsFolder>

      <SettingsFolder title="Terms & conditions" subtitle="Shown on every estimate, below the accept section">
        <TermsEditor initial={terms} />
      </SettingsFolder>

      <SettingsFolder title="Messaging" subtitle="Email + text wording used when sending an estimate, and the text-messaging switch">
        <MessagingSettings initial={messaging} />
      </SettingsFolder>

      <SettingsFolder title="Line items" subtitle="Add, edit or remove line-item templates and their descriptions" count={lineItems.length} defaultOpen>
        <LineItemsManager initial={lineItems} />
      </SettingsFolder>

      <SettingsFolder title="Areas" subtitle="The standard areas offered when you click Add area" count={areas.length}>
        <EditableTable
          table="area_names"
          rows={areas}
          blank={{ area: "", type: "interior" }}
          columns={[
            { key: "area", label: "Area name" },
            { key: "type", label: "Type", type: "select", options: ["interior", "exterior"], width: "10rem" },
          ]}
          addLabel="+ Add area"
        />
      </SettingsFolder>

      <SettingsFolder title="Substrates & production rates" subtitle="Hours per unit and charge-out rate for every surface" count={rateItems.length}>
        {cardId ? (
          <EditableTable
            table="rate_items"
            rows={rateItems}
            blank={{ code: "", category: "Interior", sub_category: "", unit: "M2", rate_card_id: cardId }}
            columns={[
              { key: "code", label: "Substrate" },
              { key: "category", label: "Category", type: "select", options: ["Interior", "Exterior"] },
              { key: "sub_category", label: "Folder" },
              { key: "unit", label: "Unit", type: "select", options: ["M2", "Lineal Metres", "Hours Per Item"] },
              { key: "rate_1_coat", label: "1-coat", type: "number", width: "6rem" },
              { key: "rate_2_coat", label: "2-coat", type: "number", width: "6rem" },
              { key: "rate_3_coat", label: "3-coat", type: "number", width: "6rem" },
              { key: "default_coats", label: "Def. coats", type: "number", width: "6rem" },
              { key: "charge_out_cents", label: "Charge-out $/hr", type: "money", width: "8rem" },
              { key: "default_product", label: "Default product" },
            ]}
            addLabel="+ Add substrate"
          />
        ) : (
          <p className="text-sm text-gray-500">No active rate card found.</p>
        )}
      </SettingsFolder>

      <SettingsFolder title="Products" subtitle="Paint catalogue, photos, blurbs and customer visibility" count={products.length}>
        <ProductsManager initial={products as ProductRow[]} />
      </SettingsFolder>

      <SettingsFolder title="Colours" subtitle="Visual colour library for the colour picker — brand swatches + add your own" count={colours.length}>
        <ColoursManager initial={colours} />
      </SettingsFolder>

      <SettingsFolder title="Presentations" subtitle="Capability/proof blocks injected into the estimate when ticked — video, before/after, reviews, capability" count={presentations.length}>
        <PresentationsManager initial={presentations} usage={usage} />
      </SettingsFolder>

      <SettingsFolder title="Modifiers" subtitle="Condition / access / finish / size multipliers" count={modifiers.length}>
        <EditableTable
          table="modifiers"
          rows={modifiers}
          blank={{ group_name: "", code: "", label: "", multiplier: 1, active: true }}
          columns={[
            { key: "group_name", label: "Group" },
            { key: "code", label: "Code" },
            { key: "label", label: "Label" },
            { key: "multiplier", label: "×", type: "number", width: "6rem" },
            { key: "active", label: "Active", type: "bool", width: "5rem" },
          ]}
          addLabel="+ Add modifier"
        />
      </SettingsFolder>

      <SettingsFolder title="Pricing & job numbers" subtitle="Markup, GST, sundries, contractor rate" count={pricingRows.length}>
        <PricingSettings initial={pricingRows} />
      </SettingsFolder>
    </div>
  );
}
