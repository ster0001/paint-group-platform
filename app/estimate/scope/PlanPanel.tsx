"use client";

import { useEffect, useRef, useState } from "react";
import PlanViewer from "@/app/wizard/PlanViewer";
import type { EstimateDocuments } from "@/lib/wizard/documents";

/**
 * R5: the customer's own plan and photos, pinned beside the confirm loop.
 *
 * "Please ensure it always shows while click into the rooms and scrolling"
 * (Tom, 20 Aug). On a desktop that is a sticky side column — it simply never
 * leaves. On a phone there is no room for a permanent plan next to a
 * full-width card, so it becomes a pinned STRIP in the frozen header that
 * opens to the full zoomable viewer on tap and stays open until it's closed.
 * Either way the plan is one glance or one tap away at any scroll position,
 * which is the point: nobody can confirm a room size from memory.
 */
export default function PlanPanel({ docs, variant }: {
  docs: EstimateDocuments;
  /** "peek" rides INSIDE the frozen header (phones); "column" is the sticky
   * desktop side column. Each is hidden by CSS at the other breakpoint, so
   * both can be rendered and only one is ever on screen. */
  variant: "peek" | "column";
}) {
  const [openMobile, setOpenMobile] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const peekRef = useRef<HTMLDivElement>(null);
  // The phone's sheet is an overlay pinned below the frozen header, so it
  // needs to know how tall that header actually is — it varies with the
  // progress row and the job type, and a hardcoded offset would either
  // overlap the score or leave a gap.
  useEffect(() => {
    if (!openMobile) return;
    const set = () => {
      const top = peekRef.current?.getBoundingClientRect().bottom;
      if (top != null) document.documentElement.style.setProperty("--pp-top", `${Math.round(top)}px`);
    };
    set();
    window.addEventListener("resize", set);
    return () => window.removeEventListener("resize", set);
  }, [openMobile]);
  if (!docs.plan && docs.photos.length === 0) return null;

  const strip = docs.photos.length > 0 && (
    <div className="pp-strip">
      <p className="pp-t">ALSO ON FILE · {docs.photos.length} PHOTO{docs.photos.length > 1 ? "S" : ""}</p>
      <div className="pp-thumbs">
        {docs.photos.map((p) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={p.url} src={p.url} alt={p.label} title={p.label} onClick={() => setLightbox(p.url)} />
        ))}
      </div>
    </div>
  );

  if (variant === "column") {
    return (
      <aside className="pp-side">
        {docs.plan && <PlanViewer src={docs.plan.url} title={docs.plan.label.toUpperCase()} note="AS YOU UPLOADED IT" />}
        {strip}
        {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
      </aside>
    );
  }

  return (
    <>
      {/* Phone: the pinned strip, and the sheet it opens. */}
      <div className="pp-mobile" ref={peekRef}>
        <button className="pp-peek" onClick={() => setOpenMobile((v) => !v)} aria-expanded={openMobile}>
          {docs.plan && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={docs.plan.url} alt="" aria-hidden />
          )}
          <span>{openMobile ? "Hide the plan" : docs.plan ? "See your floorplan" : "See your photos"}</span>
          <i>{openMobile ? "▲" : "▼"}</i>
        </button>
        {openMobile && (
          <div className="pp-sheet">
            {docs.plan && <PlanViewer src={docs.plan.url} title={docs.plan.label.toUpperCase()} note="PINCH OR USE + TO ZOOM" />}
            {strip}
          </div>
        )}
      </div>

      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </>
  );
}

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div className="pp-lightbox" onClick={onClose} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Escape" || e.key === "Enter") onClose(); }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="Photo on file" />
      <span>Tap anywhere to close</span>
    </div>
  );
}
