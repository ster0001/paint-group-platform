"use client";

import { useMemo, useState } from "react";
import SurfaceTileBox, { type TileState } from "@/app/components/scope/SurfaceTileBox";
import RoomCard from "@/app/components/scope/RoomCard";
import { tilesForRoomType, heightForStorey, type TileRule } from "@/lib/capture/presets";
import { resolveQuantity, perimeterPlausibility, type RoomGeometry } from "@/lib/capture/quantities";

/**
 * The interactive half of the workbench: pick a room type, type L/W, watch the
 * derived quantities move, tap tiles in staff mode and see the same state
 * rendered read-only in customer mode alongside.
 */
export default function ScopeComponentsDemo({ rules, roomTypes }: { rules: TileRule[]; roomTypes: string[] }) {
  const [roomType, setRoomType] = useState(roomTypes.includes("bedroom") ? "bedroom" : roomTypes[0] ?? "bedroom");
  const [lengthM, setLengthM] = useState(4.2);
  const [widthM, setWidthM] = useState(3.6);
  const storeyHeights = { ground: 2.4 };
  const heightM = heightForStorey(storeyHeights, "ground");

  const tiles = useMemo(() => tilesForRoomType(roomType, rules), [roomType, rules]);
  const [states, setStates] = useState<Record<string, TileState>>({});

  const geo: RoomGeometry = { lengthM, widthM, heightM };

  const stateFor = (id: string, defaultOn: boolean): TileState =>
    states[id] ?? { count: defaultOn ? 1 : 0 };

  const tap = (id: string, countable: boolean, defaultOn: boolean) =>
    setStates((s) => {
      const cur = stateFor(id, defaultOn);
      return { ...s, [id]: { count: countable ? cur.count + 1 : cur.count > 0 ? 0 : 1 } };
    });

  const decrement = (id: string, defaultOn: boolean) =>
    setStates((s) => {
      const cur = stateFor(id, defaultOn);
      return { ...s, [id]: { count: Math.max(0, cur.count - 1) } };
    });

  const quantityLabel = (basis: string, count: number): string | null => {
    switch (basis) {
      case "wall_area": return `${resolveQuantity({ basis: "wall_area", geo })} m²`;
      case "ceiling_area": return `${resolveQuantity({ basis: "ceiling_area", geo })} m²`;
      case "perimeter": return `${resolveQuantity({ basis: "perimeter", geo })} m`;
      case "per_item": return count > 0 ? `× ${count}` : null;
      default: return null;
    }
  };

  const selected = tiles.filter((t) => stateFor(t.id, t.defaultOn).count > 0);
  const plausibility = perimeterPlausibility(geo, false);

  const grid = (mode: "staff" | "customer") => (
    <div className="grid grid-cols-3 gap-2">
      {tiles.map((t) => {
        const st = stateFor(t.id, t.defaultOn);
        return (
          <SurfaceTileBox
            key={`${mode}:${t.id}`}
            tile={t}
            state={st}
            quantity={quantityLabel(t.measureBasis, st.count)}
            mode={mode}
            onTap={() => tap(t.id, t.countable, t.defaultOn)}
            onDecrement={() => decrement(t.id, t.defaultOn)}
          />
        );
      })}
    </div>
  );

  return (
    <div className="mt-6 space-y-8">
      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-gray-200 p-4">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-gray-500">Room type</span>
          <select value={roomType} onChange={(e) => { setRoomType(e.target.value); setStates({}); }} className="rounded border border-gray-300 px-2 py-1">
            {roomTypes.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-gray-500">L (m)</span>
          <input type="number" inputMode="decimal" step="0.1" value={lengthM} onChange={(e) => setLengthM(Number(e.target.value))} className="w-24 rounded border border-gray-300 px-2 py-1" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-gray-500">W (m)</span>
          <input type="number" inputMode="decimal" step="0.1" value={widthM} onChange={(e) => setWidthM(Number(e.target.value))} className="w-24 rounded border border-gray-300 px-2 py-1" />
        </label>
        <div className="text-sm text-gray-500">
          H {heightM} m <span className="text-xs">(inherited from storey)</span>
          {plausibility === "suspicious" && <span className="ml-2 text-amber-700">perimeter looks off</span>}
        </div>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-700">SurfaceTileBox — staff capture mode (tap to toggle / count)</h2>
        {grid("staff")}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-700">SurfaceTileBox — customer editor mode (read-only view of the same state)</h2>
        {grid("customer")}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-700">RoomCard — both modes</h2>
        <div className="grid max-w-2xl grid-cols-2 gap-3">
          <RoomCard
            mode="staff"
            room={{
              name: roomType.charAt(0).toUpperCase() + roomType.slice(1),
              surfaceCount: selected.length,
              totalCents: 110300,
              warnings: plausibility === "suspicious" ? ["perimeter implausible for L×W"] : [],
              status: "complete",
            }}
          />
          <RoomCard
            mode="customer"
            room={{
              name: roomType.charAt(0).toUpperCase() + roomType.slice(1),
              surfaceCount: selected.length,
              summary: selected.map((t) => t.tileLabel.toLowerCase()).slice(0, 4).join(", "),
              confidencePct: 88,
            }}
          />
        </div>
      </section>
    </div>
  );
}
