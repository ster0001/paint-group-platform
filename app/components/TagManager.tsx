"use client";

import { useEffect } from "react";
import { parseConsent } from "@/lib/marketing/consent";
import { CONSENT_CHANGED_EVENT } from "@/lib/marketing/consentEvents";
import { gtmIdFor, loadGtm } from "@/lib/marketing/gtm";

/**
 * Mounted once in the root layout so every page on painthome.com.au — the
 * homepage, the wizard, the thanks pages — carries the Tag Manager container,
 * and only after "Allow analytics" (lib/marketing/gtm.ts). Renders nothing.
 */
export default function TagManager() {
  useEffect(() => {
    const tryLoad = () => {
      if (parseConsent(document.cookie) !== "analytics") return;
      const id = gtmIdFor({ host: location.host, audience: document.documentElement.dataset.audience });
      if (id) loadGtm(id);
    };
    // Next tick: the audience attribute is set by AudienceProvider's own effect.
    const t = window.setTimeout(tryLoad, 0);
    window.addEventListener(CONSENT_CHANGED_EVENT, tryLoad);
    return () => { window.clearTimeout(t); window.removeEventListener(CONSENT_CHANGED_EVENT, tryLoad); };
  }, []);
  return null;
}
