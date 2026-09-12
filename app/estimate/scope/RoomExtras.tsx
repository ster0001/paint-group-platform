"use client";

import { useState } from "react";

/**
 * C10 — "Extras in this room" (prototype `s-room`): feature walls counted
 * per room, wallpaper to strip, something else. None is priced from here —
 * each is a review line pinned to the room (lib/wizard/room-extras.ts), and
 * the card says so. Optimistic: the count moves the moment it is tapped; the
 * server's answer replaces it on the next response.
 */
export default function RoomExtras({ areaId, view, busy, onExtra }: {
  areaId: number;
  view: { featureWalls: number; wallpaper: boolean; other: string };
  busy?: boolean;
  onExtra: (kind: "feature_wall" | "wallpaper" | "other", value: { count?: number; on?: boolean; text?: string }) => void;
}) {
  const [otherOpen, setOtherOpen] = useState(view.other !== "");
  const [otherText, setOtherText] = useState(view.other);
  return (
    <div className="sc-extras" data-testid={`room-extras-${areaId}`}>
      <p className="il-ql">Extras in this room <span className="wz-opt">OPTIONAL</span></p>
      <div className="sc-extra-row">
        <div>
          <b>Feature wall</b>
          <span>A different colour on one wall — priced as its own colour</span>
        </div>
        <span className="sc-st">
          <button aria-label="fewer feature walls" disabled={busy || view.featureWalls === 0} onClick={() => onExtra("feature_wall", { count: view.featureWalls - 1 })}>−</button>
          <b data-testid={`room-feature-walls-${areaId}`}>{view.featureWalls}</b>
          <button aria-label="more feature walls" disabled={busy || view.featureWalls >= 6} onClick={() => onExtra("feature_wall", { count: view.featureWalls + 1 })}>+</button>
        </span>
      </div>
      <div className="sc-extra-row">
        <div><b>Wallpaper to strip first</b></div>
        <div className="sc-chips">
          <button className={`sd-chip il-chip ${view.wallpaper ? "on" : ""}`} aria-pressed={view.wallpaper} disabled={busy} data-testid={`room-wallpaper-${areaId}-yes`} onClick={() => onExtra("wallpaper", { on: true })}>Yes</button>
          <button className={`sd-chip il-chip ${!view.wallpaper ? "on" : ""}`} aria-pressed={!view.wallpaper} disabled={busy} data-testid={`room-wallpaper-${areaId}-no`} onClick={() => onExtra("wallpaper", { on: false })}>No</button>
        </div>
      </div>
      <div className="sc-extra-row">
        <div><b>Something else in here?</b></div>
        {otherOpen ? (
          <div className="sd-mrow" style={{ display: "flex", gap: 8 }}>
            <input style={{ flex: 1, width: "auto", minWidth: 160 }} placeholder="Name it — e.g. ceiling rose" maxLength={120}
              value={otherText} onChange={(e) => setOtherText(e.target.value)} data-testid={`room-other-${areaId}`}
              onKeyDown={(e) => { if (e.key === "Enter") onExtra("other", { text: otherText }); }} />
            <button className="sd-chip" disabled={busy} onClick={() => onExtra("other", { text: otherText })}>Add</button>
          </div>
        ) : (
          <button className="sd-chip il-chip" onClick={() => setOtherOpen(true)}>Name it</button>
        )}
      </div>
      {(view.featureWalls > 0 || view.wallpaper || view.other) && (
        <p className="sc-inc" data-testid={`room-extras-note-${areaId}`}>A person prices these — they&rsquo;re on your estimate as lines to confirm, not a guess.</p>
      )}
      <p className="wz-chint">Not sure? Leave it — the estimator checks in a minute when they&rsquo;re there.</p>
    </div>
  );
}
