"use client";

import { money0 } from "@/lib/format/money";

/**
 * One captured room's summary card - the AreaPicker hub tile (staff mode) and
 * the customer editor's room card (customer mode). Same component, one `mode`
 * prop, per the master plan's shared-foundations rule.
 *
 * Staff mode shows money and warnings (the brief: "Kitchen - 6 surfaces -
 * $1,103", plus the validation strip). Customer mode shows the room's
 * inclusions and its confidence, never internal warnings or hours.
 */

export type RoomCardData = {
  name: string;
  surfaceCount: number;
  /** Dollar value of the room, cents. Staff mode only. */
  totalCents?: number | null;
  /** Validation strip entries (staff) - e.g. "no measurements yet". */
  warnings?: string[];
  /** Customer mode: 0-100 confidence for the accuracy score. */
  confidencePct?: number | null;
  /** Short inclusion summary for customer mode, e.g. "walls, ceiling, 2 doors". */
  summary?: string | null;
  status?: "capturing" | "complete";
};

export default function RoomCard({
  room, mode, onOpen,
}: {
  room: RoomCardData;
  mode: "staff" | "customer";
  onOpen?: () => void;
}) {
  // null rather than a dash: this caller omits the element entirely when a
  // room is unpriced, which is not the same as showing "—".
  const money = room.totalCents != null ? money0(room.totalCents) : null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-lg border border-gray-300 bg-white p-3 text-left transition-colors hover:border-gray-500"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-gray-900">{room.name}</span>
        {room.status === "capturing" && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800">in progress</span>
        )}
      </div>

      <div className="mt-1 text-xs text-gray-500">
        {room.surfaceCount} surface{room.surfaceCount === 1 ? "" : "s"}
        {mode === "staff" && money && <> &middot; {money}</>}
        {mode === "customer" && room.summary && <> &middot; {room.summary}</>}
      </div>

      {mode === "staff" && (room.warnings?.length ?? 0) > 0 && (
        <div className="mt-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
          {room.warnings!.join(" · ")}
        </div>
      )}

      {mode === "customer" && room.confidencePct != null && (
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1.5 flex-1 rounded bg-gray-100">
            <div
              className="h-1.5 rounded bg-gray-900"
              style={{ width: `${Math.max(0, Math.min(100, room.confidencePct))}%` }}
            />
          </div>
          <span className="text-[11px] text-gray-500">{Math.round(room.confidencePct)}%</span>
        </div>
      )}
    </button>
  );
}
