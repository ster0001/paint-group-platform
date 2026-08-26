/**
 * 3a-1 · The one place account identity keys are computed.
 *
 * accounts are found by normalised email; properties are deduped per account
 * by a normalised address key. Both rules live here and nowhere else, so the
 * wizard, the backfill script and the portal can never disagree about which
 * account an email belongs to.
 */

/** The identity key for an account: trimmed, lowercased email. */
export function normaliseEmail(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

export type AddressParts = {
  street?: string | null;
  suburb?: string | null;
  postcode?: string | null;
};

/**
 * The dedupe key for a property within an account: street + suburb + postcode,
 * lowercased, punctuation stripped, whitespace collapsed. "2/88 Victoria Rd,
 * Northcote 3070" and "2-88 victoria rd northcote 3070" collapse to the same
 * key. Returns null when there is no street — a suburb alone is not an
 * address, and a keyless property must never dedupe against a real one.
 */
export function addressKey(parts: AddressParts): string | null {
  const street = (parts.street ?? "").trim();
  if (!street) return null;
  const joined = [street, parts.suburb ?? "", parts.postcode ?? ""].join(" ");
  const key = joined
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return key || null;
}
