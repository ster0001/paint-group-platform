"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import type { CustomerPayload } from "@/lib/wizard/view";
import { assertCustomerShape } from "@/lib/wizard/contract";
import type { CustomerExteriorView, CustomerScopeRoom, ExteriorExtent } from "@/lib/wizard/scope-editor";

type Ladder = { tier: "self_serve" | "visit"; visitSlots: string[] };

/**
 * Part B (interior + shared): the customer scope editor, matching
 * design/reference/customer-scope-editor-mockup.html — room cards with tile
 * grids and steppers, "More surfaces…", the skirting pairing advice,
 * per-room "Something else?" notes (amber, never silently priced), delta
 * toasts and the live range, and the sign-off ladder's framing.
 *
 * This component computes NOTHING. Every tap posts to wizard-edit's
 * whitelisted actions; the server reprices via lib/pricing and answers with
 * the authoritative range + rebuilt tile state. No hour, rate or point
 * price exists anywhere in its props.
 */

import type { InteriorLoopMeta, RoomLoopView } from "@/lib/wizard/rooms-loop";

/** R3: the interior confirm-loop state that rides every customer response. */
export type InteriorLoopView = {
  rooms: RoomLoopView[];
  dw: { doors: number; windows: number; ok: boolean | null };
  meta: InteriorLoopMeta;
  progress: { done: number; total: number; allDone: boolean };
  /** The add-surface panel's priced catalogue (rate-card Interior extras). */
  catalogue?: Array<{ code: string; label: string }>;
};

type Payload = CustomerPayload & {
  scopeRooms?: CustomerScopeRoom[];
  exterior?: CustomerExteriorView | null;
  ladder?: Ladder;
  interiorLoop?: InteriorLoopView;
  error?: string;
};

const fmt = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-AU")}`;

const emptySubscribe = () => () => {};
const snapshotTrue = () => true;
const snapshotFalse = () => false;

export default function ScopeEditor({ estimateId, initial, initialRooms, initialExterior = null, initialLadder, initialInteriorLoop = null, roomTypes, liveRange }: {
  estimateId: string;
  initial: CustomerPayload;
  initialRooms: CustomerScopeRoom[];
  initialExterior?: CustomerExteriorView | null;
  initialLadder?: Ladder;
  initialInteriorLoop?: InteriorLoopView | null;
  roomTypes: string[];
  liveRange: boolean;
}) {
  const [payload, setPayload] = useState<CustomerPayload>(initial);
  const [rooms, setRooms] = useState<CustomerScopeRoom[]>(initialRooms);
  const [iloop, setIloop] = useState<InteriorLoopView | null>(initialInteriorLoop);
  const [sizeDrafts, setSizeDrafts] = useState<Record<number, { L: string; W: string; open: boolean }>>({});
  const [shakeCard, setShakeCard] = useState<string | null>(null);
  // P1: production feel — hydration gate, queue indicator, optimistic taps.
  const ready = useSyncExternalStore(emptySubscribe, snapshotTrue, snapshotFalse);
  const [pendingCount, setPendingCount] = useState(0);
  const [optimistic, setOptimistic] = useState<Record<string, string>>({});
  const sel = (key: string, serverOn: boolean, val = "1") => {
    const o = optimistic[key];
    return o != null ? o === val : serverOn;
  };
  const [exterior, setExterior] = useState<CustomerExteriorView | null>(initialExterior);
  const [ladder, setLadder] = useState<Ladder>(initialLadder ?? { tier: "visit", visitSlots: [] });
  const [slotsOpen, setSlotsOpen] = useState(false);
  const [booked, setBooked] = useState<string | null>(null);
  const [fenceText, setFenceText] = useState("");
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [flash, setFlash] = useState(0);
  const [openPanel, setOpenPanel] = useState<Set<number>>(new Set());
  const [advice, setAdvice] = useState<{ areaId: number; key: string } | null>(null);
  const [notes, setNotes] = useState<Record<number | string, string>>({});
  const [noteChips, setNoteChips] = useState<Record<number | string, string>>({});
  const [accepted, setAccepted] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  const mid = (payload.rangeLoCents + payload.rangeHiCents) / 2;

  function say(message: string) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }

  /** POST a whitelisted action; reconcile range + tiles from the server. */
  function act(body: Record<string, unknown>, busyKey: string, describe?: (deltaCents: number) => string, opt?: [string, string]) {
    setBusyKeys((s) => new Set(s).add(busyKey));
    if (opt) setOptimistic((o) => ({ ...o, [opt[0]]: opt[1] }));
    setPendingCount((n) => n + 1);
    const before = mid;
    chainRef.current = chainRef.current.then(async () => {
      try {
        const res = await fetch(`/api/estimates/${estimateId}/wizard-edit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // R1.1: this surface renders the CUSTOMER payload — declared
          // explicitly, so a staff preview gets exactly what a customer gets.
          body: JSON.stringify({ ...body, view: "customer" }),
        });
        const j = (await res.json().catch(() => ({}))) as Payload;
        if (!res.ok) { say(j.error ?? "That didn't save — try again."); return; }
        assertCustomerShape(j, "ScopeEditor");
        setPayload(j);
        if (j.scopeRooms) setRooms(j.scopeRooms);
        if (j.exterior !== undefined) setExterior(j.exterior);
        if (j.ladder) setLadder(j.ladder);
        if (j.interiorLoop) setIloop(j.interiorLoop);
        if (liveRange) { setFlash((n) => n + 1); }
        if (describe && liveRange) {
          const delta = (j.rangeLoCents + j.rangeHiCents) / 2 - before;
          say(describe(delta));
        } else if (describe) {
          say(describe(0).replace(/ — about.*$/, ""));
        }
      } catch {
        say("That didn't save — check the connection and try again.");
      } finally {
        setBusyKeys((s) => { const n = new Set(s); n.delete(busyKey); return n; });
        setPendingCount((n) => n - 1);
        if (opt) setOptimistic((o) => { const n = { ...o }; delete n[opt[0]]; return n; });
      }
    });
  }

  const deltaText = (label: string, added: boolean) => (delta: number) => {
    const abs = Math.abs(Math.round(delta));
    if (abs < 100) return `${added ? "Added" : "Removed"} ${label.toLowerCase()}.`;
    return `${added ? "Added" : "Removed"} ${label.toLowerCase()} — about ${added ? "+" : "−"}${fmt(abs)} ${added ? "to" : "from"} your range`;
  };

  // ---- R3: the confirm loop -------------------------------------------------
  const loopOf = (areaId: number) => iloop?.rooms.find((r) => r.areaId === areaId) ?? null;
  function refuseCard(key: string, msg: string) {
    setShakeCard(key);
    setTimeout(() => setShakeCard(null), 400);
    say(msg);
  }
  /** Confirm posts get their own path so a 400 shakes the card by name. */
  function confirmAct(body: Record<string, unknown>, cardKey: string, done: string) {
    setOptimistic((o) => ({ ...o, [`confirm:${cardKey}`]: "1" }));
    setPendingCount((n) => n + 1);
    chainRef.current = chainRef.current.then(async () => {
      try {
        const res = await fetch(`/api/estimates/${estimateId}/wizard-edit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, view: "customer" }),
        });
        const j = (await res.json().catch(() => ({}))) as Payload;
        if (!res.ok) { refuseCard(cardKey, j.error ?? "That didn't save — try again."); return; }
        assertCustomerShape(j, "ScopeEditor");
        setPayload(j);
        if (j.scopeRooms) setRooms(j.scopeRooms);
        if (j.interiorLoop) setIloop(j.interiorLoop);
        if (j.ladder) setLadder(j.ladder);
        say(done);
      } catch {
        say("That didn't save — check the connection and try again.");
      } finally {
        setPendingCount((n) => n - 1);
        setOptimistic((o) => { const n = { ...o }; delete n[`confirm:${cardKey}`]; return n; });
      }
    });
  }
  // Hallway leads the sweep — it's the highest-cost commonly-missed area.
  const sweepTypes = iloop
    ? [...roomTypes].sort((a, b) => (a === "hallway" ? -1 : b === "hallway" ? 1 : a.localeCompare(b)))
    : roomTypes;

  function toggle(room: CustomerScopeRoom, tile: CustomerScopeRoom["tiles"][number]) {
    if (tile.surfaceId != null) {
      // Catalogue line — turning it off removes that line.
      act({ action: "room_remove_line", areaId: room.areaId, surfaceId: tile.surfaceId },
        `${room.areaId}:${tile.key}`, deltaText(tile.label, false));
      return;
    }
    const turningOff = tile.on;
    // Pairing advice (mockup): skirting off while walls stay on → advisory.
    if (turningOff && tile.key === "skirting" && room.tiles.some((t) => t.key === "walls" && t.on)) {
      setAdvice({ areaId: room.areaId, key: "skirting" });
    }
    act(
      { action: "toggle_surface", areaId: room.areaId, key: tile.key, on: !tile.on },
      `${room.areaId}:${tile.key}`,
      deltaText(tile.label, !tile.on),
    );
  }

  function step(room: CustomerScopeRoom, tile: CustomerScopeRoom["tiles"][number], dir: 1 | -1) {
    const next = Math.max(1, Math.min(tile.surfaceId != null ? 20 : 12, (tile.count ?? 1) + dir));
    if (next === tile.count) return;
    act(
      tile.surfaceId != null
        ? { action: "room_line_count", areaId: room.areaId, surfaceId: tile.surfaceId, count: next }
        : { action: "set_count", areaId: room.areaId, key: tile.key, count: next },
      `${room.areaId}:${tile.key}:n`,
      (d) => `${tile.label} ×${next}${liveRange && Math.abs(d) >= 100 ? ` — about ${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}` : ""}`,
    );
  }

  /** R3: a named custom surface — an amber flag tile, recorded on the
   * estimate and NEVER auto-priced; the job routes to the visit tier. */
  function addCustom(areaId: number) {
    const text = (notes[areaId] ?? "").trim();
    if (!text) return;
    act(
      { action: "room_custom", areaId, name: text },
      `custom:${areaId}`,
      () => `Thanks — we've added “${text}”, and we'll confirm this area on the site visit.`,
    );
    setNoteChips((c) => ({ ...c, [areaId]: text }));
    setNotes((n) => ({ ...n, [areaId]: "" }));
  }

  const rangeText = `${fmt(payload.rangeLoCents)} – ${fmt(payload.rangeHiCents)}`;
  const selfServe = ladder.tier === "self_serve";
  // The visit tier is an offer, never a block (mockup copy verbatim).
  const tierLine = booked
    ? "Visit booked — your price is confirmed on the day, then fixed in writing."
    : accepted
      ? "Accepted — our team gives it a final desk check, then your fixed price and booking confirmation follow."
      : selfServe
        ? `At ${payload.accuracyPct}% accuracy you can accept online. We confirm details before we start.`
        : "The final step is a short visit so we can stand behind every number.";

  return (
    <div className={ready ? undefined : "wz-waking"} data-ready={ready ? "1" : undefined}>
      {!ready && <div className="sd-saving">ONE MOMENT…</div>}
      {ready && pendingCount > 0 && <div className="sd-saving">SAVING…</div>}
      <header className="wz-top">
        <div className="wz-wm">PAINT<span>—</span>GROUP</div>
        {iloop && (
          <span className={`sd-status ${iloop.progress.allDone ? "ok" : ""}`}>
            {iloop.progress.allDone ? "ESTIMATE CONFIRMED ✓" : "IN REVIEW · CONFIRM EACH ROOM"}
          </span>
        )}
      </header>
      {iloop && (
        <div className="il-progwrap">
          <div className="sd-lbl">
            <span className="il-prog">{iloop.progress.done} OF {iloop.progress.total} CONFIRMED</span>
            <span>ORANGE = STILL TO CONFIRM · BLUE = CONFIRMED</span>
          </div>
          <div className={`sd-pbar ${iloop.progress.allDone ? "ok" : ""}`}>
            <i style={{ width: `${(iloop.progress.done / Math.max(1, iloop.progress.total)) * 100}%` }} />
          </div>
        </div>
      )}

      <main className="sc-wrap">
        <div className="sc-scorebar">
          <div className="sc-score">
            <div className="sc-ring">
              <svg width="48" height="48" style={{ transform: "rotate(-90deg)" }}>
                <circle cx="24" cy="24" r="20" fill="none" stroke="#242B32" strokeWidth="4" />
                <circle cx="24" cy="24" r="20" fill="none" stroke={payload.accuracyPct >= 90 ? "#2FA46B" : "#E0A83C"}
                  strokeWidth="4" strokeLinecap="round" strokeDasharray="125.6"
                  strokeDashoffset={(125.6 * (1 - payload.accuracyPct / 100)).toFixed(1)} />
              </svg>
              <div className="sc-num">{payload.accuracyPct}%</div>
            </div>
            <div className="sc-lbl">
              <b>Shape your estimate</b>
              <span>Add or remove anything — we&rsquo;ll reprice as you go</span>
            </div>
          </div>
          <div className="sc-range" key={flash}>
            <small>YOUR ESTIMATE · INCL. GST</small>
            <div className="sc-r">{rangeText}</div>
          </div>
        </div>

        <div className="sc-cards">
          {rooms.map((room) => {
            const main = room.tiles.filter((t) => !t.longTail);
            const tail = room.tiles.filter((t) => t.longTail);
            
            const loop = loopOf(room.areaId);
            return (
              <section
                className={`sc-rc ${loop?.confirmed ? "done" : loop ? "amber" : ""} ${shakeCard === `room:${room.areaId}` ? "shake" : ""}`}
                key={room.areaId}
                data-room={room.areaId}
              >
                <div className="sc-hd il-hd">
                  <b>
                    {room.name}
                    {loop && (
                      <span className="il-hm"> · {loop.sizeLabel}{loop.size === "adjusted" ? " · updated by you" : ""}</span>
                    )}
                  </b>
                  <span className="sc-m">
                    {loop ? (
                      <span className={`il-pill ${loop.confirmed ? "done" : ""}`}>{loop.confirmed ? "CONFIRMED ✓" : "CONFIRM THIS ROOM"}</span>
                    ) : (
                      room.m2 != null && `${room.m2.toFixed(1)} m²`
                    )}
                    <button
                      className="sc-x" aria-label={`Remove ${room.name}`}
                      onClick={() => act({ action: "remove_room", areaId: room.areaId }, `rm:${room.areaId}`, deltaText(room.name, false))}
                    >×</button>
                  </span>
                </div>
                {loop && (
                  <div className={`il-q ${loop.size != null ? "ok" : ""}`}>
                    <p className="il-ql">
                      Is <span className="il-size">{loop.sizeLabel}{loop.size === "adjusted" ? " · updated by you" : ""}</span> about
                      the size of this room? <span className="il-req">REQUIRED</span><span className="il-okc">✓</span>
                    </p>
                    <div className="sc-chips">
                      <button className={`sd-chip ${sel(`sz:${room.areaId}`, loop.size === "yes", "yes") ? "on" : ""}`}
                        onClick={() => act({ action: "room_size_ok", areaId: room.areaId }, `sz:${room.areaId}`, undefined, [`sz:${room.areaId}`, "yes"])}>
                        Looks right
                      </button>
                      <button className={`sd-chip ${loop.size === "adjusted" || sizeDrafts[room.areaId]?.open ? "on" : ""}`}
                        onClick={() => setSizeDrafts((d) => ({ ...d, [room.areaId]: { L: "", W: "", open: true } }))}>
                        Adjust it
                      </button>
                    </div>
                    {sizeDrafts[room.areaId]?.open && (
                      <div className="sd-mrow">
                        <input placeholder="length m" inputMode="decimal" value={sizeDrafts[room.areaId].L}
                          onChange={(e) => setSizeDrafts((d) => ({ ...d, [room.areaId]: { ...d[room.areaId], L: e.target.value } }))} />
                        <span>×</span>
                        <input placeholder="width m" inputMode="decimal" value={sizeDrafts[room.areaId].W}
                          onChange={(e) => setSizeDrafts((d) => ({ ...d, [room.areaId]: { ...d[room.areaId], W: e.target.value } }))} />
                        <button onClick={() => {
                          const L = parseFloat(sizeDrafts[room.areaId].L);
                          const W = parseFloat(sizeDrafts[room.areaId].W);
                          if (isNaN(L) || isNaN(W)) { say("Just the two numbers — length and width in metres."); return; }
                          act({ action: "room_dims", areaId: room.areaId, lengthM: L, widthM: W }, `dims:${room.areaId}`,
                            () => `${room.name} updated to ${L} × ${W} m — repriced for the new size.`);
                          setSizeDrafts((d) => ({ ...d, [room.areaId]: { ...d[room.areaId], open: false } }));
                        }}>Update size</button>
                        <span className="il-unit">metres — pace it out, near enough is fine</span>
                      </div>
                    )}
                  </div>
                )}
                <div className="sc-tgrid">
                  {[...main, ...tail.filter((t) => t.on)].map((t) => (
                    <div
                      key={String(t.key)}
                      className={`sc-tl ${t.on ? "on" : ""} ${busyKeys.has(`${room.areaId}:${t.key}`) ? "busy" : ""}`}
                      role="checkbox" aria-checked={t.on} tabIndex={0}
                      onClick={() => toggle(room, t)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(room, t); } }}
                    >
                      {t.label}
                      {t.on && t.countable && (
                        <span className="sc-st" onClick={(e) => e.stopPropagation()}>
                          <button aria-label="fewer" onClick={() => step(room, t, -1)}>−</button>
                          <b>{t.count ?? 1}</b>
                          <button aria-label="more" onClick={() => step(room, t, 1)}>+</button>
                        </span>
                      )}
                      {t.on && t.styleToConfirm && (
                        // R1.2: priced at the default rate — visible, never $0.
                        <span className="sc-styleconfirm">style to confirm</span>
                      )}
                    </div>
                  ))}
                </div>
                <button className="sd-addsurf" onClick={() => setOpenPanel((s) => {
                  const n = new Set(s); if (n.has(room.areaId)) n.delete(room.areaId); else n.add(room.areaId); return n;
                })}>
                  + Add a surface
                </button>
                {openPanel.has(room.areaId) && (
                  <div className="sd-addpanel">
                    <p className="sd-pl">EVERYTHING WE PAINT — TAP TO ADD</p>
                    <div className="sd-chips">
                      {tail.filter((t) => !t.on).map((t) => (
                        <button key={String(t.key)} className="sd-chip"
                          onClick={() => act({ action: "toggle_surface", areaId: room.areaId, key: String(t.key), on: true }, `${room.areaId}:${t.key}`, deltaText(t.label, true))}>
                          + {t.label}
                        </button>
                      ))}
                      {(iloop?.catalogue ?? [])
                        .filter((c) => !room.tiles.some((t) => t.label.toLowerCase() === c.label.toLowerCase() && t.on))
                        .map((c) => (
                          <button key={c.code} className="sd-chip"
                            onClick={() => act({ action: "room_add_catalogue", areaId: room.areaId, code: c.code }, `${room.areaId}:cat:${c.code}`, deltaText(c.label, true))}>
                            + {c.label}
                          </button>
                        ))}
                      {loop && (
                        <button className="sd-chip"
                          onClick={() => act({ action: "room_add_window_group", areaId: room.areaId }, `wg:${room.areaId}`,
                            () => "Added another window group — set its count and size. Mix as many sizes as the room has.")}>
                          + More windows — a different size
                        </button>
                      )}
                    </div>
                    <div className="sd-custom">
                      <input
                        placeholder="Something else? Name it — e.g. wall panelling"
                        value={notes[room.areaId] ?? ""}
                        onChange={(e) => setNotes((n) => ({ ...n, [room.areaId]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === "Enter") addCustom(room.areaId); }}
                      />
                      <button onClick={() => addCustom(room.areaId)}>Add</button>
                    </div>
                  </div>
                )}
                {advice?.areaId === room.areaId && (
                  <div className="sc-advice">
                    <span>Skirting is usually painted with the walls — leave it out?</span>
                    <button className="keep" onClick={() => {
                      setAdvice(null);
                      const t = room.tiles.find((x) => x.key === "skirting");
                      if (t && !t.on) act({ action: "toggle_surface", areaId: room.areaId, key: "skirting", on: true }, `${room.areaId}:skirting`, () => "Skirting kept in.");
                      else say("Skirting kept in.");
                    }}>Keep it in</button>
                    <button onClick={() => { setAdvice(null); say(`No problem — skirting left out of ${room.name}.`); }}>Leave it out</button>
                  </div>
                )}
                {loop && loop.windows.length > 0 && (
                  <div className="il-wingroups">
                    {loop.windows.map((w) => (
                      <span className="il-wingroup" key={w.id}>
                        <i>{w.label} ×{w.count}</i>
                        {(["S", "M", "L"] as const).map((z) => (
                          <button key={z} className={w.sizeBand === z ? "on" : ""}
                            onClick={() => act({ action: "room_win_size", areaId: room.areaId, surfaceId: w.id, size: z }, `ws:${w.id}`,
                              () => `Windows set to ${z === "S" ? "small" : z === "M" ? "medium" : "large"} — repriced.`)}>
                            {z}
                          </button>
                        ))}
                      </span>
                    ))}
                    <button className="sd-chip" onClick={() => act({ action: "room_add_window_group", areaId: room.areaId }, `wg:${room.areaId}`,
                      () => "Added another window group — set its count and size. Mix as many sizes as the room has.")}>
                      + More windows — a different size
                    </button>
                  </div>
                )}
                {loop && loop.customs.length > 0 && (
                  <div className="sc-tgrid" style={{ marginTop: 8 }}>
                    {loop.customs.map((name, i) => <div className="sc-tl on custom" key={i}>{name}</div>)}
                  </div>
                )}
                {loop?.cupboard && (
                  <div className={`il-q il-cup ${loop.cupboard.on != null ? "ok" : ""}`}>
                    <p className="il-ql">{loop.cupboard.question} <span className="il-req">REQUIRED</span><span className="il-okc">✓</span></p>
                    <div className="sc-chips">
                      <button className={`sd-chip ${sel(`cup:${room.areaId}`, loop.cupboard.on === true, "yes") ? "on" : ""}`}
                        onClick={() => act({ action: "room_cupboard", areaId: room.areaId, on: true, count: loop.cupboard!.count }, `cup:${room.areaId}`,
                          deltaText(loop.cupboard!.unit, true), [`cup:${room.areaId}`, "yes"])}>
                        Yes
                      </button>
                      <button className={`sd-chip ${sel(`cup:${room.areaId}`, loop.cupboard.on === false, "no") ? "on" : ""}`}
                        onClick={() => act({ action: "room_cupboard", areaId: room.areaId, on: false, count: null }, `cup:${room.areaId}`,
                          () => "Noted — cupboards stay as they are.", [`cup:${room.areaId}`, "no"])}>
                        No
                      </button>
                    </div>
                    {loop.cupboard.on === true && (
                      <span className="sc-st" style={{ display: "flex", marginTop: 8 }}>
                        <button aria-label="fewer" onClick={() => act({ action: "room_cupboard", areaId: room.areaId, on: true, count: Math.max(1, loop.cupboard!.count - 1) }, `cupn:${room.areaId}`)}>−</button>
                        <b>{loop.cupboard.count}</b>
                        <button aria-label="more" onClick={() => act({ action: "room_cupboard", areaId: room.areaId, on: true, count: Math.min(40, loop.cupboard!.count + 1) }, `cupn:${room.areaId}`)}>+</button>
                        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{loop.cupboard.unit}</span>
                      </span>
                    )}
                    {loop.cupboard.on === true && loop.cupboard.note && (
                      <p className="il-note">{loop.cupboard.note}</p>
                    )}
                  </div>
                )}
                {noteChips[room.areaId] && (
                  <div className="sc-notechip">⚑ &ldquo;{noteChips[room.areaId]}&rdquo; — we&rsquo;ll confirm this area on the site visit</div>
                )}
                <div className="sc-inc">Includes filling minor cracks and sanding — allowances set by us</div>
                {loop && (
                  <button
                    className={`sd-confirm il-confirm ${loop.confirmed ? "done" : ""}`}
                    disabled={optimistic[`confirm:room:${room.areaId}`] != null}
                    onClick={() => confirmAct({ action: "confirm_room_loop", areaId: room.areaId }, `room:${room.areaId}`, `${room.name} confirmed ✓`)}
                  >
                    {optimistic[`confirm:room:${room.areaId}`] != null ? "Confirming…" : loop.confirmed ? "Confirmed ✓" : `Confirm ${room.name} ✓`}
                  </button>
                )}
              </section>
            );
          })}

          {exterior && (
            <>
              <div className="sc-geo">
                <span className="g">{exterior.storeys > 1 ? "DOUBLE" : "SINGLE"} STOREY · <i>FROM YOUR PHOTOS</i></span>
                <button onClick={() => {
                  act({ action: "flag_geometry" }, "geo", () => "Flagged — geometry is ours to verify, so your estimator will confirm this on site.");
                }}>Not right? Tell us</button>
              </div>
              {exterior.groups.map((g) => (
                <div key={g.group}>
                  <p className="sc-grouplbl">{g.label}</p>
                  <section className="sc-rc">
                    <div className="sc-tgrid">
                      {g.tiles.map((t) => (
                        <div key={String(t.key)} className={`sc-tl ${t.on ? "on" : ""}`}
                          role="checkbox" aria-checked={t.on} tabIndex={0}
                          onClick={() => act({ action: "toggle_exterior", key: String(t.key), on: !t.on }, `ext:${t.key}`, deltaText(t.label, !t.on))}>
                          {t.label}
                        </div>
                      ))}
                    </div>
                    {g.group === "body" && (
                      <div className="sc-seg">
                        {([["whole", "Whole house"], ["front", "Front only"], ["front_sides", "Front + sides"]] as Array<[ExteriorExtent, string]>).map(([v, l]) => (
                          <button key={v} className={exterior.extent === v ? "on" : ""}
                            onClick={() => act({ action: "set_extent", extent: v }, "extent", (d) => `${l}${liveRange && Math.abs(d) >= 100 ? ` — about ${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}` : ""}`)}>
                            {l}
                          </button>
                        ))}
                      </div>
                    )}
                    {g.group === "roofline" && (
                      <div className="sc-inc">Pre-selected — most exterior quotes include the roofline. Untick anything you don&rsquo;t want.</div>
                    )}
                    {g.group === "extras" && (
                      <div className="sc-else">
                        <input placeholder="Fence length in metres — or type 'not sure'"
                          value={fenceText} onChange={(e) => setFenceText(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                          onBlur={() => {
                            const v = fenceText.trim().toLowerCase();
                            if (!v) return;
                            setFenceText("");
                            if (v.includes("not")) act({ action: "set_fence", metres: null }, "fence", () => "Not a problem — we'll measure it on the day.");
                            else {
                              const m = Number(v.replace(/[^0-9.]/g, ""));
                              if (m > 0) act({ action: "set_fence", metres: m }, "fence", () => `Fence set to ${m} m — range repriced.`);
                            }
                          }} />
                      </div>
                    )}
                  </section>
                </div>
              ))}
              <section className="sc-rc"><div className="sc-inc">Prep, access equipment and sundries are allowed for by us and included in your range</div></section>
            </>
          )}

          {!iloop && (
            <div className="sc-addrooms">
              <p className="q">Are any rooms missing?</p>
              <div className="sc-chips">
                {roomTypes.map((t) => (
                  <button key={t} className="sc-chip"
                    onClick={() => act({ action: "add_room", roomType: t }, `add:${t}`, deltaText(t.replace(/_/g, " "), true))}>
                    + {t.replace(/_/g, " ")}
                  </button>
                ))}
              </div>
            </div>
          )}

          {iloop && (
            <>
              <section className={`sc-rc il-card ${iloop.meta.done.dw ? "done" : "amber"} ${shakeCard === "dw" ? "shake" : ""}`}>
                <div className="sc-hd il-hd">
                  <b>Quick check — doors &amp; windows</b>
                  <span className={`il-pill ${iloop.meta.done.dw ? "done" : ""}`}>{iloop.meta.done.dw ? "CONFIRMED ✓" : "CONFIRM THIS"}</span>
                </div>
                <div className={`il-q ${iloop.dw.ok === true ? "ok" : ""}`}>
                  <p className="il-ql">
                    We make it {iloop.dw.doors} doors and {iloop.dw.windows} windows across the house — is that right?{" "}
                    <span className="il-req">REQUIRED</span><span className="il-okc">✓</span>
                  </p>
                  <div className="sc-chips">
                    <button className={`sd-chip ${sel("dw:ok", iloop.dw.ok === true) ? "on" : ""}`} onClick={() => act({ action: "iloop_dw", ok: true }, "dwok", undefined, ["dw:ok", "1"])}>That&rsquo;s right ✓</button>
                    <button className="sd-chip" onClick={() => { act({ action: "iloop_dw", ok: false }, "dwno"); say("Use the − / + on any room's door or window tile, then come back and tap “That's right”."); }}>
                      Something&rsquo;s off — I&rsquo;ll adjust
                    </button>
                  </div>
                </div>
                <button className={`sd-confirm il-confirm ${iloop.meta.done.dw ? "done" : ""}`}
                  disabled={optimistic["confirm:dw"] != null}
                  onClick={() => confirmAct({ action: "confirm_iloop_item", item: "dw" }, "dw", "Counts confirmed ✓")}>
                  {optimistic["confirm:dw"] != null ? "Confirming…" : iloop.meta.done.dw ? "Confirmed ✓" : "Confirm counts ✓"}
                </button>
              </section>

              <section className={`sc-rc il-card ${iloop.meta.done.sweep ? "done" : "amber"} ${shakeCard === "sweep" ? "shake" : ""}`}>
                <div className="sc-hd il-hd">
                  <b>Last check — anything we haven&rsquo;t listed?</b>
                  <span className={`il-pill ${iloop.meta.done.sweep ? "done" : ""}`}>{iloop.meta.done.sweep ? "CONFIRMED ✓" : "CONFIRM THIS"}</span>
                </div>
                <div className={`il-q ${iloop.meta.sweepAns ? "ok" : ""}`}>
                  <p className="il-ql">
                    Hallways are the ones floorplans miss most — and they make the biggest difference to the price.
                    Laundries, toilets and studies go missing too. <span className="il-req">REQUIRED</span><span className="il-okc">✓</span>
                  </p>
                  <div className="sc-chips">
                    {sweepTypes.map((t) => (
                      <button key={t} className="sd-chip il-chip"
                        onClick={() => act({ action: "add_room", roomType: t }, `add:${t}`,
                          () => `${t.replace(/_/g, " ")} added and priced in — it appears above as a new orange room to confirm.`)}>
                        + {t.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())}
                      </button>
                    ))}
                    <button className={`sd-chip ${sel("sweep:none", iloop.meta.sweepAns === "none") ? "on" : ""}`}
                      onClick={() => act({ action: "iloop_sweep", ans: "none" }, "sweepnone", undefined, ["sweep:none", "1"])}>
                      No — that&rsquo;s everything ✓
                    </button>
                  </div>
                </div>
                <button className={`sd-confirm il-confirm ${iloop.meta.done.sweep ? "done" : ""}`}
                  disabled={optimistic["confirm:sweep"] != null}
                  onClick={() => confirmAct({ action: "confirm_iloop_item", item: "sweep" }, "sweep", "Everything's blue — your estimate is confirmed. Nice work.")}>
                  {optimistic["confirm:sweep"] != null ? "Confirming…" : iloop.meta.done.sweep ? "Confirmed ✓" : "Confirm — nothing missing ✓"}
                </button>
              </section>
            </>
          )}
        </div>
      </main>

      <div className="sc-stick">
        <div className={`sc-tier ${selfServe && !accepted && !booked ? "" : "visit"}`}><i />{tierLine}</div>
        <div className="sc-row">
          <div className="sc-pr"><small>ESTIMATE · INCL. GST</small><span>{rangeText}</span></div>
          <div className="sc-sp" />
          {!accepted && !booked && (
            <button
              className="sc-btn il-cta"
              // R3: acceptance and sign-off sit BEHIND full confirmation.
              disabled={iloop != null && !iloop.progress.allDone}
              onClick={() => {
                if (selfServe) {
                  setAccepted(true);
                  act({ action: "accept_intent" }, "accept");
                  say("Accepted — our team gives it a final desk check today, then your fixed price and booking confirmation follow.");
                } else {
                  setSlotsOpen((v) => !v);
                }
              }}
            >
              {iloop != null && !iloop.progress.allDone
                ? `Confirm all rooms to continue — ${iloop.progress.done} of ${iloop.progress.total}`
                : selfServe ? "Accept estimate" : "Confirm my price — book the visit"}
            </button>
          )}
        </div>
        {slotsOpen && !booked && (
          <div className="sc-slots">
            {ladder.visitSlots.map((slot) => (
              <button key={slot} onClick={() => {
                setSlotsOpen(false);
                setBooked(slot);
                act({ action: "book_visit", slot }, "book");
                say("Booked — your estimator arrives with everything you've built here.");
              }}>{slot.toUpperCase()}</button>
            ))}
          </div>
        )}
      </div>

      {toast && <div className="sc-toast">{toast}</div>}
    </div>
  );
}
