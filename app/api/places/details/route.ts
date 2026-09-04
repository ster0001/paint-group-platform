import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getWizardActor } from "@/lib/supabase/guards";
import { allowPublicPlaces } from "@/lib/places/publicLimit";
import { serviceAreaFromSettings } from "@/lib/wizard/policy";
import { clampAddress } from "@/lib/wizard/state";

/**
 * A1: resolve a selected suggestion into the structured address, and run the
 * service-area check IMMEDIATELY — an out-of-area customer hears it politely
 * before answering anything else, not after finishing the wizard. Key stays
 * server-side; same session token as the autocomplete calls.
 */

export const runtime = "nodejs";

const bodySchema = z.object({
  placeId: z.string().min(4).max(300),
  sessionToken: z.string().min(8).max(64),
});

type Component = { longText?: string; shortText?: string; types?: string[] };

function part(components: Component[], type: string, short = false): string {
  const c = components.find((x) => x.types?.includes(type));
  return (short ? c?.shortText : c?.longText) ?? "";
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const actor = await getWizardActor(supabase);
  // Homepage visitors have no session (homepage brief §4.2): same-origin +
  // per-IP brakes instead — see lib/places/publicLimit.ts.
  if (actor.kind === "none" && !allowPublicPlaces(request, "details")) {
    return NextResponse.json({ error: "Too many lookups — type the address by hand." }, { status: 429 });
  }

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return NextResponse.json({ error: "Address lookup isn't configured.", code: "no_places_key" }, { status: 503 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pick a suggestion." }, { status: 400 });

  try {
    const res = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(parsed.data.placeId)}?sessionToken=${encodeURIComponent(parsed.data.sessionToken)}`,
      {
        headers: {
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": "formattedAddress,addressComponents",
        },
        signal: AbortSignal.timeout(4000),
      },
    );
    if (!res.ok) return NextResponse.json({ error: "Couldn't fetch that address." }, { status: 502 });
    const j = (await res.json()) as { formattedAddress?: string; addressComponents?: Component[] };
    const comps = j.addressComponents ?? [];
    const streetNumber = part(comps, "street_number");
    const route = part(comps, "route");
    // Clamped to the wizard schema's caps: shortText has no short form for
    // some regions (UK counties), and a picked address must always survive
    // the wizard's own validation.
    const address = clampAddress({
      street: [streetNumber, route].filter(Boolean).join(" "),
      suburb: part(comps, "locality"),
      state: part(comps, "administrative_area_level_1", true),
      postcode: part(comps, "postal_code"),
      formatted: j.formattedAddress ?? "",
    });

    // Service-area check, same rule as the policy engine: an empty configured
    // list means "unconfigured — allow" (never block on missing setup).
    // Staff read settings under RLS; a customer OR a sessionless homepage
    // visitor has no table access, so the service client reads it for them.
    const db = actor.kind === "staff" ? supabase : createServiceClient();
    let inServiceArea: boolean | null = null;
    if (db && address.postcode) {
      const { data: row } = await db.from("settings").select("value").eq("key", "service_area").maybeSingle();
      const postcodes = serviceAreaFromSettings(row?.value);
      inServiceArea = postcodes.length === 0 ? null : postcodes.includes(address.postcode);
    }

    return NextResponse.json({ address, inServiceArea });
  } catch {
    return NextResponse.json({ error: "Couldn't fetch that address." }, { status: 502 });
  }
}
