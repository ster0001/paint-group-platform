"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { showcaseMediaUrl } from "@/lib/showcase/format";
import type { GalleryKind } from "@/lib/showcase/schema";

type Item = { path: string; caption: string; kind: GalleryKind };

/**
 * §4.4c block 4 — before/during/after photos in a masonry grid, the kind as
 * a small tag; tap opens a lightbox with captions and keyboard navigation
 * (← → Escape), focus returned to the thumbnail on close.
 */
export default function Gallery({ items, title }: { items: Item[]; title: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const lastThumb = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => {
    setOpen(null);
    lastThumb.current?.focus();
  }, []);
  const step = useCallback((d: number) => {
    setOpen((i) => (i == null ? i : (i + d + items.length) % items.length));
  }, [items.length]);

  useEffect(() => {
    if (open == null) return;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close, step]);

  if (items.length === 0) return null;
  const current = open != null ? items[open] : null;

  return (
    <>
      <div className="pp-gallery">
        {items.map((it, i) => (
          <button
            key={`${it.path}-${i}`} type="button" className="pp-thumb"
            aria-label={`${it.kind}${it.caption ? `: ${it.caption}` : ""} — open photo ${i + 1} of ${items.length}`}
            onClick={(e) => { lastThumb.current = e.currentTarget; setOpen(i); }}
          >
            <Image src={showcaseMediaUrl(it.path)} alt={it.caption || `${title} — ${it.kind}`} width={800} height={600} sizes="(min-width: 960px) 33vw, 50vw" />
            <span className="pp-tag mono">{it.kind}</span>
          </button>
        ))}
      </div>

      {current && open != null && (
        <div
          ref={dialogRef} className="pp-lightbox" role="dialog" aria-modal="true" tabIndex={-1}
          aria-label={`Photo ${open + 1} of ${items.length}`}
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}
        >
          <div className="pp-lightbox-body">
            <Image src={showcaseMediaUrl(current.path)} alt={current.caption || `${title} — ${current.kind}`} width={1600} height={1200} sizes="100vw" priority />
            <div className="pp-lightbox-bar">
              <span className="mono">{current.kind}</span>
              <span>{current.caption}</span>
              <span className="mono">{open + 1} / {items.length}</span>
            </div>
          </div>
          <button type="button" className="pp-lb-btn pp-lb-prev" aria-label="Previous photo" onClick={() => step(-1)}>‹</button>
          <button type="button" className="pp-lb-btn pp-lb-next" aria-label="Next photo" onClick={() => step(1)}>›</button>
          <button type="button" className="pp-lb-btn pp-lb-close" aria-label="Close" onClick={close}>×</button>
        </div>
      )}
    </>
  );
}
