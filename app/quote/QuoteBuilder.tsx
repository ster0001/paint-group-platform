"use client";

import { useMemo, useState } from "react";
import { priceEstimate } from "@/lib/pricing/engine";
import type { Product, QuoteInput, RateItem } from "@/lib/pricing/types";

type Modifier = { code: string; group_name: string; label: string; multiplier: number };
type Setting = { key: string; value: { value: number } | number | null };

type Line = {
  id: number;
  area: string;
  type: "Interior" | "Exterior";
  code: string;
  L: number;
  W: number;
  H: number;
  count: number; // for item-based surfaces
  override: number | null; // manual quantity override
  coats: number;
};
type Pass = { id: number; label: string; price: number; cost: number };

const fmt = (cents: number) =>
  "$" + (cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = (cents: number) =>
  "$" + Math.round(cents / 100).toLocaleString("en-AU");

let nextId = 1;

// How to turn L/W/H into a quantity, based on the surface's unit + sub-category.
function computeQuantity(item: RateItem | undefined, l: Line): number {
  if (!item) return 0;
  if (l.override != null) return l.override;
  if (item.unit === "Hours Per Item") return l.count;
  const flat = /ceiling|floor|roof|soffit/i.test(item.sub_category ?? "");
  if (item.unit === "Lineal Metres") return l.L && l.W ? 2 * (l.L + l.W) : 0;
  // area units (M2 / M2 Per Hour)
  if (flat) return l.L && l.W ? l.L * l.W : 0;
  return l.L && l.W && l.H ? 2 * (l.L + l.W) * l.H : 0; // walls: perimeter × height
}
const unitLabel = (item?: RateItem) =>
  !item ? "" : item.unit === "Hours Per Item" ? "items" : item.unit === "Lineal Metres" ? "m" : "m²";

export default function QuoteBuilder({
  rateCardVersion,
  rateItems,
  modifiers,
  products,
  settings,
}: {
  rateCardVersion: number | null;
  rateItems: RateItem[];
  modifiers: Modifier[];
  products: Product[];
  settings: Setting[];
}) {
  // Match setting keys tolerantly: ignore punctuation/dash differences (the seed
  // data can contain em-dashes that vary), comparing only letters/numbers/spaces.
  const normKey = (k: string) => k.replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase();
  const settingsMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of settings) {
      const v = s.value == null ? undefined : typeof s.value === "number" ? s.value : s.value.value;
      if (v != null) m.set(normKey(s.key), v);
    }
    return m;
  }, [settings]);
  const settingNum = (key: string): number | undefined => settingsMap.get(normKey(key));
  const markup = settingNum("Materials markup") ?? 0.1;
  const gstRate = settingNum("GST") ?? 0.1;
  const sundriesInteriorCents = Math.round((settingNum("Sundries per job — interior") ?? 0) * 100);
  const sundriesExteriorCents = Math.round((settingNum("Sundries per job — exterior") ?? 0) * 100);
  const contractorHourlyCents = Math.round((settingNum("Contractor rate") ?? 60) * 100);
  const contractorOfferPct = settingNum("Contractor offer — % of estimated hours") ?? 1;
  const interiorChargeCents = rateItems.find((r) => r.category === "Interior")?.charge_out_cents ?? 8500;

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
  const groups = useMemo(() => {
    const g: Record<string, Modifier[]> = {};
    for (const m of modifiers) (g[m.group_name] ||= []).push(m);
    return g;
  }, [modifiers]);

  const [lines, setLines] = useState<Line[]>([
    { id: nextId++, area: "Room 1", type: "Interior", code: "", L: 0, W: 0, H: 2.4, count: 1, override: null, coats: 2 },
  ]);
  const [modSel, setModSel] = useState<Record<string, string>>({});
  const [prepHours, setPrepHours] = useState(0);
  const [passes, setPasses] = useState<Pass[]>([]);

  const setLine = (id: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const addLine = () =>
    setLines((ls) => [
      ...ls,
      { id: nextId++, area: "", type: "Interior", code: "", L: 0, W: 0, H: 2.4, count: 1, override: null, coats: 2 },
    ]);
  const modMult = (group: string): number | undefined =>
    modSel[group] ? modifiers.find((m) => m.code === modSel[group])?.multiplier : undefined;

  const finishChosen = modSel["Level of Finish"] != null && modSel["Level of Finish"] !== "";
  const finishMultiplier = modMult("Level of Finish") ?? 1; // Level 3 baseline for live preview

  // Build engine input from the current state.
  const built = useMemo(() => {
    const production = lines
      .map((l) => {
        const item = itemByKey.get(`${l.type}::${l.code}`);
        if (!item) return null;
        const quantity = computeQuantity(item, l);
        if (quantity <= 0) return null;
        return {
          item,
          quantity,
          coats: l.coats,
          product: item.default_product ? productByName.get(item.default_product) ?? null : null,
        };
      })
      .filter((p): p is NonNullable<typeof p> => p != null);

    if (production.length === 0) return null;
    const anyInterior = production.some((p) => p.item.category === "Interior");
    const anyExterior = production.some((p) => p.item.category === "Exterior");

    const input: QuoteInput = {
      production,
      conditionMultiplier: modMult("Condition"),
      accessMultiplier: modMult("Access"),
      finishMultiplier,
      sizeMultiplier: modMult("Job Size"),
      stagingMultipliers: modSel["Staging"] ? [modifiers.find((m) => m.code === modSel["Staging"])!.multiplier] : [],
      prep: prepHours > 0 ? [{ hours: prepHours, chargeOutCents: interiorChargeCents }] : [],
      materialsMarkup: markup,
      sundriesCents: (anyInterior ? sundriesInteriorCents : 0) + (anyExterior ? sundriesExteriorCents : 0),
      passthroughs: passes
        .filter((p) => p.price > 0 || p.cost > 0)
        .map((p) => ({ label: p.label, priceCents: Math.round(p.price * 100), costCents: Math.round(p.cost * 100) })),
      contractorHourlyCents,
      contractorOfferPct,
    };
    return { input, production };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, modSel, prepHours, passes]);

  const result = useMemo(() => (built ? priceEstimate(built.input) : null), [built]);

  // per-line results, keyed to line ids (production is in the same order minus skipped)
  const lineResult = useMemo(() => {
    const map = new Map<number, { hours: number; labour: number; litres: number }>();
    if (!result || !built) return map;
    let ri = 0;
    for (const l of lines) {
      const item = itemByKey.get(`${l.type}::${l.code}`);
      if (!item || computeQuantity(item, l) <= 0) continue;
      const r = result.lines[ri++];
      if (r) map.set(l.id, { hours: r.modifiedHours, labour: r.labourCents, litres: r.materialLitres });
    }
    return map;
  }, [result, built, lines, itemByKey]);

  const gstCents = result ? Math.round(result.totalCents * gstRate) : 0;
  const incTotal = result ? result.totalCents + gstCents : 0;
  const totalHours = result ? result.contractorHours : 0;
  const salesRateCents = result && totalHours > 0 ? Math.round(result.totalCents / totalHours) : 0;
  const marginPct = result && result.totalCents > 0 ? (result.marginCents / result.totalCents) * 100 : 0;

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Quote builder</h1>
          <p className="text-sm text-gray-500">Rate card v{rateCardVersion ?? "?"} · live pricing</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
        {/* ---------------- LEFT ---------------- */}
        <div className="space-y-5">
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-semibold">Job settings</h2>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {["Condition", "Access", "Level of Finish", "Job Size", "Staging"].map((group) => (
                <label key={group} className="block text-xs">
                  <span className={group === "Level of Finish" ? "font-semibold text-gray-900" : "text-gray-500"}>
                    {group}
                    {group === "Level of Finish" ? " *" : ""}
                  </span>
                  <select
                    className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                    value={modSel[group] ?? ""}
                    onChange={(e) => setModSel((s) => ({ ...s, [group]: e.target.value }))}
                  >
                    <option value="">{group === "Level of Finish" ? "— required —" : "— none —"}</option>
                    {(groups[group] ?? []).map((m) => (
                      <option key={m.code} value={m.code}>
                        {m.label} (×{m.multiplier})
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <label className="block text-xs">
                <span className="text-gray-500">Prep hours</span>
                <input
                  type="number"
                  min={0}
                  step={0.25}
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  value={prepHours || ""}
                  onChange={(e) => setPrepHours(Number(e.target.value) || 0)}
                />
              </label>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Areas &amp; surfaces</h2>
              <button onClick={addLine} className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700">
                + Add surface
              </button>
            </div>

            <div className="mt-3 space-y-3">
              {lines.map((l) => {
                const item = itemByKey.get(`${l.type}::${l.code}`);
                const opts = rateItems.filter((r) => r.category === l.type);
                const qty = computeQuantity(item, l);
                const lr = lineResult.get(l.id);
                const isItem = item?.unit === "Hours Per Item";
                return (
                  <div key={l.id} className="rounded-lg border border-gray-200 p-3">
                    <div className="flex items-center gap-2">
                      <input
                        className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                        placeholder="Room / area name"
                        value={l.area}
                        onChange={(e) => setLine(l.id, { area: e.target.value })}
                      />
                      <select
                        className="rounded-md border border-gray-300 px-1 py-1.5 text-sm"
                        value={l.type}
                        onChange={(e) => setLine(l.id, { type: e.target.value as Line["type"], code: "" })}
                      >
                        <option>Interior</option>
                        <option>Exterior</option>
                      </select>
                      <select
                        className="flex-1 rounded-md border border-gray-300 px-1 py-1.5 text-sm"
                        value={l.code}
                        onChange={(e) => setLine(l.id, { code: e.target.value, override: null })}
                      >
                        <option value="">— surface —</option>
                        {opts.map((r) => (
                          <option key={r.code} value={r.code}>
                            {r.code} ({r.unit})
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}
                        className="px-1 text-gray-400 hover:text-red-600"
                        aria-label="Remove surface"
                      >
                        ×
                      </button>
                    </div>

                    <div className="mt-2 flex flex-wrap items-end gap-2 text-xs">
                      {isItem ? (
                        <Field label="Count">
                          <input
                            type="number"
                            min={0}
                            className="w-16 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                            value={l.count || ""}
                            onChange={(e) => setLine(l.id, { count: Number(e.target.value) || 0 })}
                          />
                        </Field>
                      ) : (
                        <>
                          <Field label="Length m">
                            <DimInput value={l.L} onChange={(v) => setLine(l.id, { L: v, override: null })} />
                          </Field>
                          <Field label="Width m">
                            <DimInput value={l.W} onChange={(v) => setLine(l.id, { W: v, override: null })} />
                          </Field>
                          <Field label="Height m">
                            <DimInput value={l.H} onChange={(v) => setLine(l.id, { H: v, override: null })} />
                          </Field>
                        </>
                      )}
                      <Field label="Coats">
                        <select
                          className="rounded-md border border-gray-300 px-1 py-1.5 text-sm"
                          value={l.coats}
                          onChange={(e) => setLine(l.id, { coats: Number(e.target.value) })}
                        >
                          {[1, 2, 3, 4].map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </Field>

                      {item && qty > 0 && (
                        <div className="ml-auto text-right">
                          <div className="text-sm font-medium tabular-nums">
                            {qty.toFixed(1)} {unitLabel(item)}
                            {lr && (
                              <>
                                {" · "}
                                <span className="text-gray-500">{lr.hours.toFixed(1)} hr</span>
                                {" · "}
                                {fmt(lr.labour)}
                              </>
                            )}
                          </div>
                          {lr && lr.litres > 0 && (
                            <div className="text-[11px] text-gray-400 tabular-nums">{lr.litres.toFixed(1)} L paint</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">
                Pass-throughs <span className="font-normal text-gray-400">(scaffold, lifts, permits…)</span>
              </h2>
              <button
                onClick={() => setPasses((p) => [...p, { id: nextId++, label: "", price: 0, cost: 0 }])}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium hover:bg-gray-50"
              >
                + Add
              </button>
            </div>
            {passes.length > 0 && (
              <div className="mt-3 space-y-2">
                <div className="grid grid-cols-[1fr_90px_90px_28px] gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                  <span>Item</span>
                  <span>Bill $</span>
                  <span>Cost $</span>
                  <span></span>
                </div>
                {passes.map((p) => (
                  <div key={p.id} className="grid grid-cols-[1fr_90px_90px_28px] items-center gap-2">
                    <input
                      className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                      placeholder="e.g. Scaffold hire"
                      value={p.label}
                      onChange={(e) => setPasses((ps) => ps.map((x) => (x.id === p.id ? { ...x, label: e.target.value } : x)))}
                    />
                    <input
                      type="number"
                      className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                      value={p.price || ""}
                      onChange={(e) => setPasses((ps) => ps.map((x) => (x.id === p.id ? { ...x, price: Number(e.target.value) || 0 } : x)))}
                    />
                    <input
                      type="number"
                      className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                      value={p.cost || ""}
                      onChange={(e) => setPasses((ps) => ps.map((x) => (x.id === p.id ? { ...x, cost: Number(e.target.value) || 0 } : x)))}
                    />
                    <button
                      onClick={() => setPasses((ps) => ps.filter((x) => x.id !== p.id))}
                      className="text-gray-400 hover:text-red-600"
                      aria-label="Remove pass-through"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* ---------------- RIGHT ---------------- */}
        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          {!finishChosen && result && (
            <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Showing Level 3 pricing. <strong>Choose a level of finish</strong> before sending.
            </div>
          )}

          {/* Customer-facing totals (PaintScout parity) */}
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-semibold">Quote</h2>
            {!result ? (
              <p className="mt-3 text-sm text-gray-400">Add a surface with dimensions to price.</p>
            ) : (
              <dl className="mt-3 space-y-1.5 text-sm">
                <Row label="Subtotal" value={fmt(result.totalCents)} />
                <Row label={`GST (${Math.round(gstRate * 100)}%)`} value={fmt(gstCents)} muted />
                <div className="flex justify-between border-t border-gray-200 pt-2 text-base font-semibold">
                  <span>Total</span>
                  <span>{fmt(incTotal)}</span>
                </div>
                <div className="!mt-3 grid grid-cols-2 gap-2 text-center">
                  <Stat label="Total hours" value={totalHours.toFixed(2)} />
                  <Stat label="Sales rate" value={`${fmt0(salesRateCents)}/hr`} />
                </div>
              </dl>
            )}
          </div>

          {/* Margin — the part PaintScout never shows */}
          <div className="rounded-xl border border-gray-900 bg-gray-900 p-4 text-white">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Margin</h2>
              <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-300">
                Staff only
              </span>
            </div>
            {!result ? (
              <p className="mt-3 text-sm text-gray-400">—</p>
            ) : (
              <dl className="mt-3 space-y-1.5 text-sm">
                <Row label={`Contractor (${totalHours.toFixed(1)} hr)`} value={"−" + fmt(result.contractorOfferCents)} dark />
                <Row label="Materials cost" value={"−" + fmt(result.materialCostCents)} dark />
                {result.passthroughCostCents > 0 && (
                  <Row label="Pass-through cost" value={"−" + fmt(result.passthroughCostCents)} dark />
                )}
                <div className="flex items-baseline justify-between border-t border-white/15 pt-2">
                  <span className="text-sm font-semibold">Margin</span>
                  <span className={`text-lg font-bold ${result.marginCents >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {fmt(result.marginCents)}
                    <span className="ml-1 text-xs font-normal text-gray-400">{marginPct.toFixed(0)}%</span>
                  </span>
                </div>
              </dl>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-gray-400">{label}</span>
      {children}
    </label>
  );
}
function DimInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      min={0}
      step={0.1}
      className="w-16 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
      value={value || ""}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
    />
  );
}
function Row({ label, value, muted, dark }: { label: string; value: string; muted?: boolean; dark?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? (dark ? "text-gray-400" : "text-gray-400") : dark ? "text-gray-300" : ""}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
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
