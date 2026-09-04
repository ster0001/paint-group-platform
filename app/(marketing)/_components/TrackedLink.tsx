"use client";

import type { AnchorHTMLAttributes } from "react";
import { track, type MarketingEventName, type TrackProps } from "@/lib/analytics";

/** An anchor that fires one analytics event on click (brief §5). */
export default function TrackedLink({
  ev, evProps, onClick, children, ...rest
}: { ev: MarketingEventName; evProps?: TrackProps } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      data-ev={ev}
      onClick={(e) => { track(ev, evProps); onClick?.(e); }}
      {...rest}
    >
      {children}
    </a>
  );
}
