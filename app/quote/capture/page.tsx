import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SCOPE_VERSION } from "@/lib/extract/scope";
import type { TileRule } from "@/lib/capture/presets";
import {
  priceArea,
  type Adjustments,
  type AreaInput,
  type PricingContext,
} from "@/lib/pricing/estimate";
import CaptureApp, { type ExistingRoom, type NamePreset } from "./CaptureApp";

/**
 * /quote/capture?id=... - the on-site room loop (master plan Step 4).
 *
 * A different way IN to the same estimate: rooms committed here land in
 * builder_state as nodes byte-identical to hand-built ones, and this page's
 * only jobs are staff gating and handing the client the reference data it
 * needs (rules, name presets, the estimate's current rooms priced server-side).
 */

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function CapturePage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "staff") redirect("/dashboard");

  const { id } = await searchParams;
  if (!id) redirect("/estimates");

  const [estimateRes, rulesRes, presetsRes, rateItemsRes, productsRes, modifiersRes, settingsRes] = await Promise.all([
    supabase.from("estimates").select("id, title, status, builder_state, storey_heights").eq("id", id).maybeSingle(),
    supabase.from("room_type_scope_rules").select("*").eq("version", SCOPE_VERSION),
    supabase.from("area_name_presets").select("estimate_type, name, room_type, sort_order").eq("version", 1).order("sort_order"),
    supabase.from("rate_items").select("*, rate_cards!inner(is_active)").eq("rate_cards.is_active", true),
    supabase.from("products").select("*"),
    supabase.from("modifiers").select("code, group_name, multiplier").eq("active", true),
    supabase.from("settings").select("key, value"),
  ]);

  const estimate = estimateRes.data as
    | { id: string; title: string | null; status: string | null; builder_state: unknown; storey_heights?: Record<string, number> | null }
    | null;
  if (!estimate) redirect("/estimates");
  if (estimate.status === "accepted") redirect(`/quote?id=${id}`);

  const rules = (rulesRes.data ?? []) as TileRule[];
  const presets = (presetsRes.data ?? []) as NamePreset[];

  // Price the existing rooms server-side so the AreaPicker's progress cards
  // show real dollars from the first render.
  const state = (estimate.builder_state ?? {}) as { blocks?: Array<Record<string, unknown>> } & Record<string, unknown>;
  const blocks = Array.isArray(state.blocks) ? state.blocks : [];
  const ctx: PricingContext = {
    rateItems: (rateItemsRes.data ?? []) as PricingContext["rateItems"],
    products: (productsRes.data ?? []) as PricingContext["products"],
    modifiers: (modifiersRes.data ?? []) as PricingContext["modifiers"],
    settings: (settingsRes.data ?? []) as PricingContext["settings"],
  };
  const adj: Adjustments = {
    modSel: (state.modSel as Record<string, string>) ?? {},
    materials: (state.materials as Record<string, string>) ?? {},
    discountPct: (state.discountPct as number) ?? 0,
    discountMode: (state.discountMode as "pct" | "fixed") ?? "pct",
    discountFixedCents: (state.discountFixedCents as number) ?? 0,
    hourlyRateOverride: (state.hourlyRateOverride as number | null) ?? null,
    contractorRateOverride: (state.contractorRateOverride as number | null) ?? null,
  };

  const existingRooms: ExistingRoom[] = blocks
    .filter((b) => b.kind === "area")
    .map((b) => ({
      areaId: Number(b.id),
      name: String(b.name ?? "Area"),
      roomType: typeof b.roomType === "string" ? b.roomType : null,
      storey: typeof b.storey === "string" ? b.storey : "ground",
      capturedVia: b.capturedVia === "room_loop" ? "room_loop" : "builder",
      surfaceCount: Array.isArray(b.surfaces) ? b.surfaces.length : 0,
      priceCents: priceArea(b as unknown as AreaInput, ctx, adj),
      L: Number(b.L) || 0,
      W: Number(b.W) || 0,
      H: Number(b.H) || 0,
      // Only room_loop nodes are re-editable in capture (their surfaces map
      // cleanly back onto tiles); builder-made rooms stay builder-owned.
      surfaces: Array.isArray(b.surfaces)
        ? (b.surfaces as Array<Record<string, unknown>>).map((s) => ({
            code: String(s.code ?? ""),
            count: Number(s.count) || 0,
            prepHr: Number(s.prepHr) || 0,
            coats: Number(s.coats) || 2,
            crewNote: String(s.crewNote ?? ""),
          }))
        : [],
      extraWallSegmentsM: Array.isArray(b.extraWallSegmentsM) ? (b.extraWallSegmentsM as number[]) : [],
      perimeterOverridden: b.perimeterOverridden === true,
      perimeterM: Number(b.perimeterM) || null,
    }));

  return (
    <CaptureApp
      estimateId={estimate.id}
      estimateTitle={estimate.title ?? "Untitled estimate"}
      rules={rules}
      presets={presets}
      initialStoreyHeights={estimate.storey_heights ?? null}
      initialRooms={existingRooms}
    />
  );
}
