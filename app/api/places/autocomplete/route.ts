import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getWizardActor } from "@/lib/supabase/guards";
import { allowPublicPlaces } from "@/lib/places/publicLimit";

/**
 * A1: Google Places Autocomplete, SERVER-PROXIED — the API key lives only in
 * server env (GOOGLE_MAPS_API_KEY) and never reaches a browser. AU-restricted,
 * biased to Melbourne. The client degrades to plain typing on any failure,
 * so this route's error shape is deliberately simple: a 5xx means "type it
 * by hand", never a broken page.
 */

export const runtime = "nodejs";

const bodySchema = z.object({
  input: z.string().min(3).max(120),
  /** Groups keystrokes + the details call for Google's session billing. */
  sessionToken: z.string().min(8).max(64),
});

/** Melbourne CBD, 50 km — Google's HARD CAP on circle bias radius. The
 *  original 150 km made Google refuse EVERY request with a 400 (found live
 *  25 Aug: the field had silently degraded to plain typing since launch). */
const MELBOURNE_BIAS = {
  circle: { center: { latitude: -37.8136, longitude: 144.9631 }, radius: 50_000 },
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const actor = await getWizardActor(supabase);
  // Homepage visitors have no session (homepage brief §4.2): same-origin +
  // per-IP brakes instead — see lib/places/publicLimit.ts.
  if (actor.kind === "none" && !allowPublicPlaces(request, "autocomplete")) {
    return NextResponse.json({ error: "Too many lookups — type the address by hand." }, { status: 429 });
  }

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return NextResponse.json({ error: "Address lookup isn't configured.", code: "no_places_key" }, { status: 503 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Type a few characters first." }, { status: 400 });

  try {
    const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key },
      body: JSON.stringify({
        input: parsed.data.input,
        sessionToken: parsed.data.sessionToken,
        includedRegionCodes: ["au"],
        includedPrimaryTypes: ["street_address", "subpremise", "premise", "route"],
        locationBias: MELBOURNE_BIAS,
      }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return NextResponse.json({ error: "Address lookup is unavailable." }, { status: 502 });
    const j = (await res.json()) as {
      suggestions?: Array<{ placePrediction?: { placeId?: string; structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } }; text?: { text?: string } } }>;
    };
    const suggestions = (j.suggestions ?? [])
      .map((s) => s.placePrediction)
      .filter((p): p is NonNullable<typeof p> => !!p?.placeId)
      .slice(0, 6)
      .map((p) => ({
        placeId: p.placeId as string,
        main: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
        secondary: p.structuredFormat?.secondaryText?.text ?? "",
      }));
    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json({ error: "Address lookup is unavailable." }, { status: 502 });
  }
}
