import { isPaintHomeHost } from "./audience";

/**
 * Google Tag Manager on the Paint Home website (Tom, 25 Nov 2026: container
 * GTM-MRW23TH). Like Clarity (./clarity.ts) and the ad tags (./adTags.ts) it
 * loads only after "Allow analytics" — never before, under any condition — so
 * there is no <noscript> iframe: that would load the container without a
 * consent choice. Paint Group has no container: its pages load nothing here.
 *
 * A container id is public (it is in every page that loads it), so it lives
 * in code. NEXT_PUBLIC_GTM_ID_PAINTHOME overrides it (a second container for
 * a staging host); set it to "off" to switch the tag off without a deploy of
 * code.
 */
export const PAINTHOME_GTM_ID = "GTM-MRW23TH";
export const GTM_SCRIPT_PREFIX = "https://www.googletagmanager.com/gtm.js";

const ID = /^GTM-[A-Z0-9]{4,12}$/;

/** The container for this page, or "" for none. Paint Home's host, or a page that says it is Paint Home (the /painthome preview on a dev host). */
export function gtmIdFor(
  where: { host: string | null | undefined; audience: string | null | undefined },
  override: string | undefined = process.env.NEXT_PUBLIC_GTM_ID_PAINTHOME,
): string {
  const ph = isPaintHomeHost(where.host) || where.audience === "painthome";
  if (!ph) return "";
  const o = (override ?? "").trim();
  if (o.toLowerCase() === "off") return "";
  const id = o || PAINTHOME_GTM_ID;
  return ID.test(id) ? id : "";
}

/** Idempotent. Returns "loaded" | "already" | "unconfigured". Call only after "Allow analytics". */
export function loadGtm(id: string): "loaded" | "already" | "unconfigured" {
  if (typeof window === "undefined" || !ID.test(id)) return "unconfigured";
  if (document.querySelector(`script[src^="${GTM_SCRIPT_PREFIX}"]`)) return "already";
  const w = window as Window & { dataLayer?: unknown[] };
  w.dataLayer = w.dataLayer ?? [];
  w.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
  const s = document.createElement("script");
  s.async = true;
  s.src = `${GTM_SCRIPT_PREFIX}?id=${encodeURIComponent(id)}`;
  s.setAttribute("data-consent", "analytics");
  document.head.appendChild(s);
  return "loaded";
}
