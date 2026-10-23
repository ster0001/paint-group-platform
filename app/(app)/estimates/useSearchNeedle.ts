"use client";

import { useSearchParams } from "next/navigation";

/**
 * The one needle the Estimates page filters by: `?q=`, trimmed. Read from the
 * URL on the server's first paint and after every `history.replaceState` the
 * search box makes, so the box and the three tab tables never disagree.
 */
export function useSearchNeedle(): string {
  const params = useSearchParams();
  return (params.get("q") ?? "").trim();
}

/** The `?q=` line the search box writes — other params kept, `q` set or dropped. */
export function hrefWithNeedle(params: URLSearchParams, next: string): string {
  const p = new URLSearchParams(params.toString());
  const t = next.trim();
  if (t) p.set("q", t); else p.delete("q");
  const qs = p.toString();
  return `/estimates${qs ? `?${qs}` : ""}`;
}
