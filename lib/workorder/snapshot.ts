// The work-order document — the contractor-safe job sheet. Frozen into
// work_orders.wo_snapshot when staff issue the order, and served to the public
// /w/[token] route. NEVER contains customer pricing, margin, surname or email.

export type WOColourStatus = "tbc" | "confirmed";
export type WOSurfaceStatus = "not_started" | "in_progress" | "complete";

export type WOMaterial = {
  product: string;
  photoUrl: string;
  litres: number | null; // purchasable litres; null when coverage unknown
  coverageMissing: boolean; // true → show staff warning, never a fabricated figure
  colourName: string;
  colourStatus: WOColourStatus;
};

export type WOSurface = {
  key: string; // stable key: `${areaId}:${surfaceId}`
  label: string;
  coats: number;
  product: string;
  prep: string; // plain-English prep note
  hours: number | null; // hours allowance
  status: WOSurfaceStatus; // read-only in v1
};

export type WOArea = {
  id: string;
  title: string;
  surfaces: WOSurface[];
  photos: string[];
};

export type WorkOrderDoc = {
  version: 1;
  woRef: string;
  status: string; // draft | issued | in_progress | complete
  jobTitle: string;
  jobAddress: string;
  contactFirstName: string; // first name only — never surname/email
  contactPhone: string;
  startDate: string | null;
  accessNotes: string;
  contractorName: string;
  contractorPaymentCents: number;
  materials: WOMaterial[];
  areas: WOArea[];
  exclusions: string[];
  company: { name: string; phone: string; logoUrl: string };
};

// Purchasable tin sizes (litres). Round total required litres UP to what the
// painter can actually buy at the trade counter.
const TIN_SIZES = [1, 2, 4, 10, 15, 20];
export function roundUpLitres(litres: number): number {
  if (!(litres > 0)) return 0;
  for (const s of TIN_SIZES) if (litres <= s) return s;
  return Math.ceil(litres / 20) * 20; // larger jobs: whole 20 L drums
}

export const WO_STATUS_LABEL: Record<string, string> = {
  draft: "Draft", issued: "Issued", in_progress: "In progress", complete: "Complete",
};
