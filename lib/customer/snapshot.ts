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
  };
  estRef: string; // short EST reference
  contactName: string;
  contactEmail: string; // the customer's own email (used only for the portal magic-link match)
  jobAddress: string;
  jobTitle: string;
  gstRatePct: number; // e.g. 10
  baseSubtotalCents: number; // included items + sundries, ex-GST (excludes options)
  areas: SnapshotArea[];
  lineItems: SnapshotLine[];
  options: SnapshotLine[]; // optional add-ons the customer can toggle
  inclusions: string[];
  exclusions: string[];
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
  accreditations: ["Dulux Accredited", "Master Painters"],
};
