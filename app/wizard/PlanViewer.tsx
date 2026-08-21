"use client";

import { useRef, useState } from "react";

/**
 * The pinned floorplan, zoomable and pannable — a marketing plan at the pinned
 * size is too small to read while working. Zoom with the +/− controls, the
 * wheel, or a slider; drag to pan when zoomed in. No dependencies: a CSS
 * transform inside an overflow-hidden frame.
 */
export default function PlanViewer({ src, title = "THE FLOORPLAN", note = "AS UPLOADED", onExpand, onClose }: {
  src: string;
  title?: string;
  note?: string;
  /** Renders the "open it bigger" control in the header (Tom, 21 Aug).
   * The pinned column is only ever as wide as the column; a plan you are
   * reading room dimensions off wants the whole screen. */
  onExpand?: () => void;
  /** Renders the close control instead — used by the full-screen copy. */
  onClose?: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const clampZoom = (z: number) => Math.min(5, Math.max(1, Math.round(z * 20) / 20));
  const setZ = (z: number) => {
    const nz = clampZoom(z);
    setZoom(nz);
    if (nz === 1) setPan({ x: 0, y: 0 }); // snap back to centred at 1×
  };

  return (
    <div className="wz-planbox">
      <div className="wz-t">
        <span>{title}</span>
        <span className="wz-planacts">
          {note}
          {onExpand && (
            <button type="button" className="wz-planfs" onClick={onExpand} aria-label="Open the plan full screen">
              ⤢ BIGGER
            </button>
          )}
          {onClose && (
            <button type="button" className="wz-planfs" onClick={onClose} aria-label="Close the full-screen plan">
              ✕ CLOSE
            </button>
          )}
        </span>
      </div>
      <div
        className="wz-planframe"
        onWheel={(e) => { if (e.ctrlKey || e.metaKey || zoom > 1) { e.preventDefault(); setZ(zoom - e.deltaY * 0.002); } }}
        onPointerDown={(e) => {
          if (zoom <= 1) return;
          drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
          setDragging(true);
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          setPan({ x: drag.current.px + (e.clientX - drag.current.x), y: drag.current.py + (e.clientY - drag.current.y) });
        }}
        onPointerUp={() => { drag.current = null; setDragging(false); }}
        style={{ cursor: zoom > 1 ? (dragging ? "grabbing" : "grab") : "default" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt="Uploaded floorplan"
          draggable={false}
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "center center" }}
        />
      </div>
      <div className="wz-planzoom">
        <button type="button" onClick={() => setZ(zoom - 0.5)} aria-label="Zoom out">−</button>
        <input
          type="range" min={1} max={5} step={0.05} value={zoom}
          onChange={(e) => setZ(Number(e.target.value))}
          aria-label="Zoom"
        />
        <button type="button" onClick={() => setZ(zoom + 0.5)} aria-label="Zoom in">+</button>
        <span className="wz-planpct">{Math.round(zoom * 100)}%</span>
        {zoom > 1 && <button type="button" className="wz-planreset" onClick={() => setZ(1)}>reset</button>}
      </div>
    </div>
  );
}
