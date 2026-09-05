import type { Audience } from "../audience";
import { HOME_COPY } from "./home";
import { BUSINESS_COPY } from "./business";
import { SECTIONS, type Section, type SiteCopy } from "./schema";

export const DEFAULT_COPY: Record<Audience, SiteCopy> = { home: HOME_COPY, business: BUSINESS_COPY };

/** Defaults, with the stored rows laid over them. A row with an empty value falls back too. */
export function mergeCopy(audience: Audience, rows: Array<{ section: string; key: string; value: string }>): SiteCopy {
  const base = DEFAULT_COPY[audience];
  const out = {} as SiteCopy;
  for (const s of SECTIONS) out[s] = { ...base[s] };
  for (const r of rows) {
    if (!(SECTIONS as readonly string[]).includes(r.section)) continue;
    if (typeof r.value !== "string" || !r.value.trim()) continue;
    out[r.section as Section][r.key] = r.value;
  }
  return out;
}

/** A section's text, never undefined. */
export const text = (copy: SiteCopy, section: Section, key: string): string => copy[section]?.[key] ?? "";
