"use client";

import { FAQS } from "@/lib/marketing/faq";
import { track } from "@/lib/analytics";

/** §4.12 — eight <details>; several may be open at once (people compare answers). `faq_open` carries the index. */
export default function FaqList() {
  return (
    <div className="faq" data-testid="faq">
      {FAQS.map((f, i) => (
        <details key={f.q} onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) track("faq_open", { index: i }); }}>
          <summary data-ev="faq_open">{f.q}</summary>
          <p>{f.a}</p>
        </details>
      ))}
    </div>
  );
}
