"use client";

/**
 * The room loop: AreaPicker (hub) -> Capture -> RoomReview -> next room.
 *
 * Persistence model (brief section 7): every state change lands in IndexedDB
 * immediately; the server sees one batched commit per room, flushed on Done /
 * Next room, queued and retried when offline. The sync state is always
 * visible in the header.
 */
import { money0 as money } from "@/lib/format/money";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SurfaceTileBox, { type TileState } from "@/app/components/scope/SurfaceTileBox";
import RoomCard from "@/app/components/scope/RoomCard";
import { ALLOWANCE_DEFS, emptyDraft, defectHours, DEFECT_LABELS, type DefectObservation, type DefectRate, type RoomDraft } from "@/lib/capture/commit";
import { expandCaptureTiles, heightForStorey, tilesForRoomType, DEFAULT_STOREY_HEIGHTS, type SurfaceTile, type TileRule } from "@/lib/capture/presets";
import { perimeterM, perimeterPlausibility, resolveQuantity } from "@/lib/capture/quantities";
import { hoursPerUnit } from "@/lib/pricing/engine";
import type { RateItem } from "@/lib/pricing/types";
import { loadCaptureState, saveCaptureState, type CaptureState } from "@/lib/capture/draft-store";

export type NamePreset = { estimate_type: string; name: string; room_type: string; sort_order: number };

/** B2: the customer's build, riding builder_state for the confirming visit. */
export type PrepPack = {
  kind: "visit" | "desk_check";
  slot: string | null;
  at: string;
  removedSubstrates: string[];
  flags: string[];
};
export type ExistingRoom = {
  areaId: number;
  name: string;
  roomType: string | null;
  storey: string;
  /** room_loop = capture-born (lossless re-entry) · assisted = AI-drafted or
   * customer-stated (wizard, plan reader — rebuilt onto tiles to confirm) ·
   * builder = hand-built (opens too; builder-only lines survive recommit). */
  capturedVia: "room_loop" | "assisted" | "builder";
  surfaceCount: number;
  priceCents: number;
  L: number; W: number; H: number;
  surfaces: Array<{ code: string; count: number; prepHr: number; coats: number; crewNote: string; size?: "small" | "large" | null }>;
  extraWallSegmentsM: number[];
  perimeterOverridden: boolean;
  perimeterM: number | null;
  captureDraft?: RoomDraft | null;
};

type Screen = { kind: "picker" } | { kind: "capture"; localId: string } | { kind: "review"; localId: string };
type SyncState = "synced" | "saving" | "offline";
type Totals = { subtotalCents: number; totalCents: number; contractorHours: number; marginCents: number };


export default function CaptureApp({
  estimateId, estimateTitle, rules, presets, defectRates, rateItems = [], jobMod = 1, windowSizes = { small: 0.8, large: 1.2 }, initialStoreyHeights, derivedStoreyHeights = null, initialRooms, prepPack = null,
}: {
  estimateId: string;
  estimateTitle: string;
  rules: TileRule[];
  presets: NamePreset[];
  defectRates: DefectRate[];
  rateItems?: RateItem[];
  /** The estimate's job modifier — hour placeholders must show what pricing
   * will actually charge, or a typed "confirmation" writes a wrong override. */
  jobMod?: number;
  /** A6: Settings-tuned window size multipliers, for placeholder parity. */
  windowSizes?: { small: number; large: number };
  initialStoreyHeights: Record<string, number> | null;
  /** A5: heights derived from the area nodes when none are stored — a wizard
   * estimate pre-fills the confirm prompt (both storeys) instead of wedging
   * it on an empty ground-only default. */
  derivedStoreyHeights?: Record<string, number> | null;
  initialRooms: ExistingRoom[];
  /** B2: present when the customer booked the confirming visit — capture IS
   * the verify mode: rooms pre-filled, confirm-as-you-walk flips provenance,
   * the customer's flags and removals ride this banner. */
  prepPack?: PrepPack | null;
}) {
  const [screen, setScreen] = useState<Screen>({ kind: "picker" });
  const [vocab, setVocab] = useState<"interior" | "exterior">("interior");
  const [storeyHeights, setStoreyHeights] = useState<Record<string, number>>(initialStoreyHeights ?? derivedStoreyHeights ?? DEFAULT_STOREY_HEIGHTS);
  const [heightsConfirmed, setHeightsConfirmed] = useState(initialStoreyHeights != null);
  const [currentStorey, setCurrentStorey] = useState("ground");
  const [drafts, setDrafts] = useState<RoomDraft[]>([]);
  const [committed, setCommitted] = useState<ExistingRoom[]>(initialRooms);
  const [pendingSync, setPendingSync] = useState<string[]>([]);
  const [sync, setSync] = useState<SyncState>("synced");
  const [totals, setTotals] = useState<Totals | null>(null);
  const [restoreOffer, setRestoreOffer] = useState<CaptureState | null>(null);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- local persistence: every change, immediately ------------------------
  const persist = useCallback((rooms: RoomDraft[], pending: string[], heights: Record<string, number>, storey: string) => {
    void saveCaptureState({ estimateId, storeyHeights: heights, currentStorey: storey, rooms, pendingSync: pending, updatedAt: Date.now() });
  }, [estimateId]);

  useEffect(() => {
    void loadCaptureState(estimateId).then((s) => {
      if (s && (s.rooms.length > 0 || s.pendingSync.length > 0)) setRestoreOffer(s);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimateId]);

  const updateDrafts = useCallback((next: RoomDraft[], pending = pendingSync) => {
    setDrafts(next);
    persist(next, pending, storeyHeights, currentStorey);
  }, [pendingSync, persist, storeyHeights, currentStorey]);

  // ---- server commit: one batched upsert per room --------------------------
  const commitRoom = useCallback(async (draft: RoomDraft): Promise<boolean> => {
    setSync("saving");
    try {
      const res = await fetch(`/api/estimates/${estimateId}/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room: draft, storeyHeights, exterior: vocab === "exterior" }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      const out = (await res.json()) as { areaId: number; surfaces: number; areaPriceCents: number; totals: Totals };

      setDrafts((ds) => {
        const next = ds.map((d) => (d.localId === draft.localId ? { ...d, areaId: out.areaId, status: "complete" as const } : d));
        persist(next, pendingSync.filter((p) => p !== draft.localId), storeyHeights, currentStorey);
        return next;
      });
      setPendingSync((p) => p.filter((x) => x !== draft.localId));
      setCommitted((rooms) => {
        const entry: ExistingRoom = {
          areaId: out.areaId, name: draft.name, roomType: draft.roomType, storey: draft.storey,
          capturedVia: "room_loop", surfaceCount: out.surfaces, priceCents: out.areaPriceCents,
          L: draft.lengthM, W: draft.widthM, H: draft.heightM,
          surfaces: [], extraWallSegmentsM: draft.extraWallSegmentsM,
          perimeterOverridden: draft.perimeterOverrideM != null || draft.extraWallSegmentsM.length > 0,
          perimeterM: null,
        };
        const i = rooms.findIndex((r) => r.areaId === out.areaId);
        return i >= 0 ? rooms.map((r, j) => (j === i ? entry : r)) : [...rooms, entry];
      });
      setTotals(out.totals);
      setSync("synced");
      return true;
    } catch {
      setSync("offline");
      setPendingSync((p) => (p.includes(draft.localId) ? p : [...p, draft.localId]));
      persist(drafts, [...pendingSync.filter((x) => x !== draft.localId), draft.localId], storeyHeights, currentStorey);
      return false;
    }
  }, [estimateId, storeyHeights, vocab, drafts, pendingSync, persist, currentStorey]);

  // Retry the offline queue when the network returns (and every 20 s while queued).
  useEffect(() => {
    const retry = () => {
      for (const localId of pendingSync) {
        const d = drafts.find((x) => x.localId === localId);
        if (d) void commitRoom(d);
      }
    };
    window.addEventListener("online", retry);
    if (flushTimer.current) clearTimeout(flushTimer.current);
    if (pendingSync.length > 0) flushTimer.current = setTimeout(retry, 20_000);
    return () => window.removeEventListener("online", retry);
  }, [pendingSync, drafts, commitRoom]);

  // ---- names ---------------------------------------------------------------
  const usedNames = useMemo(
    () => new Set([...committed.map((r) => r.name.toLowerCase()), ...drafts.filter((d) => d.status === "capturing").map((d) => d.name.toLowerCase())]),
    [committed, drafts],
  );
  const nextName = (base: string): string => {
    if (!usedNames.has(base.toLowerCase())) return base;
    for (let n = 2; n < 40; n++) if (!usedNames.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
    return base;
  };

  const startRoom = (name: string, roomType: string) => {
    const draft = emptyDraft(crypto.randomUUID(), nextName(name), roomType, currentStorey, heightForStorey(storeyHeights, currentStorey));
    // presets: core measured tiles arrive pre-selected
    const tiles = expandCaptureTiles(tilesForRoomType(roomType, rules));
    // Fractional tiles (wet-area walls) encode 1..4 as 25..100% — a
    // pre-ticked tile must arrive at the FULL surface, not a quarter of it.
    for (const t of tiles) if (t.defaultOn) draft.selections[t.id] = t.fractional ? 4 : 1;
    updateDrafts([...drafts, draft]);
    setScreen({ kind: "capture", localId: draft.localId });
  };

  const reenterRoom = (room: ExistingRoom) => {
    // Keep the vocabulary in step with the room being opened — committing an
    // exterior elevation under the interior vocab would flip its type.
    if ((room.roomType ?? "").startsWith("exterior")) setVocab("exterior");
    const local = drafts.find((d) => d.areaId === room.areaId);
    if (local) { setScreen({ kind: "capture", localId: local.localId }); return; }
    // Nodes committed since the captureDraft field carry their exact draft -
    // restore it losslessly (duplicates, fractions, overrides, labels intact).
    if (room.captureDraft) {
      const restored = { ...room.captureDraft, localId: crypto.randomUUID(), areaId: room.areaId };
      updateDrafts([...drafts, restored]);
      setScreen({ kind: "capture", localId: restored.localId });
      return;
    }
    // Older nodes: lossy rebuild from priced surfaces (duplicates collapse,
    // fractions/labels/hour-overrides are not recoverable - flagged in review).
    const roomType = room.roomType ?? "bedroom";
    const tiles = expandCaptureTiles(tilesForRoomType(roomType, rules));
    const draft = emptyDraft(crypto.randomUUID(), room.name, roomType, room.storey, room.H);
    draft.areaId = room.areaId;
    draft.lengthM = room.L; draft.widthM = room.W;
    draft.extraWallSegmentsM = room.extraWallSegmentsM;
    if (room.perimeterOverridden && room.perimeterM != null && room.extraWallSegmentsM.length === 0) draft.perimeterOverrideM = room.perimeterM;
    for (const s of room.surfaces) {
      const tile = tiles.find((t) => t.rateCode === s.code);
      if (!tile) continue;
      // Fractional tiles (wet-area walls) count taps as quarters: 4 = the
      // whole surface. A rebuilt full surface must arrive at 4, not 1 (25%).
      draft.selections[tile.id] = tile.fractional ? 4 : tile.countable ? s.count : 1;
      if (s.size) draft.sizes = { ...(draft.sizes ?? {}), [tile.id]: s.size };
      if (s.prepHr) draft.prepHours[tile.id] = s.prepHr;
      if (s.coats !== 2) draft.coats[tile.id] = s.coats;
      if (s.crewNote) draft.crewNotes[tile.id] = s.crewNote;
    }
    updateDrafts([...drafts, draft]);
    setScreen({ kind: "capture", localId: draft.localId });
  };

  // ---- render --------------------------------------------------------------
  const active = screen.kind === "picker" ? null : drafts.find((d) => d.localId === screen.localId) ?? null;

  return (
    <div className="mx-auto min-h-screen max-w-3xl p-4 pb-24">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Capture — {estimateTitle}</h1>
          <p className="text-xs text-gray-500">
            {sync === "synced" && "saved · synced"}
            {sync === "saving" && "saving…"}
            {sync === "offline" && `offline · ${pendingSync.length} room${pendingSync.length === 1 ? "" : "s"} queued`}
          </p>
        </div>
        <a href={`/quote?id=${estimateId}`} className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:border-gray-500">
          Exit to builder
        </a>
      </header>

      {prepPack && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
          <b>{prepPack.kind === "visit" ? `Confirming visit${prepPack.slot ? ` · ${prepPack.slot}` : ""}` : "Customer accepted online — desk check"}</b>
          <span className="block text-xs text-gray-600">
            Verify mode: rooms are pre-filled from the customer&apos;s build — confirm as you walk.
            {prepPack.removedSubstrates.length > 0 && ` Customer removed: ${prepPack.removedSubstrates.join(", ")}.`}
          </span>
          {prepPack.flags.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-xs text-amber-800">
              {prepPack.flags.map((f) => <li key={f}>{f}</li>)}
            </ul>
          )}
        </div>
      )}

      {restoreOffer && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
          <span>Unsynced capture work from this device was found for this estimate. Restore it?</span>
          <div className="flex gap-2">
            <button
              className="rounded bg-gray-900 px-3 py-1 text-white"
              onClick={() => {
                setDrafts(restoreOffer.rooms);
                setPendingSync(restoreOffer.pendingSync);
                setStoreyHeights(restoreOffer.storeyHeights);
                setCurrentStorey(restoreOffer.currentStorey);
                setHeightsConfirmed(true);
                setRestoreOffer(null);
              }}
            >Restore</button>
            <button className="rounded border border-gray-300 px-3 py-1" onClick={() => setRestoreOffer(null)}>Ignore</button>
          </div>
        </div>
      )}

      {!heightsConfirmed && (
        <StoreyHeightPrompt
          heights={storeyHeights}
          onConfirm={(h) => { setStoreyHeights(h); setHeightsConfirmed(true); persist(drafts, pendingSync, h, currentStorey); }}
        />
      )}

      {heightsConfirmed && screen.kind === "picker" && (
        <AreaPicker
          presets={presets}
          vocab={vocab}
          setVocab={setVocab}
          committed={committed}
          drafts={drafts}
          storeys={Object.keys(storeyHeights)}
          currentStorey={currentStorey}
          setCurrentStorey={setCurrentStorey}
          onPick={startRoom}
          onReenter={reenterRoom}
          onResume={(localId) => setScreen({ kind: "capture", localId })}
        />
      )}

      {heightsConfirmed && active && screen.kind === "capture" && (
        <CaptureScreen
          draft={active}
          rules={rules}
          storeyHeights={storeyHeights}
          onChange={(d) => updateDrafts(drafts.map((x) => (x.localId === d.localId ? d : x)))}
          onDone={() => setScreen({ kind: "review", localId: active.localId })}
          onNextRoom={async () => { void commitRoom(active); setScreen({ kind: "picker" }); }}
        />
      )}

      {heightsConfirmed && active && screen.kind === "review" && (
        <RoomReview
          draft={active}
          rules={rules}
          defectRates={defectRates}
          rateItems={rateItems}
          category={vocab === "exterior" ? "Exterior" : "Interior"}
          jobMod={jobMod}
          windowSizes={windowSizes}
          onChange={(d) => updateDrafts(drafts.map((x) => (x.localId === d.localId ? d : x)))}
          onBack={() => setScreen({ kind: "capture", localId: active.localId })}
          onNextRoom={async () => { void commitRoom(active); setScreen({ kind: "picker" }); }}
        />
      )}

      {totals && (
        <div className="fixed inset-x-0 bottom-0 border-t border-gray-200 bg-white/95 px-4 py-2 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center justify-between text-sm">
            <span className="font-medium">{money(totals.totalCents)} <span className="text-xs text-gray-500">inc GST</span></span>
            <span className="text-xs text-gray-500">{totals.contractorHours} hrs · margin {money(totals.marginCents)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function StoreyHeightPrompt({ heights, onConfirm }: { heights: Record<string, number>; onConfirm: (h: Record<string, number>) => void }) {
  const [rows, setRows] = useState<Array<[string, number]>>(Object.entries(heights));
  return (
    <div className="rounded-lg border border-gray-300 p-4">
      <h2 className="text-sm font-semibold">Ceiling heights</h2>
      <p className="mt-1 text-xs text-gray-500">Set once per storey — every room inherits it, and a room can still override.</p>
      <div className="mt-3 space-y-2">
        {rows.map(([name, h], i) => (
          <div key={i} className="flex items-center gap-2">
            <input value={name} onChange={(e) => setRows(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))}
              className="w-32 rounded border border-gray-300 px-2 py-1 text-sm" />
            <input type="number" inputMode="decimal" step="0.05" value={h}
              onChange={(e) => setRows(rows.map((r, j) => (j === i ? [r[0], Number(e.target.value)] : r)))}
              className="w-24 rounded border border-gray-300 px-2 py-1 text-sm" />
            <span className="text-xs text-gray-500">m</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <button className="rounded border border-gray-300 px-3 py-1.5 text-sm" onClick={() => setRows([...rows, [`storey ${rows.length + 1}`, 2.4]])}>+ Add storey</button>
        <button className="rounded bg-gray-900 px-4 py-1.5 text-sm text-white"
          onClick={() => onConfirm(Object.fromEntries(rows.filter(([n, h]) => n.trim() && h > 0)))}>Start capturing</button>
      </div>
    </div>
  );
}

function AreaPicker({
  presets, vocab, setVocab, committed, drafts, storeys, currentStorey, setCurrentStorey, onPick, onReenter, onResume,
}: {
  presets: NamePreset[];
  vocab: "interior" | "exterior";
  setVocab: (v: "interior" | "exterior") => void;
  committed: ExistingRoom[];
  drafts: RoomDraft[];
  storeys: string[];
  currentStorey: string;
  setCurrentStorey: (s: string) => void;
  onPick: (name: string, roomType: string) => void;
  onReenter: (room: ExistingRoom) => void;
  onResume: (localId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [custom, setCustom] = useState("");
  const names = presets.filter((p) => p.estimate_type === vocab && p.name.toLowerCase().includes(search.toLowerCase()));
  const inProgress = drafts.filter((d) => d.status === "capturing" && d.areaId == null);

  return (
    <div className="space-y-5">
      {(committed.length > 0 || inProgress.length > 0) && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-gray-700">This estimate</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {inProgress.map((d) => (
              <RoomCard key={d.localId} mode="staff"
                room={{ name: d.name, surfaceCount: Object.values(d.selections).filter((n) => n > 0).length, totalCents: null, warnings: d.lengthM > 0 ? [] : ["no measurements yet"], status: "capturing" }}
                onOpen={() => onResume(d.localId)} />
            ))}
            {committed.map((r) => (
              <RoomCard key={r.areaId} mode="staff"
                room={{
                  name: r.name, surfaceCount: r.surfaceCount, totalCents: r.priceCents,
                  // A5: every room opens, whoever wrote it. The note says what
                  // opening means, not that the door is locked.
                  warnings:
                    r.capturedVia === "builder" ? ["built in builder — custom lines are kept on save"]
                    : r.capturedVia === "assisted" ? ["AI-drafted — confirm as you walk"]
                    : [],
                }}
                onOpen={() => onReenter(r)} />
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-700">Add a room or area</h2>
          <div className="flex gap-1 text-xs">
            {(["interior", "exterior"] as const).map((v) => (
              <button key={v} onClick={() => setVocab(v)}
                className={`rounded px-2 py-1 ${vocab === v ? "bg-gray-900 text-white" : "border border-gray-300"}`}>{v}</button>
            ))}
          </div>
        </div>

        {storeys.length > 1 && (
          <div className="mb-2 flex items-center gap-1 text-xs">
            <span className="text-gray-500">Storey:</span>
            {storeys.map((s) => (
              <button key={s} onClick={() => setCurrentStorey(s)}
                className={`rounded px-2 py-1 ${currentStorey === s ? "bg-gray-900 text-white" : "border border-gray-300"}`}>{s}</button>
            ))}
          </div>
        )}

        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search names…"
          className="mb-2 w-full rounded border border-gray-300 px-3 py-2 text-sm" />
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {names.map((p) => (
            <button key={p.name} onClick={() => onPick(p.name, p.room_type)}
              className="rounded-lg border border-gray-300 bg-white p-3 text-sm font-medium hover:border-gray-500">
              {p.name}
            </button>
          ))}
          <div className="col-span-3 mt-1 flex gap-2 sm:col-span-4">
            <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="+ Custom name"
              className="flex-1 rounded border border-dashed border-gray-300 px-3 py-2 text-sm" />
            <button disabled={!custom.trim()} onClick={() => { onPick(custom.trim(), vocab === "exterior" ? "exterior_elevation" : "bedroom"); setCustom(""); }}
              className="rounded bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-40">Add</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function CaptureScreen({
  draft, rules, storeyHeights, onChange, onDone, onNextRoom,
}: {
  draft: RoomDraft;
  rules: TileRule[];
  storeyHeights: Record<string, number>;
  onChange: (d: RoomDraft) => void;
  onDone: () => void;
  onNextRoom: () => void;
}) {
  const tiles = useMemo(() => expandCaptureTiles(tilesForRoomType(draft.roomType, rules)), [draft.roomType, rules]);
  const geo = { lengthM: draft.lengthM, widthM: draft.widthM, heightM: draft.heightM, extraWallSegmentsM: draft.extraWallSegmentsM, perimeterOverrideM: draft.perimeterOverrideM };
  const perim = perimeterM(geo);
  const plaus = perimeterPlausibility(geo, draft.extraWallSegmentsM.length > 0);
  const inheritedH = heightForStorey(storeyHeights, draft.storey);

  const set = (patch: Partial<RoomDraft>) => onChange({ ...draft, ...patch });
  const tap = (t: SurfaceTile) => {
    const cur = draft.selections[t.id] ?? 0;
    // Wet-area walls cycle UP 25 -> 100% -> off; exterior cladding cycles
    // DOWN 100 -> 75 -> 50 -> 25% -> off (first tap = the whole elevation).
    const next = t.descending ? (cur === 0 ? 4 : cur - 1)
      : t.fractional ? (cur >= 4 ? 0 : cur + 1)
      : t.countable ? cur + 1 : cur > 0 ? 0 : 1;
    set({ selections: { ...draft.selections, [t.id]: next } });
  };
  const dec = (t: SurfaceTile) => set({ selections: { ...draft.selections, [t.id]: Math.max(0, (draft.selections[t.id] ?? 0) - 1) } });

  const isElevation = draft.roomType.startsWith("exterior");
  const qty = (t: SurfaceTile, count: number): string | null => {
    if (t.measureBasis === "plane_area" || t.measureBasis === "elevation_length") {
      if (draft.lengthM <= 0) return null;
      if (t.measureBasis === "elevation_length") return `${draft.lengthM.toFixed(1)} m`;
      const full = resolveQuantity({ basis: "plane_area", geo });
      if (t.fractional && count > 0 && count < 4) return `${count * 25}% · ${Math.round(full * count / 4 * 10) / 10} m²`;
      return `${full} m²`;
    }
    if (draft.lengthM <= 0 || draft.widthM <= 0) return null;
    switch (t.measureBasis) {
      case "wall_area": {
        const full = resolveQuantity({ basis: "wall_area", geo });
        if (t.fractional && count > 0 && count < 4) return `${count * 25}% · ${Math.round(full * count / 4 * 10) / 10} m²`;
        return `${full} m²`;
      }
      case "ceiling_area": return `${resolveQuantity({ basis: "ceiling_area", geo })} m²`;
      case "perimeter": return `${perim.toFixed(1)} m`;
      case "per_item": return count > 0 ? `× ${count}` : null;
      default: return null;
    }
  };

  const groups: Array<SurfaceTile["group"]> = ["core", "openings", "joinery", "extras"];
  const warnings: string[] = [];
  if (isElevation) {
    if (draft.lengthM <= 0) warnings.push("width needed");
    if (draft.heightM <= 0) warnings.push("height needed");
  } else if (draft.lengthM <= 0 || draft.widthM <= 0) warnings.push("L and W needed");
  if (!isElevation && plaus === "suspicious") warnings.push("perimeter looks implausible for L×W");
  if (Object.values(draft.selections).every((n) => n <= 0)) warnings.push("no surfaces selected");

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 rounded-lg border border-gray-300 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between">
          <input value={draft.name} onChange={(e) => set({ name: e.target.value })}
            className="w-40 rounded border border-transparent px-1 text-base font-semibold hover:border-gray-300" />
          <span className="text-xs text-gray-500">{isElevation ? "elevation · one plane, width × height" : `${draft.roomType} · ${draft.storey}`}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          {(isElevation ? (["lengthM"] as const) : (["lengthM", "widthM"] as const)).map((k) => (
            <label key={k} className="flex items-center gap-1">
              <span className="text-xs text-gray-500">{isElevation ? "Width" : k === "lengthM" ? "L" : "W"}</span>
              <input type="number" inputMode="decimal" step="0.05" min="0" value={draft[k] || ""}
                onChange={(e) => set({ [k]: Number(e.target.value) } as Partial<RoomDraft>)}
                className="w-20 rounded border border-gray-300 px-2 py-1" />
              <span className="text-xs text-gray-400">m</span>
            </label>
          ))}
          <label className="flex items-center gap-1">
            <span className="text-xs text-gray-500">H</span>
            <input type="number" inputMode="decimal" step="0.05" min="0" value={draft.heightM}
              onChange={(e) => set({ heightM: Number(e.target.value), heightInherited: false })}
              className={`w-20 rounded border px-2 py-1 ${draft.heightInherited ? "border-gray-200 text-gray-400" : "border-gray-300"}`} />
            <span className="text-xs text-gray-400">m{draft.heightInherited ? " (storey)" : " (override)"}</span>
            {!draft.heightInherited && (
              <button className="text-xs underline" onClick={() => set({ heightM: inheritedH, heightInherited: true })}>reset</button>
            )}
          </label>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-600">
          <label className="flex items-center gap-1">
            perimeter
            <input type="number" inputMode="decimal" step="0.1" value={Number(perim.toFixed(2))}
              onChange={(e) => set({ perimeterOverrideM: Number(e.target.value) || null })}
              className="w-20 rounded border border-gray-200 px-1 py-0.5" />
            m
          </label>
          <span>ceiling {(draft.lengthM * draft.widthM).toFixed(1)} m²</span>
          <button className="underline" onClick={() => set({ extraWallSegmentsM: [...draft.extraWallSegmentsM, 1] })}>+ wall segment</button>
          {draft.extraWallSegmentsM.map((s, i) => (
            <span key={i} className="flex items-center gap-1">
              <input type="number" inputMode="decimal" step="0.1" value={s}
                onChange={(e) => set({ extraWallSegmentsM: draft.extraWallSegmentsM.map((x, j) => (j === i ? Number(e.target.value) : x)) })}
                className="w-16 rounded border border-gray-200 px-1 py-0.5" />
              <button onClick={() => set({ extraWallSegmentsM: draft.extraWallSegmentsM.filter((_, j) => j !== i) })}>×</button>
            </span>
          ))}
        </div>
        {warnings.length > 0 && (
          <div className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">{warnings.join(" · ")}</div>
        )}
      </div>

      {groups.map((g) => {
        const inGroup = tiles.filter((t) => t.group === g);
        if (!inGroup.length) return null;
        return (
          <div key={g}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{g}</h3>
            <div className="grid grid-cols-3 gap-2">
              {inGroup.map((t) => {
                const count = draft.selections[t.id] ?? 0;
                return (
                  <SurfaceTileBox key={t.id} tile={t}
                    state={{ count, excluded: draft.exclusions.includes(t.id) } as TileState}
                    quantity={qty(t, count)} mode="staff"
                    onTap={() => tap(t)} onDecrement={() => dec(t)} />
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="flex gap-2 pt-2">
        <button onClick={onDone} className="flex-1 rounded-lg border border-gray-400 py-2.5 text-sm font-medium">Done — review</button>
        <button onClick={onNextRoom} className="flex-1 rounded-lg bg-gray-900 py-2.5 text-sm font-medium text-white">Next room →</button>
      </div>
    </div>
  );
}

/** The chips offered per surface - the brief's interior set, in rate-table keys. */
const CHIP_TYPES = ["peeling", "water_damage", "plaster_cracks", "holes_dents", "previous_poor_finish", "needs_bogging", "needs_stripping", "scraping_filling", "caulking"];

function RoomReview({
  draft, rules, defectRates, rateItems = [], category = "Interior", jobMod = 1, windowSizes = { small: 0.8, large: 1.2 }, onChange, onBack, onNextRoom,
}: {
  draft: RoomDraft;
  rules: TileRule[];
  defectRates: DefectRate[];
  rateItems?: RateItem[];
  category?: "Interior" | "Exterior";
  jobMod?: number;
  /** A6: the Settings-tuned window size multipliers, for placeholder parity. */
  windowSizes?: { small: number; large: number };
  onChange: (d: RoomDraft) => void;
  onBack: () => void;
  onNextRoom: () => void;
}) {
  const baseTiles = useMemo(() => expandCaptureTiles(tilesForRoomType(draft.roomType, rules)), [draft.roomType, rules]);
  const tiles = useMemo(() => [
    ...baseTiles,
    ...(draft.extraTiles ?? []).flatMap((x) => { const b = baseTiles.find((t) => t.id === x.from); return b ? [{ ...b, id: x.id }] : []; }),
  ], [baseTiles, draft.extraTiles]);
  const selected = tiles.filter((t) => (draft.selections[t.id] ?? 0) > 0 && !draft.exclusions.includes(t.id));
  const set = (patch: Partial<RoomDraft>) => onChange({ ...draft, ...patch });
  const itemFor = (code: string) => rateItems.find((r) => (r as { code: string; category?: string }).code === code && (r as { category?: string }).category === category);
  // The placeholder must equal what pricing will charge for the tile
  // (painting × job modifier + manual prep) — an estimator who types the
  // number they can see is CONFIRMING it, and the override must not shift
  // the price. Parity partner: priceSurface in lib/pricing/estimate.ts;
  // commit.ts subtracts the same manual prep back out of the typed total.
  const hoursFor = (t: SurfaceTile, count: number): number | null => {
    const item = itemFor(t.rateCode);
    if (!item) return null;
    const coats = draft.coats[t.id] ?? 2;
    const hpu = hoursPerUnit(item, coats);
    const geo = { lengthM: draft.lengthM, widthM: draft.widthM, heightM: draft.heightM, extraWallSegmentsM: draft.extraWallSegmentsM, perimeterOverrideM: draft.perimeterOverrideM };
    let qty = 0;
    if (t.measureBasis === "per_item") qty = count;
    else if (t.measureBasis === "ceiling_area") qty = resolveQuantity({ basis: "ceiling_area", geo });
    else if (t.measureBasis === "perimeter") qty = resolveQuantity({ basis: "perimeter", geo });
    else if (t.measureBasis === "wall_area") qty = resolveQuantity({ basis: "wall_area", geo }) * (t.fractional ? Math.min(count, 4) / 4 : 1);
    else if (t.measureBasis === "plane_area") qty = resolveQuantity({ basis: "plane_area", geo }) * (t.fractional ? Math.min(count, 4) / 4 : 1);
    else if (t.measureBasis === "elevation_length") qty = resolveQuantity({ basis: "elevation_length", geo });
    // A6: parity with priceSurface — the size multiplier scales window hours.
    const size = draft.sizes?.[t.id];
    const sizeMul = !/window/i.test(item.sub_category ?? "") ? 1
      : size === "small" ? windowSizes.small : size === "large" ? windowSizes.large : 1;
    const painting = hpu * qty * jobMod * sizeMul;
    return Math.round((painting + (draft.prepHours[t.id] ?? 0)) * 100) / 100;
  };
  const isWindowTile = (t: SurfaceTile) => /window/i.test(itemFor(t.rateCode)?.sub_category ?? "");
  const defectsFor = (tileId: string): DefectObservation[] => (draft.defects ?? {})[tileId] ?? [];
  const setDefects = (tileId: string, obs: DefectObservation[]) =>
    set({ defects: { ...(draft.defects ?? {}), [tileId]: obs } });

  // Drafts saved before the chips feature lack the map - normalise once.
  const unitLabel = (type: string) => {
    const u = defectRates.find((r) => r.defect_type === type)?.unit;
    return u === "lin_m" ? "lin m" : u === "each" ? "spots" : "m²";
  };

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold">{draft.name} — prep, coats & notes</h2>
      {selected.map((t) => {
        const prep = draft.prepHours[t.id] ?? 0;
        const coats = draft.coats[t.id] ?? 2;
        const obs = defectsFor(t.id);
        const defectPrep = obs.reduce((n, o) => n + defectHours(o, defectRates), 0);
        return (
          <div key={t.id} className="rounded-lg border border-gray-200 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 font-medium">
                <input
                  value={draft.labels?.[t.id] ?? t.label}
                  onChange={(e) => set({ labels: { ...(draft.labels ?? {}), [t.id]: e.target.value } })}
                  className="w-40 rounded border border-transparent px-1 hover:border-gray-300"
                />
                {t.countable && !t.fractional ? `× ${draft.selections[t.id]}` : ""}
                {t.fractional && (draft.selections[t.id] ?? 0) < 4 ? `${(draft.selections[t.id] ?? 0) * 25}%` : ""}
                {/* A6: compact S/M/L on window rows — a rate multiplier. */}
                {isWindowTile(t) && (
                  <span className="inline-flex overflow-hidden rounded border border-gray-300">
                    {(["small", "medium", "large"] as const).map((sz) => (
                      <button
                        key={sz}
                        type="button"
                        onClick={() => {
                          const next = { ...(draft.sizes ?? {}) };
                          if (sz === "medium") delete next[t.id]; else next[t.id] = sz;
                          set({ sizes: next });
                        }}
                        className={`px-1.5 py-0.5 text-[10px] font-semibold ${
                          (draft.sizes?.[t.id] ?? "medium") === sz ? "bg-gray-900 text-white" : "text-gray-500"
                        }`}
                        title={sz === "small" ? `Small · ×${windowSizes.small}` : sz === "large" ? `Large · ×${windowSizes.large}` : "Medium · standard rate"}
                      >
                        {sz[0].toUpperCase()}
                      </button>
                    ))}
                  </span>
                )}
                <span className="flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-normal text-gray-600">
                  <input type="number" inputMode="decimal" step="0.25" min="0"
                    placeholder={String(hoursFor(t, draft.selections[t.id] ?? 0) ?? "")}
                    value={draft.hoursOverride?.[t.id] ?? ""}
                    onChange={(e) => {
                      const v = e.target.value === "" ? undefined : Number(e.target.value);
                      const next = { ...(draft.hoursOverride ?? {}) };
                      if (v == null || Number.isNaN(v)) delete next[t.id]; else next[t.id] = v;
                      set({ hoursOverride: next });
                    }}
                    className="w-12 bg-transparent text-right" />
                  h{draft.hoursOverride?.[t.id] != null ? " (manual)" : ""}
                </span>
                {t.countable && (
                <button type="button" title="Duplicate this substrate (e.g. cupboard doors vs normal doors)"
                  onClick={() => {
                    const id = `${t.id}#${crypto.randomUUID().slice(0, 4)}`;
                    set({ extraTiles: [...(draft.extraTiles ?? []), { id, from: t.id.split("#")[0] }], selections: { ...draft.selections, [id]: 1 }, labels: { ...(draft.labels ?? {}), [id]: `${draft.labels?.[t.id] ?? t.label} (copy)` } });
                  }}
                  className="rounded border border-gray-300 px-1.5 text-[11px] text-gray-500 hover:bg-gray-50">⧉</button>
                )}
              </span>
              <div className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1">
                  prep
                  <button className="rounded border px-1.5" onClick={() => set({ prepHours: { ...draft.prepHours, [t.id]: Math.max(0, prep - 0.25) } })}>−</button>
                  <span className="w-16 text-center">{prep.toFixed(2)}h{defectPrep > 0 ? ` +${defectPrep.toFixed(2)}` : ""}</span>
                  <button className="rounded border px-1.5" onClick={() => set({ prepHours: { ...draft.prepHours, [t.id]: prep + 0.25 } })}>+</button>
                </span>
                <span className="flex items-center gap-1">
                  coats
                  {[1, 2, 3].map((c) => (
                    <button key={c} onClick={() => set({ coats: { ...draft.coats, [t.id]: c } })}
                      className={`rounded px-1.5 ${coats === c ? "bg-gray-900 text-white" : "border"}`}>{c}</button>
                  ))}
                </span>
              </div>
            </div>

            {/* defect chips: tap cycles severity 1 -> 2 -> 3 -> off */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {CHIP_TYPES.map((type) => {
                const cur = obs.find((o) => o.type === type);
                return (
                  <button key={type} type="button"
                    onClick={() => {
                      if (!cur) setDefects(t.id, [...obs, { type, severity: 1, qty: 1 }]);
                      else if (cur.severity < 3) setDefects(t.id, obs.map((o) => (o.type === type ? { ...o, severity: (o.severity + 1) as 1 | 2 | 3 } : o)));
                      else setDefects(t.id, obs.filter((o) => o.type !== type));
                    }}
                    className={`rounded-full px-2 py-0.5 text-[11px] ${cur ? "bg-gray-900 text-white" : "border border-gray-300 text-gray-600"}`}>
                    {DEFECT_LABELS[type]}{cur ? ` s${cur.severity}` : ""}
                  </button>
                );
              })}
            </div>
            {obs.length > 0 && (
              <div className="mt-1.5 space-y-1">
                {obs.map((o) => (
                  <div key={o.type} className="flex items-center gap-2 text-[11px] text-gray-600">
                    <span className="w-36">{DEFECT_LABELS[o.type] ?? o.type} — affected</span>
                    <input type="number" inputMode="decimal" step="0.5" min="0" value={o.qty}
                      onChange={(e) => setDefects(t.id, obs.map((x) => (x.type === o.type ? { ...x, qty: Number(e.target.value) } : x)))}
                      className="w-16 rounded border border-gray-200 px-1 py-0.5" />
                    <span>{unitLabel(o.type)} → {defectHours(o, defectRates).toFixed(2)}h prep</span>
                  </div>
                ))}
              </div>
            )}

            <input value={draft.crewNotes[t.id] ?? ""} placeholder="Note to crew…"
              onChange={(e) => set({ crewNotes: { ...draft.crewNotes, [t.id]: e.target.value } })}
              className="mt-2 w-full rounded border border-gray-200 px-2 py-1 text-xs" />
          </div>
        );
      })}

      {/* Work that isn't a painted surface (Tom, 23 Aug): plastering, and raw
          timber that has to be sealed first. Hours here are charged at the
          charge-out rate, and the "where" travels to the work order. */}
      <div className="rounded-lg border border-gray-200 bg-white p-3" data-testid="room-allowances">
        <div className="text-xs font-semibold text-gray-700">Also in this room</div>
        {ALLOWANCE_DEFS.map((def) => {
          const cur = draft.allowances?.[def.code] ?? { hours: 0, note: "" };
          const patch = (next: { hours?: number; note?: string }) =>
            set({ allowances: { ...(draft.allowances ?? {}), [def.code]: { ...cur, ...next } } });
          return (
            <div key={def.code} className="mt-2" data-testid={`allowance-${def.code}`}>
              <div className="flex items-center gap-2">
                <span className="w-40 shrink-0 text-xs text-gray-600">{def.label}</span>
                <input type="number" inputMode="decimal" step="0.25" min="0"
                  value={cur.hours || ""} placeholder="hrs"
                  onChange={(e) => patch({ hours: Number(e.target.value) || 0 })}
                  className="w-20 rounded border border-gray-300 px-2 py-1 text-xs" />
                <span className="text-[11px] text-gray-400">hours</span>
              </div>
              <input value={cur.note} placeholder={def.placeholder}
                onChange={(e) => patch({ note: e.target.value })}
                className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs" />
            </div>
          );
        })}
      </div>

      <div className="flex gap-2 pt-1">
        <button onClick={onBack} className="flex-1 rounded-lg border border-gray-400 py-2.5 text-sm">← Back to tiles</button>
        <button onClick={onNextRoom} className="flex-1 rounded-lg bg-gray-900 py-2.5 text-sm font-medium text-white">Next room →</button>
      </div>
    </div>
  );
}
