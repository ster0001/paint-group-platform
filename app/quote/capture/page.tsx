import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SCOPE_VERSION } from "@/lib/extract/scope";
import { storeyHeightsFromBlocks, type TileRule } from "@/lib/capture/presets";
import { jobModifier, priceArea, resolveRates, type AreaInput } from "@/lib/pricing/estimate";
import { adjustmentsFrom, loadPricingContext } from "@/lib/pricing/context";
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

  const [estimateRes, rulesRes, presetsRes, defectRatesRes, ctx] = await Promise.all([
    // NOTE: destructure order must match this array exactly.
    supabase.from("estimates").select("id, title, status, builder_state, storey_heights").eq("id", id).maybeSingle(),
    supabase.from("room_type_scope_rules").select("*").eq("version", SCOPE_VERSION),
    supabase.from("area_name_presets").select("estimate_type, name, room_type, sort_order").eq("version", 1).order("sort_order"),
    supabase.from("defect_prep_rates").select("defect_type, unit, hours_sev1, hours_sev2, hours_sev3").eq("version", SCOPE_VERSION),
    loadPricingContext(supabase),
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
  const adj = adjustmentsFrom(state);

  const existingRooms: ExistingRoom[] = blocks
    .filter((b) => b.kind === "area")
    .map((b) => ({
      areaId: Number(b.id),
      name: String(b.name ?? "Area"),
      // The wizard's exterior vocabulary is "exterior"; capture's is
      // "exterior_elevation" — same thing, normalised here so the tile
      // lookup resolves instead of 422ing (A5).
      roomType: typeof b.roomType === "string"
        ? (b.roomType === "exterior" ? "exterior_elevation" : b.roomType)
        : null,
      storey: typeof b.storey === "string" ? b.storey : "ground",
      // A5: three provenances, all openable. AI-drafted nodes (wizard, plan
      // reader) and customer-stated ones rebuild onto tiles for the
      // confirm-as-you-walk pass; builder rooms open too, with their
      // builder-only lines preserved server-side on recommit.
      capturedVia: b.capturedVia === "room_loop"
        ? "room_loop"
        : typeof b.origin === "string" && (String(b.origin).startsWith("ai_") || b.origin === "customer_stated")
          ? "assisted"
          : "builder",
      surfaceCount: Array.isArray(b.surfaces) ? b.surfaces.length : 0,
      priceCents: priceArea(b as unknown as AreaInput, ctx, adj),
      L: Number(b.L) || 0,
      W: Number(b.W) || 0,
      H: Number(b.H) || 0,
      surfaces: Array.isArray(b.surfaces)
        ? (b.surfaces as Array<Record<string, unknown>>).map((s) => ({
            code: String(s.code ?? ""),
            count: Number(s.count) || 0,
            prepHr: Number(s.prepHr) || 0,
            coats: Number(s.coats) || 2,
            crewNote: String(s.crewNote ?? ""),
            size: s.size === "small" || s.size === "large" ? s.size : null,
          }))
        : [],
      extraWallSegmentsM: Array.isArray(b.extraWallSegmentsM) ? (b.extraWallSegmentsM as number[]) : [],
      captureDraft: (b.captureDraft as import("@/lib/capture/commit").RoomDraft | undefined) ?? null,
      perimeterOverridden: b.perimeterOverridden === true,
      perimeterM: Number(b.perimeterM) || null,
    }));

  return (
    <CaptureApp
      estimateId={estimate.id}
      estimateTitle={estimate.title ?? "Untitled estimate"}
      prepPack={(state.prepPack as import("./CaptureApp").PrepPack | undefined) ?? null}
      rules={rules}
      presets={presets}
      defectRates={(defectRatesRes.data ?? []) as import("@/lib/capture/commit").DefectRate[]}
      rateItems={ctx.rateItems}
      jobMod={jobModifier(ctx.modifiers, adj.modSel)}
      windowSizes={{ small: resolveRates(ctx, adj).windowSmall, large: resolveRates(ctx, adj).windowLarge }}
      initialStoreyHeights={estimate.storey_heights ?? null}
      derivedStoreyHeights={storeyHeightsFromBlocks(blocks)}
      initialRooms={existingRooms}
    />
  );
}
