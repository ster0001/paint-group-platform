import type { Point } from "@/lib/movements/types";

/**
 * Flag 3 (Movements brief): a job's real point from its address, through the same
 * server-side Places key the wizard's address lookup uses (`GOOGLE_MAPS_API_KEY`, never in
 * the browser). Places API (New) Text Search with a `places.location` field mask — one
 * result, biased to Melbourne — because a job holds an address, not a place id (the
 * details route needs one). Returns null on no match, a bad key or a timeout; the caller
 * stamps the attempt either way so the next try waits a week.
 */
const MELBOURNE = { latitude: -37.8136, longitude: 144.9631 };
const BIAS_RADIUS_M = 60_000;

export async function geocodeAddress(address: string, key: string, fetcher: typeof fetch = fetch): Promise<Point | null> {
  const q = address.trim();
  if (!q) return null;
  let res: Response;
  try {
    res = await fetcher("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "places.location" },
      body: JSON.stringify({
        textQuery: q, regionCode: "AU", languageCode: "en-AU", maxResultCount: 1,
        locationBias: { circle: { center: MELBOURNE, radius: BIAS_RADIUS_M } },
      }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const j = (await res.json().catch(() => null)) as { places?: Array<{ location?: { latitude?: number; longitude?: number } }> } | null;
  const loc = j?.places?.[0]?.location;
  if (!loc || typeof loc.latitude !== "number" || typeof loc.longitude !== "number") return null;
  if (loc.latitude < -90 || loc.latitude > 90 || loc.longitude < -180 || loc.longitude > 180) return null;
  return { lat: loc.latitude, lng: loc.longitude };
}
