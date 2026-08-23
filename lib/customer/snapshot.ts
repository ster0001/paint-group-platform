// The customer-safe estimate document, frozen into estimates.sent_snapshot at
// send time. This is the ONLY estimate data the public token route ever sees —
// it deliberately contains no margin, costs, contractor rates, hidden items or
// internal notes. Prices are in integer cents, ex-GST unless noted.

export type SnapshotSurface = {
  label: string; // client label
  coats: number;
  product: string;
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
};

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
  baseSubtotalCents: number; // included items + sundries, ex-GST (excludes options)
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
  proof: {
    rating: string; // "5.0"
    reviews: string; // "85+"
    liability: string; // "$20M"
    warranty: string; // "2-year"
    accreditations: string[];
  };
};

export const DEFAULT_PROOF: CustomerSnapshot["proof"] = {
  rating: "5.0",
  reviews: "85+",
  liability: "$20M",
  warranty: "2-year",
  accreditations: ["Master Painters Accredited"],
};
