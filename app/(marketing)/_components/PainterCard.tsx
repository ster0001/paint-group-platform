"use client";

import { track } from "@/lib/analytics";

/** §4.9 — photo, name, specialty, `with Paint Group since YYYY`. No ratings, no job counts. */
export default function PainterCard({ n, name, meta, quote }: { n: number; name: string; meta: string; quote: string }) {
  return (
    <div className="pc" data-ev="painter_card" data-todo="9.3" onClick={() => track("painter_card", { n })} role="presentation">
      <span className="av" aria-hidden="true" /><b>{name}</b><span className="meta">{meta}</span><q>{quote}</q>
    </div>
  );
}
