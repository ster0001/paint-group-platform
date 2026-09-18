// The customer-safe estimate document, frozen into estimates.sent_snapshot at
// send time. This is the ONLY estimate data the public token route ever sees —
// it deliberately contains no margin, costs, contractor rates, hidden items or
// internal notes. Prices are in integer cents, ex-GST unless noted.

export type SnapshotSurface = {
  label: string; // client label
  coats: number;
  product: string;
  /** How many we counted (doors, windows, posts — anything priced per item).
   *  Absent for measured surfaces (walls, ceilings) and on snapshots sent
   *  before 18 Sep 2026. Tom, 18 Sep: the customer sees the count per room. */
  count?: number;
};

export type SnapshotArea = {
  id: string;
  title: string;
  descriptionHtml: string;
  priceCents: number; // ex-GST
  surfaces: SnapshotSurface[];
  photos: string[]; // public URLs
};

export type SnapshotLine = {
  id: string;
  title: string;
  descriptionHtml: string;
  priceCents: number; // ex-GST
};

// A paint product actually used in this estimate, for "The paint we're supplying".
// No cost/margin/alias — customer-safe only.
export type SnapshotPaint = {
  name: string; // display name (brand stripped where it prefixes)
  brand: string; // e.g. "Haymes"
  category: string; // e.g. "Interior walls" (drives grouping / role)
  role: string; // short role shown next to the name, e.g. "Walls"
  finish: string; // sheen, e.g. "Matt" ("" when unset)
  colourName: string; // chosen colour name ("" when TBC)
  colourHex: string; // swatch hex ("" when none)
  blurb: string; // one-liner (omitted for not-yet-verified products)
  properties: string[]; // chips strip
  guarantee: string; // amber phrase; "" when none
  photoUrl: string; // "" -> tin placeholder
  customerVisible: boolean; // false -> name + usage chips only
  isPrep: boolean; // Prep & primers -> grouped under a subheading
  usage: string[]; // usage chips e.g. ["Walls · 4 areas"]
  /** Every colour this product carries on the job, with its areas; match =
   *  we're colour-matching (to a supplied code or the existing colour).
   *  Optional — snapshots sent before 25 Aug 2026 don't carry it. */
  colours?: { name: string; hex: string; match: boolean; areas: string[] }[];
};

/** The Preparation line — customer wording (Tom, 15 Sep 2026). */
export const PREPARATION_TITLE = "Preparation";
// Tom, 17 Sep 2026: "time/ materials" — the line now carries the contractor's set-up hours too.
export const PREPARATION_DESCRIPTION = "Allowance for time/ materials for job site set up, fillers and consumables.";
export const PREPARATION_ID = "preparation";

export type CustomerSnapshot = {
  version: 1;
  company: {
    name: string;
    addressLine1: string;
    addressLine2: string;
    phone: string;
    abn: string;
    email: string;
    estimatorName: string;
    estimatorTitle: string;
    estimatorPhone: string;
    logoUrl: string;
    /** Light-background logo for the printable/PDF doc; falls back to logoUrl. */
    logoUrlLight?: string;
  };
  estRef: string; // short EST reference
  contactName: string;
  contactEmail: string; // the customer's own email (used only for the portal magic-link match)
  jobAddress: string;
  jobTitle: string;
  gstRatePct: number; // e.g. 10
  depositPct: number; // deposit % payable on acceptance (builder value, seeded from the invoicing Settings default)
  baseSubtotalCents: number; // preparation + included items, ex-GST (excludes options)
  /**
   * The Preparation line (site set-up, fillers, consumables) — sits ABOVE the
   * areas and line items. Absent on snapshots sent before 15 Sep 2026; those
   * carried the same amount silently inside baseSubtotalCents, so
   * `preparationLineFor` derives it from the residual.
   */
  preparation?: SnapshotLine | null;
  areas: SnapshotArea[];
  lineItems: SnapshotLine[];
  options: SnapshotLine[]; // optional add-ons the customer can toggle
  paints: SnapshotPaint[]; // distinct products used in the job (topcoats + prep)
  inclusions: string[];
  exclusions: string[];
  // Presentation blocks (view-only, injected between hero and scope). Snapshotted
  // at send time so later presentation edits never change a sent document.
  presentation?: { blocks: { kind: string; content: unknown }[] } | null;
  terms: string; // terms & conditions (plain text), shown below the accept panel
  discountMode: "pct" | "fixed"; // percentage of subtotal, or a flat dollar amount
  discountPct: number; // discount % applied to the ex-GST subtotal (when mode = pct)
  discountFixedCents: number; // flat discount in cents (when mode = fixed)
  /**
   * Tom, 18 Sep 2026: this job's Safe Work Method Statement, attached on the
   * estimate (Job settings → SWMS). A public-read PDF in the presentation-docs
   * bucket; the customer downloads it beside the public liability card.
   * Absent/null = none attached.
   */
  swms?: { url: string; label: string } | null;
  proof: {
    rating: string; // "5.0"
    reviews: string; // "93+"
    liability: string; // "$20M"
    warranty: string; // "2-year"
    accreditations: string[];
  };
};

/**
 * The Preparation line to show for a snapshot: the stored one, or — for a
 * snapshot sent before the line existed — whatever part of baseSubtotalCents
 * the visible areas and line items don't account for. null when there's nothing
 * to show, so the parts always add to the subtotal.
 */
export function preparationLineFor(snap: Pick<CustomerSnapshot, "baseSubtotalCents" | "areas" | "lineItems"> & { preparation?: SnapshotLine | null }): SnapshotLine | null {
  if (snap.preparation !== undefined) return snap.preparation && snap.preparation.priceCents > 0 ? snap.preparation : null;
  const shown = (snap.areas ?? []).reduce((n, a) => n + (a.priceCents || 0), 0) + (snap.lineItems ?? []).reduce((n, l) => n + (l.priceCents || 0), 0);
  const residual = (snap.baseSubtotalCents || 0) - shown;
  if (residual <= 0) return null;
  return { id: PREPARATION_ID, title: PREPARATION_TITLE, descriptionHtml: `<p>${PREPARATION_DESCRIPTION}</p>`, priceCents: residual };
}

export const DEFAULT_PROOF: CustomerSnapshot["proof"] = {
  rating: "5.0",
  reviews: "93+",
  liability: "$20M",
  warranty: "2-year",
  accreditations: ["Master Painters Accredited"],
};

/**
 * Tom, 18 Sep 2026: "if all colours are entered, remove 'Colour consultation
 * included' from the bar at the top of the estimate". Colours live on the
 * snapshot's paints: a topcoat carries `colourName` (first colour) and
 * `colours[]` (every colour it is used in; `match` = colour-matching an
 * existing colour, which is a decision too). Prep and primers never carry a
 * colour. True when there is at least one topcoat and every one has its
 * colour(s) decided — one TBC still gets the reassurance.
 */
export function allColoursChosen(snap: Pick<CustomerSnapshot, "paints">): boolean {
  const topcoats = (snap.paints ?? []).filter((p) => !p.isPrep);
  if (topcoats.length === 0) return false;
  return topcoats.every((p) => {
    if (p.colours && p.colours.length > 0) return p.colours.every((c) => Boolean((c.name ?? "").trim()) || c.match);
    return Boolean((p.colourName ?? "").trim());
  });
}

/** The company's own bank details, as the printed estimate and every invoice show them. */
export type BankDetails = { accountName?: string; bank?: string; bsb?: string; acc?: string };

/** Where per-estimate documents (the SWMS) live: public read, staff write — the presentations' bucket. */
export const ESTIMATE_DOCS_BUCKET = "presentation-docs";
export function estimateDocUrl(path: string): string {
  if (!path) return "";
  if (/^https?:\/\//.test(path)) return path;
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  return `${base}/storage/v1/object/public/${ESTIMATE_DOCS_BUCKET}/${path}`;
}

/**
 * Tom, 18 Sep 2026 (follow-up): the presentation's capability panel already
 * has a "SWMS & site inductions" card beside the public liability card. When
 * it does, THAT card carries the job's SWMS download, and the trust-strip
 * fallback card stays out of the way. A card is the SWMS card when its
 * heading or attachment label says so.
 */
export const isSwmsCard = (card: { heading?: string; attachment?: { label?: string } | null }): boolean =>
  /\bswms\b/i.test(`${card.heading ?? ""} ${card.attachment?.label ?? ""}`);

export function presentationHasSwmsCard(snap: Pick<CustomerSnapshot, "presentation">): boolean {
  for (const b of snap.presentation?.blocks ?? []) {
    if (b.kind !== "capability_panel") continue;
    const cards = (b.content as { cards?: { heading?: string; attachment?: { label?: string } | null }[] } | null)?.cards ?? [];
    if (cards.some(isSwmsCard)) return true;
  }
  return false;
}
