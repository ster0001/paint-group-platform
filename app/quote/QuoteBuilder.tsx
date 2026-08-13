"use client";

import { useMemo, useState } from "react";
import { hoursPerUnit } from "@/lib/pricing/engine";
import type { Product, RateItem } from "@/lib/pricing/types";

type Modifier = { code: string; group_name: string; label: string; multiplier: number };
type Setting = { key: string; value: { value: number } | number | null };
type LineItemRef = { name: string; type: string; pricing_method: string };

type Surface = {
  id: number;
  code: string;
  coats: number;
  L: number;
  W: number;
  H: number;
  count: number;
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
type Area = { id: number; kind: "area"; name: string; type: "Interior" | "Exterior"; surfaces: Surface[] };
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
  open: boolean;
};
type Block = Area | LineBlock;

const fmt = (c: number) => "$" + (c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = (c: number) => "$" + Math.round(c / 100).toLocaleString("en-AU");
let nextId = 1;

function computeArea(item: RateItem | undefined, s: Surface): number {
  if (!item) return 0;
  if (s.qtyOverride != null) return s.qtyOverride;
  if (item.unit === "Hours Per Item") return s.count;
  const flat = /ceiling|floor|roof|soffit/i.test(item.sub_category ?? "");
  if (item.unit === "Lineal Metres") return s.L && s.W ? 2 * (s.L + s.W) : 0;
  if (flat) return s.L && s.W ? s.L * s.W : 0;
  return s.L && s.W && s.H ? 2 * (s.L + s.W) * s.H : 0;
}
const unitLabel = (item?: RateItem) =>
  !item ? "" : item.unit === "Hours Per Item" ? "items" : item.unit === "Lineal Metres" ? "m" : "m²";

export default function QuoteBuilder({
  rateCardVersion,
  rateItems,
  modifiers,
  products,
  settings,
  lineItems,
}: {
  rateCardVersion: number | null;
  rateItems: RateItem[];
  modifiers: Modifier[];
  products: Product[];
  settings: Setting[];
  lineItems: LineItemRef[];
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

  const [blocks, setBlocks] = useState<Block[]>([newArea()]);
  const [modSel, setModSel] = useState<Record<string, string>>({});

  function newArea(): Area {
    return { id: nextId++, kind: "area", name: `Area ${nextId}`, type: "Interior", surfaces: [newSurface()] };
  }
  function newSurface(): Surface {
    return {
      id: nextId++, code: "", coats: 2, L: 0, W: 0, H: 2.4, count: 1, qtyOverride: null,
      rateOverride: null, paintingHrOverride: null, prepHr: 0, productName: null,
      coverageOverride: null, volumeOverride: null, unitPriceOverride: null, open: false,
    };
  }
  function newLine(): LineBlock {
    return { id: nextId++, kind: "line", name: "", type: "Interior", mode: "hourly", hours: 0, rate: 85, qty: 1, unitPrice: 0, custom: 0, cost: 0, woHours: 0, open: true };
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
    const qty = computeArea(item, s);
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

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Quote builder</h1>
        <p className="text-sm text-gray-500">Rate card v{rateCardVersion ?? "?"} · live pricing</p>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          {/* job modifiers */}
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

          {/* blocks */}
          {blocks.map((b) =>
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
                onRemove={() => removeBlock(b.id)}
              />
            ),
          )}

          <div className="flex gap-3">
            <button onClick={() => setBlocks((bs) => [...bs, newArea()])} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700">
              + Add area
            </button>
            <button onClick={() => setBlocks((bs) => [...bs, newLine()])} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50">
              + Add line item
            </button>
          </div>
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
    </main>
  );
}

// ---------------- Area ----------------
function AreaCard({
  area, subGroups, itemByKey, products, calc, onPatch, onPatchSurface, onAddSurface, onRemoveSurface, onRemove,
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
  onRemove: () => void;
}) {
  const subs = Object.keys(subGroups).sort();
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
          onChange={(e) => onPatch({ type: e.target.value as Area["type"], surfaces: area.surfaces.map((s) => ({ ...s, code: "" })) })}
        >
          <option>Interior</option><option>Exterior</option>
        </select>
        <button onClick={onRemove} className="px-1 text-gray-400 hover:text-red-600" aria-label="Remove area">×</button>
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
                {c.item && c.qty > 0 && (
                  <span className="whitespace-nowrap text-sm tabular-nums text-gray-600">
                    {c.qty.toFixed(1)} {unitLabel(c.item)} · {(c.paintingHr + c.prepHr).toFixed(1)} hr · {fmt(c.totalCents)}
                  </span>
                )}
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
        {isItem ? (
          <F label="Count">{num(s.count, (n) => onPatch({ count: n ?? 0 }))}</F>
        ) : (
          <>
            <F label="Length m">{num(s.L, (n) => onPatch({ L: n ?? 0, qtyOverride: null }))}</F>
            <F label="Width m">{num(s.W, (n) => onPatch({ W: n ?? 0, qtyOverride: null }))}</F>
            <F label="Height m">{num(s.H, (n) => onPatch({ H: n ?? 0, qtyOverride: null }))}</F>
          </>
        )}
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
    </div>
  );
}

// ---------------- Line item ----------------
function LineCard({
  line: l, calc, lineItems, chargeFor, onPatch, onRemove,
}: {
  line: LineBlock;
  calc: { priceCents: number; hours: number; costCents: number };
  lineItems: LineItemRef[];
  chargeFor: (t: string) => number;
  onPatch: (patch: Partial<LineBlock>) => void;
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
            });
          }}
        >
          <option value="">— choose line item —</option>
          {lineItems.map((li) => <option key={li.name} value={li.name}>{li.name} ({li.type})</option>)}
        </select>
        <span className="whitespace-nowrap text-sm font-medium tabular-nums">{fmt(calc.priceCents)}</span>
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
    </section>
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
