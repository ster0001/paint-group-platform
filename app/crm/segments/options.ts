import type { SupabaseClient } from "@supabase/supabase-js";
import type { BuilderOptions } from "./SegmentBuilder";

/** The dynamic option lists the field registry defers to the page: tags, staff, campaigns. */
export async function loadBuilderOptions(supabase: SupabaseClient): Promise<BuilderOptions> {
  const [{ data: tags }, { data: owners }, { data: campaigns }] = await Promise.all([
    supabase.from("crm_tags").select("key, label").order("sort_order").limit(100),
    supabase.from("profiles").select("id, name").eq("role", "staff").order("name").limit(50),
    supabase.from("campaigns").select("key, name").order("updated_at", { ascending: false }).limit(100),
  ]);
  return {
    tags: (tags ?? []).map((t) => ({ value: t.key as string, label: t.label as string })),
    owners: (owners ?? []).map((o) => ({ value: o.id as string, label: (o.name as string) || "Unnamed" })),
    campaigns: (campaigns ?? []).map((c) => ({ value: c.key as string, label: c.name as string })),
  };
}

/** Names for the read-only rule lines. */
export function optionNames(o: BuilderOptions): { owners: Record<string, string>; campaigns: Record<string, string>; tags: Record<string, string> } {
  const map = (xs: Array<{ value: string; label: string }>) => Object.fromEntries(xs.map((x) => [x.value, x.label]));
  return { owners: map(o.owners), campaigns: map(o.campaigns), tags: map(o.tags) };
}
