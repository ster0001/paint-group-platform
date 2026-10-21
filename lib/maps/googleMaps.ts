/**
 * Google Maps JavaScript API — the one loader (brief ruling 13, Session 6). A script tag,
 * no package: the browser key is `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` (website-restricted,
 * Maps JavaScript API only — build plan step 3), inlined into the client bundle by Next.
 * `loading=async` means the classes arrive through `importLibrary`, so callers get the
 * `maps` library object, never a global they have to wait for.
 *
 * Browser only. One in-flight load per page; a failed load can be retried.
 */

/** The browser key, or null when the Map view must stay off (Settings → Movements says so). */
export function mapsBrowserKey(): string | null {
  const k = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
  return k && k.trim() ? k.trim() : null;
}

/** What the map needs: the "maps" library (Map, OverlayView, Polyline) and "core" (LatLngBounds, event). */
export type GoogleMapsLib = google.maps.MapsLibrary & google.maps.CoreLibrary;

async function libraries(importLibrary: typeof google.maps.importLibrary): Promise<GoogleMapsLib> {
  const [maps, core] = await Promise.all([importLibrary("maps"), importLibrary("core")]);
  return { ...maps, ...core };
}

let pending: Promise<GoogleMapsLib> | null = null;
const CALLBACK = "__pgGoogleMapsReady";

type MapsWindow = Window & { [CALLBACK]?: () => void };

export function loadGoogleMaps(key: string): Promise<GoogleMapsLib> {
  if (typeof window === "undefined") return Promise.reject(new Error("Google Maps loads in the browser only"));
  const have = window.google?.maps?.importLibrary;
  if (have) return libraries(have);
  if (pending) return pending;
  pending = new Promise<GoogleMapsLib>((resolve, reject) => {
    const w = window as MapsWindow;
    const fail = (why: string) => { pending = null; delete w[CALLBACK]; reject(new Error(why)); };
    // With loading=async the script's own onload fires before the API is in place: the
    // `callback` parameter is the documented ready signal, and importLibrary exists by then.
    w[CALLBACK] = () => {
      delete w[CALLBACK];
      const lib = window.google?.maps?.importLibrary;
      if (!lib) { fail("Google Maps loaded without importLibrary"); return; }
      libraries(lib).then(resolve, (e: unknown) => fail(e instanceof Error ? e.message : String(e)));
    };
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&region=AU&language=en-AU&callback=${CALLBACK}`;
    s.async = true;
    s.onerror = () => fail("The Google Maps script could not be loaded — check the key's website restriction includes this address.");
    document.head.appendChild(s);
  });
  return pending;
}
