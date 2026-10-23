"use client";

import type { AnchorHTMLAttributes, ReactNode } from "react";
import { track } from "@/lib/analytics";
import { useAudience } from "./Audience";

/**
 * Every phone link on the site: one `tel:` target, one `call_tap` event
 * with where it was tapped (§5). The number is the BRAND's (lib/marketing/
 * brand.ts, through AudienceProvider) — Paint Group's by default, and for
 * launch Paint Home's too (⚑ P10).
 */
export default function TelLink({
  where, children, ...rest
}: { where: string; children: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const { brand } = useAudience();
  return (
    <a href={brand.phoneTel} data-ev="call_tap" onClick={() => track("call_tap", { where })} {...rest}>
      {children}
    </a>
  );
}
