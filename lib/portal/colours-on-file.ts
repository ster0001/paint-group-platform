import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * C15 — the property's colours, as the quote screens read them: the latest
 * non-superseded record per surface type. The register (`colour_records`,
 * trade portal v2) is the ONE machine-readable answer for colours; the
 * screens only read it — a spec's colour policy stays a note.
 */
export type ColourOnFile = { surface: string; name: string; when: string | null; brand: string; product: string };

export async function latestColours(db: SupabaseClient, propertyId: string): Promise<ColourOnFile[]> {
  const { data } = await db.from("colour_records")
    .select("surface_type, colour_name, brand, product, status, applied_from, created_at")
    .eq("property_id", propertyId)
    .neq("status", "superseded")
    .order("created_at", { ascending: false })
    .limit(60);
  const seen = new Map<string, ColourOnFile>();
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const surface = String(r.surface_type ?? "").trim();
    if (!surface || seen.has(surface.toLowerCase())) continue;
    const from = typeof r.applied_from === "string" ? r.applied_from : null;
    const t = from ? Date.parse(from) : NaN;
    seen.set(surface.toLowerCase(), {
      surface, name: String(r.colour_name ?? ""), brand: String(r.brand ?? ""), product: String(r.product ?? ""),
      when: Number.isFinite(t) ? new Date(t).toLocaleDateString("en-AU", { month: "short", year: "numeric", timeZone: "Australia/Melbourne" }) : null,
    });
  }
  return [...seen.values()];
}
