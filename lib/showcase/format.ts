/**
 * Display helpers for showcase jobs. Money is integer cents everywhere and
 * formatted only here (CLAUDE.md); dates are the DATE column's own
 * "YYYY-MM-DD" text, parsed by hand — never through a Date + toISOString
 * (the UTC-date trap in CLAUDE.md § Dates).
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `$8,400 – $9,600` — en dash, comma thousands, whole dollars (brief §1). */
export function formatPriceRange(lowCents: number, highCents: number): string {
  return `${formatDollars(lowCents)} – ${formatDollars(highCents)}`;
}

export function formatDollars(cents: number): string {
  const dollars = Math.round(cents / 100);
  return `$${dollars.toLocaleString("en-AU")}`;
}

/** "2026-07-14" → "Jul 2026". Callers uppercase for the `COMPLETED JUL 2026` meta line. */
export function formatCompletedOn(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) return "";
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${m[1]}` : "";
}

/** Title + suburb → `exterior-weatherboard-thornbury` (≤ 80 chars, slug shape). */
export function slugify(title: string, suburb: string): string {
  const raw = `${title} ${suburb}`
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const clipped = raw.slice(0, 80).replace(/-+$/g, "");
  return clipped.length >= 3 ? clipped : `${clipped}-job`.replace(/^-/, "job-");
}

export const SHOWCASE_BUCKET = "showcase-media";

/** Public URL for a path in the showcase-media bucket (public-read bucket). */
export function showcaseMediaUrl(path: string, base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""): string {
  return `${base.replace(/\/$/, "")}/storage/v1/object/public/${SHOWCASE_BUCKET}/${path}`;
}
