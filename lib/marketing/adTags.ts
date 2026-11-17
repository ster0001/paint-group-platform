/**
 * The ad platforms' tags, on the success pages only (Tom, 17 Nov 2026):
 * the Meta pixel and the Google tag (gtag.js — Google Ads and Analytics), so
 * "URL contains /thanks/…" counts a conversion. Like Clarity
 * (lib/marketing/clarity.ts), they load only after "Allow analytics" — never
 * before, under any condition — and only when their ids are set in the
 * environment (per brand: …_PAINTHOME). Unset = nothing loads.
 */
export type AdTagIds = { metaPixelId: string; googleTagId: string };

export function adTagIdsFor(audience: string | null | undefined): AdTagIds {
  const ph = audience === "painthome";
  return {
    metaPixelId: (ph ? process.env.NEXT_PUBLIC_META_PIXEL_ID_PAINTHOME : process.env.NEXT_PUBLIC_META_PIXEL_ID) ?? "",
    googleTagId: (ph ? process.env.NEXT_PUBLIC_GOOGLE_TAG_ID_PAINTHOME : process.env.NEXT_PUBLIC_GOOGLE_TAG_ID) ?? "",
  };
}

const ID = /^[A-Za-z0-9-]{4,40}$/;

type Fbq = ((...args: unknown[]) => void) & { queue?: unknown[]; loaded?: boolean; version?: string; push?: unknown };

/** Idempotent. Loads each configured tag once and fires its page view. */
export function loadAdTags(ids: AdTagIds): { meta: boolean; google: boolean } {
  if (typeof window === "undefined") return { meta: false, google: false };
  const out = { meta: false, google: false };
  const w = window as Window & { fbq?: Fbq; _fbq?: Fbq; dataLayer?: unknown[]; gtag?: (...a: unknown[]) => void };
  if (ID.test(ids.metaPixelId) && !document.querySelector('script[src*="connect.facebook.net"]')) {
    const q: Fbq = function (...args: unknown[]) { (q.queue = q.queue ?? []).push(args); };
    q.loaded = true; q.version = "2.0";
    w.fbq = w.fbq ?? q; w._fbq = w._fbq ?? w.fbq;
    const s = document.createElement("script");
    s.async = true; s.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(s);
    w.fbq!("init", ids.metaPixelId);
    w.fbq!("track", "PageView");
    out.meta = true;
  }
  if (ID.test(ids.googleTagId) && !document.querySelector('script[src*="googletagmanager.com/gtag/js"]')) {
    w.dataLayer = w.dataLayer ?? [];
    w.gtag = w.gtag ?? function (...a: unknown[]) { w.dataLayer!.push(a); };
    const s = document.createElement("script");
    s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ids.googleTagId)}`;
    document.head.appendChild(s);
    w.gtag("js", new Date());
    w.gtag("config", ids.googleTagId);
    out.google = true;
  }
  return out;
}
