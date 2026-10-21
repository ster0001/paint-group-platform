"use client";

import { useEffect, useState } from "react";

const KEY = "pg:movements:how-it-works";

/**
 * The three-sentence strip (brief §3.4): open on the first visit per browser, collapsed
 * after. The strip IS the training script, so its words are also the first paragraph of
 * docs/help/movements/pc.md. localStorage behind try/catch — a browser that blocks it just
 * sees the strip open every time.
 */
export default function HowItWorks({ hourlyNames }: { hourlyNames: string[] }) {
  // Closed on the server render; the effect opens it when this browser has not seen it.
  // Opening in an effect rather than reading storage during render keeps the HTML the
  // server sent and the first client render identical.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let seen = false;
    try { seen = window.localStorage.getItem(KEY) === "1"; } catch { /* blocked: open every time */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- storage is only readable on the client
    if (!seen) setOpen(true);
  }, []);
  const hourly = hourlyNames.length ? `${hourlyNames.join("'s and ")}'s lanes are in hours.` : "Hourly lanes are set in Settings → Movements.";
  return (
    <details
      className="how"
      data-testid="how-it-works"
      open={open}
      onToggle={(e) => {
        const now = (e.currentTarget as HTMLDetailsElement).open;
        setOpen(now);
        if (!now) { try { window.localStorage.setItem(KEY, "1"); } catch { /* ignore */ } }
      }}
    >
      <summary>How this tab works · 30 seconds</summary>
      <ol>
        <li><b>The tray is everything that has to move</b> this week — paint per brand, materials per line, gear, rubbish — built from the jobs. Amber = not yet planned. Anything can also be added from scratch.</li>
        <li><b>Drag a chip onto a person&rsquo;s day.</b> Supplier lane = delivered (you place the order). A painter&rsquo;s lane = they pick it up or move it. {hourly} Tick <b>Ordered</b> and the painter is told.</li>
        <li><b>Nearby</b> on a day means there are chips close to where that person already is. Tap a <b>While you&rsquo;re there</b> suggestion to drop it; open any chip for its shop, time and note.</li>
      </ol>
    </details>
  );
}
