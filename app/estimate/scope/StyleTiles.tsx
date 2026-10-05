"use client";
import type { ReactElement } from "react";

/** Tom, 14 Sep (items 14, 15): the door and window pictures from the old wizard, on the paginated questions. */
const DOOR: Record<"panel" | "flat", ReactElement> = {
  panel: <svg viewBox="0 0 60 64"><rect x="14" y="4" width="32" height="56" rx="2" fill="#D5DCE3" stroke="#B9C2CB" /><rect x="19" y="9" width="10" height="16" fill="#EEF2F5" stroke="#B9C2CB" /><rect x="31" y="9" width="10" height="16" fill="#EEF2F5" stroke="#B9C2CB" /><rect x="19" y="29" width="10" height="26" fill="#EEF2F5" stroke="#B9C2CB" /><rect x="31" y="29" width="10" height="26" fill="#EEF2F5" stroke="#B9C2CB" /></svg>,
  flat: <svg viewBox="0 0 60 64"><rect x="14" y="4" width="32" height="56" rx="2" fill="#D5DCE3" stroke="#B9C2CB" /><circle cx="41" cy="33" r="1.8" fill="#6B7A86" /></svg>,
};
export const WINDOW_DRAWINGS: Record<"casement" | "sash" | "colonial" | "winder", ReactElement> = {
  casement: <svg viewBox="0 0 60 64"><rect x="10" y="8" width="40" height="48" fill="#EEF2F5" stroke="#B9C2CB" /><line x1="30" y1="8" x2="30" y2="56" stroke="#B9C2CB" /><path d="M30 12 L46 32 L30 52" fill="none" stroke="#1F8A55" strokeDasharray="2 2" /></svg>,
  sash: <svg viewBox="0 0 60 64"><rect x="10" y="8" width="40" height="48" fill="#EEF2F5" stroke="#B9C2CB" /><rect x="13" y="11" width="34" height="20" fill="none" stroke="#B9C2CB" /><rect x="13" y="33" width="34" height="20" fill="none" stroke="#B9C2CB" /></svg>,
  colonial: <svg viewBox="0 0 60 64"><rect x="10" y="8" width="40" height="48" fill="#EEF2F5" stroke="#B9C2CB" /><line x1="30" y1="8" x2="30" y2="56" stroke="#B9C2CB" /><line x1="10" y1="24" x2="50" y2="24" stroke="#B9C2CB" /><line x1="10" y1="40" x2="50" y2="40" stroke="#B9C2CB" /></svg>,
  winder: <svg viewBox="0 0 60 64"><rect x="10" y="8" width="40" height="48" fill="#EEF2F5" stroke="#B9C2CB" /><rect x="10" y="40" width="40" height="16" fill="#EEF2F5" stroke="#B9C2CB" /><path d="M14 52 L30 43 L46 52" fill="none" stroke="#1F8A55" strokeDasharray="2 2" /></svg>,
};

export function DoorTiles({ onPick, busy }: { onPick: (style: "panel" | "flat") => void; busy?: boolean }) {
  return (
    <div className="wz-pick sc-tiles" data-testid="door-tiles">
      {(["panel", "flat"] as const).map((k) => (
        <button key={k} type="button" className="wz-pk" disabled={busy} data-testid={`door-tile-${k}`} onClick={() => onPick(k)}>
          {DOOR[k]}<small>{k === "panel" ? "Panel" : "Flat"}</small>
        </button>
      ))}
    </div>
  );
}

export function WindowTiles({ onPick, busy }: { onPick: (style: "casement" | "sash" | "colonial" | "winder") => void; busy?: boolean }) {
  const label = { casement: "Casement", sash: "Sash", colonial: "Colonial", winder: "Winder" } as const;
  return (
    <div className="wz-pick sc-tiles" data-testid="window-tiles">
      {(["casement", "sash", "colonial", "winder"] as const).map((k) => (
        <button key={k} type="button" className="wz-pk" disabled={busy} data-testid={`window-tile-${k}`} onClick={() => onPick(k)}>
          {WINDOW_DRAWINGS[k]}<small>{label[k]}</small>
        </button>
      ))}
    </div>
  );
}
