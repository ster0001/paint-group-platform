import "server-only";
import { headers } from "next/headers";

/**
 * The origin we put in links we EMAIL to customers.
 *
 * Never the request's `Origin` header first. That header is set by whoever
 * made the request, so a caller who can invoke a server action (a painter
 * signing on-device, or anyone holding a walkthrough session token) could
 * have the customer emailed a link to a host they control — carrying the
 * customer's own sign-off token in the path (18 Sep security audit).
 *
 * Order: the configured site URL, then the platform's forwarded host (set by
 * Vercel, not the caller), then a fixed fallback. `Origin` is never consulted.
 */
export async function trustedOrigin(): Promise<string> {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host && /^[A-Za-z0-9.-]+(:\d+)?$/.test(host)) {
    const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  }
  return "https://paint-group-platform.vercel.app";
}
