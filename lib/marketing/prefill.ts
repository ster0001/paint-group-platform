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
  /** Only "commercial" is ever forced; a home stays on the wizard's default. */
  propertyKind: "commercial" | null;
  /** §4.4c block 8: the showcase job's type — the wizard opens on it. */
  scope: JobType | null;
  /** The published showcase slug the visitor came from (its linked estimate seeds the draft). */
  from: string | null;
};

/** The wizard schema's own cap on a formatted address (lib/wizard/state.ts). */
const ADDRESS_MAX = 250;

type Param = string | string[] | undefined;
const first = (p: Param): string | undefined => (Array.isArray(p) ? p[0] : p);

/** Control characters (C0 + DEL) are never part of an address — drop them. */
const isPrintable = (c: string) => { const n = c.charCodeAt(0); return n >= 32 && n !== 127; };

export function parseEstimateIntent(params: { address?: Param; mode?: Param; scope?: Param; from?: Param }): EstimateIntent {
  const raw = first(params.address) ?? "";
  // Strip control characters, collapse whitespace, clamp to the schema cap.
  const cleaned = Array.from(raw)
    .map((c) => (isPrintable(c) ? c : " "))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, ADDRESS_MAX);
  const mode = first(params.mode);
  const scope = first(params.scope);
  const from = (first(params.from) ?? "").trim().toLowerCase();
  return {
    addressText: cleaned || null,
    propertyKind: isMode(mode) && mode === "business" ? "commercial" : null,
    scope: (JOB_TYPES as readonly string[]).includes(scope ?? "") ? (scope as JobType) : null,
    from: SLUG_RE.test(from) && from.length <= 80 ? from : null,
  };
}
