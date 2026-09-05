"use client";

import { track } from "@/lib/analytics";
import type { FaqEntry } from "@/lib/marketing/faq";
import Md from "./Md";

/** §4.12 — eight <details>; several may be open at once (people compare answers). `faq_open` carries the index. */
export default function FaqList({ entries }: { entries: FaqEntry[] }) {
  return (
    <div className="faq" data-testid="faq">
      {entries.map((f, i) => (
        <details key={f.q} onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) track("faq_open", { index: i }); }}>
          <summary data-ev="faq_open">{f.q}</summary>
          <Md src={f.a} />
        </details>
      ))}
    </div>
  );
}
