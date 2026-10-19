"use client";

import type { BoardZoom } from "./useBoardZoom";

/** Back / Today / Next. */
export function Paging({ zoom }: { zoom: BoardZoom }) {
  return (
    <div className="seg">
      <button onClick={zoom.back}>‹ Back</button>
      <button onClick={zoom.toToday}>Today</button>
      <button onClick={zoom.next}>Next ›</button>
    </div>
  );
}

/** Jump anywhere — Back/Next alone can't reach a job three months out. */
export function JumpTo({ zoom, label = "Jump to" }: { zoom: BoardZoom; label?: string }) {
  return (
    <label className="ctrl-lab" style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {label}
      <input type="date" value={zoom.start} onChange={(e) => e.target.value && zoom.setStart(e.target.value)} />
    </label>
  );
}

/** 2w / 4w / 8w — fit-to-range, not stretch (see useBoardZoom.fitRange). */
export function RangePresets({ zoom }: { zoom: BoardZoom }) {
  return (
    <div className="seg">
      {zoom.presets.map((n) => (
        <button key={n} className={zoom.range === n ? "on" : ""} onClick={() => zoom.fitRange(n)}>
          {n / 7}w
        </button>
      ))}
    </div>
  );
}

const zoomBtn = { padding: "4px 8px", background: "none", border: "1px solid var(--line)", color: "var(--muted)", borderRadius: 8, cursor: "pointer" } as const;

/** The zoom slider with ± either side. Blocks animate because they're positioned off --day-w rather than laid out by the grid. */
export function ZoomSlider({ zoom, label = "Zoom" }: { zoom: BoardZoom; label?: string }) {
  return (
    <div className="zoom">
      <span className="ctrl-lab">{label}</span>
      <button className="seg" style={zoomBtn} onClick={zoom.zoomOut}>−</button>
      <input type="range" min={zoom.minDayW} max={zoom.maxDayW} step={4} value={zoom.dayW} onChange={(e) => zoom.setDayW(Number(e.target.value))} />
      <button className="seg" style={zoomBtn} onClick={zoom.zoomIn}>+</button>
    </div>
  );
}
