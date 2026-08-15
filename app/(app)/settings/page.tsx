import { createClient } from "@/lib/supabase/server";
import { DEFAULT_COMPANY, type CompanyProfile } from "@/app/quote/company";
import SettingsForm from "./SettingsForm";
import SettingsFolder from "./SettingsFolder";
import EditableTable from "./EditableTable";
import LineItemsManager, { type LineItemRow } from "./LineItemsManager";
import PricingSettings, { type SettingRow } from "./PricingSettings";
import TemplatesManager, { type TemplateMeta } from "./TemplatesManager";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();

  const [companyRes, lineItemsRes, areasRes, cardRes, productsRes, modifiersRes, settingsRes] = await Promise.all([
    supabase.from("settings").select("value").eq("key", "company_profile").maybeSingle(),
    supabase.from("line_items").select("id, name, type, pricing_method, description").order("type").order("name"),
    supabase.from("area_names").select("id, area, type").order("type").order("area"),
    supabase.from("rate_cards").select("id, version").eq("is_active", true).maybeSingle(),
    supabase.from("products").select("id, name, type, coverage, price_per_litre, wastage_pct, image_url").order("name"),
    supabase.from("modifiers").select("id, group_name, code, label, multiplier, active").order("group_name"),
    supabase.from("settings").select("key, value").order("key"),
  ]);

  const company: CompanyProfile = { ...DEFAULT_COMPANY, ...((companyRes.data?.value as Partial<CompanyProfile>) ?? {}) };
  const lineItems = (lineItemsRes.data as LineItemRow[] | null) ?? [];
  const areas = areasRes.data ?? [];
  const products = productsRes.data ?? [];
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
  const pricingRows = allSettings.filter((r) => r.key !== "company_profile" && r.key !== "estimate_templates");
  const templatesRow = allSettings.find((r) => r.key === "estimate_templates");
  const templates: TemplateMeta[] = (Array.isArray(templatesRow?.value) ? (templatesRow!.value as TemplateMeta[]) : [])
    .map((t) => ({ id: t.id, name: t.name, createdAt: t.createdAt }));

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-gray-500">Everything below is editable. Open a folder to manage that data.</p>

      <SettingsFolder title="Company details" subtitle="Shown on the header of every estimate">
        <SettingsForm initial={company} />
      </SettingsFolder>

      <SettingsFolder title="Estimate templates" subtitle="Reusable starting points for new estimates" count={templates.length}>
        <TemplatesManager initial={templates} />
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

      <SettingsFolder title="Products" subtitle="Paint products, coverage and price" count={products.length}>
        <EditableTable
          table="products"
          rows={products}
          blank={{ name: "", type: "Interior" }}
          columns={[
            { key: "image_url", label: "Photo", type: "image", width: "9rem" },
            { key: "name", label: "Product name" },
            { key: "type", label: "Type", type: "select", options: ["Interior", "Exterior"], width: "9rem" },
            { key: "coverage", label: "Coverage (m²/L)", type: "number", width: "8rem" },
            { key: "price_per_litre", label: "Price $/L", type: "money", width: "7rem" },
            { key: "wastage_pct", label: "Wastage %", type: "number", width: "7rem" },
          ]}
          addLabel="+ Add product"
        />
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
