// Contractor types and pure helpers. No Supabase imports here on purpose — this
// module is shared by Server Components and Client Components, so it must not
// drag `next/headers` into the browser bundle.

export type ContractorRow = {
  id: string;
  profile_id: string;
  tier: string | null;
  insurance_expiry: string | null;
  active: boolean;
  company_name: string | null;
  abn: string | null;
  gst_registered: boolean;
  address: string | null;
  bank_bsb: string | null;
  bank_account_last4: string | null;
  logo_url: string | null;
  invoice_prefix: string | null;
  invoice_next_number: number;
  offerable: boolean;
  /** Painters they can field at once. Capacity signal, never a booking limit. */
  crew_size: number;
};

export type ContractorDoc = {
  id: string;
  contractor_id: string;
  kind: "insurance" | "licence" | "other";
  name: string;
  file_url: string;
  expires_on: string | null;
  status: "valid" | "expired" | "pending";
  created_at: string;
  /** Set once staff have read the certificate. Insurance only counts when set. */
  verified_at: string | null;
  verify_note: string;
};

export const CONTRACTOR_COLUMNS =
  "id, profile_id, tier, insurance_expiry, active, company_name, abn, gst_registered, address, bank_bsb, bank_account_last4, logo_url, invoice_prefix, invoice_next_number, offerable, crew_size";

export const DOC_COLUMNS =
  "id, contractor_id, kind, name, file_url, expires_on, status, created_at, verified_at, verify_note";

/** The fields a contractor must fill in before they can invoice Paint Group. */
export function missingProfileFields(c: Partial<ContractorRow> | null): string[] {
  if (!c) return ["company details"];
  const missing: string[] = [];
  if (!c.company_name?.trim()) missing.push("company name");
  if (!c.abn?.trim()) missing.push("ABN");
  if (!c.address?.trim()) missing.push("business address");
  if (!c.bank_bsb?.trim()) missing.push("bank details");
  return missing;
}

/** Days until a document expires — negative once it has lapsed. */
export function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const then = new Date(date + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((then.getTime() - now.getTime()) / 86_400_000);
}

/**
 * A document's status evaluated NOW, rather than trusting the stored column.
 *
 * The database stamps `status` on insert/update, so a certificate that lapses
 * while sitting untouched in the table keeps reading "valid" until something
 * writes to the row. Mirrors the same rule as the DB trigger, just evaluated at
 * read time — always use this for anything a contractor sees.
 */
export function docState(d: ContractorDoc): ContractorDoc["status"] {
  if (!d.file_url) return "pending";
  const days = daysUntil(d.expires_on);
  if (days !== null && days < 0) return "expired";
  // Unverified paperwork is not yet compliance — a human has to read it.
  if (!d.verified_at) return "pending";
  return "valid";
}

export const DOC_LABEL: Record<ContractorDoc["kind"], string> = {
  insurance: "Public liability insurance",
  licence: "Painting licence",
  other: "Other document",
};
