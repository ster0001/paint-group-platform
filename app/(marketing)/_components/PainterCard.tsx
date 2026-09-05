"use client";

import Image from "next/image";
import { track } from "@/lib/analytics";
import { showcaseMediaUrl } from "@/lib/showcase/format";

/** §4.9 — photo, name, specialty, `with Paint Group since YYYY`. No ratings, no job counts. */
export default function PainterCard({ n, name, meta, quote, photoPath = null, placeholder = false }: {
  n: number; name: string; meta: string; quote: string; photoPath?: string | null; placeholder?: boolean;
}) {
  return (
    <div className="pc" data-ev="painter_card" data-todo={placeholder ? "9.3" : undefined} onClick={() => track("painter_card", { n })} role="presentation">
      <span className="av" aria-hidden="true">
        {photoPath && <Image src={showcaseMediaUrl(photoPath)} alt="" width={64} height={64} className="av-img" />}
      </span>
      <b>{name}</b><span className="meta">{meta}</span>{quote && <q>{quote}</q>}
    </div>
  );
}
