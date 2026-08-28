"use client";

import { money0 as fmt0, amount as money } from "@/lib/format/money";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  priceSurface,
  priceLine,
  priceEstimateTotals,
  chargeOutCents,
  jobModifier,
  productNameFor as pricingProductNameFor,
  itemIndex,
  productIndex,
  resolveRates,
  depositCents as pricingDepositCents,
  type PricingContext,
  type Adjustments,
  type AreaInput,
  type SurfaceInput,
  type LineInput,
  type BlockInput,
} from "@/lib/pricing/estimate";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { BackTo } from "@/lib/navigation/backTo";
import EstimateHeader from "./EstimateHeader";
import RichTextEditor from "@/app/components/RichTextEditor";
import CustomerEstimate from "@/app/e/[token]/CustomerEstimate";
import { DEFAULT_PROOF, type CustomerSnapshot, type SnapshotArea, type SnapshotLine, type SnapshotPaint } from "@/lib/customer/snapshot";
import { type InclusionTemplate } from "@/lib/estimate/inclusionTemplates";
import WorkOrderDoc, { type WOEdit } from "@/app/w/WorkOrderDoc";
import ColourPicker from "@/app/components/ColourPicker";
import { roundUpLitres, type WorkOrderDoc as WODoc, type WOMaterial, type WOArea } from "@/lib/workorder/snapshot";
import type { WoStage } from "@/lib/workorder/stages";
import { finishFromModifier } from "@/lib/workorder/finish";
import OfferPanel from "./OfferPanel";
import { linkEstimateAccountAction, replyToEstimateChatAction, sendEstimateAction, type DeliveryOutcome } from "./actions";
import SendDialog, { type SendDelivery } from "./SendDialog";
import { reviewGate, REVIEW_GATE_CENTS, type AiDeferred } from "@/lib/estimate/reviewGate";
import { DEFAULT_MESSAGING, MESSAGING_KEY, type MessagingSettings } from "@/lib/messaging/config";
import { depositPctFromSettings } from "@/lib/invoicing/settings";
import { issueWorkOrderAction, setWorkOrderScheduleAction } from "./workOrderActions";
import type { SurfaceState } from "@/lib/workorder/surfaces";
import type { WOPhoto } from "@/lib/workorder/photos";
import { acceptAttr, checkUpload } from "@/lib/uploads/validate";
import { reportIfError, errorMessage } from "@/lib/monitoring/report";
import RevisionPanel, { type ExistingRevisionVariation } from "./RevisionPanel";
import InvoiceSheet, { type SheetLine } from "@/app/i/[token]/InvoiceSheet";
import "@/app/i/[token]/invoice.css";
import { saveWorkingScopeAction } from "./revisionActions";
import { diffRevision, type RevisionState } from "@/lib/revision/diff";

type WorkOrderRow = {
  id: string; wo_ref: string; status: string; contractor_id: string | null; start_date: string | null;
  access_notes: string; crew_notes: string; share_token: string; contractor_payment_cents: number | null;
  area_finish?: Record<string, string> | null;
  colours: Record<string, { name?: string; status?: string }>; hours_overrides: Record<string, number>;
  wo_snapshot: unknown; issued_at: string | null;
  stage?: WoStage | null; stage_entered_at?: string | null; blocked_reason?: string | null;
  end_date?: string | null;
};
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
  /** A6: window rates only — small/medium/large rate multiplier. Absent or
   * "medium" prices unchanged; staff-only (the wizard always writes medium). */
  size?: "small" | "medium" | "large" | null;
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
  color: string; // per-surface colour NAME override (empty = follow the Materials colour)
  colorHex: string; // swatch hex for the override
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
  // A 3rd-party cost (carpentry, scaffolding): flagged so the books can be
  // reconciled — we must be invoiced by the subcontractor and paid by the
  // customer for it. NB: admin tracking of invoiced-vs-paid is still to build.
  subcontractorExpense: boolean;
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
// Unguessable base62 token for the customer link, minted once per estimate.
const genShareToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(28)), (n) => "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"[n % 62]).join("");
let nextId = 1;

// New estimates start with no inclusions — staff apply a "What's included"
// template (managed in Settings) or type their own bullets in the builder.
const DEFAULT_INCLUSIONS: string[] = [];
const SHEEN_LEVELS = ["Flat", "Matt", "Egg Shell", "Satin", "Low Sheen", "Semi Gloss", "Gloss", "High Gloss"];

// Friendly labels + relative times for the Activity feed.
function eventLabel(type: string): string {
  switch (type) {
    case "sent": return "Sent to customer";
    case "viewed": return "Viewed by customer";
    case "accepted": return "Accepted";
    case "declined": return "Declined";
    case "question": return "Customer message";
    case "email_sent": return "Emailed to customer";
    case "email_failed": return "Email failed";
    case "sms_sent": return "Texted to customer";
    case "sms_failed": return "Text failed";
    default: return type;
  }
}
// Exact date + time for view entries, in the reader's local time.
function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
}
// Dwell is heartbeat-based (15s ticks), so a short open records 0ms.
function fmtDwell(ms: number): string {
  if (ms < 15000) return "under 15 sec";
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m === 0 ? `${s} sec` : `${m} min${s % 60 ? ` ${s % 60} sec` : ""}`;
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
const unitLabel = (item?: RateItem) =>
  !item ? "" : item.unit === "Hours Per Item" ? "items" : item.unit === "Lineal Metres" ? "m" : "m²";

/** Colour match on a substrate (Tom, 23 Aug): flagged, with codes when known. */
type ColourMatch = { required: boolean; code: string; brand: string; canSize: string };

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
  workOrder = null,
  woTicks = {},
  woPhotos = [],
  bookingState = "none",
  contractors = [],
  initialView,
  backTo = null,
  presentations = [],
  typicalSizes = {},
  mode = "estimate",
  revisionBaseline = null,
  revisionVariations = [],
}: {
  rateCardId: string | null;
  rateCardVersion: number | null;
  rateItems: RateItem[];
  modifiers: Modifier[];
  products: Product[];
  settings: Setting[];
  lineItems: LineItemRef[];
  areaNames: AreaNameRef[];
  initial: { id: string | null; title: string | null; builder_state: unknown; share_token?: string | null; status?: string | null; sent_at?: string | null; valid_until?: string | null; presentation_id?: string | null; sent_snapshot?: unknown } | null;
  company: CompanyProfile;
  contacts: Contact[];
  inclusionTemplates?: InclusionTemplate[];
  exclusionTemplates?: InclusionTemplate[];
  terms?: string;
  workOrder?: WorkOrderRow | null;
  /** Live ticks from wo_surfaces, keyed by surface key — see WorkOrderDoc. */
  woTicks?: Record<string, SurfaceState>;
  /** Site photos, already signed server-side (the bucket is private). */
  woPhotos?: WOPhoto[];
  bookingState?: "none" | "requested" | "proposed" | "confirmed";
  contractors?: { id: string; name: string }[];
  initialView?: "builder" | "customer" | "workorder";
  /** Top-left link target, from ?from= — see lib/navigation/backTo.ts. */
  backTo?: BackTo | null;
  presentations?: { id: string; name: string; blocks: { kind: string; position: number; enabled: boolean; content: unknown }[] }[];
  typicalSizes?: Record<string, { L: number; W: number }>;
  /**
   * "revision" (addendum A2): the SAME builder, loaded with the job's working
   * scope instead of the estimate. Edits save to wo_working_scopes only — the
   * accepted estimate row is DB-frozen — and the diff against the accepted
   * baseline becomes engine-priced variations. Shared component + mode prop,
   * per CLAUDE.md; never a fork.
   */
  mode?: "estimate" | "revision";
  /** The accepted builder_state the revision diffs against. */
  revisionBaseline?: unknown;
  /** Revision-drafted variations already on the job (for the panel). */
  revisionVariations?: ExistingRevisionVariation[];
}) {
  const chargeFor = (t: string) => chargeOutCents(t, rateItems, hourlyRateOverride);

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

  const loaded = (initial?.builder_state ?? null) as { blocks?: Block[]; modSel?: Record<string, string>; contact?: Contact; jobAddress?: JobAddress; materials?: Record<string, string>; materialColours?: Record<string, { name: string; hex: string }>; depositPct?: number; inclusions?: string[]; exclusions?: string[]; discountPct?: number; discountMode?: "pct" | "fixed"; discountFixedCents?: number; hourlyRateOverride?: number | null; contractorRateOverride?: number | null; aiDeferred?: AiDeferred[]; idealPainters?: number | null; colourMatches?: Record<string, ColourMatch> } | null;
  // Deferred plan-reader decisions ride builder_state so the review gate can
  // price them; the builder itself only carries them through saves.
  const aiDeferred = useMemo(() => loaded?.aiDeferred ?? [], [loaded]);
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
  // Ideal crew size (Tom, 23 Aug) — the scheduler divides the estimated hours
  // by it to land the job with the right number of days.
  const [idealPainters, setIdealPainters] = useState<number | null>(() => loaded?.idealPainters ?? null);
  // Materials — the GLOBAL paint choice per surface type, keyed "${type}::${code}".
  // A surface with productName === null follows this global default (falling back
  // to the rate card's default_product); a surface with productName set is PINNED
  // (a deliberate per-area override) and a global change skips it. Because a new
  // surface starts null, areas added after a global change inherit the current
  // default automatically.
  const [materials, setMaterials] = useState<Record<string, string>>(() => loaded?.materials ?? {});
  // Global colour per surface type (same cascade model as the product): choose the
  // walls colour once and every un-pinned wall follows it; a per-surface colour wins.
  const [materialColours, setMaterialColours] = useState<Record<string, { name: string; hex: string }>>(() => loaded?.materialColours ?? {});
  // Colour match per substrate (Tom, 23 Aug): flagged here, codes given here
  // or left for the painter to supply on the job. Keyed like materialColours.
  const [colourMatches, setColourMatches] = useState<Record<string, ColourMatch>>(() => loaded?.colourMatches ?? {});
  const materialKey = (type: string, code: string) => `${type}::${code}`;
  const colourFor = (type: string, s: Surface): { name: string; hex: string } =>
    s.color ? { name: s.color, hex: s.colorHex || "" } : materialColours[materialKey(type, s.code)] ?? { name: "", hex: "" };
  // Effective product NAME for a surface: pin → global → rate-card default.
  // Delegates to lib/pricing so product resolution has one definition, not two.
  const productNameFor = (type: string, s: Surface): string | null =>
    pricingProductNameFor(type, s as unknown as SurfaceInput, materials, itemByKey);
  const [contact, setContact] = useState<Contact | null>(() => loaded?.contact ?? null);
  const [jobAddress, setJobAddress] = useState<JobAddress | null>(() => loaded?.jobAddress ?? null);
  // Deposit payable on acceptance, as a % of the GST-inclusive total. Defaults to 50%.
  // A saved estimate keeps its own deposit %; a NEW one reads the Settings
  // value (Tom's 24 Aug ruling: no percentage literals — one source of truth).
  const [depositPct, setDepositPct] = useState<number>(
    () => loaded?.depositPct ?? depositPctFromSettings(settings),
  );
  // Presentation tick — which presentation (if any) injects into the customer view.
  const [presentationId, setPresentationId] = useState<string | null>(initial?.presentation_id ?? null);
  const presentationDoc = () => {
    const p = presentations.find((x) => x.id === presentationId);
    if (!p) return null;
    const blocks = p.blocks.filter((b) => b.enabled).sort((a, z) => a.position - z.position).map((b) => ({ kind: b.kind, content: b.content }));
    return blocks.length ? { blocks } : null;
  };
  // What's included / not included — one bullet per line, shown to the customer.
  const [inclusions, setInclusions] = useState<string[]>(() => loaded?.inclusions ?? DEFAULT_INCLUSIONS);
  const [exclusions, setExclusions] = useState<string[]>(() => loaded?.exclusions ?? []);
  // Calculations panel — a global $/hr override (blank = use the rate card) and a
  // percentage discount applied to the ex-GST subtotal (shown on the estimate).
  const [hourlyRateOverride, setHourlyRateOverride] = useState<number | null>(() => loaded?.hourlyRateOverride ?? null);
  // What we pay the contractor per hour (margin only, never shown to the customer).
  // Blank falls back to the settings default.
  const [contractorRateOverride, setContractorRateOverride] = useState<number | null>(() => loaded?.contractorRateOverride ?? null);
  // In-session cache of sheen edits made from the Materials panel; each edit is
  // also persisted to the products table, so this just reflects it before reload.
  const [sheenEdits, setSheenEdits] = useState<Record<string, string>>({});
  const effectiveSheen = (productName: string): string => sheenEdits[productName] ?? productByName.get(productName)?.finish ?? "";
  async function updateSheen(productName: string, finish: string) {
    setSheenEdits((m) => ({ ...m, [productName]: finish }));
    // Not best-effort: the sheen shown on the customer's estimate comes from
    // this row, so a write that fails leaves the screen disagreeing with what
    // is actually stored. (The old try/catch caught nothing — supabase returns
    // { error } instead of throwing.)
    const r = await createClient().from("products").update({ finish }).eq("name", productName);
    if (!reportIfError(r, { where: "products.sheen", extra: { productName } })) {
      setSaveMsg(`Couldn't save that sheen — ${errorMessage(r.error)}`);
      setSheenEdits((m) => { const n = { ...m }; delete n[productName]; return n; });
    }
  }
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
  // Pre-send dialog + the per-channel outcome shown in the share modal after.
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [sendingNow, setSendingNow] = useState(false);
  const [deliveryOutcome, setDeliveryOutcome] = useState<DeliveryOutcome | null>(null);
  const revision = mode === "revision";
  // In revision mode "accepted" is exactly why we're here — the working scope
  // is editable while the estimate row itself stays DB-frozen.
  const locked = estStatus === "accepted" && !revision;
  // Email/SMS wording templates, managed in Settings → Messaging. The settings
  // prop is typed for numeric pricing rows, so widen it to read this jsonb row.
  const messaging: MessagingSettings = useMemo(
    () => ({
      ...DEFAULT_MESSAGING,
      ...(((settings as { key: string; value: unknown }[]).find((s) => s.key === MESSAGING_KEY)?.value as Partial<MessagingSettings>) ?? {}),
    }),
    [settings],
  );
  // Three views on the same record: Builder | Customer view | Work order.
  // Deep-linkable: the scheduling board sends staff straight to the work order
  // tab, which is the only place a job can be issued.
  /**
   * A saved estimate opens on the ESTIMATE view — the snapshot the customer is
   * looking at — and editing is a deliberate act via "Edit estimate". A brand
   * new estimate has nothing to show yet, so it opens in the builder.
   */
  // Always open on the builder itself — a saved estimate used to open in the
  // customer view, which meant an extra click before any editing. A
  // ?view=customer / ?view=workorder deep-link still wins.
  const [viewMode, setViewMode] = useState<"builder" | "customer" | "workorder">(
    initialView ?? "builder",
  );
  // Editing is off until asked for, so nobody changes a live quote by accident.
  // A revision exists to be edited, so it opens hot.
  const [editing, setEditing] = useState(!initial?.id || mode === "revision");

  /**
   * The published customer document. This — not a live rebuild of the current
   * form state — is what both the customer and staff look at, so the two can
   * never disagree. Saving republishes it, so it's held in state and refreshed
   * there rather than needing a page reload.
   */
  const [sentSnapshot, setSentSnapshot] = useState<CustomerSnapshot | null>(
    (initial?.sent_snapshot as CustomerSnapshot | null) ?? null,
  );
  const customerView = viewMode === "customer";
  const workOrderView = viewMode === "workorder";
  // Work order editable fields — persisted to the work_orders row once it exists
  // (created on acceptance); before that the Work order tab is a live preview.
  const [woContractorId, setWoContractorId] = useState<string | null>(workOrder?.contractor_id ?? null);
  const [woStartDate, setWoStartDate] = useState<string | null>(workOrder?.start_date ?? null);
  const [woAccessNotes, setWoAccessNotes] = useState<string>(workOrder?.access_notes ?? "");
  const [woCrewNotes, setWoCrewNotes] = useState<string>(workOrder?.crew_notes ?? "");
  const [woColours, setWoColours] = useState<Record<string, { name: string; hex: string; status: "tbc" | "confirmed" }>>(() => {
    const c = (workOrder?.colours ?? {}) as Record<string, { name?: string; hex?: string; status?: string }>;
    const out: Record<string, { name: string; hex: string; status: "tbc" | "confirmed" }> = {};
    for (const k of Object.keys(c)) out[k] = { name: c[k]?.name ?? "", hex: c[k]?.hex ?? "", status: c[k]?.status === "confirmed" ? "confirmed" : "tbc" };
    return out;
  });
  const [woHours, setWoHours] = useState<Record<string, number>>(() => workOrder?.hours_overrides ?? {});
  // Per-area finish exceptions: { areaId: "PG-4" }. Anything absent inherits the
  // job's level, so the common case stays empty.
  const [woAreaFinish, setWoAreaFinish] = useState<Record<string, string>>(() => (workOrder?.area_finish ?? {}) as Record<string, string>);
  const [woIssuing, setWoIssuing] = useState(false);
  const [woLink, setWoLink] = useState<string | null>(null);
  // Persist a work-order field change (only when the row exists, i.e. accepted).
  const patchWorkOrder = async (patch: Record<string, unknown>) => {
    if (!workOrder) return;
    // contractor_id and start_date are server-owned since R2 — they move through
    // a validated action. Everything else here is hand-edited content (colours,
    // crew notes, hours overrides) and still writes directly under RLS.
    const { contractor_id, start_date, ...rest } = patch as {
      contractor_id?: string | null; start_date?: string | null;
    } & Record<string, unknown>;

    if (contractor_id !== undefined || start_date !== undefined) {
      const r = await setWorkOrderScheduleAction({
        workOrderId: workOrder.id,
        contractorId: contractor_id ?? null,
        startDate: start_date ?? null,
      });
      if (!r.ok) setSaveMsg(r.message);
    }
    if (Object.keys(rest).length > 0) {
      // Colours, crew notes and hours overrides. These are what the contractor
      // works to, so a dropped write is a real problem — and R2's column
      // lockdown means a permission error here is exactly how it would show up.
      const r = await createClient().from("work_orders").update(rest).eq("id", workOrder.id);
      if (!reportIfError(r, { where: "workorder.patch", extra: { fields: Object.keys(rest) } })) {
        setSaveMsg(`Couldn't save the work order — ${errorMessage(r.error)}`);
      }
    }
  };
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
  const [statusMenu, setStatusMenu] = useState(false);
  const [declineModal, setDeclineModal] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [statusBusy, setStatusBusy] = useState(false);
  const [materialsOpen, setMaterialsOpen] = useState(true);
  // Right-column tools bar: Activity / Chat / Calculations / Follow-ups.
  const [rightTab, setRightTab] = useState<null | "activity" | "chat" | "calc" | "followups">(null);
  const [events, setEvents] = useState<{ type: string; payload: unknown; created_at: string }[]>([]);
  const [views, setViews] = useState<{ created_at: string; updated_at: string; dwell_ms: number }[]>([]);
  const [questions, setQuestions] = useState<{ message: string; created_at: string }[]>([]);
  const [messages, setMessages] = useState<{ id: string; direction: "staff" | "customer"; body: string; author_name: string | null; created_at: string }[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatMsg, setChatMsg] = useState("");
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
      rateOverride: null, paintingHrOverride: null, prepHr: 0, priceOverride: null, productName: null, color: "", colorHex: "",
      coverageOverride: null, volumeOverride: null, unitPriceOverride: null, crewNote: "",
      hideQty: false, showCoats: false, showPrice: false, useCustomRate: false, customRate: null,
      open: false,
    };
  }
  function newLine(): LineBlock {
    return { id: nextId++, kind: "line", name: "", type: "Interior", mode: "hourly", hours: 0, rate: 85, qty: 1, unitPrice: 0, custom: 0, cost: 0, woHours: 0, description: "", clientNote: "", crewNote: "", hidden: false, isOption: false, subcontractorExpense: false, media: [], open: true, detailsOpen: false };
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
  /**
   * The coat count a substrate arrives with, off the rate card's own
   * default_coats column (21 Aug: unpainted brick is sealer + two topcoats,
   * so it must land on 3 without anyone remembering). The column has existed
   * since rate card v7 and was read by nothing; two is still the fallback.
   */
  const defaultCoatsFor = (type: string, code: string): number => {
    const cat = type === "Exterior" ? "Exterior" : "Interior";
    const n = itemByKey.get(`${cat}::${code}`)?.default_coats;
    return typeof n === "number" && n >= 1 && n <= 6 ? n : 2;
  };
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
            ? {
                ...s, code,
                internalLabel: s.internalLabel || code, clientLabel: s.clientLabel || code,
                // Only on the first pick — re-picking must not silently undo
                // an estimator's own coat count.
                coats: firstPick ? defaultCoatsFor(b.type, code) : s.coats,
              }
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
        surf.coats = defaultCoatsFor(b.type, code);
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

  const finishChosen = !!modSel["Level of Finish"];

  // ---- pricing ----
  // All arithmetic lives in lib/pricing. This component only assembles the
  // inputs and renders what comes back — it must never compute a cent itself,
  // because the server has to be able to reproduce the same numbers.
  const pricingCtx: PricingContext = useMemo(
    () => ({ rateItems, products, modifiers, settings }),
    [rateItems, products, modifiers, settings],
  );
  const adjustments: Adjustments = useMemo(
    () => ({ modSel, materials, discountPct, discountMode, discountFixedCents, hourlyRateOverride, contractorRateOverride }),
    [modSel, materials, discountPct, discountMode, discountFixedCents, hourlyRateOverride, contractorRateOverride],
  );
  const rates = useMemo(() => resolveRates(pricingCtx, adjustments), [pricingCtx, adjustments]);
  // What is still assumed on this estimate, priced and ordered - the $150 gate.
  const review = useMemo(
    () => reviewGate(blocks as unknown as Parameters<typeof reviewGate>[0], pricingCtx, adjustments, typicalSizes, aiDeferred),
    [blocks, pricingCtx, adjustments, typicalSizes, aiDeferred],
  );
  const gstRate = rates.gstRate;
  const contractorHourlyCents = rates.contractorHourlyCents;

  const itemsIdx = useMemo(() => itemIndex(rateItems), [rateItems]);
  const productsIdx = useMemo(() => productIndex(products), [products]);
  const jobMod = useMemo(() => jobModifier(modifiers, modSel), [modifiers, modSel]);

  /** Thin adapter: the module's result plus the rate item the UI labels with. */
  const surfaceCalc = (area: Area, s: Surface): SurfaceCalc => {
    const r = priceSurface(
      area as unknown as AreaInput,
      s as unknown as SurfaceInput,
      pricingCtx,
      adjustments,
      rates,
      itemsIdx,
      productsIdx,
      jobMod,
    );
    return { ...r, item: itemsIdx.get(`${area.type}::${s.code}`) };
  };
  const lineCalc = (l: LineBlock) => priceLine(l as unknown as LineInput);

  const totals = useMemo(() => {
    const t = priceEstimateTotals(blocks as unknown as BlockInput[], pricingCtx, adjustments);
    // Same field names the component has always used, so nothing below changes.
    return {
      subtotal: t.subtotalCents,
      sundries: t.sundriesCents,
      discountCents: t.discountCents,
      netSubtotal: t.netSubtotalCents,
      gst: t.gstCents,
      total: t.totalCents,
      contractorHours: t.contractorHours,
      contractorOffer: t.contractorOfferCents,
      materialsCost: t.materialsCostCents,
      margin: t.marginCents,
    };
  }, [blocks, pricingCtx, adjustments]);

  // Revision preview: the live diff of what's on screen vs the accepted
  // baseline, priced by the same engine. Display only — the server action
  // recomputes from the SAVED scope before any variation is written.
  const revisionDiff = useMemo(() => {
    if (!revision || !revisionBaseline) return null;
    const currentState = {
      blocks, modSel, materials, discountPct, discountMode, discountFixedCents,
      hourlyRateOverride, contractorRateOverride,
    } as RevisionState;
    return diffRevision(revisionBaseline as RevisionState, currentState, pricingCtx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, revisionBaseline, blocks, modSel, materials, discountPct, discountMode, discountFixedCents, hourlyRateOverride, contractorRateOverride, pricingCtx]);

  const marginPct = totals.subtotal > 0 ? (totals.margin / totals.subtotal) * 100 : 0;
  const salesRateCents = totals.contractorHours > 0 ? Math.round(totals.subtotal / totals.contractorHours) : 0;

  async function save(): Promise<{ id: string | null; token: string | null }> {
    if (locked) { setSaveMsg("This estimate is accepted and locked."); return { id: quoteId, token: shareToken }; }

    // Revision mode: the whole save goes to the WORKING SCOPE. The estimate
    // row is DB-frozen (estimates_frozen trigger) and stays byte-identical.
    if (revision) {
      if (!quoteId) { setSaveMsg("No estimate id."); return { id: null, token: shareToken }; }
      setSaving(true);
      setSaveMsg("");
      try {
        const result = await saveWorkingScopeAction({
          estimateId: quoteId,
          state: { ...(loaded ?? {}), blocks, modSel, contact, jobAddress, materials, materialColours, colourMatches, depositPct, inclusions, exclusions, discountPct, discountMode, discountFixedCents, hourlyRateOverride, contractorRateOverride, aiDeferred, idealPainters },
        });
        setSaveMsg(result.ok ? "Saved ✓ (working scope)" : result.message);
      } finally {
        setSaving(false);
      }
      return { id: quoteId, token: shareToken };
    }

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
      // woDoc: the contractor-safe work-order document, recomputed on every save.
      // accept_estimate copies it straight onto the new work order, so an accepted
      // job is bookable on the scheduling board immediately instead of waiting for
      // someone to remember to press Issue.
      // R4 (diagnostic §2a): SPREAD what was loaded before writing the builder's
      // keys — the old fixed key list silently dropped builder_state.wizard
      // (the answers + proving snapshot), prepPack, sidesLoop and interiorLoop
      // on every staff save. Keys the builder owns still overwrite.
      builder_state: { ...(loaded ?? {}), blocks, modSel, contact, jobAddress, materials, materialColours, colourMatches, depositPct, inclusions, exclusions, discountPct, discountMode, discountFixedCents, hourlyRateOverride, contractorRateOverride, aiDeferred, idealPainters, woDoc: computeWorkOrderDoc() },
      share_token: token,
      presentation_id: presentationId,
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
      // Republished — keep the on-screen estimate in step without a reload.
      setSentSnapshot(base.sent_snapshot);
      setSaveMsg("Saved ✓");
      // 3a: a contact email joins the estimate to its customer account —
      // fire-and-forget; a save never waits on (or fails with) the link.
      if (id && contact?.email) {
        void linkEstimateAccountAction({ estimateId: id }).catch(() => undefined);
      }
      return { id, token };
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Save failed");
      return { id: quoteId, token: shareToken };
    } finally {
      setSaving(false);
    }
  }

  function openSendDialog() {
    if (!finishChosen) { setSaveMsg("Choose a level of finish before sending."); return; }
    setSendDialogOpen(true);
  }

  async function sendToCustomer(delivery: SendDelivery) {
    setSendingNow(true);
    try {
      const { id, token } = await save(); // persists token + live doc
      if (!id || !token) return;
      const nowIso = new Date().toISOString();
      const until = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
      // Guarded transition through the server: an accepted quote is locked, and a
      // stale tab can't re-send something that has moved on. Email/SMS delivery
      // rides along and comes back as a per-channel outcome.
      const r = await sendEstimateAction({ estimateId: id, expectedStatus: estStatus, validUntil: until, ...delivery });
      if (!r.ok) { setSaveMsg(r.message); return; }
      setEstStatus("sent");
      setSentAt(sentAt ?? nowIso);
      setValidUntil(until);
      setSendDialogOpen(false);
      setDeliveryOutcome(r.delivery ?? null);
      setShareUrl(`${window.location.origin}/e/${token}`);
    } finally {
      setSendingNow(false);
    }
  }

  // Load the activity feed + customer messages for the Activity / Chat tabs.
  async function loadActivity() {
    if (!quoteId) return;
    setActivityLoading(true);
    const supabase = createClient();
    const [{ data: ev }, { data: q }, { data: vw }, { data: msgs }] = await Promise.all([
      supabase.from("estimate_events").select("type, payload, created_at").eq("estimate_id", quoteId).order("created_at", { ascending: false }).limit(50),
      supabase.from("estimate_questions").select("message, created_at").eq("estimate_id", quoteId).order("created_at", { ascending: false }).limit(50),
      // One row per open session — created_at is when they opened it, dwell_ms
      // how long the page stayed in front of them (15s heartbeats).
      supabase.from("estimate_views").select("created_at, updated_at, dwell_ms").eq("estimate_id", quoteId).order("created_at", { ascending: false }).limit(50),
      supabase.from("estimate_messages").select("id, direction, body, author_name, created_at").eq("estimate_id", quoteId).order("created_at").limit(200),
    ]);
    setEvents((ev as typeof events) ?? []);
    setQuestions((q as typeof questions) ?? []);
    setViews((vw as typeof views) ?? []);
    setMessages((msgs as typeof messages) ?? []);
    setActivityLoading(false);
  }
  const openRightTab = (tab: typeof rightTab) => {
    const next = rightTab === tab ? null : tab;
    setRightTab(next);
    if (next === "activity" || next === "chat") loadActivity();
  };

  // Poll the chat while it's open, so a customer reply appears without a manual
  // refresh (the customer page polls the same way).
  useEffect(() => {
    if (rightTab !== "chat" || !quoteId) return;
    const t = setInterval(loadActivity, 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rightTab, quoteId]);

  async function sendChatReply() {
    const body = chatDraft.trim();
    if (!body || !quoteId) return;
    setChatSending(true);
    setChatMsg("");
    try {
      const res = await replyToEstimateChatAction({ estimateId: quoteId, body });
      if (!res.ok) { setChatMsg(res.message ?? "Couldn't send."); return; }
      setChatDraft("");
      // Note delivery — a customer with no phone/email, or missing keys, is not
      // a failure of the message itself.
      const d = res.delivery;
      const bits: string[] = [];
      if (d?.email) bits.push(d.email.status === "sent" ? "emailed" : d.email.status === "not_configured" ? "email off" : "email failed");
      if (d?.sms) bits.push(d.sms.status === "sent" ? "texted" : d.sms.status === "not_configured" ? "SMS off" : "SMS failed");
      setChatMsg(bits.length ? `Sent · ${bits.join(" · ")}` : "Sent");
      await loadActivity();
    } finally {
      setChatSending(false);
    }
  }

  // Save the current build as a reusable template (stored in settings, not as an
  // estimate) so a new estimate can be started from it later.
  // Manual status change (feature #6). Goes through the server-owned RPC —
  // staff never write the status column directly. A move to 'declined'
  // carries the reason. The estimate must be saved first (needs an id).
  async function changeStatus(next: string, reason?: string) {
    if (!quoteId) { setSaveMsg("Save the estimate first."); return; }
    setStatusBusy(true);
    setSaveMsg("");
    try {
      const { data, error } = await createClient().rpc("set_estimate_status", {
        p_estimate_id: quoteId, p_status: next, p_reason: reason ?? null,
      });
      if (error) throw error;
      const res = String(data ?? "");
      if (res.startsWith("ok:")) {
        setEstStatus(next);
        setSaveMsg(`Marked ${next} ✓`);
      } else if (res === "conflict:accepted") {
        setSaveMsg("This estimate is accepted and signed — its status is locked.");
      } else {
        setSaveMsg(`Couldn't change status (${res}).`);
      }
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Status change failed");
    } finally {
      setStatusBusy(false);
      setStatusMenu(false);
      setDeclineModal(false);
      setDeclineReason("");
    }
  }

  async function saveTemplate(name: string) {
    setSaving(true);
    setSaveMsg("");
    const supabase = createClient();
    try {
      const { data } = await supabase.from("settings").select("value").eq("key", "estimate_templates").maybeSingle();
      const list = Array.isArray(data?.value) ? (data!.value as unknown[]) : [];
      const tpl = { id: crypto.randomUUID(), name: name.trim(), createdAt: new Date().toISOString(), builder_state: { blocks, modSel, contact, jobAddress, materials, materialColours, depositPct, inclusions, exclusions, discountPct, discountMode, discountFixedCents, hourlyRateOverride, contractorRateOverride } };
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
    if (/deck/i.test(cat)) return "Decking";
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
    const colourByProduct = new Map<string, { name: string; hex: string }>(); // first resolved colour per product
    // Tom (25 Aug): every colour on the job is LISTED on its paint card, with
    // its areas — and a colour-matched substrate says so to the customer.
    // product → "name|hex|match" → { colour, match, areas }
    const coloursByProduct = new Map<string, Map<string, { name: string; hex: string; match: boolean; areas: Set<string> }>>();
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
        const col = colourFor(b.type, s);
        if (col.name && !colourByProduct.get(pname)?.name) colourByProduct.set(pname, col);
        const match = Boolean(colourMatches[materialKey(b.type, s.code)]?.required);
        if (col.name || match) {
          if (!coloursByProduct.has(pname)) coloursByProduct.set(pname, new Map());
          const groups = coloursByProduct.get(pname)!;
          const gkey = `${col.name}|${col.hex}|${match ? 1 : 0}`;
          if (!groups.has(gkey)) groups.set(gkey, { name: col.name, hex: col.hex, match, areas: new Set() });
          groups.get(gkey)!.areas.add(areaTitle);
        }
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
        finish: effectiveSheen(pname),
        colourName: colourByProduct.get(pname)?.name ?? "",
        colourHex: colourByProduct.get(pname)?.hex ?? "",
        blurb: visible ? (p?.blurb ?? "") : "",
        properties: visible ? (p?.properties ?? []) : [],
        guarantee: visible ? (p?.guarantee ?? "") : "",
        photoUrl: p?.photo_url ?? p?.image_url ?? "",
        customerVisible: visible,
        isPrep: /prep|primer/i.test(category),
        usage: usage.slice(0, 3),
        colours: [...(coloursByProduct.get(pname)?.values() ?? [])].map((g) => ({
          name: g.name, hex: g.hex, match: g.match, areas: [...g.areas].slice(0, 6),
        })),
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
        estimatorPhone: company.estimatorPhone, logoUrl: company.logoUrl, logoUrlLight: company.logoUrlLight,
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
      presentation: presentationDoc(),
      terms,
      discountMode,
      discountPct: discountPct || 0,
      discountFixedCents: discountFixedCents || 0,
      proof: DEFAULT_PROOF,
    };
  }

  // Build the work-order (job sheet) document live from the current estimate.
  // Contractor-safe: no customer pricing/margin, no surname/email.
  function computeWorkOrderDoc(): WODoc {
    const matMap = new Map<string, { vol: number; photo: string }>();
    const colourByProduct = new Map<string, { name: string; hex: string }>();
    // A product's colour match: the first substrate (material key) that uses
    // the product and is flagged wins — one product, one match on the sheet.
    const matchByProduct = new Map<string, ColourMatch>();
    const areasDoc: WOArea[] = [];
    // The job's contractor-facing standard, derived from the priced level of
    // finish. Null when the estimate's level has no PG equivalent.
    const jobFinishCode = finishFromModifier(modSel["Level of Finish"]);
    for (const b of blocks) {
      if (b.kind !== "area" || b.isOption) continue;
      const surfaces: WOArea["surfaces"] = [];
      for (const s of b.surfaces) {
        if (!s.code || s.hidden) continue;
        const pname = productNameFor(b.type, s) || "";
        const calc = surfaceCalc(b, s);
        if (pname) {
          const cur = matMap.get(pname) ?? { vol: 0, photo: productByName.get(pname)?.photo_url ?? productByName.get(pname)?.image_url ?? "" };
          cur.vol += calc.volume;
          matMap.set(pname, cur);
          const col = colourFor(b.type, s);
          if (col.name && !colourByProduct.get(pname)?.name) colourByProduct.set(pname, col);
          const cm = colourMatches[materialKey(b.type, s.code)];
          if (cm?.required && !matchByProduct.has(pname)) matchByProduct.set(pname, cm);
        }
        const key = `${b.id}:${s.id}`;
        surfaces.push({
          key, label: s.clientLabel || s.code, coats: s.coats, product: pname,
          prep: s.crewNote || "",
          hours: woHours[key] ?? Number((calc.paintingHr + calc.prepHr).toFixed(2)),
          status: "not_started",
        });
      }
      const photos = [
        ...(b.media ?? []).map((m) => m.url),
        ...b.surfaces.filter((s) => !s.hidden).flatMap((s) => (s.media ?? []).map((m) => m.url)),
      ];
      const areaOverride = woAreaFinish[String(b.id)] || null;
      areasDoc.push({
        id: String(b.id),
        title: b.name || "Area",
        surfaces,
        photos,
        finishCode: areaOverride ?? jobFinishCode,
        finishOverridden: Boolean(areaOverride && areaOverride !== jobFinishCode),
      });
    }
    const materials: WOMaterial[] = [...matMap.entries()].map(([product, { vol, photo }]) => {
      const missing = !(vol > 0); // no coverage data → never fabricate a litre figure
      const col = colourByProduct.get(product) ?? { name: "", hex: "" }; // colour comes from the estimate
      const status = woColours[product]?.status ?? "tbc"; // confirmed/TBC stays on the work order
      const cm = matchByProduct.get(product) ?? null;
      return {
        product, photoUrl: photo, litres: missing ? null : roundUpLitres(vol), coverageMissing: missing,
        colourName: col.name, colourHex: col.hex, colourStatus: status,
        colourMatch: cm ? { required: true, code: cm.code ?? "", brand: cm.brand ?? "", canSize: cm.canSize ?? "" } : null,
      };
    });
    return {
      version: 1,
      woRef: workOrder?.wo_ref ?? `WO-${(shareToken ?? "PREVIEW0").slice(0, 8).toUpperCase()}`,
      status: workOrder?.status ?? "draft",
      jobTitle: title || "Painting works",
      jobAddress: jobAddress ? [jobAddress.address, jobAddress.city, jobAddress.state, jobAddress.postal].filter(Boolean).join(", ") : "",
      contactFirstName: contact?.first_name ?? "",
      contactPhone: contact?.phone ?? "",
      startDate: woStartDate,
      accessNotes: woAccessNotes,
      crewNotes: woCrewNotes,
      levelOfFinish: (modifiers.find((m) => m.code === modSel["Level of Finish"])?.label ?? "").replace(/\s*\(×[^)]*\)\s*$/, "").trim(),
      finishCode: jobFinishCode,
      contractorName: contractors.find((c) => c.id === woContractorId)?.name ?? "",
      contractorPaymentCents: totals.contractorOffer,
      materials, areas: areasDoc,
      exclusions: exclusions.map((t) => t.trim()).filter(Boolean),
      inclusions: inclusions.map((t) => t.trim()).filter(Boolean),
      company: { name: company.name, phone: company.phone, logoUrl: company.logoUrl },
      idealPainters,
    };
  }

  const woEdit: WOEdit = {
    contractors,
    contractorId: woContractorId,
    onContractor: (id) => { setWoContractorId(id); patchWorkOrder({ contractor_id: id }); },
    onStart: (d) => { setWoStartDate(d); patchWorkOrder({ start_date: d }); },
    onAccess: (n) => { setWoAccessNotes(n); patchWorkOrder({ access_notes: n }); },
    onCrewNotes: (n) => { setWoCrewNotes(n); patchWorkOrder({ crew_notes: n }); },
    onColour: (product, patch) => {
      setWoColours((m) => {
        const cur = m[product] ?? { name: "", hex: "", status: "tbc" as const };
        const next = { ...m, [product]: { name: patch.name ?? cur.name, hex: patch.hex ?? cur.hex, status: patch.status ?? cur.status } };
        patchWorkOrder({ colours: next });
        return next;
      });
    },
    onHours: (key, hours) => {
      setWoHours((m) => {
        const next = { ...m };
        if (hours == null) delete next[key]; else next[key] = hours;
        patchWorkOrder({ hours_overrides: next });
        return next;
      });
    },
    onAreaFinish: (areaId, code) => {
      setWoAreaFinish((m) => {
        const next = { ...m };
        // Null means "back to the job's level" — store nothing rather than a
        // duplicate of the default, so changing the job level still cascades.
        if (!code) delete next[areaId]; else next[areaId] = code;
        patchWorkOrder({ area_finish: next });
        return next;
      });
    },
  };

  /**
   * Self-heal for work orders created before the builder started saving its
   * document (or accepted from an estimate last saved before that change).
   *
   * Writes straight to work_orders, so the accepted-estimate lock doesn't apply
   * — the lock protects the CUSTOMER's quote, and this is the crew's document.
   * Runs once, silently: nobody should have to know this step exists.
   */
  const healedRef = useRef(false);
  useEffect(() => {
    if (healedRef.current) return;
    if (!workOrder || workOrder.wo_snapshot) return;
    healedRef.current = true;
    // Same server path as the Issue button — no document or money from here.
    void issueWorkOrderAction({ workOrderId: workOrder.id });
  }, [workOrder]);

  async function issueWorkOrder() {
    if (!workOrder) return;
    setWoIssuing(true);
    // The server builds the snapshot and the payment from the estimate's saved
    // document — this button sends neither.
    const r = await issueWorkOrderAction({ workOrderId: workOrder.id });
    setWoIssuing(false);
    if (r.ok) setWoLink(`${window.location.origin}/w/${workOrder.share_token}`);
    else setSaveMsg(r.message);
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
          {/* Where you came from, not always the estimates list — you may have
              arrived here from a job to set its colours. */}
          <Link
            href={backTo?.href ?? "/estimates"}
            className="text-sm font-medium text-gray-400 hover:text-white"
            data-testid="builder-back"
          >
            ← {backTo?.label ?? "Estimates"}
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title || "New estimate"}</h1>
          <p className="text-sm text-gray-400">
            Rate card v{rateCardVersion ?? "?"} · live pricing
            {quoteId ? " · saved draft" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View switcher — Builder | Customer view | Work order (mono labels) */}
          <div className="inline-flex overflow-hidden rounded-md border border-line2" style={{ fontFamily: "var(--font-mono, monospace)" }}>
            {([
              { key: "builder", label: "BUILDER" },
              // In revision mode the customer tab IS the invoice preview —
              // what the final invoice will read once changes are signed.
              { key: "customer", label: revision ? "INVOICE" : "ESTIMATE" },
              { key: "workorder", label: "WORK ORDER" },
            ] as const).map((t) => (
              <button
                key={t.key}
                onClick={() => { if (t.key === "builder") setEditing(true); setViewMode(t.key); setView(null); }}
                className={`px-3 py-2 text-[11px] font-medium tracking-wider ${viewMode === t.key ? "bg-accent text-accentink" : "text-gray-300 hover:bg-white/5"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {/* The property's money: add, request or delete payment requests
              (Tom, 25 Aug — every way into a job offers its Payments tab). */}
          {initial?.id && (
            <a
              href={`/invoicing/job/${initial.id}`}
              className="rounded-md border border-line2 px-3 py-2 text-[11px] font-medium tracking-wider text-gray-300 hover:bg-white/5"
              style={{ fontFamily: "var(--font-mono, monospace)" }}
              title="Payments, invoices and costs for this job"
              data-testid="payments-tab"
            >
              PAYMENTS
            </a>
          )}
          {/* On-site room-loop capture - a different way IN to this same estimate. */}
          {initial?.id && !locked && !revision && (
            <a
              href={`/quote/capture?id=${initial.id}`}
              className="rounded-md border border-line2 px-3 py-2 text-[11px] font-medium tracking-wider text-gray-300 hover:bg-white/5"
              style={{ fontFamily: "var(--font-mono, monospace)" }}
              title="On-site room-loop capture"
            >
              CAPTURE
            </a>
          )}
          {locked && (
            <>
              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">Accepted · locked</span>
              {/* The accepted estimate is the signed truth; changes happen in
                  the revision builder over the working scope (addendum A2). */}
              {quoteId && (
                <a
                  href={`/quote?id=${quoteId}&mode=revision`}
                  className="rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-black hover:bg-amber-400"
                  data-testid="open-revision"
                  title="Edit the working scope — the diff becomes signed variations"
                >
                  Revise scope
                </a>
              )}
            </>
          )}
          {revision && (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700" data-testid="revision-badge">
              Revision · working scope
            </span>
          )}
          {!locked && !revision && quoteId && (
            <div className="relative">
              <button
                onClick={() => setStatusMenu((v) => !v)}
                disabled={statusBusy}
                className={`rounded-full px-3 py-1 text-xs font-medium capitalize disabled:opacity-50 ${
                  estStatus === "sent" ? "bg-sky-100 text-sky-700"
                  : estStatus === "declined" ? "bg-rose-100 text-rose-700"
                  : estStatus === "expired" ? "bg-amber-100 text-amber-700"
                  : "bg-gray-200 text-gray-700"
                }`}
                title="Click to change the status"
              >
                {statusBusy ? "…" : estStatus} ▾
              </button>
              {statusMenu && (
                <div className="absolute left-0 top-8 z-50 w-40 rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-lg">
                  {(["draft", "sent", "declined", "expired"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => (s === "declined" ? (setStatusMenu(false), setDeclineModal(true)) : changeStatus(s))}
                      className={`block w-full px-3 py-1.5 text-left capitalize text-gray-700 hover:bg-gray-50 ${s === estStatus ? "font-semibold" : ""}`}
                    >
                      {s}{s === estStatus ? " ·" : ""}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {viewMode === "builder" && !locked && (
            <>
              {!revision && (
                <input
                  className="w-40 rounded-md border border-line2 bg-graphite px-3 py-2 text-sm text-white placeholder-gray-500"
                  placeholder="Quote name"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              )}
              <button
                onClick={save}
                disabled={saving}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accentink hover:bg-paint disabled:opacity-50"
                data-testid="builder-save"
              >
                {saving ? "Saving…" : revision ? "Save working scope" : quoteId ? "Save" : "Save draft"}
              </button>
              {!revision && (
                <>
                  <button
                    onClick={openSendDialog}
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
          <div className={`mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2 text-xs ${revision ? "bg-amber-50 text-amber-800" : "bg-blue-50 text-blue-700"}`}>
            <span>
              <span className="font-semibold">
                {revision ? "The final invoice, previewed" : sentSnapshot ? "The customer's copy" : "Not published yet"}
              </span>
              <span>
                {revision
                  ? " · the working scope as the customer's invoice will read once every change is signed. Their live page keeps the accepted figures until then."
                  : sentSnapshot
                    ? " · exactly what they see at their link. Editing republishes it."
                    : " · a preview. Sending publishes this to the customer."}
              </span>
            </span>
            {!locked && !revision && (
              <button
                onClick={() => { setEditing(true); setViewMode("builder"); }}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
              >
                Edit estimate
              </button>
            )}
            {revision && (
              <button
                onClick={() => setViewMode("builder")}
                className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-medium text-black hover:bg-amber-400"
                data-testid="back-to-revision"
              >
                Back to the builder
              </button>
            )}
          </div>
          {revision ? (() => {
            /* THE INVOICE, previewed (Tom, 25 Aug): the same white A4 sheet as
               /i/[token] — whose Chromium print IS the PDF — fed LIVE from the
               working scope. Same component, so preview, page and paper agree. */
            const snap = buildCustomerDoc(shareToken ?? "PREVIEW00");
            const plain = (h: string) => h.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
            const asLine = (title2: string, html: string, cents: number): SheetLine => ({
              description: plain(html) ? `${title2} — ${plain(html)}` : title2,
              amount_ex_cents: cents, source: "estimate_snapshot", qty: null, approved_on: null,
            });
            const sheetLines: SheetLine[] = [
              ...snap.areas.map((a) => asLine(a.title, a.descriptionHtml, a.priceCents)),
              ...snap.lineItems.map((l) => asLine(l.title, l.descriptionHtml, l.priceCents)),
            ];
            const linesSum = sheetLines.reduce((n, l) => n + l.amount_ex_cents, 0);
            const sundriesResidual = snap.baseSubtotalCents - linesSum;
            if (sundriesResidual > 0) {
              sheetLines.push({ description: "Sundries & consumables", amount_ex_cents: sundriesResidual, source: "estimate_snapshot", qty: null, approved_on: null });
            }
            if (totals.discountCents > 0) {
              sheetLines.push({ description: "Discount", amount_ex_cents: -totals.discountCents, source: "adjustment", qty: null, approved_on: null });
            }
            const signedCount = revisionVariations.filter(
              (v) => v.status === "customer_approved" || v.status === "contractor_accepted").length;
            const unsigned = revisionDiff?.changes.length ?? 0;
            return (
              <div className="invoice-view" data-testid="invoice-preview">
                <div className="sheet-wrap">
                  <InvoiceSheet
                    doc={{
                      number: null, kind: "final", status: "draft",
                      issued_on: null, due_on: null,
                      subtotal_ex_cents: totals.netSubtotal,
                      gst_cents: totals.gst,
                      total_inc_cents: totals.total,
                      billed_to: snap.contactName,
                      job_address: snap.jobAddress,
                      job_title: snap.jobTitle,
                      lines: sheetLines, payments: [], paid_cents: 0,
                      adjusted_contract_cents: null,
                      previously_invoiced_cents: null, previous_numbers: null,
                    }}
                    entity={{
                      tradingName: company.name,
                      address: [company.addressLine1, company.addressLine2].filter(Boolean).join(", "),
                      abn: company.abn,
                    }}
                    bank={{ accountName: company.bankName, bank: company.bank, bsb: company.bsb, acc: company.acc }}
                    extraNote={
                      <div className="status-note" data-testid="live-preview-note">
                        Live from the working scope — every edit updates these figures.
                        {signedCount > 0 ? ` ${signedCount} signed change${signedCount === 1 ? "" : "s"} built in.` : ""}
                        {unsigned > 0 ? ` ${unsigned} change${unsigned === 1 ? "" : "s"} shown here still need${unsigned === 1 ? "s" : ""} the customer's signature before reaching their invoice.` : ""}
                      </div>
                    }
                  />
                </div>
              </div>
            );
          })() : (
          <div className="cv overflow-hidden rounded-xl border border-gray-200">
            {/* Published snapshot when there is one — this is literally the
                customer's copy. Only an unsent estimate falls back to a live
                build, because there is nothing published yet. */}
            <CustomerEstimate
              snapshot={(sentSnapshot as ReturnType<typeof buildCustomerDoc> | null) ?? buildCustomerDoc(shareToken ?? "PREVIEW00")}
              validUntil={validUntil}
              sentAt={sentAt}
              preview
            />
          </div>
          )}
        </div>
      )}

      {workOrderView && (
        /* ---- work order: live job sheet, editable; issued to a contractor link ---- */
        <div className="mt-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-700">
            <span><span className="font-semibold">Work order</span> · {workOrder ? "created on acceptance — edits save automatically" : "live preview — a work order is created when the estimate is accepted"}</span>
            {workOrder && (
              <button onClick={issueWorkOrder} disabled={woIssuing} className="rounded-md bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                {woIssuing ? "Issuing…" : workOrder.issued_at ? "Re-issue + copy link" : "Issue to contractor"}
              </button>
            )}
          </div>
          {woLink && (
            <div className="mb-3 flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              <span className="font-semibold">Contractor link:</span>
              <a href={woLink} target="_blank" rel="noreferrer" className="truncate underline">{woLink}</a>
              <button onClick={() => navigator.clipboard?.writeText(woLink)} className="rounded border border-emerald-300 px-2 py-0.5">Copy</button>
            </div>
          )}
          <OfferPanel
            workOrderId={workOrder?.id ?? null}
            contractorId={woContractorId}
            contractorName={contractors.find((c) => c.id === woContractorId)?.name ?? ""}
            defaultStart={woStartDate}
            issued={Boolean(workOrder?.issued_at)}
          />
          <div className="mt-4 overflow-hidden rounded-xl border border-gray-200">
            <WorkOrderDoc
              doc={computeWorkOrderDoc()}
              edit={woEdit}
              ticks={woTicks}
              photos={woPhotos}
              stage={workOrder?.stage ?? null}
              booking={workOrder ? {
                state: bookingState, startDate: workOrder.start_date, endDate: workOrder.end_date ?? null,
              } : null}
            />
          </div>
        </div>
      )}

      {/* Editing something the customer is already looking at is worth saying out
          loud — saving republishes their copy underneath them. */}
      {editing && sentSnapshot && !customerView && !workOrderView && !locked && !revision && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span>
            <span className="font-semibold">Editing a published estimate</span>
            <span> · the customer can already see this quote. Saving republishes it to their link.</span>
          </span>
          <button
            onClick={() => setViewMode("customer")}
            className="rounded-md border border-amber-300 bg-white px-2.5 py-1 font-medium hover:bg-amber-100"
          >
            Back to the estimate
          </button>
        </div>
      )}

      {/* The estimate header (company / estimator / banking / contact) only shows
          in build mode, and not when drilled into a folder. */}
      {!folderEl && !customerView && !workOrderView && (
        <div className="mt-6">
          <EstimateHeader
            docTitle={revision ? "Invoice" : "Estimate"}
            company={company}
            contacts={contacts}
            contact={contact}
            jobAddress={jobAddress}
            onContact={setContact}
            onJobAddress={(a) => {
              setJobAddress(a);
              // Auto-name the quote from the first line of the address, unless
              // the estimator has already typed a name of their own.
              const firstLine = a?.address?.trim() ?? "";
              if (firstLine && title.trim() === "") setTitle(firstLine);
            }}
            estimateId={quoteId ? quoteId.slice(0, 8) : "New"}
            dateStr={new Date().toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
          />
        </div>
      )}

      {viewMode === "builder" && revision && revisionDiff && quoteId && (
        <div className="mt-4">
          <RevisionPanel
            estimateId={quoteId}
            diff={revisionDiff}
            existing={revisionVariations}
            saveFirst={save}
            onViewInvoice={() => setViewMode("customer")}
          />
        </div>
      )}

      {viewMode === "builder" && (
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
                  <label className="mt-3 block text-xs sm:max-w-xs">
                    <span className="text-gray-500">Ideal number of painters <span className="text-gray-400">· the scheduler sizes the booking from this</span></span>
                    <input
                      type="number" min={1} max={20} step={1} inputMode="numeric"
                      className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                      value={idealPainters ?? ""}
                      placeholder="e.g. 2"
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10);
                        setIdealPainters(Number.isFinite(n) && n > 0 ? Math.min(20, n) : null);
                      }}
                      data-testid="ideal-painters"
                    />
                    {idealPainters && totals.contractorHours > 0 && (
                      <span className="mt-1 block text-[11px] text-gray-500">
                        ≈ {Math.max(1, Math.ceil(totals.contractorHours / (8 * idealPainters)))} day{Math.max(1, Math.ceil(totals.contractorHours / (8 * idealPainters))) === 1 ? "" : "s"} on site at {totals.contractorHours.toFixed(1)} h
                      </span>
                    )}
                  </label>
                  {presentations.length > 0 && (
                    <label className="mt-3 block text-xs">
                      <span className="text-gray-500">Presentation <span className="text-gray-400">· injects capability/proof blocks into the customer view</span></span>
                      <select
                        className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm sm:max-w-xs"
                        value={presentationId ?? ""}
                        onChange={(e) => setPresentationId(e.target.value || null)}
                      >
                        <option value="">— none —</option>
                        {presentations.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </label>
                  )}
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
                            {globalName && (
                              <select
                                className="w-32 shrink-0 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                                value={effectiveSheen(globalName)}
                                onChange={(e) => updateSheen(globalName, e.target.value)}
                                title="Finish / sheen"
                              >
                                <option value="">— sheen —</option>
                                {effectiveSheen(globalName) && !SHEEN_LEVELS.includes(effectiveSheen(globalName)) && <option value={effectiveSheen(globalName)}>{effectiveSheen(globalName)}</option>}
                                {SHEEN_LEVELS.map((s) => <option key={s} value={s}>{s}</option>)}
                              </select>
                            )}
                            {globalName && (
                              <ColourPicker
                                value={materialColours[r.key]?.name ? materialColours[r.key] : null}
                                onChange={(c) => setMaterialColours((m) => ({ ...m, [r.key]: c }))}
                                compact
                              />
                            )}
                            {globalName && (
                              <label className="flex items-center gap-1.5 text-[11px] text-gray-600" title="This colour needs a colour match — codes here, or the painter supplies them on the job">
                                <input type="checkbox" checked={Boolean(colourMatches[r.key]?.required)}
                                  data-testid={`colour-match-${r.key}`}
                                  onChange={(e) => setColourMatches((m) => ({
                                    ...m, [r.key]: { required: e.target.checked, code: m[r.key]?.code ?? "", brand: m[r.key]?.brand ?? "", canSize: m[r.key]?.canSize ?? "" },
                                  }))} />
                                Colour match
                              </label>
                            )}
                            {globalName && colourMatches[r.key]?.required && (
                              <div className="flex w-full flex-wrap items-center gap-2 pl-40 text-xs" data-testid={`colour-match-fields-${r.key}`}>
                                <input className="w-32 rounded-md border border-gray-300 px-2 py-1 text-xs" placeholder="Colour code"
                                  value={colourMatches[r.key]?.code ?? ""}
                                  onChange={(e) => setColourMatches((m) => ({ ...m, [r.key]: { ...(m[r.key] ?? { required: true, code: "", brand: "", canSize: "" }), code: e.target.value } }))} />
                                <input className="w-32 rounded-md border border-gray-300 px-2 py-1 text-xs" placeholder="Paint brand"
                                  value={colourMatches[r.key]?.brand ?? ""}
                                  onChange={(e) => setColourMatches((m) => ({ ...m, [r.key]: { ...(m[r.key] ?? { required: true, code: "", brand: "", canSize: "" }), brand: e.target.value } }))} />
                                <input className="w-24 rounded-md border border-gray-300 px-2 py-1 text-xs" placeholder="Can size"
                                  value={colourMatches[r.key]?.canSize ?? ""}
                                  onChange={(e) => setColourMatches((m) => ({ ...m, [r.key]: { ...(m[r.key] ?? { required: true, code: "", brand: "", canSize: "" }), canSize: e.target.value } }))} />
                                <span className="text-[11px] text-gray-500">
                                  {colourMatches[r.key]?.code ? "Code on the job sheet." : "Leave the code blank and the painter supplies it — the job can't go to sign-off until it's in."}
                                </span>
                              </div>
                            )}
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
                <span className="font-semibold tabular-nums">{fmt(pricingDepositCents(totals.total, depositPct))}</span>
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
                      : events.length === 0 && views.length === 0 ? <p className="text-xs text-gray-500">No activity yet.</p>
                      : (
                        <ul className="space-y-2">
                          {[
                            // The bare "viewed" flag is superseded by the per-session
                            // entries below, which carry the open time + duration.
                            ...events.filter((e) => !(e.type === "viewed" && views.length > 0)).map((e) => ({
                              at: e.created_at,
                              label: eventLabel(e.type),
                              detail: null as string | null,
                            })),
                            ...views.map((v) => ({
                              at: v.created_at,
                              label: "Opened by customer",
                              detail: `${fmtDateTime(v.created_at)} · viewed for ${fmtDwell(v.dwell_ms)}`,
                            })),
                          ]
                            .sort((a, b) => b.at.localeCompare(a.at))
                            .map((e, i) => (
                              <li key={i} className="flex items-start justify-between gap-2">
                                <span className="text-gray-700">
                                  {e.label}
                                  {e.detail && <span className="block text-[11px] text-gray-400">{e.detail}</span>}
                                </span>
                                <span className="shrink-0 text-[11px] tabular-nums text-gray-400">{relTime(e.at)}</span>
                              </li>
                            ))}
                        </ul>
                      )
                    )}

                    {row.key === "chat" && (
                      <div>
                        {!quoteId ? <p className="text-xs text-gray-500">Save and send the estimate to message the customer.</p> : (() => {
                          // The two-way thread plus any legacy one-way questions,
                          // in one timeline.
                          const thread = [
                            ...messages.map((m) => ({ side: m.direction, body: m.body, at: m.created_at, who: m.direction === "staff" ? (m.author_name || "You") : "Customer" })),
                            ...questions.map((q) => ({ side: "customer" as const, body: q.message, at: q.created_at, who: "Customer" })),
                          ].sort((a, b) => a.at.localeCompare(b.at));
                          return (
                            <>
                              {thread.length === 0
                                ? <p className="text-xs text-gray-500">No messages yet. Say hello — the customer gets a text and an email that link straight back here.</p>
                                : (
                                  <div className="max-h-72 space-y-2 overflow-y-auto pr-0.5">
                                    {thread.map((m, i) => {
                                      const mine = m.side === "staff";
                                      return (
                                        <div key={i} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                                          <div className={`max-w-[85%] rounded-2xl px-3 py-1.5 ${mine ? "rounded-br-sm bg-emerald-600 text-white" : "rounded-bl-sm bg-gray-100 text-gray-800"}`}>
                                            <div className="whitespace-pre-wrap break-words text-[13px] leading-snug">{m.body}</div>
                                            <div className={`mt-0.5 text-[10px] ${mine ? "text-emerald-100" : "text-gray-400"}`}>{m.who} · {relTime(m.at)}</div>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              <div className="mt-2 flex items-end gap-1.5">
                                <textarea
                                  rows={2}
                                  value={chatDraft}
                                  onChange={(e) => setChatDraft(e.target.value)}
                                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendChatReply(); } }}
                                  placeholder="Message the customer…"
                                  className="flex-1 resize-none rounded-md border border-gray-300 px-2 py-1.5 text-[13px]"
                                />
                                <button
                                  onClick={sendChatReply}
                                  disabled={chatSending || chatDraft.trim() === ""}
                                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                                >
                                  {chatSending ? "…" : "Send"}
                                </button>
                              </div>
                              <p className="mt-1 text-[11px] text-gray-400">
                                {chatMsg || "They'll get a text + email linking back to this chat. ⌘/Ctrl+Enter to send."}
                              </p>
                            </>
                          );
                        })()}
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

      {sendDialogOpen && (
        <SendDialog
          contact={contact}
          company={company}
          messaging={messaging}
          estimateTitle={title}
          totalCents={totals.total}
          isResend={estStatus !== "draft"}
          sending={sendingNow || saving}
          reviewItems={review.items}
          reviewTotalCents={review.totalImpactCents}
          reviewGateCents={REVIEW_GATE_CENTS}
          onSend={sendToCustomer}
          onClose={() => setSendDialogOpen(false)}
        />
      )}

      {shareUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShareUrl(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">Sent — customer link</h2>
            <p className="mt-1 text-xs text-gray-500">Text or email this to the customer. Any edits you save later show on the same link.</p>
            {deliveryOutcome && (
              <div className="mt-3 space-y-1">
                {(["email", "sms"] as const).map((ch) => {
                  const o = deliveryOutcome[ch];
                  if (!o) return null;
                  const label = ch === "email" ? "Email" : "Text message";
                  return (
                    <p key={ch} className={`text-sm ${o.status === "sent" ? "text-emerald-700" : "text-amber-700"}`}>
                      {o.status === "sent" && `✓ ${label} sent`}
                      {o.status === "not_configured" && `${label} not sent — ${ch === "email" ? "email" : "SMS"} isn't set up yet (needs the ${ch === "email" ? "Resend" : "Twilio"} keys).`}
                      {o.status === "error" && `${label} failed — ${o.message ?? "unknown error"}`}
                    </p>
                  );
                })}
              </div>
            )}
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

      {declineModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDeclineModal(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">Mark this estimate declined</h2>
            <p className="mt-1 text-sm text-gray-500">Why did they decide not to go ahead? This helps us learn what to change.</p>
            <textarea
              className="mt-3 w-full rounded-md border border-gray-300 p-2 text-sm"
              rows={3}
              placeholder="e.g. Went with a cheaper quote · timing didn't suit · scope changed"
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setDeclineModal(false)} className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:border-gray-500">Cancel</button>
              <button
                onClick={() => changeStatus("declined", declineReason.trim() || undefined)}
                disabled={statusBusy}
                className="rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {statusBusy ? "Saving…" : "Mark declined"}
              </button>
            </div>
          </div>
        </div>
      )}

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
  // No dollar sign here — the column carries it. `amount` is that variant.
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
                      {/* A6: compact S/M/L on window rows — a rate multiplier. */}
                      {/window/i.test(c.item?.sub_category ?? "") && (
                        <span className="mr-1 inline-flex overflow-hidden rounded border border-gray-300 align-middle">
                          {(["small", "medium", "large"] as const).map((sz) => (
                            <button
                              key={sz}
                              onClick={(e) => {
                                e.stopPropagation();
                                onPatch({ surfaces: area.surfaces.map((x) => (x.id === s.id ? { ...x, size: sz === "medium" ? null : sz } : x)) });
                              }}
                              className={`px-1.5 py-0.5 text-[10px] font-semibold ${
                                (s.size ?? "medium") === sz ? "bg-gray-900 text-white" : "text-gray-500 hover:bg-gray-100"
                              }`}
                              title={sz === "small" ? "Small window · ×0.8" : sz === "large" ? "Large window · ×1.2" : "Medium window · standard rate"}
                            >
                              {sz[0].toUpperCase()}
                            </button>
                          ))}
                        </span>
                      )}
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
              <div className="mt-2 flex items-end gap-4">
                <div className="max-w-[8rem]">
                  <F label="Count (items)">{num(s.count, (n) => onPatch({ count: n ?? 0 }))}</F>
                </div>
                {/* A6: window size — a multiplier on the window rate. */}
                {/window/i.test(item.sub_category ?? "") && (
                  <F label="Window size">
                    <div className="flex gap-1">
                      {(["small", "medium", "large"] as const).map((sz) => (
                        <button
                          key={sz}
                          type="button"
                          onClick={() => onPatch({ size: sz === "medium" ? null : sz })}
                          className={`rounded-md border px-2.5 py-1.5 text-xs font-medium ${
                            (s.size ?? "medium") === sz
                              ? "border-gray-900 bg-gray-900 text-white"
                              : "border-gray-300 text-gray-600 hover:border-gray-500"
                          }`}
                          title={sz === "small" ? "×0.8 on the window rate" : sz === "large" ? "×1.2 on the window rate" : "standard rate"}
                        >
                          {sz[0].toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </F>
                )}
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
              <F label={`Colour${s.color ? " · override" : ""}`}>
                <ColourPicker value={s.color ? { name: s.color, hex: s.colorHex || "" } : null} onChange={(c) => onPatch({ color: c.name, colorHex: c.hex })} />
                {s.color && (
                  <button onClick={() => onPatch({ color: "", colorHex: "" })} className="mt-1 text-[11px] font-medium text-blue-600 hover:text-blue-800">↺ follow Materials colour</button>
                )}
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
          <label className="flex items-center gap-1.5 text-gray-600" title="Carpentry, scaffolding etc. supplied by a 3rd party — tracked so we're invoiced and paid to balance the books.">
            <input type="checkbox" checked={l.subcontractorExpense} onChange={(e) => onPatch({ subcontractorExpense: e.target.checked })} /> Subcontractor expense
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
    // Check the whole selection first: uploading half a batch and then failing
    // leaves the user guessing which photos made it.
    for (const f of Array.from(files)) {
      const bad = checkUpload(f, "image");
      if (bad) { setErr(`${f.name}: ${bad}`); return; }
    }
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
          <input type="file" accept={acceptAttr("image")} multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
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
