"use client";

import { useState, type ReactNode } from "react";

/**
 * Session 3 · The property screen's four panes (mockup: Progress · Colours ·
 * Money · Documents). Panes arrive fully rendered from the server; this only
 * switches which one shows.
 */
const TABS = ["Progress", "Colours", "Money", "Documents"] as const;

export default function PropertyTabs({ progress, colours, money, documents, initialTab }: {
  progress: ReactNode; colours: ReactNode; money: ReactNode; documents: ReactNode;
  /** ?tab= deep links (the colour card PDF's touch-up link lands on Colours). */
  initialTab?: string;
}) {
  const initial = TABS.find((t) => t.toLowerCase() === initialTab?.toLowerCase()) ?? "Progress";
  const [on, setOn] = useState<(typeof TABS)[number]>(initial);
  const panes = { Progress: progress, Colours: colours, Money: money, Documents: documents };
  return (
    <>
      <div className="ptabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={on === t}
            className={on === t ? "on" : ""} onClick={() => setOn(t)} data-testid={`ptab-${t.toLowerCase()}`}>
            {t}
          </button>
        ))}
      </div>
      {TABS.map((t) => (
        <div key={t} className={`pane ${on === t ? "on" : ""}`} data-testid={`pane-${t.toLowerCase()}`}>
          {panes[t]}
        </div>
      ))}
    </>
  );
}
