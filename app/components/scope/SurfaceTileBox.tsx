"use client";

/**
 * One surface tile - the shared unit of the capture grid (staff mode) and the
 * customer wizard editor (customer mode). Built mode-aware from day one per
 * the master plan: forking this later into staff/customer variants is exactly
 * the drift the plan tells us to stop and flag.
 *
 * Interaction model (room-loop brief section 4):
 *   measured tile   tap = toggle on/off, shows the live derived quantity
 *   countable tile  tap = increment (badge), never a duplicate row; the minus
 *                   affordance decrements
 *   customer mode   read-only selection view - customers see what is included,
 *                   they do not retap quantities
 */
import type { SurfaceTile } from "@/lib/capture/presets";

export type TileState = {
  /** For countable tiles: the count. For measured tiles: 1 = on, 0 = off. */
  count: number;
  excluded?: boolean;
};

export default function SurfaceTileBox({
  tile, state, quantity, mode, onTap, onDecrement,
}: {
  tile: SurfaceTile;
  state: TileState;
  /** Live derived quantity for measured tiles ("15.6 m2"), null when off. */
  quantity: string | null;
  mode: "staff" | "customer";
  onTap?: () => void;
  onDecrement?: () => void;
}) {
  const selected = state.count > 0 && !state.excluded;
  const interactive = mode === "staff";

  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? onTap : undefined}
      onKeyDown={interactive ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onTap?.(); } } : undefined}
      className={[
        "relative rounded-lg border p-3 text-left select-none transition-colors",
        interactive ? "cursor-pointer active:scale-[0.98]" : "",
        state.excluded
          ? "border-gray-200 bg-gray-50 text-gray-400"
          : selected
            ? "border-gray-900 bg-gray-900 text-white"
            : "border-gray-300 bg-white text-gray-800 hover:border-gray-500",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium leading-tight">{tile.tileLabel}</span>
        {state.excluded ? (
          <span aria-label="excluded" className="text-base leading-none">&#8856;</span>
        ) : tile.countable && state.count > 0 ? (
          <span className="rounded-full bg-white/90 px-1.5 text-xs font-semibold text-gray-900 ring-1 ring-gray-900">
            {state.count}
          </span>
        ) : selected ? (
          <span aria-label="selected" className="text-sm leading-none">&#10003;</span>
        ) : null}
      </div>

      {selected && quantity && (
        <div className={`mt-1 text-xs ${selected ? "text-gray-200" : "text-gray-500"}`}>{quantity}</div>
      )}
      {tile.requiresConfirm && selected && (
        <div className="mt-1 text-[11px] text-amber-300">confirm required</div>
      )}

      {interactive && tile.countable && state.count > 0 && (
        <button
          type="button"
          aria-label={`remove one ${tile.tileLabel}`}
          onClick={(e) => { e.stopPropagation(); onDecrement?.(); }}
          className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full border border-gray-300 bg-white text-xs leading-none text-gray-700 shadow-sm"
        >
          &minus;
        </button>
      )}
    </div>
  );
}
