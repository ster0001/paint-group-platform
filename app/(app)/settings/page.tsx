import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_COMPANY, type CompanyProfile } from "@/app/quote/company";
import SettingsForm from "./SettingsForm";
import SettingsShell, { type SettingsBucketDef } from "./SettingsShell";
import BrainManager, { type BrainRow } from "./BrainManager";
import EditableTable from "./EditableTable";
import LineItemsManager, { type LineItemRow } from "./LineItemsManager";
import PricingSettings, { type SettingRow } from "./PricingSettings";
import { isNumericSetting } from "@/lib/settings/numeric";
import TemplatesManager, { type TemplateMeta } from "./TemplatesManager";
import InclusionTemplatesManager from "./InclusionTemplatesManager";
import TermsEditor, { TERMS_KEY } from "./TermsEditor";
import AutomationsSettings from "./AutomationsSettings";
import InvoicingSettings from "./InvoicingSettings";
import CostIntakeSettings from "./CostIntakeSettings";
import { COST_INTAKE_KEY } from "@/lib/costs/intake";
import { MESSAGING_KEY, type MessagingSettings as MessagingValues } from "@/lib/messaging/config";
import ProductsManager, { type ProductRow } from "./ProductsManager";
import ColoursManager, { type ColourRow } from "./ColoursManager";
import DocumentsManager, { type CompanyDocRow } from "./DocumentsManager";
import TradeAccountsManager from "./TradeAccountsManager";
import ColourCardSettings from "./ColourCardSettings";
import PresentationsManager, { type PresentationRow } from "./PresentationsManager";
import { DEFAULT_INCLUSION_TEMPLATES, DEFAULT_EXCLUSION_TEMPLATES, INCLUSION_TEMPLATES_KEY, EXCLUSION_TEMPLATES_KEY, type InclusionTemplate } from "@/lib/estimate/inclusionTemplates";
import { SCOPE_VERSION } from "@/lib/extract/scope";
import AccountingSettings from "./AccountingSettings";
import { MYOB_ACCOUNTS_KEY, MYOB_CONNECTION_KEY, myobStatus, type MyobAccountMap, type MyobCompanyFile, type MyobConnection } from "@/lib/myob/config";
import { myobEnv } from "@/lib/myob/oauth";
import { freshConnection, listAccounts, listCompanyFiles, type MyobAccount } from "@/lib/myob/client";
import { requestNowMs } from "@/lib/time/requestClock";
import { AUTOMATIONS } from "@/lib/automations/registry";
import WebsiteContentManager from "./WebsiteContentManager";
import { WEBSITE_CONTENT_KEY, parseWebsiteContent } from "@/lib/marketing/siteContent";

const AUTOMATION_COUNT = AUTOMATIONS.length;

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

  // Step 3 scope tables - fetched separately and tolerantly: each degrades to
  // an empty list (with the folder explaining itself) until its migration runs.
  const [scopeRulesRes, roomDefaultsRes, areaPresetsRes] = await Promise.all([
    supabase.from("room_type_scope_rules").select("*").eq("version", SCOPE_VERSION).order("room_type").order("sort_order"),
    supabase.from("room_type_defaults").select("*").eq("version", SCOPE_VERSION).order("room_type"),
    supabase.from("area_name_presets").select("*").eq("version", 1).order("estimate_type").order("sort_order"),
  ]);
  const scopeRules = scopeRulesRes.data ?? [];
  const scopeRulesMigrated = scopeRules.length === 0 || (scopeRules[0] as Record<string, unknown>).countable !== undefined;
  const roomDefaults = roomDefaultsRes.data ?? [];
  const areaPresets = areaPresetsRes.data ?? [];

  const company: CompanyProfile = { ...DEFAULT_COMPANY, ...((companyRes.data?.value as Partial<CompanyProfile>) ?? {}) };
  const lineItems = (lineItemsRes.data as LineItemRow[] | null) ?? [];
  const areas = areasRes.data ?? [];
  const products = productsRes.data ?? [];
  // Paint names for the substrate "Default paint" dropdown.
  const productNames = [...new Set(
    (products as Array<{ name?: string | null }>).map((p) => (p.name ?? "").trim()).filter(Boolean),
  )].sort();
  const colours = (coloursRes.data as ColourRow[] | null) ?? [];
  // 3a-5: company documents + the warranty approval flag. Tolerant reads —
  // both degrade to empty until migration 20261129 runs.
  const [companyDocsRes] = await Promise.all([
    supabase.from("company_documents")
      .select("id, title, kind, storage_path, expires_on, active")
      .order("created_at", { ascending: false }),
  ]);
  const companyDocs = (companyDocsRes.data as CompanyDocRow[] | null) ?? [];
  const warrantyApproved = Boolean(
    ((settingsRes.data ?? []).find((r) => r.key === "warranty_terms")?.value as { approved?: boolean } | undefined)?.approved,
  );
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
  const websiteContent = parseWebsiteContent(allSettings.find((r) => r.key === WEBSITE_CONTENT_KEY)?.value);
  // Numeric levers only, decided by SHAPE. The old filter excluded six named
  // keys and swept up everything else — including whole config objects like
  // `wizard_policy` and `wo_loop`, which coerced to NaN, serialised to null and
  // failed the NOT NULL column, taking the entire save with them. A key added
  // tomorrow is now handled without anyone having to remember this line.
  const pricingRows = allSettings.filter((r) => isNumericSetting(r.value));
  // A6: the window size multipliers live with the other engine factors. Shown
  // with their defaults until saved — saving upserts the rows.
  for (const [key, dflt] of [["Window size — small", 0.8], ["Window size — large", 1.2]] as const) {
    if (!pricingRows.some((r) => r.key.toLowerCase().replace(/[^a-z]+/g, "") === key.toLowerCase().replace(/[^a-z]+/g, ""))) {
      pricingRows.push({ key, value: dflt });
    }
  }
  // A6: the model is one window rate × size multiplier — any legacy separate
  // small/large window rate items keep pricing as-is but are flagged.
  const supersededWindowItems = (rateItems as Array<{ code?: string | null; sub_category?: string | null }>)
    .filter((r) => /window/i.test(`${r.sub_category ?? ""} ${r.code ?? ""}`) && /\b(small|large)\b/i.test(r.code ?? ""))
    .map((r) => r.code as string);
  const messaging = (allSettings.find((r) => r.key === MESSAGING_KEY)?.value as Partial<MessagingValues> | undefined) ?? null;
  // Settings → Automations: the one wo_loop key the office can flip here.
  const variationRelease = ((allSettings.find((r) => r.key === "wo_loop")?.value as { variationRelease?: string } | undefined)?.variationRelease === "pc") ? "pc" as const : "auto" as const;

  // MYOB — status from the stored connection; when connected, the chart of
  // accounts is read live so the mapping dropdowns are MYOB's own list.
  // Everything is tolerant: an unreachable MYOB never breaks Settings.
  const myobConnRaw = (allSettings.find((r) => r.key === MYOB_CONNECTION_KEY)?.value as Partial<MyobConnection> | undefined) ?? null;
  const myobConn = myobConnRaw?.refreshToken ? (myobConnRaw as MyobConnection) : null;
  const myobState = myobStatus(Boolean(myobEnv()), myobConn);
  let myobFiles: MyobCompanyFile[] = [];
  let myobAccounts: MyobAccount[] = [];
  let myobAccountsError: string | null = null;
  if (myobState.state === "pick_business" || myobState.state === "connected") {
    try {
      const live = await freshConnection(supabase, requestNowMs());
      if (live) {
        if (myobState.state === "pick_business") myobFiles = await listCompanyFiles(live);
        else myobAccounts = await listAccounts(live);
      }
    } catch (e) {
      myobAccountsError = e instanceof Error ? e.message : "MYOB didn't answer";
    }
  }
  const myobMap = ((allSettings.find((r) => r.key === MYOB_ACCOUNTS_KEY)?.value as { accounts?: MyobAccountMap } | undefined)?.accounts) ?? {};
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

  const brainRes = await (await import("@/lib/supabase/server")).createClient().then((c) => c.from("brain_entries").select("id, slug, topic, question, answer_md, audience, status, needs_content").order("topic").order("slug"));
  const brainRows = ((brainRes.error ? [] : brainRes.data) ?? []) as BrainRow[];

  // ---- the buckets (Tom, 3 Sep 2026) --------------------------------------
  // Six sections, each a list of folders. Titles are what the office and the
  // e2e specs click on — keep them stable; move folders between buckets freely.
  const buckets: SettingsBucketDef[] = [
    {
      id: "company", title: "Company", icon: "🏢",
      blurb: "Who you are on every document and portal.",
      folders: [
        { id: "company-details", title: "Company details", subtitle: "Company info, logo and project coordinator — shown on the header of every estimate", defaultOpen: true,
          content: <SettingsForm initial={company} /> },
        { id: "documents", title: "Documents", subtitle: "Credentials on display in every customer portal — insurance certificates with expiry, plus the warranty-terms approval switch", count: companyDocs.length,
          content: <DocumentsManager initialDocs={companyDocs} warrantyApproved={warrantyApproved} /> },
        { id: "website", title: "Website", subtitle: "The homepage's painter cards and the photos in the promise card and the progress story — the top-left logo comes from Company details (logo 1)", count: websiteContent.painters.length,
          content: <WebsiteContentManager initial={websiteContent} /> },
        { id: "showcase", title: "Showcase jobs", subtitle: "Finished jobs shown on the website as “Real jobs, real prices” — photos, price range, what we did; the three featured ones are the homepage cards",
          content: (
            <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
              <span>Each job is one page on the website, filled in top to bottom exactly as a visitor reads it.</span>
              <Link href="/settings/showcase" data-testid="open-showcase" className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700">Open showcase jobs →</Link>
            </div>
          ) },
        { id: "trade-accounts", title: "Trade accounts", subtitle: "Create a trade login or grant an existing customer the trade workspace — office-side only, never self-serve",
          content: (
            <>
              <TradeAccountsManager />
              <div className="mt-4 border-t border-gray-200 pt-4">
                <ColourCardSettings />
              </div>
            </>
          ) },
      ],
    },
    {
      id: "communications", title: "Communications & automations", icon: "✉️",
      blurb: "Every message the platform sends, and what the assistant may say.",
      folders: [
        { id: "automations", title: "Automations", subtitle: "Every email, text and calendar invite sent to customers and painters — what fires it, switch it off, change the wording", count: AUTOMATION_COUNT,
          content: <AutomationsSettings initial={messaging} initialVariationRelease={variationRelease} /> },
        { id: "brain", title: "Brain", subtitle: "What the assistant may say about how Paint Group works — approve each entry; unwritten ones are never served", count: brainRows.length,
          content: <BrainManager rows={brainRows} /> },
      ],
    },
    {
      id: "estimates", title: "Estimates", icon: "📄",
      blurb: "Templates and wording that shape every estimate the customer reads.",
      folders: [
        { id: "estimate-templates", title: "Estimate templates", subtitle: "Reusable starting points for new estimates", count: templates.length,
          content: <TemplatesManager initial={templates} /> },
        { id: "included-templates", title: "What's included templates", subtitle: "Reusable inclusion lists applied from the estimate builder", count: inclusionTemplates.length,
          content: <InclusionTemplatesManager initial={inclusionTemplates} settingsKey={INCLUSION_TEMPLATES_KEY} boxLabel="What's included" /> },
        { id: "excluded-templates", title: "What's excluded templates", subtitle: "Reusable exclusion lists applied from the estimate builder", count: exclusionTemplates.length,
          content: <InclusionTemplatesManager initial={exclusionTemplates} settingsKey={EXCLUSION_TEMPLATES_KEY} boxLabel="Not included" /> },
        { id: "terms", title: "Terms & conditions", subtitle: "Shown on every estimate, below the accept section",
          content: <TermsEditor initial={terms} /> },
        { id: "presentations", title: "Presentations", subtitle: "Capability/proof blocks injected into the estimate when ticked — video, before/after, reviews, capability", count: presentations.length,
          content: <PresentationsManager initial={presentations} usage={usage} /> },
      ],
    },
    {
      id: "pricing", title: "Pricing", icon: "💲",
      blurb: "The numbers behind every price: rates, multipliers, products, overheads.",
      folders: [
        { id: "pricing-numbers", title: "Pricing & job numbers", subtitle: "Markup, GST, sundries, contractor rate, window sizes, overheads", count: pricingRows.length,
          content: (
            <>
              {supersededWindowItems.length > 0 && (
                <p className="mb-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Superseded: {supersededWindowItems.join(", ")} — window sizing is now one window rate × the
                  S/M/L multiplier below. These items still price as before where used, but new work should
                  use the size control instead.
                </p>
              )}
              <PricingSettings initial={pricingRows} />
            </>
          ) },
        { id: "substrates", title: "Substrates & production rates", subtitle: "Hours per unit and charge-out rate for every surface", count: rateItems.length,
          content: cardId ? (
            <EditableTable
              table="rate_items"
              rows={rateItems}
              sectionKey="sub_category"
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
                // The paint field lists the products on file rather than free text.
                { key: "default_product", label: "Default paint", type: "select", options: productNames },
                // Paint quantity per item (Hours Per Item rows) / metres per litre
                // (Lineal Metres rows) — Tom, 5 Sep: the garage door read 22 L
                // because this sat at 10 with no way to see or change it.
                { key: "litres_per_item_per_coat", label: "L / item / coat", type: "number", width: "7rem" },
                { key: "metres_per_litre", label: "m / L", type: "number", width: "6rem" },
              ]}
              addLabel="+ Add substrate"
            />
          ) : (
            <p className="text-sm text-gray-500">No active rate card found.</p>
          ) },
        { id: "modifiers", title: "Modifiers", subtitle: "Condition / access / finish / size multipliers — a Poor or Heritage condition adds prep hours for the painter too", count: modifiers.length,
          content: (
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
          ) },
        { id: "line-items", title: "Line items", subtitle: "Add, edit or remove line-item templates and their descriptions", count: lineItems.length,
          content: <LineItemsManager initial={lineItems} /> },
        { id: "products", title: "Products", subtitle: "Paint catalogue, photos, blurbs and customer visibility", count: products.length,
          content: <ProductsManager initial={products as ProductRow[]} /> },
        { id: "colours", title: "Colours", subtitle: "Visual colour library for the colour picker — brand swatches + add your own", count: colours.length,
          content: <ColoursManager initial={colours} /> },
      ],
    },
    {
      id: "scope", title: "Rooms & scope rules", icon: "📐",
      blurb: "What the wizard, the plan reader and capture mode offer for each room.",
      folders: [
        { id: "areas", title: "Areas", subtitle: "The standard areas offered when you click Add area", count: areas.length,
          content: (
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
          ) },
        { id: "area-presets", title: "Area name presets", subtitle: "The room/area names offered by capture mode's AreaPicker, per estimate type", count: areaPresets.length,
          content: (
            <>
              {areaPresets.length === 0 && (
                <p className="mb-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  No rows found - run migration 20260913000000_step3_shared_scope.sql (creates and seeds this table).
                </p>
              )}
              <EditableTable
                table="area_name_presets"
                rows={areaPresets}
                blank={{ version: 1, estimate_type: "interior", name: "", room_type: "", sort_order: 0 }}
                columns={[
                  { key: "estimate_type", label: "Type", type: "select", options: ["interior", "exterior", "commercial"], width: "8rem" },
                  { key: "name", label: "Name" },
                  { key: "room_type", label: "Room type" },
                  { key: "sort_order", label: "Order", type: "number", width: "5rem" },
                ]}
                addLabel="+ Add name"
              />
            </>
          ) },
        { id: "room-scope-rules", title: "Room scope rules", subtitle: "Which surfaces each room type gets - drives the AI plan reader AND the capture tile grid", count: scopeRules.length,
          content: (
            <>
              {!scopeRulesMigrated && (
                <p className="mb-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Tile grouping columns are missing - run migration 20260913000000_step3_shared_scope.sql to edit grouping and order here.
                </p>
              )}
              <EditableTable
                table="room_type_scope_rules"
                rows={scopeRules}
                blank={{ version: SCOPE_VERSION, room_type: "", surface_type: "", is_option: false, requires_confirm: false, countable: false, tile_group: "core", sort_order: 0 }}
                columns={[
                  { key: "room_type", label: "Room type" },
                  { key: "surface_type", label: "Surface" },
                  ...(scopeRulesMigrated
                    ? [
                        { key: "tile_group", label: "Group", type: "select" as const, options: ["core", "openings", "joinery", "extras"], width: "8rem" },
                        { key: "sort_order", label: "Order", type: "number" as const, width: "5rem" },
                        { key: "countable", label: "Countable", type: "bool" as const, width: "6rem" },
                      ]
                    : []),
                  { key: "is_option", label: "Optional", type: "bool", width: "6rem" },
                  { key: "requires_confirm", label: "Confirm", type: "bool", width: "6rem" },
                  { key: "notes", label: "Notes" },
                ]}
                addLabel="+ Add rule"
              />
            </>
          ) },
        { id: "room-sizes", title: "Typical room sizes", subtitle: "Owner-supplied typical dimensions per room type - powers no-plan starter lists and wizard defaults", count: roomDefaults.length,
          content: (
            <>
              {roomDefaults.length === 0 && (
                <p className="mb-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  No rows found - run migration 20260912000000_room_type_defaults.sql, then scripts/seed-extraction-settings.ts.
                </p>
              )}
              <EditableTable
                table="room_type_defaults"
                rows={roomDefaults}
                blank={{ version: SCOPE_VERSION, room_type: "", typical_length_m: 3.5, typical_width_m: 3.25 }}
                columns={[
                  { key: "room_type", label: "Room type" },
                  { key: "typical_length_m", label: "Length (m)", type: "number", width: "7rem" },
                  { key: "typical_width_m", label: "Width (m)", type: "number", width: "7rem" },
                  { key: "notes", label: "Notes" },
                ]}
                addLabel="+ Add room type"
              />
            </>
          ) },
      ],
    },
    {
      id: "money", title: "Money", icon: "🧾",
      blurb: "Invoices, the ledger, and the bills that come in.",
      folders: [
        { id: "invoicing", title: "Invoicing", subtitle: "Business identity, bank details and money defaults — shown on every invoice and the customer payment page",
          content: (
            <InvoicingSettings
              initialEntity={(allSettings.find((r) => r.key === "invoicing_entity")?.value as Record<string, string> | undefined) ?? null}
              initialBank={(allSettings.find((r) => r.key === "invoicing_bank")?.value as Record<string, string> | undefined) ?? null}
              initialCore={(allSettings.find((r) => r.key === "invoicing")?.value as Record<string, number> | undefined) ?? null}
            />
          ) },
        { id: "accounting", title: "Accounting — MYOB", subtitle: "Connect MYOB Business and choose which ledger accounts the platform's money posts to",
          content: (
            <AccountingSettings
              status={myobState}
              files={myobFiles}
              accounts={myobAccounts}
              initialMap={myobMap}
              accountsError={myobAccountsError}
            />
          ) },
        { id: "cost-intake", title: "Cost intake", subtitle: "bills@ intake queue rules — duplicate window, auto-confirm, contractor expense threshold",
          content: (
            <CostIntakeSettings
              initial={(allSettings.find((r) => r.key === COST_INTAKE_KEY)?.value as { duplicateWindowDays?: number; autoConfirmExactRef?: boolean; expenseThresholdCents?: number } | undefined) ?? null}
            />
          ) },
      ],
    },
  ];

  return (
    <div className="p-6">
      <div className="max-w-5xl">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Grouped into six sections. Jump with the bar below, or search for a setting by name. Open a folder to edit it.
        </p>
      </div>
      <SettingsShell buckets={buckets} />
    </div>
  );
}
