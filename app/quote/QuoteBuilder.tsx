"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { hoursPerUnit } from "@/lib/pricing/engine";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import EstimateHeader from "./EstimateHeader";
import type { CompanyProfile, Contact, JobAddress } from "./company";
import type { Product, RateItem } from "@/lib/pricing/types";

type MediaItem = { path: string; url: string };
type Modifier = { code: string; group_name: string; label: string; multiplier: number };
type Setting = { key: string; value: { value: number } | number | null };
type LineItemRef = { name: string; type: string; pricing_method: string; description?: string | null };
type AreaNameRef = { area: string; type: "interior" | "exterior" };

type Surface = {
  id: number;
  code: string;
  coats: number;
  count: number;
  hidden: boolean; // priced into the total, but omitted from the customer's copy
  media: MediaItem[];
  qtyOverride: number | null;
  rateOverride: number | null; // productivity (units/hr) or hours/item
  paintingHrOverride: number | null;
  prepHr: number;
  productName: string | null;
  coverageOverride: number | null;
  volumeOverride: number | null;
  unitPriceOverride: number | null; // $/L
  open: boolean;
};
type AreaType = "room" | "surface";
type Area = {
  id: number;
  kind: "area";
  name: string;
  type: "Interior" | "Exterior";
  areaType: AreaType;
  L: number;
  W: number;
  H: number;
  isOption: boolean; // sits outside the total until the customer adds it
  media: MediaItem[];
  surfaces: Surface[];
};
type LineBlock = {
  id: number;
  kind: "line";
  name: string;
  type: "Interior" | "Exterior";
  mode: "hourly" | "quantity" | "custom";
  hours: number;
  rate: number; // $/hr
  qty: number;
  unitPrice: number; // $
  custom: number; // $
  cost: number; // $ (materials/passthrough cost for margin)
  woHours: number; // hours for work order (contractor) on quantity/custom lines
  description: string; // rich-text (HTML) description shown on the estimate; seeded from the line-item template
  clientNote: string;
  crewNote: string;
  hidden: boolean; // priced but omitted from the customer's copy
  isOption: boolean; // sits outside the total until the customer adds it
  media: MediaItem[];
  open: boolean;
  detailsOpen: boolean;
};
type Block = Area | LineBlock;

const fmt = (c: number) => "$" + (c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = (c: number) => "$" + Math.round(c / 100).toLocaleString("en-AU");
let nextId = 1;

// Quantity for a surface, from the AREA's dimensions and Room/Surface geometry.
// A surface can still override with a direct m²/lineal/count value.
function computeQuantity(item: RateItem | undefined, area: Area, s: Surface): number {
  if (!item) return 0;
  if (s.qtyOverride != null) return s.qtyOverride;
  if (item.unit === "Hours Per Item") return s.count;
  const flat = /ceiling|floor|roof|soffit/i.test(item.sub_category ?? "");
  const { L, W, H } = area;
  if (area.areaType === "surface") {
    // a single plane: length × height (area), or just length (lineal)
    if (item.unit === "Lineal Metres") return L || 0;
    return L && H ? L * H : 0;
  }
  // a room: four walls (perimeter × height), ceilings/floors (L × W), lineal = perimeter
  if (item.unit === "Lineal Metres") return L && W ? 2 * (L + W) : 0;
  if (flat) return L && W ? L * W : 0;
  return L && W && H ? 2 * (L + W) * H : 0;
}
const unitLabel = (item?: RateItem) =>
  !item ? "" : item.unit === "Hours Per Item" ? "items" : item.unit === "Lineal Metres" ? "m" : "m²";

export default function QuoteBuilder({
  rateCardId,
  rateCardVersion,
  rateItems,
  modifiers,
  products,
  settings,
  lineItems,
  areaNames,
  initial,
  company,
  contacts,
}: {
  rateCardId: string | null;
  rateCardVersion: number | null;
  rateItems: RateItem[];
  modifiers: Modifier[];
  products: Product[];
  settings: Setting[];
  lineItems: LineItemRef[];
  areaNames: AreaNameRef[];
  initial: { id: string; title: string | null; builder_state: unknown } | null;
  company: CompanyProfile;
  contacts: Contact[];
}) {
  const normKey = (k: string) => k.replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase();
  const settingsMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of settings) {
      const v = s.value == null ? undefined : typeof s.value === "number" ? s.value : s.value.value;
      if (v != null) m.set(normKey(s.key), v);
    }
    return m;
  }, [settings]);
  const sNum = (k: string) => settingsMap.get(normKey(k));
  const markup = sNum("Materials markup") ?? 0.1;
  const gstRate = sNum("GST") ?? 0.1;
  const sundriesIntCents = Math.round((sNum("Sundries per job — interior") ?? 0) * 100);
  const sundriesExtCents = Math.round((sNum("Sundries per job — exterior") ?? 0) * 100);
  const contractorHourlyCents = Math.round((sNum("Contractor rate") ?? 60) * 100);
  const offerPct = sNum("Contractor offer — % of estimated hours") ?? 1;
  const chargeFor = (t: string) => rateItems.find((r) => r.category === t)?.charge_out_cents ?? (t === "Interior" ? 8500 : 10000);

  const itemByKey = useMemo(() => {
    const m = new Map<string, RateItem>();
    for (const r of rateItems) m.set(`${r.category}::${r.code}`, r);
    return m;
  }, [rateItems]);
  const productByName = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of products) m.set(p.name, p);
    return m;
  }, [products]);
  // substrates grouped into folders (sub-category) per Interior/Exterior
  const subGroups = useMemo(() => {
    const g: Record<string, Record<string, RateItem[]>> = { Interior: {}, Exterior: {} };
    for (const r of rateItems) {
      const cat = r.category === "Exterior" ? "Exterior" : "Interior";
      const sub = r.sub_category ?? "Other";
      ((g[cat] ||= {})[sub] ||= []).push(r);
    }
    return g;
  }, [rateItems]);
  const modGroups = useMemo(() => {
    const g: Record<string, Modifier[]> = {};
    for (const m of modifiers) (g[m.group_name] ||= []).push(m);
    return g;
  }, [modifiers]);

  const loaded = (initial?.builder_state ?? null) as { blocks?: Block[]; modSel?: Record<string, string>; contact?: Contact; jobAddress?: JobAddress } | null;
  const [blocks, setBlocks] = useState<Block[]>(() => {
    const b = loaded?.blocks;
    if (b && b.length) {
      const ids = b.flatMap((x) => [x.id, ...(x.kind === "area" ? x.surfaces.map((s) => s.id) : [])]);
      nextId = Math.max(nextId, ...ids) + 1;
      return b;
    }
    return [newArea()];
  });
  const [modSel, setModSel] = useState<Record<string, string>>(() => loaded?.modSel ?? {});
  const [contact, setContact] = useState<Contact | null>(() => loaded?.contact ?? null);
  const [jobAddress, setJobAddress] = useState<JobAddress | null>(() => loaded?.jobAddress ?? null);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [quoteId, setQuoteId] = useState<string | null>(initial?.id ?? null);
  const [focusAreaId, setFocusAreaId] = useState<number | null>(null);
  const [areaPickerOpen, setAreaPickerOpen] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [saving, setSaving] = useState(false);

  function newArea(preset?: { name: string; type: "Interior" | "Exterior" }): Area {
    const type = preset?.type ?? "Interior";
    return {
      id: nextId++,
      kind: "area",
      name: preset?.name ?? `Area ${nextId}`,
      type,
      areaType: type === "Exterior" ? "surface" : "room",
      L: 0, W: 0, H: 2.4, isOption: false, media: [], surfaces: [newSurface()],
    };
  }
  function newSurface(): Surface {
    return {
      id: nextId++, code: "", coats: 2, count: 1, hidden: false, media: [], qtyOverride: null,
      rateOverride: null, paintingHrOverride: null, prepHr: 0, productName: null,
      coverageOverride: null, volumeOverride: null, unitPriceOverride: null, open: false,
    };
  }
  function newLine(): LineBlock {
    return { id: nextId++, kind: "line", name: "", type: "Interior", mode: "hourly", hours: 0, rate: 85, qty: 1, unitPrice: 0, custom: 0, cost: 0, woHours: 0, description: "", clientNote: "", crewNote: "", hidden: false, isOption: false, media: [], open: true, detailsOpen: false };
  }

  const patchBlock = (id: number, patch: Partial<Area> | Partial<LineBlock>) =>
    setBlocks((bs) => bs.map((b) => (b.id === id ? ({ ...b, ...patch } as Block) : b)));
  const patchSurface = (areaId: number, sid: number, patch: Partial<Surface>) =>
    setBlocks((bs) =>
      bs.map((b) =>
        b.id === areaId && b.kind === "area"
          ? { ...b, surfaces: b.surfaces.map((s) => (s.id === sid ? { ...s, ...patch } : s)) }
          : b,
      ),
    );
  const removeBlock = (id: number) => setBlocks((bs) => bs.filter((b) => b.id !== id));
  const duplicateBlock = (id: number) =>
    setBlocks((bs) => {
      const i = bs.findIndex((b) => b.id === id);
      if (i < 0) return bs;
      const b = bs[i];
      const clone: Block =
        b.kind === "area"
          ? { ...b, id: nextId++, name: `${b.name} (copy)`, surfaces: b.surfaces.map((s) => ({ ...s, id: nextId++ })) }
          : { ...b, id: nextId++ };
      return [...bs.slice(0, i + 1), clone, ...bs.slice(i + 1)];
    });
  const duplicateSurface = (areaId: number, sid: number) =>
    setBlocks((bs) =>
      bs.map((b) => {
        if (b.id !== areaId || b.kind !== "area") return b;
        const i = b.surfaces.findIndex((s) => s.id === sid);
        if (i < 0) return b;
        const clone = { ...b.surfaces[i], id: nextId++ };
        return { ...b, surfaces: [...b.surfaces.slice(0, i + 1), clone, ...b.surfaces.slice(i + 1)] };
      }),
    );

  const modMult = (group: string) => (modSel[group] ? modifiers.find((m) => m.code === modSel[group])?.multiplier : undefined);
  const finishChosen = !!modSel["Level of Finish"];
  const jobMod =
    (modMult("Condition") ?? 1) *
    (modMult("Access") ?? 1) *
    (modMult("Level of Finish") ?? 1) *
    (modMult("Job Size") ?? 1) *
    (modSel["Staging"] ? modifiers.find((m) => m.code === modSel["Staging"])!.multiplier : 1);

  // ---- pricing ----
  type SCalc = { qty: number; item?: RateItem; paintingHr: number; prepHr: number; labourCents: number; volume: number; matCostCents: number; matPriceCents: number; totalCents: number };
  const surfaceCalc = (area: Area, s: Surface): SCalc => {
    const item = itemByKey.get(`${area.type}::${s.code}`);
    if (!item) return { qty: 0, paintingHr: 0, prepHr: s.prepHr, labourCents: Math.round(s.prepHr * chargeFor(area.type)), volume: 0, matCostCents: 0, matPriceCents: 0, totalCents: 0 };
    const qty = computeQuantity(item, area, s);
    const isItem = item.unit === "Hours Per Item";
    const baseHpu = hoursPerUnit(item, s.coats);
    const dispRate = s.rateOverride ?? (isItem ? baseHpu : 1 / baseHpu);
    const baseHours = isItem ? dispRate * qty : dispRate > 0 ? qty / dispRate : 0;
    const paintingHr = s.paintingHrOverride ?? baseHours * jobMod;
    const charge = chargeFor(area.type);
    const labourCents = Math.round((paintingHr + s.prepHr) * charge);

    const product = s.productName ? productByName.get(s.productName) : item.default_product ? productByName.get(item.default_product) : undefined;
    const wastage = (product?.wastage_pct ?? 0) / 100;
    const coverage = s.coverageOverride ?? product?.coverage ?? null;
    let volume = s.volumeOverride;
    if (volume == null) {
      if (isItem) volume = item.litres_per_item_per_coat != null ? qty * s.coats * item.litres_per_item_per_coat * (1 + wastage) : 0;
      else if (item.metres_per_litre != null) volume = (qty * s.coats) / item.metres_per_litre * (1 + wastage);
      else if (coverage) volume = (qty * s.coats) / coverage * (1 + wastage);
      else volume = 0;
    }
    const unitPriceCents = s.unitPriceOverride != null ? Math.round(s.unitPriceOverride * 100) : product?.price_per_litre ?? 0;
    const matCostCents = Math.round(volume * unitPriceCents);
    const matPriceCents = Math.round(matCostCents * (1 + markup));
    return { qty, item, paintingHr, prepHr: s.prepHr, labourCents, volume, matCostCents, matPriceCents, totalCents: labourCents + matPriceCents };
  };
  const lineCalc = (l: LineBlock) => {
    let priceCents = 0;
    let hours = 0;
    let costCents = Math.round(l.cost * 100);
    if (l.mode === "hourly") {
      hours = l.hours;
      priceCents = Math.round(l.hours * l.rate * 100);
      costCents = 0; // labour paid via contractor offer
    } else if (l.mode === "quantity") {
      priceCents = Math.round(l.qty * l.unitPrice * 100);
      hours = l.woHours;
    } else {
      priceCents = Math.round(l.custom * 100);
      hours = l.woHours;
    }
    return { priceCents, hours, costCents };
  };

  const totals = useMemo(() => {
    let subtotal = 0, contractorHours = 0, materialsCost = 0;
    let anyInt = false, anyExt = false;
    for (const b of blocks) {
      if (b.isOption) continue; // options are outside the total until added
      if (b.kind === "area") {
        if (b.type === "Interior") anyInt = true; else anyExt = true;
        for (const s of b.surfaces) {
          const c = surfaceCalc(b, s);
          subtotal += c.totalCents;
          contractorHours += c.paintingHr + c.prepHr;
          materialsCost += c.matCostCents;
        }
      } else {
        if (b.type === "Interior") anyInt = true; else anyExt = true;
        const c = lineCalc(b);
        subtotal += c.priceCents;
        contractorHours += c.hours;
        materialsCost += c.costCents;
      }
    }
    const sundries = (anyInt ? sundriesIntCents : 0) + (anyExt ? sundriesExtCents : 0);
    subtotal += sundries;
    const gst = Math.round(subtotal * gstRate);
    const contractorOffer = Math.round(contractorHours * contractorHourlyCents * offerPct);
    const margin = subtotal - contractorOffer - materialsCost;
    return { subtotal, sundries, gst, total: subtotal + gst, contractorHours, contractorOffer, materialsCost, margin };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, modSel]);

  const marginPct = totals.subtotal > 0 ? (totals.margin / totals.subtotal) * 100 : 0;
  const salesRateCents = totals.contractorHours > 0 ? Math.round(totals.subtotal / totals.contractorHours) : 0;

  async function save() {
    setSaving(true);
    setSaveMsg("");
    const supabase = createClient();
    const finishCode = modSel["Level of Finish"];
    const payload = {
      title: title.trim() || "Untitled quote",
      status: "draft",
      rate_card_id: rateCardId,
      rate_card_version: rateCardVersion,
      level_of_finish: finishCode ? Number(finishCode.split("-")[1]) : null,
      size_band: modSel["Job Size"] || null,
      subtotal_cents: totals.subtotal,
      total_cents: totals.total,
      builder_state: { blocks, modSel, contact, jobAddress },
    };
    try {
      if (quoteId) {
        const { error } = await supabase.from("estimates").update(payload).eq("id", quoteId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("estimates").insert(payload).select("id").single();
        if (error) throw error;
        setQuoteId(data.id);
        window.history.replaceState(null, "", `/quote?id=${data.id}`);
      }
      setSaveMsg("Saved ✓");
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const renderBlock = (b: Block) =>
    b.kind === "area" ? (
      <AreaCard
        key={b.id}
        area={b}
        subGroups={subGroups[b.type]}
        itemByKey={itemByKey}
        products={products}
        calc={(s) => surfaceCalc(b, s)}
        onPatch={(patch) => patchBlock(b.id, patch)}
        onPatchSurface={(sid, patch) => patchSurface(b.id, sid, patch)}
        onAddSurface={() => patchBlock(b.id, { surfaces: [...b.surfaces, newSurface()] })}
        onRemoveSurface={(sid) => patchBlock(b.id, { surfaces: b.surfaces.filter((x) => x.id !== sid) })}
        onDuplicateSurface={(sid) => duplicateSurface(b.id, sid)}
        onDuplicate={() => duplicateBlock(b.id)}
        onRemove={() => removeBlock(b.id)}
      />
    ) : (
      <LineCard
        key={b.id}
        line={b}
        calc={lineCalc(b)}
        lineItems={lineItems}
        chargeFor={chargeFor}
        onPatch={(patch) => patchBlock(b.id, patch)}
        onDuplicate={() => duplicateBlock(b.id)}
        onRemove={() => removeBlock(b.id)}
      />
    );
  const mainBlocks = blocks.filter((b) => !b.isOption);
  const optionBlocks = blocks.filter((b) => b.isOption);
  const focusArea = focusAreaId != null ? (blocks.find((b) => b.id === focusAreaId && b.kind === "area") as Area | undefined) : undefined;
  const renderSummary = (b: Block) =>
    b.kind === "area" ? (
      <AreaSummary
        key={b.id}
        area={b}
        calc={(s) => surfaceCalc(b, s)}
        onOpen={() => setFocusAreaId(b.id)}
        onToggleOption={(v) => patchBlock(b.id, { isOption: v })}
        onDuplicate={() => duplicateBlock(b.id)}
        onRemove={() => removeBlock(b.id)}
      />
    ) : (
      renderBlock(b)
    );

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/estimates" className="text-sm font-medium text-gray-500 hover:text-gray-900">← Estimates</Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title || "New estimate"}</h1>
          <p className="text-sm text-gray-500">
            Rate card v{rateCardVersion ?? "?"} · live pricing
            {quoteId ? " · saved draft" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="w-48 rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="Quote name"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button
            onClick={save}
            disabled={saving}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : quoteId ? "Save" : "Save draft"}
          </button>
          <a href="/quote" className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50">
            New
          </a>
          {saveMsg && (
            <span className={`text-sm ${saveMsg.startsWith("Saved") ? "text-green-600" : "text-red-600"}`}>{saveMsg}</span>
          )}
        </div>
      </div>

      <div className="mt-6">
        <EstimateHeader
          company={company}
          contacts={contacts}
          contact={contact}
          jobAddress={jobAddress}
          onContact={setContact}
          onJobAddress={setJobAddress}
          estimateId={quoteId ? quoteId.slice(0, 8) : "New"}
          dateStr={new Date().toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          {focusArea ? (
            /* ---------- focused single-area view ---------- */
            <>
              <button
                onClick={() => setFocusAreaId(null)}
                className="flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900"
              >
                ← All areas
              </button>
              {renderBlock(focusArea)}
            </>
          ) : (
            /* ---------- overview: job settings + area cards ---------- */
            <>
              <section className="rounded-xl border border-gray-200 bg-white p-4">
                <h2 className="text-sm font-semibold">Job settings</h2>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {["Condition", "Access", "Level of Finish", "Job Size", "Staging"].map((group) => (
                    <label key={group} className="block text-xs">
                      <span className={group === "Level of Finish" ? "font-semibold text-gray-900" : "text-gray-500"}>
                        {group}{group === "Level of Finish" ? " *" : ""}
                      </span>
                      <select
                        className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                        value={modSel[group] ?? ""}
                        onChange={(e) => setModSel((s) => ({ ...s, [group]: e.target.value }))}
                      >
                        <option value="">{group === "Level of Finish" ? "— required —" : "— none —"}</option>
                        {(modGroups[group] ?? []).map((m) => (
                          <option key={m.code} value={m.code}>{m.label} (×{m.multiplier})</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </section>

              {mainBlocks.map(renderSummary)}

              {optionBlocks.length > 0 && (
                <section className="rounded-xl border border-dashed border-gray-300 bg-white p-4">
                  <h2 className="text-sm font-semibold">
                    Options{" "}
                    <span className="font-normal text-gray-400">— not in the total until the customer adds them</span>
                  </h2>
                  <div className="mt-3 space-y-4">{optionBlocks.map(renderSummary)}</div>
                </section>
              )}

              <div className="flex gap-3">
                <button onClick={() => setAreaPickerOpen(true)} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700">
                  + Add area
                </button>
                <button onClick={() => setBlocks((bs) => [...bs, newLine()])} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50">
                  + Add line item
                </button>
              </div>
            </>
          )}
        </div>

        {/* right panel */}
        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          {!finishChosen && (
            <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Showing Level 3 pricing. <strong>Choose a level of finish</strong> before sending.
            </div>
          )}
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-semibold">Quote</h2>
            <dl className="mt-3 space-y-1.5 text-sm">
              <Row label="Subtotal" value={fmt(totals.subtotal)} />
              <Row label={`GST (${Math.round(gstRate * 100)}%)`} value={fmt(totals.gst)} muted />
              <div className="flex justify-between border-t border-gray-200 pt-2 text-base font-semibold">
                <span>Total</span><span>{fmt(totals.total)}</span>
              </div>
              <div className="!mt-3 grid grid-cols-2 gap-2 text-center">
                <Stat label="Total hours" value={totals.contractorHours.toFixed(2)} />
                <Stat label="Sales rate" value={`${fmt0(salesRateCents)}/hr`} />
              </div>
            </dl>
          </div>
          <div className="rounded-xl border border-gray-900 bg-gray-900 p-4 text-white">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Margin</h2>
              <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-300">Staff only</span>
            </div>
            <dl className="mt-3 space-y-1.5 text-sm">
              <Row label={`Contractor (${totals.contractorHours.toFixed(1)} hr)`} value={"−" + fmt(totals.contractorOffer)} dark />
              <Row label="Materials cost" value={"−" + fmt(totals.materialsCost)} dark />
              <div className="flex items-baseline justify-between border-t border-white/15 pt-2">
                <span className="text-sm font-semibold">Margin</span>
                <span className={`text-lg font-bold ${totals.margin >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {fmt(totals.margin)}<span className="ml-1 text-xs font-normal text-gray-400">{marginPct.toFixed(0)}%</span>
                </span>
              </div>
            </dl>
          </div>
        </aside>
      </div>

      {areaPickerOpen && (
        <AreaPicker
          areaNames={areaNames}
          onPick={(preset) => {
            setBlocks((bs) => [...bs, newArea(preset)]);
          }}
          onClose={() => setAreaPickerOpen(false)}
        />
      )}
    </main>
  );
}

// ---------------- Add-area picker ----------------
function AreaPicker({
  areaNames, onPick, onClose,
}: {
  areaNames: AreaNameRef[];
  onPick: (preset?: { name: string; type: "Interior" | "Exterior" }) => void;
  onClose: () => void;
}) {
  const [added, setAdded] = useState(0);
  const [query, setQuery] = useState("");
  const groups: { label: "Interior" | "Exterior"; names: string[] }[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pick = (t: "interior" | "exterior") =>
      areaNames.filter((a) => a.type === t && (!q || a.area.toLowerCase().includes(q))).map((a) => a.area);
    return [
      { label: "Interior", names: pick("interior") },
      { label: "Exterior", names: pick("exterior") },
    ];
  }, [areaNames, query]);

  const add = (name: string, type: "Interior" | "Exterior") => {
    onPick({ name, type });
    setAdded((n) => n + 1);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onClick={onClose}>
      <div
        className="mt-4 w-full max-w-2xl rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Add an area</h2>
            <p className="text-xs text-gray-500">Pick from your standard areas, or start a blank one. Click as many as you need.</p>
          </div>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-2xl leading-none text-gray-400 hover:text-gray-700" aria-label="Close">×</button>
        </div>

        <div className="px-5 pt-4">
          <input
            autoFocus
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="Search areas…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="max-h-[55vh] space-y-5 overflow-y-auto px-5 py-4">
          {groups.map((g) =>
            g.names.length === 0 ? null : (
              <div key={g.label}>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{g.label}</div>
                <div className="flex flex-wrap gap-2">
                  {g.names.map((name) => (
                    <button
                      key={name}
                      onClick={() => add(name, g.label)}
                      className="rounded-full border border-gray-300 px-3 py-1.5 text-sm hover:border-gray-900 hover:bg-gray-900 hover:text-white"
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>
            ),
          )}
          {groups.every((g) => g.names.length === 0) && (
            <p className="text-sm text-gray-500">No standard areas match “{query}”. Use “Blank area” below, or add areas in Settings later.</p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-5 py-4">
          <button
            onClick={() => add("Area", "Interior")}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50"
          >
            + Blank area
          </button>
          <div className="flex items-center gap-3">
            {added > 0 && <span className="text-sm text-green-600">{added} added</span>}
            <button onClick={onClose} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700">
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------- Area ----------------
function AreaCard({
  area, subGroups, itemByKey, products, calc, onPatch, onPatchSurface, onAddSurface, onRemoveSurface, onDuplicateSurface, onDuplicate, onRemove,
}: {
  area: Area;
  subGroups: Record<string, RateItem[]>;
  itemByKey: Map<string, RateItem>;
  products: Product[];
  calc: (s: Surface) => { qty: number; item?: RateItem; paintingHr: number; prepHr: number; labourCents: number; volume: number; matCostCents: number; matPriceCents: number; totalCents: number };
  onPatch: (patch: Partial<Area>) => void;
  onPatchSurface: (sid: number, patch: Partial<Surface>) => void;
  onAddSurface: () => void;
  onRemoveSurface: (sid: number) => void;
  onDuplicateSurface: (sid: number) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const subs = Object.keys(subGroups).sort();
  // per-area totals (matches PaintScout's Area Hours / Area Price + breakdown)
  const at = area.surfaces.reduce(
    (a, s) => {
      const c = calc(s);
      return { hrs: a.hrs + c.paintingHr + c.prepHr, prep: a.prep + c.prepHr, paint: a.paint + c.paintingHr, mat: a.mat + c.matPriceCents, labour: a.labour + c.labourCents, price: a.price + c.totalCents };
    },
    { hrs: 0, prep: 0, paint: 0, mat: 0, labour: 0, price: 0 },
  );
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <input
          className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm font-medium"
          value={area.name}
          placeholder="Area name (e.g. Ground hallway)"
          onChange={(e) => onPatch({ name: e.target.value })}
        />
        <select
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          value={area.type}
          onChange={(e) => {
            const t = e.target.value as Area["type"];
            onPatch({ type: t, areaType: t === "Exterior" ? "surface" : "room", surfaces: area.surfaces.map((s) => ({ ...s, code: "" })) });
          }}
        >
          <option>Interior</option><option>Exterior</option>
        </select>
        <label className="flex items-center gap-1 whitespace-nowrap text-xs text-gray-500" title="Show as an optional add-on, outside the total">
          <input type="checkbox" checked={area.isOption} onChange={(e) => onPatch({ isOption: e.target.checked })} /> Option
        </label>
        <button onClick={onDuplicate} className="px-1 text-lg text-gray-400 hover:text-gray-700" title="Duplicate area" aria-label="Duplicate area">⧉</button>
        <button onClick={onRemove} className="px-1 text-gray-400 hover:text-red-600" aria-label="Remove area">×</button>
      </div>

      <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg bg-gray-50 p-2">
        <F label="Measure as">
          <select
            className="rounded-md border border-gray-300 px-1 py-1.5 text-sm"
            value={area.areaType}
            onChange={(e) => onPatch({ areaType: e.target.value as AreaType })}
          >
            <option value="room">Room (4 walls)</option>
            <option value="surface">Surface (single plane)</option>
          </select>
        </F>
        <F label="Length m">
          <input type="number" min={0} step={0.1} className="w-20 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            value={area.L || ""} onChange={(e) => onPatch({ L: Number(e.target.value) || 0 })} />
        </F>
        {area.areaType === "room" && (
          <F label="Width m">
            <input type="number" min={0} step={0.1} className="w-20 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              value={area.W || ""} onChange={(e) => onPatch({ W: Number(e.target.value) || 0 })} />
          </F>
        )}
        <F label="Height m">
          <input type="number" min={0} step={0.1} className="w-20 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            value={area.H || ""} onChange={(e) => onPatch({ H: Number(e.target.value) || 0 })} />
        </F>
        <span className="pb-1.5 text-[11px] text-gray-400">
          {area.areaType === "room" ? "walls = perimeter × height · ceilings = L × W" : "plane = length × height"}
        </span>
      </div>

      <div className="mt-3 space-y-2">
        {area.surfaces.map((s) => {
          const c = calc(s);
          return (
            <div key={s.id} className="rounded-lg border border-gray-200">
              <div className="flex items-center gap-2 p-2">
                <button onClick={() => onPatchSurface(s.id, { open: !s.open })} className="text-gray-400 hover:text-gray-700" aria-label="Expand">
                  {s.open ? "▾" : "▸"}
                </button>
                <select
                  className="flex-1 rounded-md border border-gray-300 px-1 py-1.5 text-sm"
                  value={s.code}
                  onChange={(e) => onPatchSurface(s.id, { code: e.target.value })}
                >
                  <option value="">— choose substrate —</option>
                  {subs.map((sub) => (
                    <optgroup key={sub} label={sub}>
                      {subGroups[sub].map((r) => (
                        <option key={r.code} value={r.code}>{r.code} ({r.unit})</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {s.hidden && (
                  <span className="whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Hidden</span>
                )}
                {(s.media?.length ?? 0) > 0 && (
                  <span className="whitespace-nowrap text-[11px] text-gray-400">📷 {s.media.length}</span>
                )}
                {c.item && c.qty > 0 && (
                  <span className="whitespace-nowrap text-sm tabular-nums text-gray-600">
                    {c.qty.toFixed(1)} {unitLabel(c.item)} · {s.coats}c ·{" "}
                    {c.prepHr > 0 ? `${c.paintingHr.toFixed(1)}+${c.prepHr.toFixed(1)}h` : `${c.paintingHr.toFixed(1)}h`} ·{" "}
                    {fmt(c.totalCents)}
                  </span>
                )}
                <button onClick={() => onDuplicateSurface(s.id)} className="px-1 text-gray-400 hover:text-gray-700" title="Duplicate surface" aria-label="Duplicate surface">⧉</button>
                <button onClick={() => onRemoveSurface(s.id)} className="px-1 text-gray-400 hover:text-red-600" aria-label="Remove surface">×</button>
              </div>
              {s.open && c.item && (
                <SurfaceEditor surface={s} item={c.item} calc={c} products={products} onPatch={(patch) => onPatchSurface(s.id, patch)} />
              )}
            </div>
          );
        })}
      </div>
      <button onClick={onAddSurface} className="mt-2 text-sm font-medium text-gray-700 hover:text-gray-900">+ Add surface</button>

      <div className="mt-3 border-t border-gray-200 pt-3">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-400">Room photos</div>
        <MediaUploader items={area.media ?? []} onChange={(m) => onPatch({ media: m })} />
      </div>

      {at.price > 0 && (
        <div className="mt-3 border-t border-gray-200 pt-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-gray-600">Area total · {at.hrs.toFixed(1)} hr</span>
            <span className="font-semibold tabular-nums">{fmt(at.price)}</span>
          </div>
          <div className="mt-0.5 text-[11px] tabular-nums text-gray-400">
            prep {at.prep.toFixed(1)}h · paint {at.paint.toFixed(1)}h · materials {fmt(at.mat)} · labour {fmt(at.labour)}
          </div>
        </div>
      )}
    </section>
  );
}

function AreaSummary({
  area, calc, onOpen, onToggleOption, onDuplicate, onRemove,
}: {
  area: Area;
  calc: (s: Surface) => { paintingHr: number; prepHr: number; totalCents: number };
  onOpen: () => void;
  onToggleOption: (v: boolean) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const at = area.surfaces.reduce(
    (a, s) => {
      const c = calc(s);
      return { hrs: a.hrs + c.paintingHr + c.prepHr, price: a.price + c.totalCents };
    },
    { hrs: 0, price: 0 },
  );
  const surfaceCount = area.surfaces.filter((s) => s.code).length;
  const photoCount = (area.media?.length ?? 0) + area.surfaces.reduce((n, s) => n + (s.media?.length ?? 0), 0);
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-3">
        <button onClick={onOpen} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{area.name || "Untitled area"}</span>
            {area.isOption && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-500">Option</span>}
          </div>
          <div className="text-xs text-gray-500">
            {area.type} · {area.areaType === "room" ? "Room" : "Surface"} · {surfaceCount} surface{surfaceCount === 1 ? "" : "s"}
            {area.L > 0 ? ` · ${area.L}×${area.areaType === "room" ? area.W + "×" : ""}${area.H}m` : ""}
            {photoCount > 0 ? ` · 📷 ${photoCount}` : ""}
          </div>
        </button>
        <div className="text-right">
          <div className="text-sm font-semibold tabular-nums">{fmt(at.price)}</div>
          <div className="text-[11px] text-gray-400">{at.hrs.toFixed(1)} hr</div>
        </div>
        <button onClick={onOpen} className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700">Open →</button>
        <label className="flex items-center gap-1 text-xs text-gray-500" title="Show as an optional add-on">
          <input type="checkbox" checked={area.isOption} onChange={(e) => onToggleOption(e.target.checked)} /> Opt
        </label>
        <button onClick={onDuplicate} className="px-1 text-lg text-gray-400 hover:text-gray-700" title="Duplicate area" aria-label="Duplicate area">⧉</button>
        <button onClick={onRemove} className="px-1 text-gray-400 hover:text-red-600" title="Remove area" aria-label="Remove area">×</button>
      </div>
    </section>
  );
}

function SurfaceEditor({
  surface: s, item, calc, products, onPatch,
}: {
  surface: Surface;
  item: RateItem;
  calc: { qty: number; paintingHr: number; matCostCents: number; volume: number };
  products: Product[];
  onPatch: (patch: Partial<Surface>) => void;
}) {
  const isItem = item.unit === "Hours Per Item";
  const num = (v: number, on: (n: number | null) => void, ph?: string) => (
    <input type="number" className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" placeholder={ph}
      value={Number.isFinite(v) ? v : ""} onChange={(e) => on(e.target.value === "" ? null : Number(e.target.value))} />
  );
  return (
    <div className="border-t border-gray-200 bg-gray-50 p-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {isItem && <F label="Count">{num(s.count, (n) => onPatch({ count: n ?? 0 }))}</F>}
        <F label="Coats">
          <select className="w-full rounded-md border border-gray-300 px-1 py-1.5 text-sm" value={s.coats} onChange={(e) => onPatch({ coats: Number(e.target.value) })}>
            {[1, 2, 3, 4].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </F>
        <F label={`Prep hr`}>{num(s.prepHr, (n) => onPatch({ prepHr: n ?? 0 }))}</F>
        <F label={`Painting hr${s.paintingHrOverride == null ? " (auto)" : ""}`}>
          <input type="number" className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            value={s.paintingHrOverride ?? Number(calc.paintingHr.toFixed(2))}
            onChange={(e) => onPatch({ paintingHrOverride: e.target.value === "" ? null : Number(e.target.value) })} />
        </F>
        <F label="Qty override">{num(s.qtyOverride ?? NaN, (n) => onPatch({ qtyOverride: n }), calc.qty.toFixed(1))}</F>
      </div>

      <div className="mt-3 border-t border-gray-200 pt-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Materials</div>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <F label="Product">
            <select className="w-full rounded-md border border-gray-300 px-1 py-1.5 text-sm"
              value={s.productName ?? item.default_product ?? ""}
              onChange={(e) => onPatch({ productName: e.target.value })}>
              {products.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
          </F>
          <F label="Volume L">
            <input type="number" className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              value={s.volumeOverride ?? Number(calc.volume.toFixed(2))}
              onChange={(e) => onPatch({ volumeOverride: e.target.value === "" ? null : Number(e.target.value) })} />
          </F>
          <F label="$ / L">{num(s.unitPriceOverride ?? NaN, (n) => onPatch({ unitPriceOverride: n }), "auto")}</F>
          <F label="Materials cost"><div className="px-2 py-1.5 text-sm tabular-nums text-gray-600">{fmt(calc.matCostCents)}</div></F>
        </div>
      </div>

      <label className="mt-3 flex items-center gap-2 border-t border-gray-200 pt-3 text-xs text-gray-600">
        <input type="checkbox" checked={s.hidden} onChange={(e) => onPatch({ hidden: e.target.checked })} />
        Hidden from customer <span className="text-gray-400">(still priced; shows on the work order)</span>
      </label>

      <div className="mt-3 border-t border-gray-200 pt-3">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-400">Photos</div>
        <MediaUploader items={s.media ?? []} onChange={(m) => onPatch({ media: m })} />
      </div>
    </div>
  );
}

// ---------------- Line item ----------------
function LineCard({
  line: l, calc, lineItems, chargeFor, onPatch, onDuplicate, onRemove,
}: {
  line: LineBlock;
  calc: { priceCents: number; hours: number; costCents: number };
  lineItems: LineItemRef[];
  chargeFor: (t: string) => number;
  onPatch: (patch: Partial<LineBlock>) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const num = (v: number, on: (n: number) => void) => (
    <input type="number" className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" value={v || ""} onChange={(e) => on(Number(e.target.value) || 0)} />
  );
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <span className="rounded bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Line item</span>
        <select
          className="flex-1 rounded-md border border-gray-300 px-1 py-1.5 text-sm"
          value={l.name}
          onChange={(e) => {
            const li = lineItems.find((x) => x.name === e.target.value);
            const type = (li?.type as LineBlock["type"]) ?? l.type;
            onPatch({
              name: e.target.value, type,
              mode: li?.pricing_method === "Custom" ? "custom" : "hourly",
              rate: chargeFor(type) / 100,
              // Attach the template's pre-written description (staff can then edit it).
              ...(li ? { description: li.description ?? "" } : {}),
            });
          }}
        >
          <option value="">— choose line item —</option>
          {lineItems.map((li) => <option key={li.name} value={li.name}>{li.name} ({li.type})</option>)}
        </select>
        {l.hidden && <span className="whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Hidden</span>}
        <span className="whitespace-nowrap text-sm font-medium tabular-nums">{fmt(calc.priceCents)}</span>
        <button onClick={onDuplicate} className="px-1 text-lg text-gray-400 hover:text-gray-700" title="Duplicate line item" aria-label="Duplicate line item">⧉</button>
        <button onClick={onRemove} className="px-1 text-gray-400 hover:text-red-600" aria-label="Remove line item">×</button>
      </div>

      <div className="mt-3">
        <div className="flex gap-4 text-sm">
          {(["hourly", "quantity", "custom"] as const).map((m) => (
            <label key={m} className="flex items-center gap-1.5">
              <input type="radio" checked={l.mode === m} onChange={() => onPatch({ mode: m })} />
              <span className="capitalize">{m === "hourly" ? "Hourly rate" : m}</span>
            </label>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {l.mode === "hourly" && (
            <>
              <F label="Hours">{num(l.hours, (n) => onPatch({ hours: n }))}</F>
              <F label="$ / hr">{num(l.rate, (n) => onPatch({ rate: n }))}</F>
              <F label="Price"><div className="px-2 py-1.5 text-sm font-medium tabular-nums">{fmt(calc.priceCents)}</div></F>
            </>
          )}
          {l.mode === "quantity" && (
            <>
              <F label="Quantity">{num(l.qty, (n) => onPatch({ qty: n }))}</F>
              <F label="$ / unit">{num(l.unitPrice, (n) => onPatch({ unitPrice: n }))}</F>
              <F label="Price"><div className="px-2 py-1.5 text-sm font-medium tabular-nums">{fmt(calc.priceCents)}</div></F>
              <F label="Hrs (work order)">{num(l.woHours, (n) => onPatch({ woHours: n }))}</F>
              <F label="Cost">{num(l.cost, (n) => onPatch({ cost: n }))}</F>
            </>
          )}
          {l.mode === "custom" && (
            <>
              <F label="Price $">{num(l.custom, (n) => onPatch({ custom: n }))}</F>
              <F label="Hrs (work order)">{num(l.woHours, (n) => onPatch({ woHours: n }))}</F>
              <F label="Cost">{num(l.cost, (n) => onPatch({ cost: n }))}</F>
            </>
          )}
          <F label="Type">
            <select className="w-full rounded-md border border-gray-300 px-1 py-1.5 text-sm" value={l.type} onChange={(e) => onPatch({ type: e.target.value as LineBlock["type"] })}>
              <option>Interior</option><option>Exterior</option>
            </select>
          </F>
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-400">Description (shown on the estimate)</div>
        <RichTextEditor
          value={l.description ?? ""}
          onChange={(html) => onPatch({ description: html })}
          placeholder="Describe this line item for the customer…"
        />
      </div>

      <div className="mt-3 border-t border-gray-200 pt-3">
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <label className="flex items-center gap-1.5 text-gray-600">
            <input type="checkbox" checked={l.isOption} onChange={(e) => onPatch({ isOption: e.target.checked })} /> Option (add-on)
          </label>
          <label className="flex items-center gap-1.5 text-gray-600">
            <input type="checkbox" checked={l.hidden} onChange={(e) => onPatch({ hidden: e.target.checked })} /> Hidden from customer
          </label>
          <button type="button" onClick={() => onPatch({ detailsOpen: !l.detailsOpen })} className="font-medium text-gray-500 hover:text-gray-800">
            {l.detailsOpen ? "▾ Crew note & photos" : "▸ Crew note & photos"}
          </button>
        </div>
        {l.detailsOpen && (
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-0.5 text-xs">
              <span className="text-gray-400">Crew note (work order only)</span>
              <textarea rows={2} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" value={l.crewNote} onChange={(e) => onPatch({ crewNote: e.target.value })} />
            </label>
            <div className="sm:col-span-2">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-400">Photos</div>
              <MediaUploader items={l.media ?? []} onChange={(m) => onPatch({ media: m })} />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function MediaUploader({ items, onChange }: { items: MediaItem[]; onChange: (m: MediaItem[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const list = items ?? [];

  async function onFiles(files: FileList | null) {
    if (!files || !files.length) return;
    setBusy(true);
    setErr("");
    const supabase = createClient();
    const added: MediaItem[] = [];
    try {
      for (const f of Array.from(files)) {
        const ext = f.name.split(".").pop() || "jpg";
        const path = `${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from("estimate-media").upload(path, f);
        if (error) throw error;
        const { data } = supabase.storage.from("estimate-media").getPublicUrl(path);
        added.push({ path, url: data.publicUrl });
      }
      onChange([...list, ...added]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }
  async function remove(m: MediaItem) {
    const supabase = createClient();
    await supabase.storage.from("estimate-media").remove([m.path]);
    onChange(list.filter((x) => x.path !== m.path));
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {list.map((m) => (
          <div key={m.path} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={m.url} alt="" className="h-16 w-16 rounded border border-gray-200 object-cover" />
            <button
              onClick={() => remove(m)}
              className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 bg-white text-[10px] text-gray-500 hover:text-red-600"
              aria-label="Remove photo"
            >
              ×
            </button>
          </div>
        ))}
        <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded border border-dashed border-gray-300 text-center text-[11px] text-gray-400 hover:bg-white">
          {busy ? "…" : "+ Photo"}
          <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
        </label>
      </div>
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
    </div>
  );
}

// Lightweight rich-text editor (contentEditable). Stores HTML.
// Uncontrolled DOM synced from `value` only when it differs, so typing never
// jumps the caret, but applying a template / loading a saved quote updates it.
function RichTextEditor({
  value, onChange, placeholder,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== (value ?? "")) el.innerHTML = value ?? "";
  }, [value]);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    // Treat a lone <br> or whitespace as empty so the placeholder shows.
    const html = el.innerHTML === "<br>" ? "" : el.innerHTML;
    el.classList.toggle("is-empty", el.textContent?.trim() === "" && !el.querySelector("li"));
    onChange(html);
  };
  const exec = (cmd: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false);
    emit();
  };
  const btn = "rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200";

  return (
    <div className="rounded-md border border-gray-300 focus-within:border-gray-500">
      <div className="flex items-center gap-0.5 border-b border-gray-200 bg-gray-50 px-1.5 py-1">
        <button type="button" className={btn} title="Bold" onMouseDown={(e) => { e.preventDefault(); exec("bold"); }}><b>B</b></button>
        <button type="button" className={btn} title="Italic" onMouseDown={(e) => { e.preventDefault(); exec("italic"); }}><i>I</i></button>
        <button type="button" className={btn} title="Underline" onMouseDown={(e) => { e.preventDefault(); exec("underline"); }}><u>U</u></button>
        <span className="mx-1 h-4 w-px bg-gray-300" />
        <button type="button" className={btn} title="Bulleted list" onMouseDown={(e) => { e.preventDefault(); exec("insertUnorderedList"); }}>• List</button>
        <button type="button" className={btn} title="Numbered list" onMouseDown={(e) => { e.preventDefault(); exec("insertOrderedList"); }}>1. List</button>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder}
        onInput={emit}
        className="rte min-h-[84px] px-3 py-2 text-sm focus:outline-none"
      />
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-gray-400">{label}</span>
      {children}
    </label>
  );
}
function Row({ label, value, muted, dark }: { label: string; value: string; muted?: boolean; dark?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? "text-gray-400" : dark ? "text-gray-300" : ""}`}>
      <dt>{label}</dt><dd className="tabular-nums">{value}</dd>
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-gray-50 p-2">
      <div className="text-[11px] text-gray-400">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}
