/**
 * Backfill attribution (ruling 4, 30 Aug): where an estimate has no
 * property_id, attribute by address — but ONLY on an exact match after
 * normalisation. addressKey (lib/accounts/identity) already folds case,
 * whitespace and punctuation; this adds the street-type and unit
 * abbreviations the ruling names. Anything weaker than an exact fold match
 * is unattributed, with a reason, for Tom to resolve by hand — never guessed.
 */
import { addressKey, type AddressParts } from "@/lib/accounts/identity";

/** Long and short street-type forms fold to one token. */
const STREET_TYPES: Record<string, string> = {
  street: "st",
  road: "rd",
  avenue: "ave",
  av: "ave",
  drive: "dr",
  court: "ct",
  place: "pl",
  crescent: "cres",
  cr: "cres",
  highway: "hwy",
  terrace: "tce",
  grove: "gr",
  parade: "pde",
  boulevard: "bvd",
  blvd: "bvd",
  close: "cl",
  lane: "ln",
  esplanade: "esp",
};

/**
 * Fold an addressKey-shaped string ("unit 7 22 ormond road elwood 3184")
 * to its comparison form ("7 22 ormond rd elwood 3184").
 */
export function foldAddressKey(key: string): string {
  const tokens = key.split(" ").filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    // "unit 7 …" / "u 7 …" → the 7 alone (addressKey already split 7/22).
    if ((t === "unit" || t === "u" || t === "apt" || t === "apartment" || t === "flat")
      && /^\d/.test(tokens[i + 1] ?? "")) continue;
    out.push(STREET_TYPES[t] ?? t);
  }
  return out.join(" ");
}

/** The comparison key for a raw address; null when there is no street. */
export function matchKey(parts: AddressParts): string | null {
  const key = addressKey(parts);
  return key ? foldAddressKey(key) : null;
}
