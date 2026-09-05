"use client";

import type { AnchorHTMLAttributes, ReactNode } from "react";
import { track } from "@/lib/analytics";
import { PHONE_TEL } from "@/lib/marketing/site";

/**
 * Every phone link on the site: one `tel:` target, one `call_tap` event
 * with where it was tapped (§5). The number lives in lib/marketing/site.ts.
 */
export default function TelLink({
  where, children, ...rest
}: { where: string; children: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return (
    <a href={PHONE_TEL} data-ev="call_tap" onClick={() => track("call_tap", { where })} {...rest}>
      {children}
    </a>
  );
}
