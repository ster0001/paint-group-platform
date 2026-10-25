/**
 * /estimate reads the homepage hand-off (`?address=&mode=`) through this —
 * pure, so it is unit-tested and the page stays a thin shell.
 *
 * Tom's ruling (4 Sep): `mode` is INTENT only. It pre-selects the wizard's
 * "what kind of property" answer (business → commercial); it never creates
 * an account, changes a rate limit, or fires an event — `see_price` is the
 * homepage's, fired before navigation.
 */
import { isMode } from "./estimateLink";
import { JOB_TYPES, SLUG_RE, type JobType } from "@/lib/showcase/schema";

export type EstimateIntent = {
  /** What the visitor typed (or picked) on the homepage, shown in the
   *  wizard's address field. Null when nothing usable arrived. */
  addressText: string | null;
  /** Tom, 25 Oct 2026: the homepage's resolved pick, when the hand-off carried one (suburb + postcode present) — the wizard seeds its address and customer fields from it. */
  address: { street: string; suburb: string; state: string; postcode: string; formatted: string } | null;
  /** Only "commercial" is ever forced; a home stays on the wizard's default. */
  propertyKind: "commercial" | null;
  /** §4.4c block 8: the showcase job's type — the wizard opens on it. */
  scope: JobType | null;
  /** The published showcase slug the visitor came from (its linked estimate seeds the draft). */
  from: string | null;
  /** Buckets brief §2.1: the hero chip as typed, for the session row. */
  mode: "home" | "business" | null;
  /** Buckets brief §2.1 / §4.2: `homepage_hero | homepage_cta | job_page:<slug> | direct`. Missing = direct. */
  entrySource: string;
  /** Paint Home brief §5: the shopfront the visitor came through. Only `painthome` is ever carried; Paint Group is the default and has no tag. */
  brand: "painthome" | null;
};

const SRC_RE = /^[a-z_]{2,40}(:[a-z0-9-]{1,80})?$/;

/** The wizard schema's own cap on a formatted address (lib/wizard/state.ts). */
const ADDRESS_MAX = 250;

type Param = string | string[] | undefined;
const first = (p: Param): string | undefined => (Array.isArray(p) ? p[0] : p);

/** Control characters (C0 + DEL) are never part of an address — drop them. */
const isPrintable = (c: string) => { const n = c.charCodeAt(0); return n >= 32 && n !== 127; };

const cleanText = (raw: string, max: number) => Array.from(raw)
  .map((c) => (isPrintable(c) ? c : " "))
  .join("")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, max);

export function parseEstimateIntent(params: { address?: Param; street?: Param; suburb?: Param; state?: Param; postcode?: Param; mode?: Param; scope?: Param; from?: Param; src?: Param; brand?: Param }): EstimateIntent {
  const raw = first(params.address) ?? "";
  // Strip control characters, collapse whitespace, clamp to the schema cap.
  const cleaned = cleanText(raw, ADDRESS_MAX);
  // The pick's parts, clamped like lib/wizard/state.ts clampAddress; a pick needs a suburb and a postcode or it is only words.
  const suburb = cleanText(first(params.suburb) ?? "", 80);
  const postcode = cleanText(first(params.postcode) ?? "", 10);
  const street = cleanText(first(params.street) ?? "", 120);
  const state = cleanText(first(params.state) ?? "", 10);
  const address = suburb && /^\d{3,10}$/.test(postcode)
    ? { street, suburb, state, postcode, formatted: cleaned || [street, suburb, state, postcode].filter(Boolean).join(", ").slice(0, ADDRESS_MAX) }
    : null;
  // Paint Home is residential only (brief §5): a business mode on a Paint Home hand-off is refused, never honoured.
  const brand = first(params.brand) === "painthome" ? "painthome" as const : null;
  const mode = brand ? "home" : first(params.mode);
  const scope = first(params.scope);
  const from = (first(params.from) ?? "").trim().toLowerCase();
  const src = (first(params.src) ?? "").trim().toLowerCase();
  const fromOk = SLUG_RE.test(from) && from.length <= 80 ? from : null;
  return {
    addressText: cleaned || address?.formatted || null,
    address,
    propertyKind: isMode(mode) && mode === "business" ? "commercial" : null,
    scope: (JOB_TYPES as readonly string[]).includes(scope ?? "") ? (scope as JobType) : null,
    from: fromOk,
    mode: isMode(mode) ? mode : null,
    entrySource: SRC_RE.test(src) ? src : fromOk ? `job_page:${fromOk}` : "direct",
    brand,
  };
}
