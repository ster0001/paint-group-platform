"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import type { Audience } from "@/lib/marketing/audience";
import { captureTouch } from "@/lib/crm/attributionClient";

/**
 * Session 8 §2 — the audience, decided per request by the proxy and handed
 * to the page as a prop (no cookie, no client switching). `wizardOrigin` is
 * the residential origin the wizard hand-off must use when the business
 * site runs on its own domain (⚑ D2: hand off, never duplicate the wizard);
 * empty on the residential host. The document carries data-audience so
 * lib/analytics can stamp every event (§7).
 */
type Ctx = { audience: Audience; wizardOrigin: string };
const AudienceContext = createContext<Ctx>({ audience: "home", wizardOrigin: "" });

export function AudienceProvider({ audience, wizardOrigin = "", children }: { audience: Audience; wizardOrigin?: string; children: ReactNode }) {
  useEffect(() => { document.documentElement.dataset.audience = audience; }, [audience]);
  // The first touch is recorded HERE, on the landing page, so an ad that
  // lands on the homepage keeps its source when the visitor moves on to the
  // wizard days later (same origin; across domains the hand-off URL carries
  // the tags). Writes itself only once; never throws.
  useEffect(() => { captureTouch(); }, []);
  return <AudienceContext.Provider value={{ audience, wizardOrigin }}>{children}</AudienceContext.Provider>;
}

export function useAudience(): Ctx {
  return useContext(AudienceContext);
}
