"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

/** A thumbnail that opens full size (Tom, 5 Sep: the variation card's photos). Esc or a tap outside closes; focus returns. */
export default function PhotoZoom({ src, alt, width, height, className }: { src: string; alt: string; width: number; height: number; className?: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  useEffect(() => { if (!open) btn.current?.focus({ preventScroll: true }); }, [open]);
  return (
    <>
      <button ref={btn} type="button" className={className} onClick={() => setOpen(true)} aria-label={`${alt} — open full size`}>
        <Image src={src} alt={alt} width={width} height={height} style={{ objectFit: "cover", width: "100%", height: "100%" }} />
      </button>
      {open && (
        <div className="pp-lightbox" role="dialog" aria-modal="true" aria-label={alt} onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="pp-lightbox-body">
            <Image src={src} alt={alt} width={1600} height={1200} sizes="100vw" priority />
          </div>
          <button type="button" className="pp-lb-btn pp-lb-close" aria-label="Close" onClick={() => setOpen(false)}>×</button>
        </div>
      )}
    </>
  );
}
