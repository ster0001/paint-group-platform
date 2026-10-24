"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import type { Audience } from "@/lib/marketing/audience";
import { BRAND_DEFAULTS, brandView, type BrandView } from "@/lib/marketing/brand";
import { captureTouch } from "@/lib/crm/attributionClient";

/**
 * Session 8 §2 — the audience, decided per request by the proxy and handed
 * to the page as a prop (no cookie, no client switching). `wizardOrigin` is
 * the residential origin the wizard hand-off must use when the business
 * site runs on its own domain (⚑ D2: hand off, never duplicate the wizard);
 * empty on the residential host. The document carries data-audience so
 * lib/analytics can stamp every event (§7).
 *
 * Paint Home brief §3: `brand` is the shopfront's record (lib/marketing/
 * brand.ts) as a client component needs it — the phone link and the
 * hand-off tag. Defaults to the audience's brand, so a page that never set
 * it behaves as before.
 */
type Ctx = { audience: Audience; wizardOrigin: string; brand: BrandView };
const AudienceContext = createContext<Ctx>({ audience: "home", wizardOrigin: "", brand: brandView(BRAND_DEFAULTS.paintgroup) });

export function AudienceProvider({ audience, wizardOrigin = "", brand, children }: { audience: Audience; wizardOrigin?: string; brand?: BrandView; children: ReactNode }) {
  useEffect(() => { document.documentElement.dataset.audience = audience; }, [audience]);
  // The first touch is recorded HERE, on the landing page, so an ad that
  // lands on the homepage keeps its source when the visitor moves on to the
  // wizard days later (same origin; across domains the hand-off URL carries
  // the tags). Writes itself only once; never throws.
  useEffect(() => { captureTouch(); }, []);
  const b = brand ?? brandView(BRAND_DEFAULTS[audience === "painthome" ? "painthome" : "paintgroup"]);
  return <AudienceContext.Provider value={{ audience, wizardOrigin, brand: b }}>{children}</AudienceContext.Provider>;
}

export function useAudience(): Ctx {
  return useContext(AudienceContext);
}
