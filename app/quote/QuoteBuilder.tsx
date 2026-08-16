"use client";

import { useEffect, useMemo, useState } from "react";
import { hoursPerUnit } from "@/lib/pricing/engine";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import EstimateHeader from "./EstimateHeader";
import RichTextEditor from "@/app/components/RichTextEditor";
import CustomerEstimate from "@/app/e/[token]/CustomerEstimate";
import { DEFAULT_PROOF, type CustomerSnapshot, type SnapshotArea, type SnapshotLine, type SnapshotPaint } from "@/lib/customer/snapshot";
import { type InclusionTemplate } from "@/lib/estimate/inclusionTemplates";
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
  internalLabel: string;  // staff-facing label (defaults to the substrate code)
  clientLabel: string;    // customer-facing label shown on the estimate
  coats: number;
  count: number;
  hidden: boolean; // priced into the total, but omitted from the customer's copy
  media: MediaItem[];
  // per-surface measurement override — e.g. one wall that is half render, half
  // weatherboard: each surface gets its own size instead of the area dimensions.
  measureL: number | null; // length (m)
  measureH: number | null; // height / width (m), for area (m²) substrates
  qtyOverride: number | null;
  rateOverride: number | null; // productivity (units/hr) or hours/item
  paintingHrOverride: number | null;
  prepHr: number;
  priceOverride: number | null; // $ — overrides the surface total (labour absorbs the difference)
  productName: string | null;
  color: string;
  coverageOverride: number | null;
  volumeOverride: number | null;
  unitPriceOverride: number | null; // $/L
  crewNote: string;
  // advanced (customer-facing display + rate) options
  hideQty: boolean;
  showCoats: boolean;
  showPrice: boolean;
  useCustomRate: boolean;
  customRate: number | null; // $/hr
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
  description: string; // rich-text (HTML) — the only body text the customer sees for this area
  open: boolean; // staff builder: expanded (editing) vs collapsed folder
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
type SurfaceCalc = {
  qty: number; item?: RateItem; rate: number; isItem: boolean; chargeCents: number;
  paintingHr: number; prepHr: number; labourCents: number; volume: number;
  unitPriceCents: number; matCostCents: number; matPriceCents: number; totalCents: number;
};

const fmt = (c: number) => "$" + (c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = (c: number) => "$" + Math.round(c / 100).toLocaleString("en-AU");
// Unguessable base62 token for the customer link, minted once per estimate.
const genShareToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(28)), (n) => "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"[n % 62]).join("");
let nextId = 1;

// New estimates start with no inclusions — staff apply a "What's included"
// template (managed in Settings) or type their own bullets in the builder.
const DEFAULT_INCLUSIONS: string[] = [];

// Friendly labels + relative times for the Activity feed.
function eventLabel(type: string): string {
  switch (type) {
    case "sent": return "Sent to customer";
    case "viewed": return "Viewed by customer";
    case "accepted": return "Accepted";
    case "declined": return "Declined";
    case "question": return "Customer message";
    default: return type;
  }
}
function relTime(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); return `${d}d ago`;
}

// Quantity for a surface, from the AREA's dimensions and Room/Surface geometry.
// A surface can still override with a direct m²/lineal/count value.
function computeQuantity(item: RateItem | undefined, area: Area, s: Surface): number {
  if (!item) return 0;
  if (s.qtyOverride != null) return s.qtyOverride;
  if (item.unit === "Hours Per Item") return s.count;
  // Per-surface measurement override (takes precedence over the area size).
  if (item.unit === "Lineal Metres") {
    if (s.measureL != null) return s.measureL;
  } else if (s.measureL != null && s.measureH != null) {
    return s.measureL * s.measureH;
  }
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
  inclusionTemplates = [],
  exclusionTemplates = [],
  terms = "",
}: {
  rateCardId: string | null;
  rateCardVersion: number | null;
  rateItems: RateItem[];
  modifiers: Modifier[];
  products: Product[];
  settings: Setting[];
  lineItems: LineItemRef[];
  areaNames: AreaNameRef[];
  initial: { id: string | null; title: string | null; builder_state: unknown; share_token?: string | null; status?: string | null; sent_at?: string | null; valid_until?: string | null } | null;
  company: CompanyProfile;
  contacts: Contact[];
  inclusionTemplates?: InclusionTemplate[];
  exclusionTemplates?: InclusionTemplate[];
  terms?: string;
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
  const chargeFor = (t: string) =>
    hourlyRateOverride != null ? Math.round(hourlyRateOverride * 100)
      : rateItems.find((r) => r.category === t)?.charge_out_cents ?? (t === "Interior" ? 8500 : 10000);

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

  const loaded = (initial?.builder_state ?? null) as { blocks?: Block[]; modSel?: Record<string, string>; contact?: Contact; jobAddress?: JobAddress; materials?: Record<string, string>; depositPct?: number; inclusions?: string[]; exclusions?: string[]; discountPct?: number; discountMode?: "pct" | "fixed"; discountFixedCents?: number; hourlyRateOverride?: number | null; contractorRateOverride?: number | null } | null;
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
  // Materials — the GLOBAL paint choice per surface type, keyed "${type}::${code}".
  // A surface with productName === null follows this global default (falling back
  // to the rate card's default_product); a surface with productName set is PINNED
  // (a deliberate per-area override) and a global change skips it. Because a new
  // surface starts null, areas added after a global change inherit the current
  // default automatically.
  const [materials, setMaterials] = useState<Record<string, string>>(() => loaded?.materials ?? {});
  const materialKey = (type: string, code: string) => `${type}::${code}`;
  // Effective product NAME for a surface: pin → global → rate-card default.
  const productNameFor = (type: string, s: Surface): string | null =>
    s.productName ?? materials[materialKey(type, s.code)] ?? itemByKey.get(materialKey(type, s.code))?.default_product ?? null;
  const [contact, setContact] = useState<Contact | null>(() => loaded?.contact ?? null);
  const [jobAddress, setJobAddress] = useState<JobAddress | null>(() => loaded?.jobAddress ?? null);
  // Deposit payable on acceptance, as a % of the GST-inclusive total. Defaults to 50%.
  const [depositPct, setDepositPct] = useState<number>(() => loaded?.depositPct ?? 50);
  // What's included / not included — one bullet per line, shown to the customer.
  const [inclusions, setInclusions] = useState<string[]>(() => loaded?.inclusions ?? DEFAULT_INCLUSIONS);
  const [exclusions, setExclusions] = useState<string[]>(() => loaded?.exclusions ?? []);
  // Calculations panel — a global $/hr override (blank = use the rate card) and a
  // percentage discount applied to the ex-GST subtotal (shown on the estimate).
  const [hourlyRateOverride, setHourlyRateOverride] = useState<number | null>(() => loaded?.hourlyRateOverride ?? null);
  // What we pay the contractor per hour (margin only, never shown to the customer).
  // Blank falls back to the settings default.
  const [contractorRateOverride, setContractorRateOverride] = useState<number | null>(() => loaded?.contractorRateOverride ?? null);
  const [discountMode, setDiscountMode] = useState<"pct" | "fixed">(() => loaded?.discountMode ?? "pct");
  const [discountPct, setDiscountPct] = useState<number>(() => loaded?.discountPct ?? 0);
  const [discountFixedCents, setDiscountFixedCents] = useState<number>(() => loaded?.discountFixedCents ?? 0);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [quoteId, setQuoteId] = useState<string | null>(initial?.id ?? null);
  // Customer-view / send state. The share_token is minted on first save so the
  // link is stable; the estimate stays a draft until Sent, and locks on accept.
  const [shareToken, setShareToken] = useState<string | null>(initial?.share_token ?? null);
  const [estStatus, setEstStatus] = useState<string>(initial?.status ?? "draft");
  const [sentAt, setSentAt] = useState<string | null>(initial?.sent_at ?? null);
  const [validUntil, setValidUntil] = useState<string | null>(initial?.valid_until ?? null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const locked = estStatus === "accepted";
  const [customerView, setCustomerView] = useState(false);
  // Folder navigation: null = the list; otherwise we've drilled into an area,
  // a surface within an area, or a line item. "Done" pops back up a level.
  type View =
    | { type: "area"; id: number }
    | { type: "line"; id: number }
    | { type: "surface"; areaId: number; sid: number };
  const [view, setView] = useState<View | null>(null);
  // Whenever you drill into (or out of) a folder, jump to the top so a surface
  // always opens on its starting view rather than mid-scroll.
  useEffect(() => { window.scrollTo({ top: 0 }); }, [view]);
  const [areaPickerOpen, setAreaPickerOpen] = useState(false);
  // Surface (substrate) folder picker: which area, and whether adding new or changing an existing surface.
  const [surfacePicker, setSurfacePicker] = useState<{ areaId: number; sid: number | null } | null>(null);
  // Drag-and-drop reorder of blocks (areas + line items).
  const [dragId, setDragId] = useState<number | null>(null);
  const [dragEnabledId, setDragEnabledId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);
  const moveBlock = (fromId: number, toId: number) =>
    setBlocks((bs) => {
      const from = bs.findIndex((b) => b.id === fromId);
      const to = bs.findIndex((b) => b.id === toId);
      if (from < 0 || to < 0 || from === to) return bs;
      const copy = [...bs];
      const [moved] = copy.splice(from, 1);
      const insertAt = copy.findIndex((b) => b.id === toId);
      copy.splice(from < to ? insertAt + 1 : insertAt, 0, moved);
      return copy;
    });
  const [saveMsg, setSaveMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [templateModal, setTemplateModal] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [materialsOpen, setMaterialsOpen] = useState(true);
  // Right-column tools bar: Activity / Chat / Calculations / Follow-ups.
  const [rightTab, setRightTab] = useState<null | "activity" | "chat" | "calc" | "followups">(null);
  const [events, setEvents] = useState<{ type: string; payload: unknown; created_at: string }[]>([]);
  const [questions, setQuestions] = useState<{ message: string; created_at: string }[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  function newArea(preset?: { name: string; type: "Interior" | "Exterior" }): Area {
    const type = preset?.type ?? "Interior";
    return {
      id: nextId++,
      kind: "area",
      name: preset?.name ?? "New area",
      type,
      areaType: type === "Exterior" ? "surface" : "room",
      L: 0, W: 0, H: 2.4, isOption: false, description: "", open: true, media: [], surfaces: [],
    };
  }
  function newSurface(): Surface {
    return {
      id: nextId++, code: "", internalLabel: "", clientLabel: "", coats: 2, count: 1, hidden: false, media: [], measureL: null, measureH: null, qtyOverride: null,
      rateOverride: null, paintingHrOverride: null, prepHr: 0, priceOverride: null, productName: null, color: "",
      coverageOverride: null, volumeOverride: null, unitPriceOverride: null, crewNote: "",
      hideQty: false, showCoats: false, showPrice: false, useCustomRate: false, customRate: null,
      open: false,
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
  // Choose a substrate for a surface. Seeds the internal/client labels and, on the
  // FIRST selection, appends the substrate's label to the area's client Description.
  const selectSubstrate = (areaId: number, sid: number, code: string) =>
    setBlocks((bs) =>
      bs.map((b) => {
        if (b.id !== areaId || b.kind !== "area") return b;
        const prev = b.surfaces.find((s) => s.id === sid);
        const firstPick = !prev?.code && !!code;
        const surfaces = b.surfaces.map((s) =>
          s.id === sid
            ? { ...s, code, internalLabel: s.internalLabel || code, clientLabel: s.clientLabel || code }
            : s,
        );
        let description = b.description ?? "";
        if (firstPick) {
          const line = `<p>${code}</p>`;
          description = description.trim() ? description + line : line;
        }
        return { ...b, surfaces, description };
      }),
    );
  // Add a brand-new surface with a chosen substrate (from the folder picker) and
  // append its label to the area description.
  const addSurfaceWithCode = (areaId: number, code: string): number => {
    const surf: Surface = { ...newSurface(), code, internalLabel: code, clientLabel: code, open: true };
    setBlocks((bs) =>
      bs.map((b) => {
        if (b.id !== areaId || b.kind !== "area") return b;
        const line = `<p>${code}</p>`;
        const description = (b.description ?? "").trim() ? b.description + line : line;
        return { ...b, surfaces: [...b.surfaces, surf], description };
      }),
    );
    return surf.id;
  };
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
  const surfaceCalc = (area: Area, s: Surface): SurfaceCalc => {
    const chargeBase = s.useCustomRate && s.customRate != null ? Math.round(s.customRate * 100) : chargeFor(area.type);
    const item = itemByKey.get(`${area.type}::${s.code}`);
    if (!item) return { qty: 0, rate: 0, isItem: false, chargeCents: chargeBase, paintingHr: 0, prepHr: s.prepHr, labourCents: Math.round(s.prepHr * chargeBase), volume: 0, unitPriceCents: 0, matCostCents: 0, matPriceCents: 0, totalCents: Math.round(s.prepHr * chargeBase) };
    const qty = computeQuantity(item, area, s);
    const isItem = item.unit === "Hours Per Item";
    const baseHpu = hoursPerUnit(item, s.coats);
    const dispRate = s.rateOverride ?? (isItem ? baseHpu : 1 / baseHpu);
    const baseHours = isItem ? dispRate * qty : dispRate > 0 ? qty / dispRate : 0;
    const paintingHr = s.paintingHrOverride ?? baseHours * jobMod;
    const charge = chargeBase;
    const labourCents = Math.round((paintingHr + s.prepHr) * charge);

    const prodName = productNameFor(area.type, s);
    const product = prodName ? productByName.get(prodName) : undefined;
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
    // A manual price override sets the surface total; labour absorbs the difference
    // so contractor hours and materials cost (and therefore margin) stay honest.
    const computedTotal = labourCents + matPriceCents;
    const totalCents = s.priceOverride != null ? Math.round(s.priceOverride * 100) : computedTotal;
    const finalLabour = s.priceOverride != null ? totalCents - matPriceCents : labourCents;
    return { qty, item, rate: dispRate, isItem, chargeCents: charge, paintingHr, prepHr: s.prepHr, labourCents: finalLabour, volume, unitPriceCents, matCostCents, matPriceCents, totalCents };
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
    // Discount comes off the ex-GST subtotal (and out of our margin) — either a
    // percentage or a flat dollar amount, capped so it can't exceed the subtotal.
    const discountCents = discountMode === "fixed"
      ? Math.min(discountFixedCents || 0, subtotal)
      : Math.round(subtotal * (discountPct || 0) / 100);
    const netSubtotal = subtotal - discountCents;
    const gst = Math.round(netSubtotal * gstRate);
    const effContractorHourlyCents = contractorRateOverride != null ? Math.round(contractorRateOverride * 100) : contractorHourlyCents;
    const contractorOffer = Math.round(contractorHours * effContractorHourlyCents * offerPct);
    const margin = netSubtotal - contractorOffer - materialsCost;
    return { subtotal, sundries, discountCents, netSubtotal, gst, total: netSubtotal + gst, contractorHours, contractorOffer, materialsCost, margin };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, modSel, materials, discountPct, discountMode, discountFixedCents, hourlyRateOverride, contractorRateOverride]);

  const marginPct = totals.subtotal > 0 ? (totals.margin / totals.subtotal) * 100 : 0;
  const salesRateCents = totals.contractorHours > 0 ? Math.round(totals.subtotal / totals.contractorHours) : 0;

  async function save(): Promise<{ id: string | null; token: string | null }> {
    if (locked) { setSaveMsg("This estimate is accepted and locked."); return { id: quoteId, token: shareToken }; }
    setSaving(true);
    setSaveMsg("");
    const supabase = createClient();
    const finishCode = modSel["Level of Finish"];
    const token = shareToken ?? genShareToken();
    // On update we deliberately DON'T touch status — a sent estimate stays sent,
    // and its refreshed sent_snapshot is what the customer sees live.
    const base = {
      title: title.trim() || "Untitled quote",
      rate_card_id: rateCardId,
      rate_card_version: rateCardVersion,
      level_of_finish: finishCode ? Number(finishCode.split("-")[1]) : null,
      size_band: modSel["Job Size"] || null,
      subtotal_cents: totals.subtotal,
      total_cents: totals.total,
      builder_state: { blocks, modSel, contact, jobAddress, materials, depositPct, inclusions, exclusions, discountPct, discountMode, discountFixedCents, hourlyRateOverride, contractorRateOverride },
      share_token: token,
      sent_snapshot: buildCustomerDoc(token),
    };
    try {
      let id = quoteId;
      if (id) {
        const { error } = await supabase.from("estimates").update(base).eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("estimates").insert({ ...base, status: "draft" }).select("id").single();
        if (error) throw error;
        id = data.id;
        setQuoteId(id);
        window.history.replaceState(null, "", `/quote?id=${id}`);
      }
      setShareToken(token);
      setSaveMsg("Saved ✓");
      return { id, token };
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Save failed");
      return { id: quoteId, token: shareToken };
    } finally {
      setSaving(false);
    }
  }

  async function sendToCustomer() {
    if (!finishChosen) { setSaveMsg("Choose a level of finish before sending."); return; }
    const { id, token } = await save(); // persists token + live doc
    if (!id || !token) return;
    const supabase = createClient();
    const nowIso = new Date().toISOString();
    const until = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
    const { error } = await supabase.from("estimates").update({ status: "sent", sent_at: sentAt ?? nowIso, valid_until: until }).eq("id", id);
    if (error) { setSaveMsg(error.message); return; }
    setEstStatus("sent");
    setSentAt(sentAt ?? nowIso);
    setValidUntil(until);
    setShareUrl(`${window.location.origin}/e/${token}`);
  }

  // Load the activity feed + customer messages for the Activity / Chat tabs.
  async function loadActivity() {
    if (!quoteId) return;
    setActivityLoading(true);
    const supabase = createClient();
    const [{ data: ev }, { data: q }] = await Promise.all([
      supabase.from("estimate_events").select("type, payload, created_at").eq("estimate_id", quoteId).order("created_at", { ascending: false }).limit(50),
      supabase.from("estimate_questions").select("message, created_at").eq("estimate_id", quoteId).order("created_at", { ascending: false }).limit(50),
    ]);
    setEvents((ev as typeof events) ?? []);
    setQuestions((q as typeof questions) ?? []);
    setActivityLoading(false);
  }
  const openRightTab = (tab: typeof rightTab) => {
    const next = rightTab === tab ? null : tab;
    setRightTab(next);
    if (next === "activity" || next === "chat") loadActivity();
  };

  // Save the current build as a reusable template (stored in settings, not as an
  // estimate) so a new estimate can be started from it later.
  async function saveTemplate(name: string) {
    setSaving(true);
    setSaveMsg("");
    const supabase = createClient();
    try {
      const { data } = await supabase.from("settings").select("value").eq("key", "estimate_templates").maybeSingle();
      const list = Array.isArray(data?.value) ? (data!.value as unknown[]) : [];
      const tpl = { id: crypto.randomUUID(), name: name.trim(), createdAt: new Date().toISOString(), builder_state: { blocks, modSel, contact, jobAddress, materials, depositPct, inclusions, exclusions, discountPct, discountMode, discountFixedCents, hourlyRateOverride, contractorRateOverride } };
      const { error } = await supabase.from("settings").upsert({ key: "estimate_templates", value: [...list, tpl] }, { onConflict: "key" });
      if (error) throw error;
      setSaveMsg("Template saved ✓");
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Template save failed");
    } finally {
      setSaving(false);
      setTemplateModal(false);
      setTemplateName("");
    }
  }

  // Materials rows — one per distinct surface type (type::code) used anywhere in
  // the quote. Auto-builds from the blocks: add a new substrate to any area and a
  // row appears; the row's product cascades to every un-pinned surface of that type.
  const materialRows = useMemo(() => {
    const map = new Map<string, { key: string; type: "Interior" | "Exterior"; code: string; count: number; customCount: number }>();
    for (const b of blocks) {
      if (b.kind !== "area") continue;
      for (const s of b.surfaces) {
        if (!s.code) continue;
        const key = `${b.type}::${s.code}`;
        const row = map.get(key) ?? { key, type: b.type, code: s.code, count: 0, customCount: 0 };
        row.count += 1;
        if (s.productName != null) row.customCount += 1;
        map.set(key, row);
      }
    }
    return [...map.values()].sort((a, z) => a.type.localeCompare(z.type) || a.code.localeCompare(z.code));
  }, [blocks]);
  // Reset every pinned (custom) surface of a given type back to the global default.
  const clearMaterialPins = (type: string, code: string) =>
    setBlocks((bs) =>
      bs.map((b) =>
        b.kind === "area" && b.type === type
          ? { ...b, surfaces: b.surfaces.map((s) => (s.code === code ? { ...s, productName: null } : s)) }
          : b,
      ),
    );

  const mainBlocks = blocks.filter((b) => !b.isOption);
  const optionBlocks = blocks.filter((b) => b.isOption);
  // In customer view, hidden line items drop out of the document entirely.
  const visibleToCustomer = (b: Block) => !customerView || !(b.kind === "line" && b.hidden);
  const areaPriceCents = (b: Area) => b.surfaces.reduce((n, s) => n + surfaceCalc(b, s).totalCents, 0);

  // Distinct products actually used in the included areas → customer paint cards.
  const roleForCategory = (cat: string): string => {
    if (/walls/i.test(cat)) return "Walls";
    if (/ceiling/i.test(cat)) return "Ceilings";
    if (/trim|door/i.test(cat)) return "Trim & doors";
    if (/texture|membrane/i.test(cat)) return "Texture";
    if (/prep|primer/i.test(cat)) return "Preparation";
    if (/clear|floor/i.test(cat)) return "Clear & floors";
    return "";
  };
  function computePaints(): SnapshotPaint[] {
    const used = new Map<string, Map<string, Set<string>>>(); // product → surfaceLabel → area titles
    for (const b of blocks) {
      if (b.kind !== "area" || b.isOption) continue; // only included areas
      const areaTitle = b.name || "Area";
      for (const s of b.surfaces) {
        if (!s.code || s.hidden) continue;
        const pname = productNameFor(b.type, s);
        if (!pname) continue;
        const label = s.clientLabel || s.code;
        if (!used.has(pname)) used.set(pname, new Map());
        const bySurf = used.get(pname)!;
        if (!bySurf.has(label)) bySurf.set(label, new Set());
        bySurf.get(label)!.add(areaTitle);
      }
    }
    const paints: SnapshotPaint[] = [];
    for (const [pname, bySurf] of used) {
      const p = productByName.get(pname);
      const usage: string[] = [];
      for (const [label, areas] of bySurf) {
        usage.push(areas.size > 1 ? `${label} · ${areas.size} areas` : `${label} · ${[...areas][0]}`);
      }
      const brand = p?.brand ?? "";
      const category = p?.category ?? "";
      const visible = p?.customer_visible ?? false;
      // display name — strip a leading brand prefix (brand is shown separately)
      let display = pname;
      if (brand && display.toLowerCase().startsWith(brand.toLowerCase() + " ")) display = display.slice(brand.length + 1);
      paints.push({
        name: display,
        brand,
        category,
        role: roleForCategory(category),
        blurb: visible ? (p?.blurb ?? "") : "",
        properties: visible ? (p?.properties ?? []) : [],
        guarantee: visible ? (p?.guarantee ?? "") : "",
        photoUrl: p?.photo_url ?? p?.image_url ?? "",
        customerVisible: visible,
        isPrep: /prep|primer/i.test(category),
        usage: usage.slice(0, 3),
      });
    }
    paints.sort((a, z) => (a.isPrep ? 1 : 0) - (z.isPrep ? 1 : 0));
    return paints;
  }

  // Build the customer-safe document from the CURRENT state — no margin, costs,
  // contractor rates, hidden surfaces/items or internal notes. Used both for the
  // live "Customer view" preview and written to sent_snapshot on every save.
  function buildCustomerDoc(token: string): CustomerSnapshot {
    const areas: SnapshotArea[] = [];
    const lineItemsDoc: SnapshotLine[] = [];
    const options: SnapshotLine[] = [];
    for (const b of blocks) {
      if (b.kind === "area") {
        const surfaces = b.surfaces
          .filter((s) => s.code && !s.hidden)
          .map((s) => ({ label: s.clientLabel || s.code, coats: s.coats, product: productNameFor(b.type, s) || "" }));
        const photos = [
          ...(b.media ?? []).map((m) => m.url),
          ...b.surfaces.filter((s) => !s.hidden).flatMap((s) => (s.media ?? []).map((m) => m.url)),
        ];
        const entry: SnapshotArea = { id: String(b.id), title: b.name || "Area", descriptionHtml: b.description ?? "", priceCents: areaPriceCents(b), surfaces, photos };
        if (b.isOption) options.push({ id: entry.id, title: entry.title, descriptionHtml: entry.descriptionHtml, priceCents: entry.priceCents });
        else areas.push(entry);
      } else {
        if (b.hidden) continue;
        const line: SnapshotLine = { id: String(b.id), title: b.name || "Line item", descriptionHtml: b.description ?? "", priceCents: lineCalc(b).priceCents };
        if (b.isOption) options.push(line);
        else lineItemsDoc.push(line);
      }
    }
    return {
      version: 1,
      company: {
        name: company.name, addressLine1: company.addressLine1, addressLine2: company.addressLine2, phone: company.phone,
        abn: company.abn, email: company.email, estimatorName: company.estimatorName, estimatorTitle: company.estimatorTitle,
        estimatorPhone: company.estimatorPhone, logoUrl: company.logoUrl,
      },
      estRef: token.slice(0, 8).toUpperCase(),
      contactName: contact ? [contact.first_name, contact.last_name].filter(Boolean).join(" ") || contact.company || "" : "",
      contactEmail: contact?.email ?? "",
      jobAddress: jobAddress ? [jobAddress.address, jobAddress.city, jobAddress.state, jobAddress.postal].filter(Boolean).join(", ") : "",
      jobTitle: title || "Painting estimate",
      gstRatePct: Math.round(gstRate * 100),
      depositPct,
      baseSubtotalCents: totals.subtotal,
      areas, lineItems: lineItemsDoc, options,
      paints: computePaints(),
      inclusions: inclusions.map((t) => t.trim()).filter(Boolean),
      exclusions: exclusions.map((t) => t.trim()).filter(Boolean),
      terms,
      discountMode,
      discountPct: discountPct || 0,
      discountFixedCents: discountFixedCents || 0,
      proof: DEFAULT_PROOF,
    };
  }

  // ---- folder screens (drilled-in views) ----
  const renderAreaFolder = (b: Area) => (
    <AreaCard
      area={b}
      calc={(s) => surfaceCalc(b, s)}
      onDone={() => setView(null)}
      onPatch={(patch) => patchBlock(b.id, patch)}
      onOpenSurface={(sid) => setView({ type: "surface", areaId: b.id, sid })}
      onAddSurface={() => setSurfacePicker({ areaId: b.id, sid: null })}
      onRemoveSurface={(sid) => patchBlock(b.id, { surfaces: b.surfaces.filter((x) => x.id !== sid) })}
      onDuplicateSurface={(sid) => duplicateSurface(b.id, sid)}
      onDuplicate={() => duplicateBlock(b.id)}
      onRemove={() => { removeBlock(b.id); setView(null); }}
    />
  );
  const renderLineFolder = (b: LineBlock) => (
    <LineCard
      line={b}
      calc={lineCalc(b)}
      lineItems={lineItems}
      chargeFor={chargeFor}
      onDone={() => setView(null)}
      onPatch={(patch) => patchBlock(b.id, patch)}
      onDuplicate={() => duplicateBlock(b.id)}
      onRemove={() => { removeBlock(b.id); setView(null); }}
    />
  );

  // ---- list row (Level 0): a closed folder. Click anywhere on it to open. ----
  const renderFolderRow = (b: Block) => {
    const title = b.kind === "area" ? b.name || "Untitled area" : b.name || "Line item";
    const price = b.kind === "area" ? areaPriceCents(b) : lineCalc(b).priceCents;
    const areaSubtitle =
      b.kind === "area" ? b.surfaces.filter((s) => s.code).map((s) => s.clientLabel || s.code).join(", ") || "No surfaces yet" : "";
    const lineDesc = b.kind === "line" ? b.description ?? "" : "";
    const lineHasDesc = !!lineDesc && lineDesc.replace(/<[^>]*>/g, "").trim() !== "";
    const open = () => setView(b.kind === "area" ? { type: "area", id: b.id } : { type: "line", id: b.id });
    const stop = (e: React.MouseEvent) => e.stopPropagation();
    return (
      <section
        onClick={open}
        className="cursor-pointer rounded-xl border border-gray-200 bg-white hover:border-gray-400 hover:bg-gray-50"
      >
        <div className="flex items-start gap-2 p-3">
          <span className="text-2xl leading-none">📁</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{title}</span>
              {b.isOption && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-500">Optional</span>}
            </div>
            {b.kind === "area" ? (
              <div className="truncate text-xs text-gray-500">{areaSubtitle}</div>
            ) : lineHasDesc ? (
              <div className="rte mt-1 text-xs text-gray-600" dangerouslySetInnerHTML={{ __html: lineDesc }} />
            ) : (
              <div className="text-xs text-gray-400">Line item — no description yet</div>
            )}
          </div>
          <div className="whitespace-nowrap text-sm font-semibold tabular-nums">{fmt(price)}</div>
          <label onClick={stop} className="flex items-center gap-1 text-xs text-gray-500" title="Optional add-on">
            <input type="checkbox" checked={b.isOption} onChange={(e) => patchBlock(b.id, { isOption: e.target.checked })} /> Opt
          </label>
          <button onClick={(e) => { stop(e); duplicateBlock(b.id); }} className="px-1 text-lg text-gray-400 hover:text-gray-700" title="Duplicate">⧉</button>
          <button onClick={(e) => { stop(e); removeBlock(b.id); }} className="px-1 text-gray-400 hover:text-red-600" title="Remove">×</button>
        </div>
      </section>
    );
  };
  const renderSummary = (b: Block) => (
    <BlockSummary
      key={b.id}
      title={b.kind === "area" ? b.name || "Untitled area" : b.name || "Line item"}
      descriptionHtml={b.description ?? ""}
      priceCents={b.kind === "area" ? areaPriceCents(b) : lineCalc(b).priceCents}
      isOption={b.isOption}
      customerView={customerView}
      onOpen={() => {}}
      onToggleOption={(v) => patchBlock(b.id, { isOption: v })}
      onDuplicate={() => duplicateBlock(b.id)}
      onRemove={() => removeBlock(b.id)}
    />
  );
  // Build mode: each block is draggable by its grip handle so staff can reorder.
  const renderDraggable = (b: Block) => (
    <div
      key={b.id}
      draggable={dragEnabledId === b.id}
      onDragStart={(e) => { setDragId(b.id); e.dataTransfer.effectAllowed = "move"; }}
      onDragEnd={() => { setDragId(null); setDragEnabledId(null); setOverId(null); }}
      onDragOver={(e) => { if (dragId != null && dragId !== b.id) { e.preventDefault(); setOverId(b.id); } }}
      onDrop={(e) => { e.preventDefault(); if (dragId != null) moveBlock(dragId, b.id); setOverId(null); }}
      className={`flex items-stretch gap-1 rounded-xl transition ${dragId === b.id ? "opacity-40" : ""} ${overId === b.id && dragId !== b.id ? "ring-2 ring-blue-400" : ""}`}
    >
      <span
        onMouseDown={() => setDragEnabledId(b.id)}
        onMouseUp={() => setDragEnabledId(null)}
        className="mt-3 flex h-7 w-5 shrink-0 cursor-grab items-center justify-center rounded text-lg leading-none text-gray-300 hover:bg-gray-100 hover:text-gray-600 active:cursor-grabbing"
        title="Drag to reorder"
        aria-label="Drag to reorder"
      >⠿</span>
      <div className="min-w-0 flex-1">{renderFolderRow(b)}</div>
    </div>
  );

  // The drilled-in folder screen for the current view (null → show the list).
  let folderEl: React.ReactNode = null;
  if (!customerView && view) {
    if (view.type === "surface") {
      const area = blocks.find((b) => b.id === view.areaId && b.kind === "area") as Area | undefined;
      const s = area?.surfaces.find((x) => x.id === view.sid);
      if (area && s) {
        const c = surfaceCalc(area, s);
        folderEl = (
          <SurfaceEditor
            surface={s}
            item={c.item}
            calc={c}
            products={products}
            materialDefault={materials[materialKey(area.type, s.code)] ?? c.item?.default_product ?? null}
            chargeFor={chargeFor}
            areaType={area.type}
            areaName={area.name || "area"}
            onChangeSelection={() => setSurfacePicker({ areaId: area.id, sid: s.id })}
            onPatch={(patch) => patchSurface(area.id, s.id, patch)}
            onDone={() => setView({ type: "area", id: area.id })}
            onRemove={() => { patchBlock(area.id, { surfaces: area.surfaces.filter((x) => x.id !== s.id) }); setView({ type: "area", id: area.id }); }}
          />
        );
      }
    } else {
      const b = blocks.find((x) => x.id === view.id);
      if (b?.kind === "area" && view.type === "area") folderEl = renderAreaFolder(b);
      else if (b?.kind === "line" && view.type === "line") folderEl = renderLineFolder(b);
    }
  }

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3 rounded-xl bg-ink px-5 py-4 text-white">
        <div>
          <Link href="/estimates" className="text-sm font-medium text-gray-400 hover:text-white">← Estimates</Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title || "New estimate"}</h1>
          <p className="text-sm text-gray-400">
            Rate card v{rateCardVersion ?? "?"} · live pricing
            {quoteId ? " · saved draft" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setCustomerView((v) => !v); setView(null); }}
            className={`rounded-md px-4 py-2 text-sm font-medium ${customerView ? "bg-accent text-accentink hover:bg-paint" : "border border-line2 text-gray-200 hover:bg-white/5"}`}
          >
            {customerView ? "← Back to building" : "👁 Customer view"}
          </button>
          {locked && <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">Accepted · locked</span>}
          {!customerView && !locked && (
            <>
              <input
                className="w-40 rounded-md border border-line2 bg-graphite px-3 py-2 text-sm text-white placeholder-gray-500"
                placeholder="Quote name"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <button
                onClick={save}
                disabled={saving}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accentink hover:bg-paint disabled:opacity-50"
              >
                {saving ? "Saving…" : quoteId ? "Save" : "Save draft"}
              </button>
              <button
                onClick={sendToCustomer}
                disabled={saving}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                title={estStatus === "draft" ? "Save + mark sent, and get the customer link" : "Update the sent estimate"}
              >
                {estStatus === "draft" ? "Send to customer" : "Update sent"}
              </button>
              <button
                onClick={() => { setTemplateName(title.trim()); setTemplateModal(true); }}
                className="rounded-md border border-line2 px-3 py-2 text-sm font-medium text-gray-200 hover:bg-white/5"
                title="Save this build as a reusable template"
              >
                Save as template
              </button>
              <a href="/estimates" className="rounded-md border border-line2 px-3 py-2 text-sm font-medium text-gray-200 hover:bg-white/5">
                New
              </a>
            </>
          )}
          {saveMsg && (
            <span className={`text-sm ${saveMsg.startsWith("Saved") ? "text-green-600" : "text-red-600"}`}>{saveMsg}</span>
          )}
        </div>
      </div>

      {customerView && (
        /* ---- live customer view: the same dark page the customer opens ---- */
        <div className="mt-4">
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-700">
            <span className="font-semibold">Customer view — live preview</span>
            <span>· exactly what the customer sees. Save to publish your latest edits to their link.</span>
          </div>
          <div className="cv overflow-hidden rounded-xl border border-gray-200">
            <CustomerEstimate snapshot={buildCustomerDoc(shareToken ?? "PREVIEW00")} validUntil={validUntil} sentAt={sentAt} preview />
          </div>
        </div>
      )}

      {/* The estimate header (company / estimator / banking / contact) only shows
          in build mode, and not when drilled into a folder. */}
      {!folderEl && !customerView && (
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
      )}

      {!customerView && (
      <div className={`mt-6 grid grid-cols-1 gap-6 ${folderEl ? "" : "lg:grid-cols-[1fr_300px]"}`}>
        <div className="space-y-4">
          {folderEl ? (
            /* ---------- drilled-in folder screen (area / surface / line) ---------- */
            folderEl
          ) : (
            /* ---------- the list of folders ---------- */
            <>
              {!customerView && (
                <section className="rounded-xl border border-gray-200 bg-white p-4">
                  <h2 className="text-sm font-semibold">Job settings <span className="font-normal text-gray-400">· staff only</span></h2>
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
              )}

              {/* Materials — the global paint control. Change a product here and it
                  cascades to every area using that surface type; a per-area override
                  (pinned) is skipped and shown as "custom" with a one-tap reset. */}
              {!customerView && materialRows.length > 0 && (
                <section className="rounded-xl border border-gray-200 bg-white p-4">
                  <button onClick={() => setMaterialsOpen((v) => !v)} className="flex w-full items-center justify-between text-left">
                    <h2 className="text-sm font-semibold">
                      Materials <span className="font-normal text-gray-400">· one product per surface type — change once, applies everywhere</span>
                    </h2>
                    <span className="text-gray-400">{materialsOpen ? "▾" : "▸"}</span>
                  </button>
                  {materialsOpen && (
                    <div className="mt-3 divide-y divide-gray-100">
                      {materialRows.map((r) => {
                        const globalName = materials[r.key] ?? itemByKey.get(r.key)?.default_product ?? "";
                        // Filter to products for this Int/Ext type, but always keep the
                        // currently-selected product in the list so it never shows blank.
                        const opts = products.filter((p) => !p.type || p.type === r.type || p.name === globalName);
                        return (
                          <div key={r.key} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2">
                            <div className="flex w-40 shrink-0 items-center gap-1.5">
                              <span className="text-sm font-medium text-gray-900">{r.code}</span>
                              <span className={`rounded px-1 py-0.5 text-[10px] font-medium ${r.type === "Exterior" ? "bg-orange-100 text-orange-700" : "bg-sky-100 text-sky-700"}`}>
                                {r.type === "Exterior" ? "Ext" : "Int"}
                              </span>
                            </div>
                            <select
                              className="min-w-[12rem] flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                              value={globalName}
                              onChange={(e) => setMaterials((m) => ({ ...m, [r.key]: e.target.value }))}
                            >
                              {globalName === "" && <option value="">— choose a product —</option>}
                              {opts.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
                            </select>
                            {r.customCount > 0 && (
                              <div className="flex items-center gap-2">
                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                                  {r.customCount} area{r.customCount > 1 ? "s" : ""} custom
                                </span>
                                <button
                                  onClick={() => clearMaterialPins(r.type, r.code)}
                                  className="text-[11px] font-medium text-blue-600 hover:text-blue-800"
                                >
                                  reset to default
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              )}

              {/* Each area/line is a closed folder — click to open it (drag the grip
                  to reorder); in customer view it's the read-only document card. */}
              {mainBlocks.filter(visibleToCustomer).map((b) => (customerView ? renderSummary(b) : renderDraggable(b)))}

              {optionBlocks.filter(visibleToCustomer).length > 0 && (
                <section className="rounded-xl border border-dashed border-gray-300 bg-white p-4">
                  <h2 className="text-sm font-semibold">
                    Optional extras{" "}
                    <span className="font-normal text-gray-400">— not included in the total unless added</span>
                  </h2>
                  <div className="mt-3 space-y-4">{optionBlocks.filter(visibleToCustomer).map((b) => (customerView ? renderSummary(b) : renderDraggable(b)))}</div>
                </section>
              )}

              {!customerView && (
                <div className="flex gap-3">
                  <button onClick={() => setAreaPickerOpen(true)} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700">
                    + Add area
                  </button>
                  <button onClick={() => { const l = newLine(); setBlocks((bs) => [...bs, l]); setView({ type: "line", id: l.id }); }} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50">
                    + Add line item
                  </button>
                </div>
              )}

              {/* What's included / Not included — one bullet per line. These flow
                  straight into the customer's "Included in your price" and
                  "Not included" lists. */}
              {!customerView && (
                <section className="rounded-xl border border-gray-200 bg-white p-4">
                  <h2 className="text-sm font-semibold">
                    What&apos;s included / excluded <span className="font-normal text-gray-400">· one bullet per line — shown to the customer</span>
                  </h2>
                  <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {/* Included */}
                    <div className="text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-emerald-700">Included in your price</span>
                        {inclusionTemplates.length > 0 && (
                          <select
                            className="rounded-md border border-gray-300 px-1.5 py-1 text-[11px]"
                            value=""
                            onChange={(e) => {
                              const t = inclusionTemplates.find((x) => x.id === e.target.value);
                              if (!t) return;
                              setInclusions((cur) => {
                                const have = new Set(cur.map((i) => i.trim()));
                                const base = cur.length === 1 && cur[0].trim() === "" ? [] : cur;
                                return [...base, ...t.items.filter((i) => !have.has(i.trim()))];
                              });
                            }}
                          >
                            <option value="">+ Template…</option>
                            {inclusionTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        )}
                      </div>
                      <textarea
                        rows={6}
                        className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                        placeholder={"All surface preparation\nPremium paints and materials\nDaily clean-up"}
                        value={inclusions.join("\n")}
                        onChange={(e) => setInclusions(e.target.value.split("\n"))}
                      />
                    </div>
                    {/* Excluded */}
                    <div className="text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-gray-600">Not included</span>
                        {exclusionTemplates.length > 0 && (
                          <select
                            className="rounded-md border border-gray-300 px-1.5 py-1 text-[11px]"
                            value=""
                            onChange={(e) => {
                              const t = exclusionTemplates.find((x) => x.id === e.target.value);
                              if (!t) return;
                              setExclusions((cur) => {
                                const have = new Set(cur.map((i) => i.trim()));
                                const base = cur.length === 1 && cur[0].trim() === "" ? [] : cur;
                                return [...base, ...t.items.filter((i) => !have.has(i.trim()))];
                              });
                            }}
                          >
                            <option value="">+ Template…</option>
                            {exclusionTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        )}
                      </div>
                      <textarea
                        rows={6}
                        className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                        placeholder={"Plaster repairs beyond minor filling\nFurniture removal"}
                        value={exclusions.join("\n")}
                        onChange={(e) => setExclusions(e.target.value.split("\n"))}
                      />
                    </div>
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        {/* right panel — quote + margin (staff only, build mode) */}
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
              <div className="!mt-2 flex items-center justify-between gap-2 border-t border-gray-100 pt-2">
                <span className="flex items-center gap-1 text-gray-500">
                  Deposit
                  <input
                    type="number" min={0} max={100} value={depositPct}
                    onChange={(e) => setDepositPct(e.target.value === "" ? 0 : Math.min(100, Math.max(0, Number(e.target.value))))}
                    className="w-14 rounded-md border border-gray-300 px-1.5 py-1 text-right text-sm tabular-nums"
                  />
                  %
                </span>
                <span className="font-semibold tabular-nums">{fmt(Math.round(totals.total * depositPct / 100))}</span>
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

          {/* Tools bar — Activity / Chat / Calculations / Follow-ups */}
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            {[
              { key: "activity", icon: "📈", label: "Activity" },
              { key: "chat", icon: "💬", label: "Chat" },
              { key: "calc", icon: "🧮", label: "Calculations" },
              { key: "followups", icon: "🔔", label: "Follow-ups" },
            ].map((row) => (
              <div key={row.key} className="border-b border-gray-100 last:border-b-0">
                <button
                  onClick={() => openRightTab(row.key as typeof rightTab)}
                  className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium hover:bg-gray-50"
                >
                  <span className="flex items-center gap-2"><span aria-hidden>{row.icon}</span>{row.label}</span>
                  <span className="text-gray-400">{rightTab === row.key ? "▾" : "▸"}</span>
                </button>

                {rightTab === row.key && (
                  <div className="border-t border-gray-100 px-3 py-3 text-sm">
                    {row.key === "activity" && (
                      !quoteId ? <p className="text-xs text-gray-500">Save the estimate to start tracking activity.</p>
                      : activityLoading ? <p className="text-xs text-gray-400">Loading…</p>
                      : events.length === 0 ? <p className="text-xs text-gray-500">No activity yet.</p>
                      : (
                        <ul className="space-y-2">
                          {events.map((e, i) => (
                            <li key={i} className="flex items-start justify-between gap-2">
                              <span className="capitalize text-gray-700">{eventLabel(e.type)}</span>
                              <span className="shrink-0 text-[11px] tabular-nums text-gray-400">{relTime(e.created_at)}</span>
                            </li>
                          ))}
                        </ul>
                      )
                    )}

                    {row.key === "chat" && (
                      <div>
                        {!quoteId ? <p className="text-xs text-gray-500">Save and send the estimate to message the customer.</p> : (
                          <>
                            {questions.length === 0
                              ? <p className="text-xs text-gray-500">No messages from the customer yet.</p>
                              : (
                                <ul className="space-y-2">
                                  {questions.map((q, i) => (
                                    <li key={i} className="rounded-md bg-gray-50 px-2 py-1.5">
                                      <div className="text-[13px] text-gray-800">{q.message}</div>
                                      <div className="mt-0.5 text-[11px] text-gray-400">{relTime(q.created_at)}</div>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            <div className="mt-2 flex gap-1.5">
                              <input disabled placeholder="Reply (two-way chat coming soon)" className="flex-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-400" />
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {row.key === "calc" && (
                      <div className="space-y-3">
                        <label className="block text-xs">
                          <span className="text-gray-500">Charge-out rate ($/hr) · blank uses the rate card</span>
                          <input
                            type="number" min={0} value={hourlyRateOverride ?? ""}
                            placeholder={String((chargeFor("Interior") / 100).toFixed(0))}
                            onChange={(e) => setHourlyRateOverride(e.target.value === "" ? null : Number(e.target.value))}
                            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                          />
                        </label>
                        <div className="text-xs">
                          <label className="block">
                            <span className="text-gray-500">Contractor rate ($/hr) · what you pay the crew (margin only)</span>
                            <input
                              type="number" min={0} value={contractorRateOverride ?? ""}
                              placeholder={String((contractorHourlyCents / 100).toFixed(0))}
                              onChange={(e) => setContractorRateOverride(e.target.value === "" ? null : Number(e.target.value))}
                              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                            />
                          </label>
                          <div className="mt-1 flex items-center justify-between text-[11px] text-gray-400">
                            <span>Contractor offer: {fmt(totals.contractorOffer)}</span>
                            {contractorRateOverride != null && (
                              <button onClick={() => setContractorRateOverride(null)} className="font-medium text-blue-600 hover:text-blue-800">↺ reset</button>
                            )}
                          </div>
                        </div>
                        <div className="text-xs">
                          <div className="flex items-center justify-between">
                            <span className="text-gray-500">Discount · shown on the estimate</span>
                            <div className="inline-flex overflow-hidden rounded-md border border-gray-300">
                              <button
                                onClick={() => setDiscountMode("pct")}
                                className={`px-2 py-0.5 text-[11px] font-medium ${discountMode === "pct" ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
                              >%</button>
                              <button
                                onClick={() => setDiscountMode("fixed")}
                                className={`px-2 py-0.5 text-[11px] font-medium ${discountMode === "fixed" ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
                              >$</button>
                            </div>
                          </div>
                          {discountMode === "pct" ? (
                            <input
                              type="number" min={0} max={100} value={discountPct || ""} placeholder="e.g. 10"
                              onChange={(e) => setDiscountPct(e.target.value === "" ? 0 : Math.min(100, Math.max(0, Number(e.target.value))))}
                              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                            />
                          ) : (
                            <input
                              type="number" min={0} value={discountFixedCents ? discountFixedCents / 100 : ""} placeholder="e.g. 500"
                              onChange={(e) => setDiscountFixedCents(e.target.value === "" ? 0 : Math.max(0, Math.round(Number(e.target.value) * 100)))}
                              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                            />
                          )}
                        </div>
                        {totals.discountCents > 0 && (
                          <div className="flex justify-between rounded-md bg-emerald-50 px-2 py-1.5 text-xs text-emerald-700">
                            <span>Discount{discountMode === "pct" ? ` (${discountPct}%)` : ""}</span>
                            <span className="font-semibold tabular-nums">−{fmt(totals.discountCents)}</span>
                          </div>
                        )}
                        {hourlyRateOverride != null && (
                          <button onClick={() => setHourlyRateOverride(null)} className="text-[11px] font-medium text-blue-600 hover:text-blue-800">↺ reset hourly rate to rate card</button>
                        )}
                      </div>
                    )}

                    {row.key === "followups" && (
                      <p className="text-xs text-gray-500">Automated follow-ups are coming soon — reminders sent to the customer while an estimate is awaiting a decision. This is where you&apos;ll set them up.</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </aside>
      </div>
      )}

      {shareUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShareUrl(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">Sent — customer link</h2>
            <p className="mt-1 text-xs text-gray-500">Text or email this to the customer. Any edits you save later show on the same link.</p>
            <div className="mt-4 flex items-center gap-2">
              <input readOnly value={shareUrl} className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm" onFocus={(e) => e.target.select()} />
              <button onClick={() => navigator.clipboard?.writeText(shareUrl)} className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700">Copy</button>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <a href={shareUrl} target="_blank" rel="noreferrer" className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">Open</a>
              <button onClick={() => setShareUrl(null)} className="rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-700">Done</button>
            </div>
          </div>
        </div>
      )}

      {areaPickerOpen && (
        <AreaPicker
          areaNames={areaNames}
          onPick={(preset) => {
            setBlocks((bs) => [...bs, newArea(preset)]);
          }}
          onClose={() => setAreaPickerOpen(false)}
        />
      )}

      {surfacePicker && (() => {
        const area = blocks.find((b) => b.id === surfacePicker.areaId && b.kind === "area") as Area | undefined;
        if (!area) return null;
        return (
          <SurfacePicker
            subGroups={subGroups[area.type]}
            onPick={(code) => {
              if (surfacePicker.sid == null) {
                // adding a new surface → open its editable folder straight away
                const sid = addSurfaceWithCode(surfacePicker.areaId, code);
                setView({ type: "surface", areaId: surfacePicker.areaId, sid });
              } else {
                selectSubstrate(surfacePicker.areaId, surfacePicker.sid, code);
              }
              setSurfacePicker(null);
            }}
            onClose={() => setSurfacePicker(null)}
          />
        );
      })()}

      {templateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setTemplateModal(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">Save as template</h2>
            <p className="mt-1 text-xs text-gray-500">Saves the areas, surfaces, line items and job settings so you can start a future estimate from this.</p>
            <input
              autoFocus
              className="mt-4 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="Template name (e.g. Standard 3-bed interior)"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && templateName.trim()) saveTemplate(templateName); }}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setTemplateModal(false)} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={() => saveTemplate(templateName)} disabled={!templateName.trim() || saving} className="rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
                {saving ? "Saving…" : "Save template"}
              </button>
            </div>
          </div>
        </div>
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
            onClick={() => add("New area", "Interior")}
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

// ---------------- Surface (substrate) folder picker ----------------
// Two levels of folders: pick a category (Walls, Ceilings, Doors…), then a
// substrate inside it. Built for fast on-site quoting instead of a long dropdown.
function SurfacePicker({
  subGroups, onPick, onClose,
}: {
  subGroups: Record<string, RateItem[]>;
  onPick: (code: string) => void;
  onClose: () => void;
}) {
  const [folder, setFolder] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const folders = useMemo(() => Object.keys(subGroups).sort(), [subGroups]);
  const q = query.trim().toLowerCase();
  const searchHits = q
    ? Object.entries(subGroups).flatMap(([sub, items]) =>
        items.filter((r) => r.code.toLowerCase().includes(q)).map((r) => ({ sub, r })))
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onClick={onClose}>
      <div className="mt-4 w-full max-w-2xl rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div className="flex items-center gap-2">
            {folder && (
              <button onClick={() => setFolder(null)} className="rounded-md px-2 py-1 text-sm font-medium text-gray-500 hover:text-gray-900">← Folders</button>
            )}
            <div>
              <h2 className="text-lg font-semibold">{folder ?? "Choose a surface"}</h2>
              <p className="text-xs text-gray-500">{folder ? "Pick the substrate to add." : "Open a folder, or search."}</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-2xl leading-none text-gray-400 hover:text-gray-700" aria-label="Close">×</button>
        </div>

        <div className="px-5 pt-4">
          <input
            autoFocus
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="Search all surfaces…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setFolder(null); }}
          />
        </div>

        <div className="max-h-[55vh] overflow-y-auto px-5 py-4">
          {q ? (
            searchHits.length ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {searchHits.map(({ sub, r }) => (
                  <button key={`${sub}:${r.code}`} onClick={() => onPick(r.code)}
                    className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-left text-sm hover:border-gray-900 hover:bg-gray-50">
                    <span><span className="font-medium">{r.code}</span> <span className="text-gray-400">· {sub}</span></span>
                    <span className="text-xs text-gray-400">{r.unit}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No surfaces match “{query}”.</p>
            )
          ) : folder ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {subGroups[folder].map((r) => (
                <button key={r.code} onClick={() => onPick(r.code)}
                  className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-left text-sm hover:border-gray-900 hover:bg-gray-50">
                  <span className="font-medium">{r.code}</span>
                  <span className="text-xs text-gray-400">{r.unit}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {folders.map((sub) => (
                <button key={sub} onClick={() => setFolder(sub)}
                  className="flex flex-col items-start gap-1 rounded-xl border border-gray-200 p-3 text-left hover:border-gray-900 hover:bg-gray-50">
                  <span className="text-2xl">📁</span>
                  <span className="text-sm font-medium leading-tight">{sub}</span>
                  <span className="text-[11px] text-gray-400">{subGroups[sub].length} surface{subGroups[sub].length === 1 ? "" : "s"}</span>
                </button>
              ))}
              {folders.length === 0 && <p className="text-sm text-gray-500">No surfaces available for this area type.</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------- Area folder screen ----------------
function AreaCard({
  area, calc, onDone, onPatch, onOpenSurface, onAddSurface, onRemoveSurface, onDuplicateSurface, onDuplicate, onRemove,
}: {
  area: Area;
  calc: (s: Surface) => SurfaceCalc;
  onDone: () => void;
  onPatch: (patch: Partial<Area>) => void;
  onOpenSurface: (sid: number) => void;
  onAddSurface: () => void;
  onRemoveSurface: (sid: number) => void;
  onDuplicateSurface: (sid: number) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  // per-area totals (matches PaintScout's Area Hours / Area Price + breakdown)
  const at = area.surfaces.reduce(
    (a, s) => {
      const c = calc(s);
      return { hrs: a.hrs + c.paintingHr + c.prepHr, prep: a.prep + c.prepHr, paint: a.paint + c.paintingHr, mat: a.mat + c.matPriceCents, labour: a.labour + c.labourCents, price: a.price + c.totalCents };
    },
    { hrs: 0, prep: 0, paint: 0, mat: 0, labour: 0, price: 0 },
  );
  const nc = "px-2 py-2 text-right tabular-nums";
  const money = (cents: number) => (cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      {/* back bar */}
      <div className="mb-3 flex items-center justify-between">
        <button onClick={onDone} className="flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900">← All areas</button>
        <div className="flex items-center gap-2">
          <button onClick={onDuplicate} className="px-1 text-lg text-gray-400 hover:text-gray-700" title="Duplicate area" aria-label="Duplicate area">⧉</button>
          <button onClick={onRemove} className="px-1 text-gray-400 hover:text-red-600" aria-label="Remove area">×</button>
          <button onClick={onDone} className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700">Done</button>
        </div>
      </div>

      {/* header: title + area price/hours + type + option */}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <input
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm font-medium"
            value={area.name}
            placeholder="Area name (e.g. Right Side upper)"
            onChange={(e) => onPatch({ name: e.target.value })}
          />
          <div className="mt-1 truncate text-xs text-gray-500">
            {area.surfaces.filter((s) => s.code).map((s) => s.clientLabel || s.code).join(", ") || "No surfaces yet"}
          </div>
        </div>
        <div className="rounded-lg bg-gray-50 px-3 py-1.5 text-right">
          <div className="text-[10px] uppercase tracking-wide text-gray-400">Area price</div>
          <div className="text-sm font-semibold tabular-nums">{fmt(at.price)}</div>
          <div className="text-[11px] tabular-nums text-gray-400">{at.hrs.toFixed(2)} hr</div>
        </div>
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
      </div>

      {/* dimensions */}
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

      {/* Estimate table */}
      <div className="mt-4">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-400">Estimate</div>
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="bg-blue-600 text-left text-xs font-semibold text-white">
                <th className="px-2 py-2">Description</th>
                <th className="px-2 py-2 text-right">Qty</th>
                <th className="px-2 py-2 text-right">Prep (hr)</th>
                <th className="px-2 py-2 text-right">Painting (hr)</th>
                <th className="px-2 py-2 text-right">Total (hr)</th>
                <th className="px-2 py-2 text-right">Materials ($)</th>
                <th className="px-2 py-2 text-right">Labor ($)</th>
                <th className="px-2 py-2 text-right">Total ($)</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {area.surfaces.map((s) => {
                const c = calc(s);
                return (
                  <tr key={s.id} onClick={() => onOpenSurface(s.id)} className="cursor-pointer border-t border-gray-200 hover:bg-blue-50/40" title="Open surface">
                    <td className="px-2 py-2">
                      <span className="flex items-center gap-1 text-left">
                        <span className="text-gray-400">📁</span>
                        <span>
                          <span className="font-medium">{s.clientLabel || s.code || "New surface"}</span>
                          {s.productName != null && (
                            <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-medium text-amber-700" title={`Custom product: ${s.productName}`}>custom</span>
                          )}
                          <span className="block text-[11px] text-gray-400">
                            {s.code
                              ? c.isItem
                                ? `${s.internalLabel || s.code}${s.count > 1 ? ` · ${s.count}` : ""}`
                                : `${c.qty.toFixed(0)} ${unitLabel(c.item)}`
                              : "choose a substrate"}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className={nc}>{c.isItem ? s.count : c.qty ? c.qty.toFixed(0) : ""}</td>
                    <td className={nc}>{c.prepHr ? c.prepHr.toFixed(2) : ""}</td>
                    <td className={nc}>{c.paintingHr ? c.paintingHr.toFixed(2) : ""}</td>
                    <td className={nc}>{s.code ? (c.prepHr + c.paintingHr).toFixed(2) : ""}</td>
                    <td className={nc}>{money(c.matPriceCents)}</td>
                    <td className={nc}>{money(c.labourCents)}</td>
                    <td className={`${nc} font-semibold`}>{money(c.totalCents)}</td>
                    <td className="whitespace-nowrap px-1 py-2 text-right">
                      {s.hidden && <span className="mr-1 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-medium text-amber-700">Hidden</span>}
                      <button onClick={(e) => { e.stopPropagation(); onDuplicateSurface(s.id); }} className="px-1 text-gray-400 hover:text-gray-700" title="Duplicate surface">⧉</button>
                      <button onClick={(e) => { e.stopPropagation(); onRemoveSurface(s.id); }} className="px-1 text-gray-400 hover:text-red-600" title="Remove surface">×</button>
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t border-dashed border-gray-300">
                <td colSpan={9} className="px-2 py-2 text-center">
                  <button onClick={onAddSurface} className="text-sm font-semibold text-blue-600 hover:text-blue-800">+ Add Surface</button>
                </td>
              </tr>
              <tr className="border-t-2 border-gray-300 font-semibold">
                <td className="px-2 py-2">TOTAL</td>
                <td className={nc} />
                <td className={nc}>{at.prep.toFixed(2)}</td>
                <td className={nc}>{at.paint.toFixed(2)}</td>
                <td className={nc}>{at.hrs.toFixed(2)}</td>
                <td className={nc}>{money(at.mat)}</td>
                <td className={nc}>{money(at.labour)}</td>
                <td className={nc}>{money(at.price)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Description — sits below the estimate, above the photos */}
      <div className="mt-4">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-400">
          Description <span className="normal-case text-gray-400">· shown to the customer</span>
        </div>
        <RichTextEditor
          value={area.description ?? ""}
          onChange={(html) => onPatch({ description: html })}
          placeholder="Describe this area for the customer… (substrate labels are added automatically as you pick them)"
        />
      </div>

      {/* Room photos */}
      <div className="mt-3 border-t border-gray-200 pt-3">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-400">Room photos</div>
        <MediaUploader items={area.media ?? []} onChange={(m) => onPatch({ media: m })} />
      </div>
    </section>
  );
}

// The customer-facing card for an area or line: title + description + price.
// This is exactly what the customer sees; staff get edit controls below it,
// which vanish in customer view (and when the estimate is sent).
function BlockSummary({
  title, descriptionHtml, priceCents, isOption, customerView, onOpen, onToggleOption, onDuplicate, onRemove,
}: {
  title: string;
  descriptionHtml: string;
  priceCents: number;
  isOption: boolean;
  customerView: boolean;
  onOpen: () => void;
  onToggleOption: (v: boolean) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const hasDesc = !!descriptionHtml && descriptionHtml.replace(/<[^>]*>/g, "").trim() !== "";
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{title}</span>
            {isOption && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-500">Optional</span>}
          </div>
          {hasDesc ? (
            <div className="rte mt-1 text-sm text-gray-600" dangerouslySetInnerHTML={{ __html: descriptionHtml }} />
          ) : (
            !customerView && <div className="mt-1 text-xs text-gray-400">No description yet — click Edit details to add surfaces.</div>
          )}
        </div>
        <div className="whitespace-nowrap text-right text-base font-semibold tabular-nums">{fmt(priceCents)}</div>
      </div>
      {!customerView && (
        <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-2">
          <button onClick={onOpen} className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700">Edit details →</button>
          <label className="flex items-center gap-1 text-xs text-gray-500" title="Show as an optional add-on, outside the total">
            <input type="checkbox" checked={isOption} onChange={(e) => onToggleOption(e.target.checked)} /> Optional
          </label>
          <div className="ml-auto flex items-center gap-1">
            <button onClick={onDuplicate} className="px-1 text-lg text-gray-400 hover:text-gray-700" title="Duplicate" aria-label="Duplicate">⧉</button>
            <button onClick={onRemove} className="px-1 text-gray-400 hover:text-red-600" title="Remove" aria-label="Remove">×</button>
          </div>
        </div>
      )}
    </section>
  );
}

function SurfaceEditor({
  surface: s, item, calc, products, materialDefault, chargeFor, areaType, areaName, onChangeSelection, onPatch, onDone, onRemove,
}: {
  surface: Surface;
  item?: RateItem;
  calc: SurfaceCalc;
  products: Product[];
  materialDefault: string | null;
  chargeFor: (t: string) => number;
  areaType: "Interior" | "Exterior";
  areaName: string;
  onChangeSelection: () => void;
  onPatch: (patch: Partial<Surface>) => void;
  onDone: () => void;
  onRemove: () => void;
}) {
  const isItem = calc.isItem;
  const inp = "w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm";
  const num = (v: number, on: (n: number | null) => void, ph?: string) => (
    <input type="number" className={inp} placeholder={ph}
      value={Number.isFinite(v) ? v : ""} onChange={(e) => on(e.target.value === "" ? null : Number(e.target.value))} />
  );
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      {/* back bar */}
      <div className="mb-3 flex items-center justify-between">
        <button onClick={onDone} className="flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900">← {areaName}</button>
        <div className="flex items-center gap-2">
          <button onClick={onRemove} className="px-1 text-gray-400 hover:text-red-600" title="Remove surface" aria-label="Remove surface">×</button>
          <button onClick={onDone} className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700">Done</button>
        </div>
      </div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Edit Surface — {s.clientLabel || s.code || "new"}</div>

      {/* substrate + labels */}
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        <F label="Surface">
          <button onClick={onChangeSelection} className="flex w-full items-center justify-between rounded-md border border-gray-300 px-2 py-1.5 text-left text-sm hover:border-gray-900">
            <span className={s.code ? "font-medium" : "text-gray-400"}>{s.code || "Choose a surface"}</span>
            <span className="text-xs text-blue-600">Change ›</span>
          </button>
        </F>
        <F label="Internal Label">
          <input className={inp} value={s.internalLabel} placeholder={s.code || "Internal"} onChange={(e) => onPatch({ internalLabel: e.target.value })} />
        </F>
        <F label="Client Label">
          <input className={inp} value={s.clientLabel} placeholder={s.code || "Shown to customer"} onChange={(e) => onPatch({ clientLabel: e.target.value })} />
        </F>
      </div>

      {!item ? (
        <p className="mt-3 text-xs text-gray-500">Choose a surface to set rates and materials.</p>
      ) : (
        <>
          {/* Measurements — per-surface size override (interior & exterior). */}
          {!isItem && (
            <div className="mt-3 border-t border-gray-200 pt-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Measurements</div>
              <p className="mt-0.5 text-[11px] text-gray-400">
                Set this surface&apos;s size directly — e.g. one wall that is half render, half weatherboard. Leave blank to use the area size.
              </p>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <F label="Length (m)">{num(s.measureL ?? NaN, (n) => onPatch({ measureL: n }), "auto")}</F>
                {item.unit !== "Lineal Metres" && (
                  <F label="Height / width (m)">{num(s.measureH ?? NaN, (n) => onPatch({ measureH: n }), "auto")}</F>
                )}
                <F label={`${item.unit === "Lineal Metres" ? "Length" : "Area"} (${unitLabel(item)})`}>
                  <div className="px-2 py-1.5 text-sm tabular-nums text-gray-600">{calc.qty.toFixed(2)} {unitLabel(item)}</div>
                </F>
              </div>
            </div>
          )}

          {/* Rate — pre-filled from the data set, all manually adjustable */}
          <div className="mt-3 border-t border-gray-200 pt-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Rate</div>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <F label="Quantity">
                <input type="number" className={inp} value={s.qtyOverride ?? Number(calc.qty.toFixed(isItem ? 0 : 1))}
                  onChange={(e) => onPatch({ qtyOverride: e.target.value === "" ? null : Number(e.target.value) })} />
              </F>
              <F label={isItem ? "Rate (hrs/item)" : "Rate (units/hr)"}>
                <input type="number" className={inp} value={s.rateOverride ?? Number(calc.rate.toFixed(3))}
                  onChange={(e) => onPatch({ rateOverride: e.target.value === "" ? null : Number(e.target.value) })} />
              </F>
              <F label="Coats">
                <select className={inp} value={s.coats} onChange={(e) => onPatch({ coats: Number(e.target.value) })}>
                  {[1, 2, 3, 4].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </F>
              <F label="Prep (hr)">{num(s.prepHr, (n) => onPatch({ prepHr: n ?? 0 }))}</F>
              <F label={`Painting (hr)${s.paintingHrOverride == null ? " · auto" : ""}`}>
                <input type="number" className={inp} value={s.paintingHrOverride ?? Number(calc.paintingHr.toFixed(2))}
                  onChange={(e) => onPatch({ paintingHrOverride: e.target.value === "" ? null : Number(e.target.value) })} />
              </F>
              <F label={`Calculated Price ($)${s.priceOverride == null ? " · auto" : ""}`}>
                <input type="number" className={inp} value={s.priceOverride ?? Number((calc.totalCents / 100).toFixed(2))}
                  onChange={(e) => onPatch({ priceOverride: e.target.value === "" ? null : Number(e.target.value) })} />
              </F>
            </div>
            {isItem && (
              <div className="mt-2 max-w-[8rem]">
                <F label="Count (items)">{num(s.count, (n) => onPatch({ count: n ?? 0 }))}</F>
              </div>
            )}
          </div>

          {/* Materials — estimated paint, editable */}
          <div className="mt-3 border-t border-gray-200 pt-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Product · Estimated paint</div>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <F label={`Product${s.productName != null ? " · custom" : ""}`}>
                <select className={inp} value={s.productName ?? ""} onChange={(e) => onPatch({ productName: e.target.value || null })}>
                  <option value="">— Default · {materialDefault || "none"} —</option>
                  {products.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
                </select>
                {s.productName != null && (
                  <button onClick={() => onPatch({ productName: null })} className="mt-1 text-[11px] font-medium text-blue-600 hover:text-blue-800">
                    ↺ reset to default
                  </button>
                )}
              </F>
              <F label="Color">
                <input className={inp} value={s.color} placeholder="Color" onChange={(e) => onPatch({ color: e.target.value })} />
              </F>
              <F label="Coverage (per L)">{num(s.coverageOverride ?? NaN, (n) => onPatch({ coverageOverride: n }), "auto")}</F>
              <F label="Volume (L)">
                <input type="number" className={inp} value={s.volumeOverride ?? Number(calc.volume.toFixed(2))}
                  onChange={(e) => onPatch({ volumeOverride: e.target.value === "" ? null : Number(e.target.value) })} />
              </F>
              <F label="Unit Price ($/L)">{num(s.unitPriceOverride ?? NaN, (n) => onPatch({ unitPriceOverride: n }), "auto")}</F>
              <F label="Total ($)"><div className="px-2 py-1.5 text-sm tabular-nums text-gray-600">{fmt(calc.matPriceCents)}</div></F>
            </div>
            <div className="mt-1 text-[11px] text-gray-400">Materials cost {fmt(calc.matCostCents)} · charged {fmt(calc.matPriceCents)}</div>
          </div>

          {/* Notes */}
          <div className="mt-3 border-t border-gray-200 pt-3">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-400">Crew note · work order only</div>
            <RichTextEditor value={s.crewNote ?? ""} onChange={(html) => onPatch({ crewNote: html })} placeholder="Notes for the crew…" />
          </div>

          {/* Advanced options */}
          <div className="mt-3 border-t border-gray-200 pt-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Advanced Options</div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <Check checked={s.hidden} onChange={(v) => onPatch({ hidden: v })} label="Hide From Customer" hint="Still priced; shows on the work order" />
              <Check checked={s.hideQty} onChange={(v) => onPatch({ hideQty: v })} label="Hide Quantity From Customer" />
              <Check checked={s.showCoats} onChange={(v) => onPatch({ showCoats: v })} label="Show Coats" />
              <Check checked={s.showPrice} onChange={(v) => onPatch({ showPrice: v })} label="Show Price" />
              <Check checked={s.useCustomRate} onChange={(v) => onPatch({ useCustomRate: v })} label="Use Custom Hourly Rate" />
              {s.useCustomRate && (
                <F label="Custom rate ($/hr)">
                  <input type="number" className={inp} value={s.customRate ?? Number((chargeFor(areaType) / 100).toFixed(2))}
                    onChange={(e) => onPatch({ customRate: e.target.value === "" ? null : Number(e.target.value) })} />
                </F>
              )}
            </div>
          </div>

          {/* Photos */}
          <div className="mt-3 border-t border-gray-200 pt-3">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-400">Photos</div>
            <MediaUploader items={s.media ?? []} onChange={(m) => onPatch({ media: m })} />
          </div>
        </>
      )}
    </section>
  );
}

function Check({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm text-gray-700">
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint && <span className="block text-[11px] text-gray-400">{hint}</span>}
      </span>
    </label>
  );
}

// ---------------- Line item folder screen ----------------
function LineCard({
  line: l, calc, lineItems, chargeFor, onDone, onPatch, onDuplicate, onRemove,
}: {
  line: LineBlock;
  calc: { priceCents: number; hours: number; costCents: number };
  lineItems: LineItemRef[];
  chargeFor: (t: string) => number;
  onDone: () => void;
  onPatch: (patch: Partial<LineBlock>) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const num = (v: number, on: (n: number) => void) => (
    <input type="number" className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" value={v || ""} onChange={(e) => on(Number(e.target.value) || 0)} />
  );
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      {/* back bar */}
      <div className="mb-3 flex items-center justify-between">
        <button onClick={onDone} className="flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900">← All areas</button>
        <div className="flex items-center gap-2">
          <button onClick={onDuplicate} className="px-1 text-lg text-gray-400 hover:text-gray-700" title="Duplicate line item" aria-label="Duplicate line item">⧉</button>
          <button onClick={onRemove} className="px-1 text-gray-400 hover:text-red-600" aria-label="Remove line item">×</button>
          <button onClick={onDone} className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700">Done</button>
        </div>
      </div>

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
