"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import type { CustomerPayload } from "@/lib/wizard/view";
import { assertCustomerShape } from "@/lib/wizard/contract";
import type { CustomerExteriorView, CustomerScopeRoom } from "@/lib/wizard/scope-editor";
import type { SidesView } from "@/lib/wizard/sides";
import SidesEditor from "./SidesEditor";
import PlanPanel from "./PlanPanel";
import { useCoalesced } from "./useCoalesced";
import type { EstimateDocuments } from "@/lib/wizard/documents";

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
  /** R5: every interior surface the live rate card can price, grouped by
   * the card's own sub-category. `via` says whether the tap is a substrate
   * tick or a rate-code add. */
  catalogue?: Array<{ via: "substrate" | "code"; key: string; label: string; group: string }>;
};

type Payload = CustomerPayload & {
  scopeRooms?: CustomerScopeRoom[];
  exterior?: CustomerExteriorView | null;
  ladder?: Ladder;
  interiorLoop?: InteriorLoopView;
  error?: string;
  /** A guardrail verdict arrives as a 200 with no range — see act(). */
  message?: string;
};

const fmt = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-AU")}`;

/** Matches the wizard-edit route's own cap on a batch. */
const MAX_BATCH = 24;

/** A confirm ends its batch: its refusal is part of the walk, and a batch
 * stops at the first refusal, so anything queued behind one would be lost. */
const endsBatch = (body: Record<string, unknown>) =>
  String(body.action ?? "").startsWith("confirm_");

const emptySubscribe = () => () => {};
const snapshotTrue = () => true;
const snapshotFalse = () => false;

export default function ScopeEditor({ estimateId, initial, initialRooms, initialExterior = null, initialSides = null, initialLadder, initialInteriorLoop = null, roomTypes, liveRange, docs = { plan: null, photos: [] } }: {
  estimateId: string;
  initial: CustomerPayload;
  initialRooms: CustomerScopeRoom[];
  initialExterior?: CustomerExteriorView | null;
  /** Batch 4: a Both job stacks the sides loop below the rooms — ONE
   * combined progress count, ONE CTA (always the visit tier in v1). */
  initialSides?: SidesView | null;
  initialLadder?: Ladder;
  initialInteriorLoop?: InteriorLoopView | null;
  roomTypes: string[];
  liveRange: boolean;
  /** R5: the plan and photos this customer uploaded, pinned beside the loop. */
  docs?: EstimateDocuments;
}) {
  const [payload, setPayload] = useState<CustomerPayload>(initial);
  const [rooms, setRooms] = useState<CustomerScopeRoom[]>(initialRooms);
  const [iloop, setIloop] = useState<InteriorLoopView | null>(initialInteriorLoop);
  const [sidesProg, setSidesProg] = useState<SidesView["progress"] | null>(initialSides?.progress ?? null);
  const [sizeDrafts, setSizeDrafts] = useState<Record<number, { L: string; W: string; open: boolean }>>({});
  // A3: the confirmation walk — one card open at a time; confirming opens
  // the next unconfirmed card and scrolls it into view (mockup openRoom).
  const [openCard, setOpenCard] = useState<string>(() => {
    const il = initialInteriorLoop;
    if (!il) return "";
    const firstRoom = il.rooms.find((r) => !r.confirmed);
    if (firstRoom) return `room:${firstRoom.areaId}`;
    if (!il.meta.done.dw) return "dw";
    if (!il.meta.done.sweep) return "sweep";
    return "";
  });
  function openAndScroll(key: string) {
    setOpenCard(key);
    setTimeout(() => {
      const el = document.querySelector(`[data-card="${key}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
  }
  function nextUnconfirmed(il: InteriorLoopView): string {
    const room = il.rooms.find((r) => !r.confirmed);
    if (room) return `room:${room.areaId}`;
    if (!il.meta.done.dw) return "dw";
    if (!il.meta.done.sweep) return "sweep";
    return "";
  }
  const [shakeCard, setShakeCard] = useState<string | null>(null);
  // P1: production feel — hydration gate, queue indicator, optimistic taps.
  const ready = useSyncExternalStore(emptySubscribe, snapshotTrue, snapshotFalse);
  const [pendingCount, setPendingCount] = useState(0);
  const [optimistic, setOptimistic] = useState<Record<string, string>>({});
  const sel = (key: string, serverOn: boolean, val = "1") => {
    const o = optimistic[key];
    return o != null ? o === val : serverOn;
  };
  const [ladder, setLadder] = useState<Ladder>(initialLadder ?? { tier: "visit", visitSlots: [] });
  const [slotsOpen, setSlotsOpen] = useState(false);
  const [booked, setBooked] = useState<string | null>(null);
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
  // R5: a burst of stepper taps becomes ONE save carrying the final count.
  const { queue, flush } = useCoalesced();
  /** What the customer has tapped a counter to, ahead of the server. The
   * stepper reads THIS, not the server's count — the old code stepped from
   * the server value, so a quick second tap recomputed the same number and
   * the tap was silently lost. */
  const [draftCounts, setDraftCounts] = useState<Record<string, number>>({});
  /** R5.1: surfaces the customer has tapped to add, before the save lands.
   * Without this the chip stayed in the panel and no tile appeared for a
   * whole round trip (~3.4s on production) — so people tapped again, and the
   * second tap became a duplicate the server refused. Reproduced end to end:
   * three taps, nothing visible for fifteen seconds, one surface added. */
  const [pendingAdds, setPendingAdds] = useState<Record<number, string[]>>({});
  const addPending = (areaId: number, label: string) =>
    setPendingAdds((p) => ({ ...p, [areaId]: [...(p[areaId] ?? []), label] }));
  const clearPending = (areaId: number, label: string) =>
    setPendingAdds((p) => ({ ...p, [areaId]: (p[areaId] ?? []).filter((l) => l !== label) }));

  const mid = (payload.rangeLoCents + payload.rangeHiCents) / 2;

  function say(message: string) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }

  /**
   * R5.1 (Tom: "while it continually autosaves, it stops working, so you
   * can't add any further detail and you have to wait").
   *
   * Saves must run one at a time — they read-modify-write one row — and a
   * round trip is ~3.4s on production. Sending one request per tap meant
   * three quick taps took fifteen seconds, showing nothing in between.
   *
   * So taps no longer queue as REQUESTS, they queue as WORK: anything
   * tapped while a save is in flight is collected and sent as a single
   * batch the moment that save returns. Ten taps cost two round trips, not
   * ten, and the customer is never blocked from adding the next thing.
   */
  const queuedRef = useRef<Array<{ body: Record<string, unknown>; describe?: (d: number) => string; onSettled?: () => void }>>([]);

  /**
   * Append a send step to the chain. When the step RUNS it sweeps up
   * everything queued by then — so taps made while the previous save was in
   * flight travel together, and a step that finds an empty queue (because an
   * earlier one already swept it) simply does nothing.
   *
   * Ordering falls out of the chain rather than a flag: a confirm appended
   * after a tap can never overtake it, which is the bug a separate
   * in-flight flag would have introduced.
   */
  function drain() {
    chainRef.current = chainRef.current.then(async () => {
      // Take up to MAX_BATCH (the route's own cap), stopping AFTER the first
      // confirm: a batch halts at its first refusal, and a confirm's refusal
      // is a NORMAL part of the walk ("that question still needs an answer").
      // Batching past one would discard the customer's correction — see the
      // note on endsBatch in SidesEditor.
      const q = queuedRef.current;
      let take = 0;
      while (take < q.length && take < MAX_BATCH) { take++; if (endsBatch(q[take - 1].body)) break; }
      const batch = q.slice(0, take);
      if (batch.length === 0) return;
      queuedRef.current = q.slice(take);
      const before = mid;
      // The last tap owns the toast — it is the one they are watching.
      const describe = [...batch].reverse().find((b) => b.describe)?.describe;
      try {
        const res = await fetch(`/api/estimates/${estimateId}/wizard-edit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // R1.1: this surface renders the CUSTOMER payload — declared
          // explicitly, so a staff preview gets exactly what a customer gets.
          body: JSON.stringify(
            batch.length === 1
              ? { ...batch[0].body, view: "customer" }
              : { actions: batch.map((b) => b.body), view: "customer" },
          ),
        });
        const j = (await res.json().catch(() => ({}))) as Payload;
        if (!res.ok) { say(j.error ?? "That didn't save — try again."); return; }
        assertCustomerShape(j, "ScopeEditor");
        if (typeof j.outcome === "string" && j.outcome !== "reveal") {
          say(j.message ?? "That change needs one of our team — we'll be in touch.");
          return;
        }
        setPayload(j);
        if (j.scopeRooms) setRooms(j.scopeRooms);
        if (j.ladder) setLadder(j.ladder);
        if (j.interiorLoop) setIloop(j.interiorLoop);
        if (liveRange) setFlash((n) => n + 1);
        // A batch that stopped part-way still saved what applied.
        if (j.error) say(j.error);
        else if (describe && liveRange) {
          say(describe((j.rangeLoCents + j.rangeHiCents) / 2 - before));
        } else if (describe) {
          say(describe(0).replace(/ — about.*$/, ""));
        }
      } catch {
        say("That didn't save — check the connection and try again.");
      } finally {
        for (const b of batch) b.onSettled?.();
        setPendingCount((n) => n - batch.length);
        // Anything tapped while this ran needs a step of its own to carry it.
        if (queuedRef.current.length) drain();
      }
    });
  }

  /** Record a whitelisted action; the queue decides when it travels. */
  function act(body: Record<string, unknown>, busyKey: string, describe?: (deltaCents: number) => string, opt?: [string, string], onSettled?: () => void) {
    setBusyKeys((s) => new Set(s).add(busyKey));
    if (opt) setOptimistic((o) => ({ ...o, [opt[0]]: opt[1] }));
    setPendingCount((n) => n + 1);
    queuedRef.current.push({
      body,
      describe,
      onSettled: () => {
        setBusyKeys((s) => { const n = new Set(s); n.delete(busyKey); return n; });
        if (opt) setOptimistic((o) => { const n = { ...o }; delete n[opt[0]]; return n; });
        onSettled?.();
      },
    });
    drain();
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
    // A debounce must never eat an answer: anything still queued goes now,
    // ahead of the confirm, so the room is confirmed with what they tapped.
    flush();
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
        // R5: a guardrail outcome is a 200 with NO range in it. Storing it as
        // the payload rendered "$NaN – $NaN" and an NaN progress ring — the
        // screen looked broken at exactly the moment we needed to explain
        // ourselves. Keep the last good numbers and say the sentence instead.
        if (typeof j.outcome === "string" && j.outcome !== "reveal") {
          say(j.message ?? "That change needs one of our team — we'll be in touch.");
          return;
        }
        setPayload(j);
        if (j.scopeRooms) setRooms(j.scopeRooms);
        if (j.interiorLoop) setIloop(j.interiorLoop);
        if (j.ladder) setLadder(j.ladder);
        say(done);
        if (j.interiorLoop) {
          const nxt = nextUnconfirmed(j.interiorLoop);
          if (nxt) openAndScroll(nxt);
        }
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
    // R5: read the tile's state OPTIMISTICALLY. It used to read the server's
    // `tile.on`, which is stale for the ~2.9s a save takes on production, so
    // a second tap re-sent the SAME instruction and the server answered
    // "that surface isn't on this room" — a red error toast for what the
    // customer experienced as one ordinary double tap.
    const optKey = `on:${room.areaId}:${tile.key}`;
    const isOn = sel(optKey, tile.on);
    const turningOff = isOn;
    // Pairing advice (mockup): skirting off while walls stay on → advisory.
    if (turningOff && tile.key === "skirting" && room.tiles.some((t) => t.key === "walls" && t.on)) {
      setAdvice({ areaId: room.areaId, key: "skirting" });
    }
    act(
      { action: "toggle_surface", areaId: room.areaId, key: tile.key, on: !isOn },
      `${room.areaId}:${tile.key}`,
      deltaText(tile.label, !isOn),
      [optKey, !isOn ? "1" : "0"],
    );
  }

  /** Is this tile ON right now, as far as the customer is concerned? */
  const tileOn = (room: CustomerScopeRoom, tile: CustomerScopeRoom["tiles"][number]) =>
    sel(`on:${room.areaId}:${tile.key}`, tile.on);

  /** The count to SHOW: what the customer has tapped to, falling back to the
   * server's number once the save has landed. */
  const shownCount = (room: CustomerScopeRoom, tile: CustomerScopeRoom["tiles"][number]) =>
    draftCounts[`${room.areaId}:${tile.key}`] ?? tile.count ?? 1;

  function step(room: CustomerScopeRoom, tile: CustomerScopeRoom["tiles"][number], dir: 1 | -1) {
    const cap = tile.surfaceId != null ? 20 : 12;
    const key = `${room.areaId}:${tile.key}`;
    const next = Math.max(1, Math.min(cap, shownCount(room, tile) + dir));
    if (next === shownCount(room, tile)) return;
    setDraftCounts((d) => ({ ...d, [key]: next }));
    // One save per burst, carrying the final count (useCoalesced).
    queue(`n:${key}`, () => act(
      tile.surfaceId != null
        ? { action: "room_line_count", areaId: room.areaId, surfaceId: tile.surfaceId, count: next }
        : { action: "set_count", areaId: room.areaId, key: tile.key, count: next },
      `${key}:n`,
      (d) => `${tile.label} ×${next}${liveRange && Math.abs(d) >= 100 ? ` — about ${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}` : ""}`,
      undefined,
      () => setDraftCounts((cur) => { const n = { ...cur }; delete n[key]; return n; }),
    ));
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

  // Batch 4: ONE loop — interior items plus the embedded sides items.
  const combined = iloop ? {
    done: iloop.progress.done + (sidesProg?.done ?? 0),
    total: iloop.progress.total + (sidesProg?.total ?? 0),
    allDone: iloop.progress.allDone && (sidesProg ? sidesProg.allDone : true),
  } : null;

  /**
   * R5: the add panel's offer for ONE room — everything the card can price
   * that this room hasn't got, grouped the way the card groups it. The two
   * filters matter: a substrate already ticked would refuse server-side
   * ("that surface is already on"), and a rate row already on the room would
   * duplicate the line.
   */
  function addGroupsFor(room: CustomerScopeRoom): Array<[string, NonNullable<InteriorLoopView["catalogue"]>]> {
    const onKeys = new Set(room.tiles.filter((t) => t.on).map((t) => String(t.key)));
    const onLabels = new Set(room.tiles.filter((t) => t.on).map((t) => t.label.toLowerCase()));
    const offered = (iloop?.catalogue ?? []).filter((o) =>
      o.via === "substrate" ? !onKeys.has(o.key) : !onLabels.has(o.label.toLowerCase()) && !onKeys.has(o.key));
    // Long-tail scope rules this room type declares but the card-derived list
    // doesn't name (custom surface types live only in the rules table).
    const extraTail = room.tiles
      .filter((t) => t.longTail && !t.on && !offered.some((o) => o.key === String(t.key)))
      .map((t) => ({ via: "substrate" as const, key: String(t.key), label: t.label, group: "The usual surfaces" }));
    const groups = new Map<string, NonNullable<InteriorLoopView["catalogue"]>>();
    for (const o of [...offered, ...extraTail]) {
      if (!groups.has(o.group)) groups.set(o.group, []);
      groups.get(o.group)!.push(o);
    }
    return [...groups.entries()];
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
      {/* R5 (Tom, 20 Aug): ONE frozen stack — brand, progress and the
          confidence score all stay on screen while the cards scroll under
          them, so "how far am I" and "how sure are we" are never more than
          a glance away. */}
      <div className="sc-freeze">
        <header className="wz-top">
          <div className="wz-wm">PAINT<span>—</span>GROUP</div>
          {iloop && (
            <span className={`sd-status ${combined!.allDone ? "ok" : ""}`}>
              {combined!.allDone ? "ESTIMATE CONFIRMED ✓" : initialSides ? "IN REVIEW · INSIDE THEN OUTSIDE" : "IN REVIEW · CONFIRM EACH ROOM"}
            </span>
          )}
        </header>
        {iloop && (
          <div className="il-progwrap">
            <div className="sd-lbl">
              <span className="il-prog">{combined!.done} OF {combined!.total} CONFIRMED</span>
              <span>ORANGE = STILL TO CONFIRM · BLUE = CONFIRMED</span>
            </div>
            <div className={`sd-pbar ${combined!.allDone ? "ok" : ""}`}>
              <i style={{ width: `${(combined!.done / Math.max(1, combined!.total)) * 100}%` }} />
            </div>
          </div>
        )}
        <div className="sc-scorewrap">
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
                <b>Confidence score</b>
                <span>{combined?.allDone
                  ? "Everything confirmed — this is as sure as we get before we see it"
                  : "It climbs with every room you confirm — we\u2019ll reprice as you go"}</span>
              </div>
            </div>
            <div className="sc-range" key={flash}>
              <small>YOUR ESTIMATE · INCL. GST</small>
              <div className="sc-r">{rangeText}</div>
            </div>
          </div>
        </div>
        <div className="sc-scorewrap" style={{ paddingTop: 0 }}>
          <PlanPanel docs={docs} variant="peek" />
        </div>
      </div>

      <main className="sc-wrap">
        <div className="sc-cols">
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
                data-card={`room:${room.areaId}`}
              >
                <div className="sc-hd il-hd" onClick={() => loop && openAndScroll(`room:${room.areaId}`)} style={loop ? { cursor: "pointer" } : undefined}>
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
                {(!loop || openCard === `room:${room.areaId}`) && (<>
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
                          const rawL = parseFloat(sizeDrafts[room.areaId].L);
                          const rawW = parseFloat(sizeDrafts[room.areaId].W);
                          if (isNaN(rawL) || isNaN(rawW)) { say("Just the two numbers — length and width in metres."); return; }
                          // The gentle clamp (1–15 m a side) — mirrors the
                          // server so the toast reports what was recorded.
                          const L = Math.min(15, Math.max(1, rawL));
                          const W = Math.min(15, Math.max(1, rawW));
                          const clamped = L !== rawL || W !== rawW;
                          act({ action: "room_dims", areaId: room.areaId, lengthM: L, widthM: W }, `dims:${room.areaId}`,
                            () => clamped
                              ? `${room.name} set to ${L} × ${W} m (rooms run 1–15 m a side) — repriced.`
                              : `${room.name} updated to ${L} × ${W} m — repriced for the new size.`);
                          setSizeDrafts((d) => ({ ...d, [room.areaId]: { ...d[room.areaId], open: false } }));
                        }}>Update size</button>
                        <span className="il-unit">metres — pace it out, near enough is fine</span>
                      </div>
                    )}
                  </div>
                )}
                <div className="sc-tgrid">
                  {[...main, ...tail.filter((t) => t.on)]
                    .filter((t) => !(loop && String(t.key) === "windows" && loop.windows.length > 0))
                    .map((t) => (
                    <div
                      key={String(t.key)}
                      className={`sc-tl ${tileOn(room, t) ? "on" : ""} ${busyKeys.has(`${room.areaId}:${t.key}`) ? "busy" : ""}`}
                      role="checkbox" aria-checked={tileOn(room, t)} tabIndex={0}
                      onClick={() => toggle(room, t)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(room, t); } }}
                    >
                      {t.label}
                      {tileOn(room, t) && t.countable && (
                        <span className="sc-st" onClick={(e) => e.stopPropagation()}>
                          <button aria-label="fewer" onClick={() => step(room, t, -1)}>−</button>
                          <b>{shownCount(room, t)}</b>
                          <button aria-label="more" onClick={() => step(room, t, 1)}>+</button>
                        </span>
                      )}
                      {tileOn(room, t) && t.styleToConfirm && (
                        // R1.2: priced at the default rate — visible, never $0.
                        <span className="sc-styleconfirm">style to confirm</span>
                      )}
                    </div>
                  ))}
                  {(pendingAdds[room.areaId] ?? [])
                    .filter((label) => !room.tiles.some((t) => t.on && t.label.toLowerCase() === label.toLowerCase()))
                    .map((label) => (
                      <div key={`pending:${label}`} className="sc-tl on busy" aria-live="polite">{label}</div>
                    ))}
                  {loop && loop.windows.map((w) => (
                    // B4/B5: window GROUPS are tiles of their own, with the
                    // stepper and the S/M/L seg INSIDE the tile (mockup).
                    <div key={`win${w.id}`} className="sc-tl on"
                      role="checkbox" aria-checked tabIndex={0}
                      onClick={() => act({ action: "room_remove_line", areaId: room.areaId, surfaceId: w.id }, `${room.areaId}:win${w.id}`, deltaText(w.label, false))}>
                      {w.label}
                      <span className="sc-st" onClick={(e) => e.stopPropagation()}>
                        <button aria-label="fewer" onClick={() => w.count > 1 && act({ action: "room_line_count", areaId: room.areaId, surfaceId: w.id, count: w.count - 1 }, `${room.areaId}:win${w.id}:n`, (d) => `${w.label} ×${w.count - 1}${Math.abs(d) >= 100 ? ` — about ${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}` : ""}`)}>−</button>
                        <b>{w.count}</b>
                        <button aria-label="more" onClick={() => act({ action: "room_line_count", areaId: room.areaId, surfaceId: w.id, count: w.count + 1 }, `${room.areaId}:win${w.id}:n`, (d) => `${w.label} ×${w.count + 1}${Math.abs(d) >= 100 ? ` — about ${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}` : ""}`)}>+</button>
                      </span>
                      <span className="sd-wseg" onClick={(e) => e.stopPropagation()}>
                        <i>Size</i>
                        {(["S", "M", "L"] as const).map((z) => (
                          <button key={z} className={w.sizeBand === z ? "on" : ""}
                            onClick={() => act({ action: "room_win_size", areaId: room.areaId, surfaceId: w.id, size: z }, `ws:${w.id}`,
                              (d) => `Windows set to ${z === "S" ? "small" : z === "M" ? "medium" : "large"}${Math.abs(d) >= 100 ? ` — ${d >= 0 ? "+" : "−"}${fmt(Math.abs(d))}` : ""}`)}>
                            {z}
                          </button>
                        ))}
                      </span>
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
                    {/* R5: every interior surface the card can price, in the
                        card's own groups — not just this room type's optional
                        rules plus a single "Extras" row. Anything already on
                        the room is filtered out so the panel only ever offers
                        what tapping it would actually add. */}
                    {addGroupsFor(room).map(([group, opts]) => (
                      <div className="sd-group" key={group}>
                        <p className="sd-gl">{group.toUpperCase()}</p>
                        <div className="sd-chips">
                          {opts
                            .filter((o) => !(pendingAdds[room.areaId] ?? []).includes(o.label))
                            .map((o) => (
                            <button key={`${o.via}:${o.key}`} className="sd-chip"
                              onClick={() => {
                                // React on the tap, not on the response.
                                addPending(room.areaId, o.label);
                                act(
                                  o.via === "substrate"
                                    ? { action: "toggle_surface", areaId: room.areaId, key: o.key, on: true }
                                    : { action: "room_add_catalogue", areaId: room.areaId, code: o.key },
                                  `${room.areaId}:${o.key}`, deltaText(o.label, true), undefined,
                                  () => clearPending(room.areaId, o.label));
                              }}>
                              + {o.label}
                            </button>
                          ))}
                          {group === "The usual surfaces" && loop && (
                            <button className="sd-chip"
                              onClick={() => act({ action: "room_add_window_group", areaId: room.areaId }, `wg:${room.areaId}`,
                                () => "Added another window group — set its count and size. Mix as many sizes as the room has.")}>
                              + More windows — a different size
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
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
                </>)}
              </section>
            );
          })}

          {initialSides && (
            // Batch 4: the Both-job editor stacks the SIDES loop below the
            // rooms — the embedded SidesEditor owns its cards and actions,
            // reports progress + range up so this page's single header/CTA
            // covers the whole walk. (The old element-grouped exterior
            // editor is deleted — no estimate renders it any more.)
            <SidesEditor
              estimateId={estimateId}
              initial={initial}
              initialSides={initialSides}
              initialExterior={initialExterior}
              initialLadder={ladder}
              embedded
              onState={({ progress, payload: p }) => { setSidesProg(progress); setPayload(p); }}
            />
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
              <section className={`sc-rc il-card ${iloop.meta.done.dw ? "done" : "amber"} ${shakeCard === "dw" ? "shake" : ""}`} data-card="dw">
                <div className="sc-hd il-hd" onClick={() => openAndScroll("dw")} style={{ cursor: "pointer" }}>
                  <b>Quick check — doors &amp; windows</b>
                  <span className={`il-pill ${iloop.meta.done.dw ? "done" : ""}`}>{iloop.meta.done.dw ? "CONFIRMED ✓" : "CONFIRM THIS"}</span>
                </div>
                {openCard === "dw" && (<>
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
                </>)}
              </section>

              <section className={`sc-rc il-card ${iloop.meta.done.sweep ? "done" : "amber"} ${shakeCard === "sweep" ? "shake" : ""}`} data-card="sweep">
                <div className="sc-hd il-hd" onClick={() => openAndScroll("sweep")} style={{ cursor: "pointer" }}>
                  <b>Last check — anything we haven&rsquo;t listed?</b>
                  <span className={`il-pill ${iloop.meta.done.sweep ? "done" : ""}`}>{iloop.meta.done.sweep ? "CONFIRMED ✓" : "CONFIRM THIS"}</span>
                </div>
                {openCard === "sweep" && (<>
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
                </>)}
              </section>
            </>
          )}
        </div>
        <PlanPanel docs={docs} variant="column" />
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
              disabled={combined != null && !combined.allDone}
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
              {combined != null && !combined.allDone
                ? `Confirm ${initialSides ? "everything" : "all rooms"} to continue — ${combined.done} of ${combined.total}`
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
