"use client";

import { useState, type ReactNode } from "react";
import { trackProgressPreview } from "@/lib/progress-preview/track";

/**
 * The way in to the live-progress phone (Tom, 20 Sep: "move the phone demo
 * so it is always fixed in 'A few extra details' as its only tab which can be
 * clicked on — make it stand out and glow"). One glowing card in the
 * presentation's capability panel; the phone is mounted only once it is
 * pressed, so nothing plays until the customer asks, and it starts the moment
 * it is on screen (the phone's own 40 %-in-view rule). Pressing again closes it.
 *
 * `children` is the server-rendered ProgressSection / ProgressPhone. The
 * card is the only entry point: the hero button and the step-4 link are gone.
 */
export default function LiveUpdatesCard({ children, token = null, set = null }: {
  children: ReactNode;
  token?: string | null;
  set?: "residential" | "commercial" | null;
}) {
  const [open, setOpen] = useState(false);
  const toggle = () => {
    setOpen((o) => {
      if (!o && set) trackProgressPreview(token, "cta_clicked", set);
      return !o;
    });
  };
  return (
    <>
      <button type="button" className="cap cap-live print-hide" aria-expanded={open} aria-controls="live-progress" onClick={toggle} data-testid="live-updates-tab">
        <h3><i>📱</i> Receive live on-the-job updates as your job progresses</h3>
        <p>Click here to see a demo of your live updates.</p>
        <span className="cap-live-cta">{open ? "▲ Hide the demo" : "▶ Show me the demo"}</span>
      </button>
      {open && <div className="cap-live-panel" data-testid="live-updates-panel">{children}</div>}
    </>
  );
}
