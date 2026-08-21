"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  /** Tom, 21 Aug: "make the floorplan view bigger." The pinned column is
   * wider now, but a column is still a column — this opens the same zoomable
   * viewer over the whole page, which is what you want when you are reading
   * a room off the plan rather than glancing at it. */
  const [full, setFull] = useState(false);
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
  // Escape closes the full-screen plan — it covers the page, so there has to
  // be a way out that isn't hunting for the button.
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFull(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

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

  // ONE full-screen plan for both variants — rendered by whichever variant is
  // actually on screen at this breakpoint (the other is display:none, and a
  // fixed overlay inside a hidden ancestor would never show).
  //
  // PORTALLED TO document.body, and this is not decoration. Rendered in place
  // it sat UNDERNEATH the frozen header and the sticky footer despite a
  // higher z-index — measured with elementFromPoint: .sc-freeze was on top at
  // the header, .sc-row at the footer — so the ✕ CLOSE control was covered
  // and Escape was the only way out. A page-level overlay belongs at the page
  // level.
  const fullScreen = full && docs.plan
    ? createPortal(
        <div className="wz">
          {/* Clicking the backdrop closes; clicking the plan itself must not,
              because that is the pan gesture. */}
          <div className="pp-full" onClick={(e) => { if (e.target === e.currentTarget) setFull(false); }}>
            <PlanViewer
              src={docs.plan.url}
              title={docs.plan.label.toUpperCase()}
              note="PINCH OR USE + TO ZOOM"
              onClose={() => setFull(false)}
            />
          </div>
        </div>,
        document.body,
      )
    : null;

  if (variant === "column") {
    return (
      <aside className="pp-side">
        {docs.plan && (
          <PlanViewer
            src={docs.plan.url}
            title={docs.plan.label.toUpperCase()}
            note="AS YOU UPLOADED IT"
            onExpand={() => setFull(true)}
          />
        )}
        {strip}
        {fullScreen}
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
            {docs.plan && (
              <PlanViewer
                src={docs.plan.url}
                title={docs.plan.label.toUpperCase()}
                note="PINCH OR USE + TO ZOOM"
                onExpand={() => setFull(true)}
              />
            )}
            {strip}
          </div>
        )}
      </div>

      {fullScreen}
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </>
  );
}

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  // Same reason as the full-screen plan: an overlay rendered inside the
  // sticky side column loses to the frozen header and footer.
  return createPortal(
    <div className="wz">
      <div className="pp-lightbox" onClick={onClose} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Escape" || e.key === "Enter") onClose(); }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="Photo on file" />
        <span>Tap anywhere to close</span>
      </div>
    </div>,
    document.body,
  );
}
