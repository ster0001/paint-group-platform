import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SCOPE_VERSION } from "@/lib/extract/scope";
import type { TileRule } from "@/lib/capture/presets";
import ScopeComponentsDemo from "./ScopeComponentsDemo";

/**
 * /dev/scope-components - the storybook-style page the master plan's Step 3
 * "done when" names: the shared room tile and room card render here in BOTH
 * modes, driven by the LIVE room_type_scope_rules rows, with a measurement
 * block so the derived quantities can be watched updating.
 *
 * Staff only. This is a workbench, not a product surface.
 */

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function ScopeComponentsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "staff") redirect("/dashboard");

  // select("*") so the page keeps working before the Step 3 migration adds
  // the tile columns - missing fields are synthesised below and a banner says
  // the migration is pending rather than the page erroring.
  const { data } = await supabase
    .from("room_type_scope_rules")
    .select("*")
    .eq("version", SCOPE_VERSION)
    .order("room_type");

  const raw = (data ?? []) as Array<Partial<TileRule> & { room_type: string; surface_type: string; is_option: boolean; requires_confirm: boolean; notes: string | null }>;
  const migrated = raw.length > 0 && raw[0].countable !== undefined;

  const rules: TileRule[] = raw.map((r) => ({
    room_type: r.room_type,
    surface_type: r.surface_type,
    is_option: r.is_option,
    requires_confirm: r.requires_confirm,
    notes: r.notes,
    countable: r.countable ?? ["Door & Frame", "Windows", "Cabinets", "Shelving", "Architrave"].includes(r.surface_type),
    tile_group: r.tile_group ?? (["Door & Frame", "Windows"].includes(r.surface_type) ? "openings" : "core"),
    sort_order: r.sort_order ?? 0,
  }));

  const roomTypes = [...new Set(rules.map((r) => r.room_type))].sort();

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="text-xl font-semibold tracking-tight">Scope components workbench</h1>
      <p className="mt-1 text-sm text-gray-500">
        The shared SurfaceTileBox and RoomCard, both modes, driven by the live scope rules (version {SCOPE_VERSION}, {rules.length} rows).
      </p>
      {!migrated && rules.length > 0 && (
        <p className="mt-2 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
          The Step 3 migration (20260913) has not run yet - tile grouping shown here is synthesised defaults, not Settings data.
        </p>
      )}
      {rules.length === 0 && (
        <p className="mt-2 rounded bg-red-50 px-3 py-2 text-sm text-red-800">
          No scope rules found for version {SCOPE_VERSION} - run scripts/seed-extraction-settings.ts.
        </p>
      )}
      <ScopeComponentsDemo rules={rules} roomTypes={roomTypes} />
    </div>
  );
}
