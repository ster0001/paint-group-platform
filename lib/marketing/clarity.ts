/**
 * Microsoft Clarity — the one place its tag is injected, and only ever
 * after "Allow analytics" (Tom, 4 Sep: never before consent under any
 * condition). The project id is NEXT_PUBLIC_CLARITY_ID; without it nothing
 * loads and the page says so in dev. ⚑9.7 if Tom prefers PostHog.
 */
export const CLARITY_ID = process.env.NEXT_PUBLIC_CLARITY_ID ?? "";
export const CLARITY_SCRIPT_PREFIX = "https://www.clarity.ms/tag/";

type ClarityQueue = ((...args: unknown[]) => void) & { q?: unknown[][] };

export function clarityLoaded(): boolean {
  return typeof document !== "undefined" && Boolean(document.querySelector(`script[src^="${CLARITY_SCRIPT_PREFIX}"]`));
}

/** Idempotent. Returns "loaded" | "already" | "unconfigured". */
export function loadClarity(): "loaded" | "already" | "unconfigured" {
  if (typeof window === "undefined") return "unconfigured";
  if (!CLARITY_ID) {
    if (process.env.NODE_ENV !== "production") console.debug("[clarity] NEXT_PUBLIC_CLARITY_ID not set — not loading");
    return "unconfigured";
  }
  if (clarityLoaded()) return "already";
  const w = window as Window & { clarity?: ClarityQueue };
  if (typeof w.clarity !== "function") {
    const q: ClarityQueue = function (...args: unknown[]) { (q.q = q.q ?? []).push(args); };
    w.clarity = q;
  }
  const s = document.createElement("script");
  s.async = true;
  s.src = `${CLARITY_SCRIPT_PREFIX}${encodeURIComponent(CLARITY_ID)}`;
  s.setAttribute("data-consent", "analytics");
  document.head.appendChild(s);
  return "loaded";
}
