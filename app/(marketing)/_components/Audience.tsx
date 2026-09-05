"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import type { Audience } from "@/lib/marketing/audience";

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
  return <AudienceContext.Provider value={{ audience, wizardOrigin }}>{children}</AudienceContext.Provider>;
}

export function useAudience(): Ctx {
  return useContext(AudienceContext);
}
