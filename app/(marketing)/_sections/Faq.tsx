import FaqList from "../_components/FaqList";
import type { FaqEntry } from "@/lib/marketing/faq";

/** §4.12 — the questions people ask before they type their address. Copy from site content (session 8). */
export default function Faq({ h2, entries }: { h2: string; entries: FaqEntry[] }) {
  return (
    <section className="sec light warm" id="faq">
      <div className="wrap">
        <h2>{h2}</h2>
        <FaqList entries={entries} />
      </div>
    </section>
  );
}
