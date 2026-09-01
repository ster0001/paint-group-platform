export type CompanyProfile = {
  name: string;
  addressLine1: string;
  addressLine2: string;
  phone: string;
  abn: string;
  logoUrl: string;
  /** A logo for LIGHT backgrounds (email, quote PDF). Falls back to logoUrl. */
  logoUrlLight: string;
  estimatorName: string;
  estimatorTitle: string;
  estimatorPhone: string;
  /** Shown on the customer dashboard's "who is managing the job" (Tom, 1 Sep). */
  coordinatorName: string;
  email: string;
  bankName: string;
  bsb: string;
  acc: string;
  bank: string;
};
export type Contact = {
  id?: string;
  first_name: string;
  last_name: string;
  company: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  postal: string;
};
export type JobAddress = { address: string; city: string; state: string; postal: string };

/**
 * The SHAPE of a company profile, not a company.
 *
 * A6-01 (audit 2026-08-28): this constant used to carry Paint Group's real
 * ABN, street address, bank name, BSB, account number and the director's
 * personal mobile — committed to the repo, against two CLAUDE.md rules
 * ("bank/payment details ... displayed masked" and "no secrets, keys, or real
 * customer data in the repo").
 *
 * The real values live in `settings.company_profile`, which every reader
 * already spreads OVER this object:
 *
 *   { ...DEFAULT_COMPANY, ...(settings.company_profile ?? {}) }
 *
 * so behaviour is unchanged once that row is populated — and a licensee gets
 * their own letterhead by writing their own row, not by editing this file
 * (A6-02, tenancy ruling (b)).
 *
 * PREREQUISITE: `settings.company_profile` must be fully populated before this
 * ships, or the estimate and invoice letterheads render blank. See
 * docs/manual-tests/f0-company-settings.md.
 */
export const DEFAULT_COMPANY: CompanyProfile = {
  name: "",
  addressLine1: "",
  addressLine2: "",
  phone: "",
  abn: "",
  logoUrl: "",
  logoUrlLight: "",
  estimatorName: "",
  estimatorTitle: "",
  estimatorPhone: "",
  coordinatorName: "Felipe Martinez",
  email: "",
  bankName: "",
  bsb: "",
  acc: "",
  bank: "",
};
export const EMPTY_CONTACT: Contact = {
  first_name: "", last_name: "", company: "", email: "", phone: "", address: "", city: "", state: "", postal: "",
};
export const EMPTY_JOB: JobAddress = { address: "", city: "", state: "", postal: "" };
