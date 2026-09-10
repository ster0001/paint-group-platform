"use client";

import ContactCard from "./ContactCard";
import ReachStrip from "./ReachStrip";
import { afterLayout, scrollCardToTop } from "./scrollCard";
import { useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { CustomerPayload } from "@/lib/wizard/view";
import { assertCustomerShape } from "@/lib/wizard/contract";
import type { CustomerExteriorView, CustomerScopeRoom } from "@/lib/wizard/scope-editor";
import type { PaintSystemLine } from "@/lib/wizard/systems-view";
import RoomSpots from "./RoomSpots";
import SiteAccessCard from "./SiteAccess";
import JobExtras from "./JobExtras";
import type { JobExtra } from "@/lib/wizard/extras";
import type { SiteAccess } from "@/lib/wizard/site-access";
import type { SidesView } from "@/lib/wizard/sides";
import SidesEditor from "./SidesEditor";
import PlanPanel from "./PlanPanel";
import { useCoalesced } from "./useCoalesced";
import { useStickyRoom } from "./useStickyRoom";
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
import Wordmark from "@/app/wizard/Wordmark";

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
  paintSystems?: PaintSystemLine[];
  siteAccess?: SiteAccess;
  jobExtras?: { on: string[]; colourHelp: boolean; note: string };
  exterior?: CustomerExteriorView | null;
  ladder?: Ladder;
  interiorLoop?: InteriorLoopView;
  error?: string;
  /** A guardrail verdict arrives as a 200 with no range — see act(). */
  message?: string;
};

const fmt = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-AU")}`;

/** A room type as a person says it: "wc" is WC, the rest is words. */
const roomTypeLabel = (t: string) => (t === "wc" ? "WC" : t.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()));

/** Matches the wizard-edit route's own cap on a batch. */
const MAX_BATCH = 24;

/** A confirm ends its batch: its refusal is part of the walk, and a batch
 * stops at the first refusal, so anything queued behind one would be lost. */
const endsBatch = (body: Record<string, unknown>) =>
  String(body.action ?? "").startsWith("confirm_");

/** The door tile's "what comes with each door" segment: value, the label on
 * the button, and how the toast says it back. */
// Tom, 31 Aug: architraves and frames are one thing to a customer — the
// third option is gone, and legacy "architrave" answers render as + frame
// (their priced architrave line stays visible in the room).
const DOOR_SCOPE_SEG: Array<["door" | "frame", string, string]> = [
  ["door", "Door", "the door only"],
  ["frame", "+ frame", "the door and its frame"],
];

/** Walls share (Tom, 31 Aug): how much of the room's walls gets painted. */
const WALLS_SEG: Array<[number, string]> = [[100, "All"], [75, "75%"], [50, "50%"], [25, "25%"]];

const emptySubscribe = () => () => {};
const snapshotTrue = () => true;
const snapshotFalse = () => false;

export default function ScopeEditor({ estimateId, initial, initialRooms, initialExterior = null, initialSides = null, initialLadder, initialInteriorLoop = null, initialSystems = [], initialAccess = { answers: {}, asksLift: false }, initialExtras = { offer: [], on: [], colourHelp: false, note: "" }, roomTypes, liveRange, docs = { plan: null, photos: [] }, logoUrl = null, companyPhone = null, phoneHours = null, customerPhone = null, chatMode = false }: {
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
  logoUrl?: string | null;
  companyPhone?: string | null;
  /** When the office answers the phone — Settings owns the wording. */
  phoneHours?: string | null;
  /** The mobile the customer already gave us (Tom, 8 Sep: don't ask twice). */
  customerPhone?: string | null;
  /** Phase 4 (6 Sep plan): mounted beside the assistant. The chat asks the
   * questions, so this pane is a quiet live preview — no amber list, no
   * details card, cards collapsed — instead of a pile of open questions
   * repeating what the chat is already asking. */
  chatMode?: boolean;
  /** Phase 4 (estimator journey v2 §4.2): the coats and preparation we
   * derived, in the painter's words, with a correction per line. Empty on an
   * exterior-only job or an estimate with no readable wizard snapshot. */
  initialSystems?: PaintSystemLine[];
  /** §4.4 — the site and access answers, and whether a lift applies. */
  initialAccess?: { answers: SiteAccess; asksLift: boolean };
  /** §4.5 — the extras on offer, which are on, the colour tick and the note. */
  initialExtras?: { offer: JobExtra[]; on: string[]; colourHelp: boolean; note: string };
}) {
  const [payload, setPayload] = useState<CustomerPayload>(initial);
  const [rooms, setRooms] = useState<CustomerScopeRoom[]>(initialRooms);
  const [iloop, setIloop] = useState<InteriorLoopView | null>(initialInteriorLoop);
  const [systems, setSystems] = useState<PaintSystemLine[]>(initialSystems);
  const [access, setAccess] = useState<SiteAccess>(initialAccess.answers);
  const [extras, setExtras] = useState({ on: initialExtras.on, colourHelp: initialExtras.colourHelp, note: initialExtras.note });
  const [sidesProg, setSidesProg] = useState<SidesView["progress"] | null>(initialSides?.progress ?? null);
  const [sizeDrafts, setSizeDrafts] = useState<Record<number, { L: string; W: string; open: boolean }>>({});
  // A3: the confirmation walk — one card open at a time; confirming opens
  // the next unconfirmed card and scrolls it into view (mockup openRoom).
  const [openCard, setOpenCard] = useState<string>(() => {
    const il = initialInteriorLoop;
    if (!il || chatMode) return "";
    const firstRoom = il.rooms.find((r) => !r.confirmed);
    if (firstRoom) return `room:${firstRoom.areaId}`;
    if (!il.meta.done.dw) return "dw";
    if (!il.meta.done.sweep) return "sweep";
    return "";
  });
  const router = useRouter();
  function openAndScroll(key: string) {
    // Beside the chat the cards are a preview — a tap opens the FULL editor.
    if (chatMode) { router.push(`/estimate/scope?id=${estimateId}`); return; }
    setOpenCard(key);
    // The card's NAME must land in view — not its middle (see scrollCard.ts).
    afterLayout(() => scrollCardToTop(document.querySelector(`[data-card="${key}"]`)));
  }
  function nextUnconfirmed(il: InteriorLoopView): string {
    const room = il.rooms.find((r) => !r.confirmed);
    if (room) return `room:${room.areaId}`;
    if (!il.meta.done.dw) return "dw";
    if (!il.meta.done.sweep) return "sweep";
    return "";
  }
  const [shakeCard, setShakeCard] = useState<string | null>(null);
  // Tom, 7 Sep: the customer can rename a room ("Bed 2" → "Nursery").
  const [renaming, setRenaming] = useState<{ areaId: number; value: string } | null>(null);
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
  const [sweepOtherOpen, setSweepOtherOpen] = useState(false);
  const [sweepOtherText, setSweepOtherText] = useState("");
  const [booked, setBooked] = useState<string | null>(null);
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  /** Phase 2 (6 Sep plan): the last thing that moved the range, kept under it. */
  const [lastChange, setLastChange] = useState<string | null>(null);
  const [flash, setFlash] = useState(0);
  const [openPanel, setOpenPanel] = useState<Set<number>>(new Set());
  const [advice, setAdvice] = useState<{ areaId: number; key: string } | null>(null);
  const [notes, setNotes] = useState<Record<number | string, string>>({});
  const [noteChips, setNoteChips] = useState<Record<number | string, string>>({});
  /**
   * There is no `accepted` state here any more. Accepting moved to the finish
   * line (§3, screen 10) and lands on the hand-off screen, and this page
   * never sees an accepted estimate anyway — /estimate/scope refuses one
   * outright ("this estimate is accepted — its scope is locked in"). A flag
   * that can only ever be false is three dead branches pretending to be
   * behaviour.
   */
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  /** The fixed footer takes no space in the flow — reserve its real height. */
  const stickRef = useRef<HTMLDivElement | null>(null);
  // R5: a burst of stepper taps becomes ONE save carrying the final count.
  const { queue, flush } = useCoalesced();
  useStickyRoom(stickRef);
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
  // Phase 2 (6 Sep plan): the styles the wizard left "Not sure" are answerable
  // here — the amber lines used to sit at the top with no control behind them.
  const styleOpen = {
    doors: payload.confirmOnSite.some((n) => /door style to confirm/.test(n)),
    windows: payload.confirmOnSite.some((n) => /window style to confirm/.test(n)),
  };
  const styleChip = (label: string, body: Record<string, unknown>, said: string) => (
    <button key={label} className="sd-chip il-chip" onClick={() => act(body, `style:${label}`, () => said)}>{label}</button>
  );

  function say(message: string) {
    setToast(message);
    if (/[$—]/.test(message)) setLastChange(message);
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
        if (j.paintSystems) setSystems(j.paintSystems);
        if (j.siteAccess) setAccess(j.siteAccess);
        if (j.jobExtras) setExtras(j.jobExtras);
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


  /** "+ Something else" in the final sweep — the typed name rides the amber
   * flag, so the estimator prices a "stairwell", never a "Something else". */
  function addSweepOther() {
    const name = sweepOtherText.trim().slice(0, 60);
    if (!name) { say("Give it a name first — a word or two is plenty."); return; }
    act({ action: "iloop_sweep", add: name }, "sweepadd",
      () => `Thanks — "${name}" is on the list; your estimator prices it with you before anything is fixed.`);
    setSweepOtherText("");
    setSweepOtherOpen(false);
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
        if (j.paintSystems) setSystems(j.paintSystems);
        if (j.siteAccess) setAccess(j.siteAccess);
        if (j.jobExtras) setExtras(j.jobExtras);
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

  /**
   * ONE stepper for every +/− on this screen (Tom, 21 Aug: "doors now move
   * quickly, but windows don't — please allow so anything with a +/− button
   * moves the same as the doors").
   *
   * The tile stepper got the optimistic-count + coalesce treatment in R5;
   * the window-group and cupboard steppers were left posting one request per
   * tap off the SERVER's count, which is exactly the two bugs R5 fixed —
   * ~2.9s of nothing per tap, and a quick second tap recomputing the same
   * number and being lost. Everything routes through here now.
   *
   * `key` is the draft-count slot and the coalesce key; `send` builds the
   * action for the settled value.
   */
  function stepBy(
    key: string, current: number, dir: 1 | -1, cap: number,
    send: (count: number) => Record<string, unknown>,
    label: string,
  ) {
    const shown = draftCounts[key] ?? current;
    const next = Math.max(1, Math.min(cap, shown + dir));
    if (next === shown) return;
    setDraftCounts((d) => ({ ...d, [key]: next }));
    // One save per burst, carrying the final count (useCoalesced).
    queue(`n:${key}`, () => act(
      send(next),
      `${key}:n`,
      (d) => `${label} ×${next}${liveRange && Math.abs(d) >= 100 ? ` — about ${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}` : ""}`,
      undefined,
      () => setDraftCounts((cur) => { const n = { ...cur }; delete n[key]; return n; }),
    ));
  }

  /** The count to SHOW for any stepper: the customer's taps, then the server. */
  const shown = (key: string, serverCount: number) => draftCounts[key] ?? serverCount;

  function step(room: CustomerScopeRoom, tile: CustomerScopeRoom["tiles"][number], dir: 1 | -1) {
    stepBy(
      `${room.areaId}:${tile.key}`, tile.count ?? 1, dir, tile.surfaceId != null ? 20 : 12,
      (count) => tile.surfaceId != null
        ? { action: "room_line_count", areaId: room.areaId, surfaceId: tile.surfaceId, count }
        : { action: "set_count", areaId: room.areaId, key: tile.key, count },
      tile.label,
    );
  }

  /** A window GROUP's stepper — same path as the door tile's. */
  function stepWindow(room: CustomerScopeRoom, w: { id: number; count: number; label: string }, dir: 1 | -1) {
    stepBy(`${room.areaId}:win${w.id}`, w.count, dir, 20,
      (count) => ({ action: "room_line_count", areaId: room.areaId, surfaceId: w.id, count }), w.label);
  }

  /** The cupboard stepper — same path again. */
  function stepCupboard(room: CustomerScopeRoom, cup: { count: number; unit: string }, dir: 1 | -1) {
    stepBy(`${room.areaId}:cup`, cup.count, dir, 40,
      (count) => ({ action: "room_cupboard", areaId: room.areaId, on: true, count }), cup.unit);
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
    ? `${booked} — we'll be in touch to finalise your price.`
    : selfServe
        ? `At ${payload.accuracyPct}% accuracy you can accept online. We confirm details before we start.`
        : payload.photosPendingSignOff
          ? "Your photos are with your estimator — pending sign-off for any extra preparation. Then a quick call or visit fixes your price."
          : "The final step is a quick call or a visit with one of our people, so we can stand behind every number.";

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
          <Wordmark logoUrl={logoUrl} />
          {/* Tom, 9 Sep: "estimate confirmed" was the wrong word for this
              moment — WE have not confirmed anything yet, and the customer has
              not accepted. All it means is that they have checked every card
              and the ball is back in their court. Saying so removes a promise
              nobody had made. */}
          {iloop && (
            <span className={`sd-status ${combined!.allDone ? "ok" : ""}`}>
              {combined!.allDone ? "AWAITING YOUR SIGN-OFF" : initialSides ? "IN REVIEW · INSIDE THEN OUTSIDE" : "IN REVIEW · CONFIRM EACH ROOM"}
            </span>
          )}
        </header>
        {iloop && (
          <div className="il-progwrap">
            <div className="sd-lbl">
              {/* Phase 0 (6 Sep plan): rooms and the two whole-job checks are
                  counted apart — "0 of 9 confirmed" read as nine rooms. */}
              <span className="il-prog">{initialSides
                ? `${combined!.done} OF ${combined!.total} CONFIRMED`
                : `${iloop.rooms.filter((r) => r.confirmed).length} OF ${iloop.rooms.length} ROOMS · ${Number(iloop.meta.done.dw) + Number(iloop.meta.done.sweep)} OF 2 CHECKS`}</span>
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
        {/* R1.3 lives HERE now the interstitial result screen is gone
            (Tom, 28 Aug): anything the reads couldn't settle is an amber
            trace the customer sees — never silence. */}
        {chatMode && payload.confirmOnSite.length > 0 && (
          <p className="wz-note" style={{ margin: "14px 0 0" }} data-testid="chat-quiet-note">
            {payload.confirmOnSite.length} {payload.confirmOnSite.length === 1 ? "detail" : "details"} still to settle — I&rsquo;ll ask as we go, or tap any room to answer them yourself.{" "}
            <button type="button" className="wz-linkish" style={{ display: "inline", margin: 0 }} onClick={() => router.push(`/estimate/scope?id=${estimateId}`)} data-testid="chat-open-editor">Open the full editor →</button>
          </p>
        )}
        {!chatMode && (styleOpen.doors || styleOpen.windows || payload.heightUnconfirmed) && (
          <section className="sc-rc il-card amber sc-details" data-card="details" data-testid="details-card">
            <div className="sc-hd il-hd"><b>A few details to settle</b><span className="il-pill">TIGHTENS YOUR RANGE</span></div>
            {styleOpen.doors && (
              <div className="il-q">
                <p className="il-ql">The doors — mostly panelled, or flat?</p>
                <div className="sc-chips">
                  {styleChip("Panel", { action: "set_door_style", style: "panel" }, "Panel doors — every door is priced at the panel rate now")}
                  {styleChip("Flat", { action: "set_door_style", style: "flat" }, "Flat doors — every door is priced at the flat rate now")}
                </div>
              </div>
            )}
            {styleOpen.windows && (
              <div className="il-q">
                <p className="il-ql">The windows — which type, mostly?</p>
                <div className="sc-chips">
                  {styleChip("Casement", { action: "set_window_style", style: "casement" }, "Casement windows — priced at the casement rate now")}
                  {styleChip("Sash", { action: "set_window_style", style: "sash" }, "Sash windows — priced at the sash rate now")}
                  {styleChip("Colonial", { action: "set_window_style", style: "colonial" }, "Colonial windows — priced at the colonial rate now")}
                  {styleChip("Winder", { action: "set_window_style", style: "winder" }, "Winder windows — priced at the awning rate now")}
                </div>
              </div>
            )}
            {payload.heightUnconfirmed && (
              <div className="il-q">
                <p className="il-ql">Ceiling height — approximate is fine.</p>
                <div className="sc-chips">
                  {styleChip("2.4 m", { action: "confirm_height", heightM: 2.4 }, "Ceilings at 2.4 m — every room repriced at that height")}
                  {styleChip("2.7 m", { action: "confirm_height", heightM: 2.7 }, "Ceilings at 2.7 m — every room repriced at that height")}
                  {styleChip("3 m+", { action: "confirm_height", heightM: 3 }, "Ceilings at 3 m — every room repriced at that height")}
                </div>
              </div>
            )}
          </section>
        )}
        {/*
          Phase 4 (estimator journey v2 §4.2, prototype screen 8) — "How we'll
          paint each surface".

          This is the card that makes the derivation honest. The customer was
          never asked to pick coats; they are shown what we worked out, in the
          painter's own words, with one tap per line to correct it. Hidden in
          chat mode like the other question cards — the assistant asks these
          in conversation instead.
        */}
        {!chatMode && systems.length > 0 && (
          <section className="sc-rc il-card sc-systems" data-card="systems" data-testid="systems-card">
            <div className="sc-hd il-hd">
              <b>How we&rsquo;ll paint each surface</b>
              <span className="il-pill">WORKED OUT FOR YOU</span>
            </div>
            <p className="wz-note" style={{ margin: "2px 0 12px" }}>
              You never had to pick coats — we work them out per surface from your colours and the
              condition. Change anything that isn&rsquo;t right.
            </p>
            {systems.map((line) => (
              <div className="il-q" key={line.group} data-testid={`system-${line.group}`}>
                <p className="il-ql">
                  {line.title}
                  <span className="il-hm">
                    {" · "}{line.coats} coat{line.coats === 1 ? "" : "s"}
                    {line.undercoat ? " (one an undercoat)" : ""}
                    {line.group === "doors" && line.surfaceCount > 0 ? ` · ${line.surfaceCount} so far` : ""}
                  </span>
                </p>
                <p className="sc-sys-say" data-testid={`system-say-${line.group}`}>{line.sentence}</p>
                {line.reason !== "" && (
                  <p className="sc-sys-why" data-testid={`system-why-${line.group}`}>Because {line.reason}.</p>
                )}
                {line.group === "trims" && (
                  <p className="il-ql" style={{ marginTop: 10 }}>
                    Are the trims shiny at the moment — a gloss finish?
                    <span className="il-hm"> Old oil-based gloss needs a bonding primer first.</span>
                  </p>
                )}
                {line.chips.length > 0 && (
                  <div className="sc-chips">
                    {line.chips.map((chip) => (
                      <button
                        key={chip.label}
                        type="button"
                        className={`sd-chip il-chip ${chip.on ? "on" : ""}`}
                        aria-pressed={chip.on}
                        data-testid={`system-chip-${line.group}-${chip.patch.field}-${String(chip.patch.value)}`}
                        onClick={() => act(
                          { action: "set_paint_system", field: chip.patch.field, value: chip.patch.value },
                          `sys:${line.group}:${chip.label}`,
                          () => chip.said,
                        )}
                      >{chip.label}</button>
                    ))}
                  </div>
                )}
                {/*
                  Tom, 9 Sep: "what if the doors need 3 coats because they're
                  all stained, but the rest are 2?" — the customer says what is
                  THERE on this surface and the engine derives the coats. Never
                  a coat picker: a picked coat count would walk straight past
                  the coverage rule and tell the painter nothing.
                */}
                {line.flagChips.length > 0 && (
                  <div className="sc-sys-flags">
                    <p className="sc-sys-why" style={{ marginBottom: 6 }}>
                      Anything different about {line.group === "walls" ? "the walls" : line.title.toLowerCase()}?
                    </p>
                    <div className="sc-chips">
                      {line.flagChips.map((chip) => (
                        <button
                          key={chip.patch.field === "surfaceFlag" ? chip.patch.flag : chip.label}
                          type="button"
                          className={`sd-chip il-chip ${chip.on ? "on" : ""}`}
                          aria-pressed={chip.on}
                          data-testid={`system-flag-${line.group}-${chip.patch.field === "surfaceFlag" ? chip.patch.flag : ""}`}
                          onClick={() => chip.patch.field === "surfaceFlag" && act(
                            {
                              action: "set_paint_system", field: "surfaceFlag",
                              group: chip.patch.group, flag: chip.patch.flag, value: chip.patch.value,
                            },
                            `sysflag:${line.group}:${chip.patch.flag}`,
                            () => chip.said,
                          )}
                        >{chip.label}</button>
                      ))}
                    </div>
                  </div>
                )}
                {line.review && (
                  <p className="sc-sys-why" data-testid={`system-review-${line.group}`}>
                    We&rsquo;ll check this one ourselves before your price is fixed.
                  </p>
                )}
              </div>
            ))}
          </section>
        )}
        {/* ⚑ Tom, 10 Sep: "'anything we haven't listed' and 'site and access'
            can move to underneath the rooms — they shouldn't be at the top."
            He is right about the order of the work: the rooms ARE the estimate,
            and two whole-job cards sitting above them pushed the thing somebody
            came to check below the fold. They now follow the rooms, where they
            read as the last two questions rather than the first two. */}
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
                  {renaming?.areaId === room.areaId ? (
                    <form className="sc-rn" data-testid={`room-rename-${room.areaId}`} onClick={(e) => e.stopPropagation()}
                      onSubmit={(e) => {
                        e.preventDefault();
                        const name = renaming.value.trim().slice(0, 60);
                        setRenaming(null);
                        if (name && name !== room.name) act({ action: "rename_room", areaId: room.areaId, name }, `rn:${room.areaId}`, () => `Renamed to ${name}`);
                      }}>
                      <input autoFocus value={renaming.value} maxLength={60} aria-label="Room name"
                        onChange={(e) => setRenaming({ areaId: room.areaId, value: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Escape") setRenaming(null); }} />
                      <button type="submit" className="sc-x">Save</button>
                      <button type="button" className="sc-x" onClick={() => setRenaming(null)}>Cancel</button>
                    </form>
                  ) : (
                    <b>
                      {room.name}
                      {loop && (
                        <span className="il-hm"> · {loop.sizeLabel}{loop.size === "adjusted" ? " · updated by you" : ""}</span>
                      )}
                    </b>
                  )}
                  <span className="sc-m">
                    {loop ? (
                      <span className={`il-pill ${loop.confirmed ? "done" : ""}`}>{loop.confirmed ? "CONFIRMED ✓" : "CONFIRM THIS ROOM"}</span>
                    ) : (
                      room.m2 != null && `${room.m2.toFixed(1)} m²`
                    )}
                    <button
                      className="sc-pen" aria-label={`Rename ${room.name}`} data-testid={`room-rename-btn-${room.areaId}`}
                      onClick={(e) => { e.stopPropagation(); setRenaming({ areaId: room.areaId, value: room.name }); }}
                    >✎</button>
                    <button
                      className="sc-x" aria-label={`Remove ${room.name}`}
                      onClick={() => act({ action: "remove_room", areaId: room.areaId }, `rm:${room.areaId}`, deltaText(room.name, false))}
                    >×</button>
                  </span>
                </div>
                {(!loop || openCard === `room:${room.areaId}`) && (<>
                {/* Tom, 21 Aug: "make this stand out a bit more so it's easy
                    for the customer to answer first." It is the one question
                    every room needs and the one the price moves most on, so it
                    gets its own panel and its own kicker instead of reading
                    like the tiles above it. */}
                {loop && (
                  <div className={`il-q il-first ${loop.size != null ? "ok" : ""}`}>
                    <p className="il-kick">FIRST — THE SIZE OF THIS ROOM</p>
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
                      {tileOn(room, t) && t.doorScope != null && (
                        // Tom, 21 Aug: "it only lists doors, without frames".
                        // The card prices all three, so the tile asks — and
                        // the architrave rides as its own visible line.
                        <span className="sd-wseg" onClick={(e) => e.stopPropagation()}>
                          <i>With each</i>
                          {DOOR_SCOPE_SEG.map(([v, short, said]) => (
                            <button
                              key={v}
                              className={`dsg ${sel(`ds:${room.areaId}`, t.doorScope === v || (v === "frame" && t.doorScope === "architrave"), v) ? "on" : ""}`}
                              onClick={() => act(
                                { action: "room_door_scope", areaId: room.areaId, scope: v },
                                `ds:${room.areaId}`,
                                (d) => `${room.name}: ${said}${liveRange && Math.abs(d) >= 100 ? ` — about ${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}` : ""}`,
                                [`ds:${room.areaId}`, v],
                              )}
                            >
                              {short}
                            </button>
                          ))}
                        </span>
                      )}
                      {tileOn(room, t) && t.wallsPct != null && (
                        // Tom, 31 Aug: "I can't adjust the % of the walls for
                        // any of the rooms" — now every Walls tile can.
                        <span className="sd-wseg" onClick={(e) => e.stopPropagation()}>
                          <i>How much</i>
                          {WALLS_SEG.map(([pct, short]) => (
                            <button
                              key={pct}
                              className={`dsg ${sel(`ws:${room.areaId}`, t.wallsPct === pct, String(pct)) ? "on" : ""}`}
                              data-testid={`walls-share-${room.areaId}-${pct}`}
                              onClick={() => act(
                                { action: "walls_share", areaId: room.areaId, pct },
                                `ws:${room.areaId}`,
                                (d) => `${room.name}: ${pct === 100 ? "all the walls" : `${pct}% of the walls`}${liveRange && Math.abs(d) >= 100 ? ` — about ${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}` : ""}`,
                                [`ws:${room.areaId}`, String(pct)],
                              )}
                            >
                              {short}
                            </button>
                          ))}
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
                        <button aria-label="fewer" onClick={() => stepWindow(room, w, -1)}>−</button>
                        <b>{shown(`${room.areaId}:win${w.id}`, w.count)}</b>
                        <button aria-label="more" onClick={() => stepWindow(room, w, 1)}>+</button>
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
                        <button aria-label="fewer" onClick={() => stepCupboard(room, loop.cupboard!, -1)}>−</button>
                        <b>{shown(`${room.areaId}:cup`, loop.cupboard.count)}</b>
                        <button aria-label="more" onClick={() => stepCupboard(room, loop.cupboard!, 1)}>+</button>
                        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{loop.cupboard.unit}</span>
                      </span>
                    )}
                    {loop.cupboard.on === true && loop.cupboard.note && (
                      <p className="il-note">{loop.cupboard.note}</p>
                    )}
                  </div>
                )}
                {/* Tom, 7 Sep: the walls inside the cupboards, and the inside of the robe doors — asked, not assumed. */}
                {loop?.cupboardInterior && (
                  <div className={`il-q il-cup ${loop.cupboardInterior.on != null ? "ok" : ""}`} data-testid={`cup-interior-${room.areaId}`}>
                    <p className="il-ql">{loop.cupboardInterior.question} <span className="il-okc">✓</span></p>
                    <div className="sc-chips">
                      <button className={`sd-chip ${sel(`cupi:${room.areaId}`, loop.cupboardInterior.on === true, "yes") ? "on" : ""}`}
                        onClick={() => act({ action: "room_cupboard_interior", areaId: room.areaId, on: true, count: loop.cupboardInterior!.count }, `cupi:${room.areaId}`,
                          deltaText(`inside the ${loop.cupboardInterior!.unit}`, true), [`cupi:${room.areaId}`, "yes"])}>
                        Yes
                      </button>
                      <button className={`sd-chip ${sel(`cupi:${room.areaId}`, loop.cupboardInterior.on === false, "no") ? "on" : ""}`}
                        onClick={() => act({ action: "room_cupboard_interior", areaId: room.areaId, on: false, count: null }, `cupi:${room.areaId}`,
                          () => "Noted — the insides stay as they are.", [`cupi:${room.areaId}`, "no"])}>
                        No
                      </button>
                    </div>
                    {loop.cupboardInterior.on === true && (
                      <span className="sc-st" style={{ display: "flex", marginTop: 8 }}>
                        <button aria-label="fewer" onClick={() => stepBy(`${room.areaId}:cupi`, loop.cupboardInterior!.count, -1, 40, (count) => ({ action: "room_cupboard_interior", areaId: room.areaId, on: true, count }), loop.cupboardInterior!.unit)}>−</button>
                        <b>{shown(`${room.areaId}:cupi`, loop.cupboardInterior.count)}</b>
                        <button aria-label="more" onClick={() => stepBy(`${room.areaId}:cupi`, loop.cupboardInterior!.count, 1, 40, (count) => ({ action: "room_cupboard_interior", areaId: room.areaId, on: true, count }), loop.cupboardInterior!.unit)}>+</button>
                        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{loop.cupboardInterior.unit}</span>
                      </span>
                    )}
                    {loop.cupboardInterior.on === true && loop.cupboardInterior.note && <p className="il-note">{loop.cupboardInterior.note}</p>}
                  </div>
                )}
                {loop?.cupboardDoorInside && (
                  <div className={`il-q il-cup ${loop.cupboardDoorInside.on != null ? "ok" : ""}`} data-testid={`cup-door-inside-${room.areaId}`}>
                    <p className="il-ql">{loop.cupboardDoorInside.question} <span className="il-okc">✓</span></p>
                    <div className="sc-chips">
                      <button className={`sd-chip ${sel(`cupd:${room.areaId}`, loop.cupboardDoorInside.on === true, "yes") ? "on" : ""}`}
                        onClick={() => act({ action: "room_cupboard_door_inside", areaId: room.areaId, on: true, count: loop.cupboardDoorInside!.count }, `cupd:${room.areaId}`,
                          deltaText("the inside of the robe doors", true), [`cupd:${room.areaId}`, "yes"])}>
                        Yes
                      </button>
                      <button className={`sd-chip ${sel(`cupd:${room.areaId}`, loop.cupboardDoorInside.on === false, "no") ? "on" : ""}`}
                        onClick={() => act({ action: "room_cupboard_door_inside", areaId: room.areaId, on: false, count: null }, `cupd:${room.areaId}`,
                          () => "Noted — the door insides stay as they are.", [`cupd:${room.areaId}`, "no"])}>
                        No
                      </button>
                    </div>
                    {loop.cupboardDoorInside.on === true && (
                      <span className="sc-st" style={{ display: "flex", marginTop: 8 }}>
                        <button aria-label="fewer" onClick={() => stepBy(`${room.areaId}:cupd`, loop.cupboardDoorInside!.count, -1, 40, (count) => ({ action: "room_cupboard_door_inside", areaId: room.areaId, on: true, count }), loop.cupboardDoorInside!.unit)}>−</button>
                        <b>{shown(`${room.areaId}:cupd`, loop.cupboardDoorInside.count)}</b>
                        <button aria-label="more" onClick={() => stepBy(`${room.areaId}:cupd`, loop.cupboardDoorInside!.count, 1, 40, (count) => ({ action: "room_cupboard_door_inside", areaId: room.areaId, on: true, count }), loop.cupboardDoorInside!.unit)}>+</button>
                        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{loop.cupboardDoorInside.unit}</span>
                      </span>
                    )}
                  </div>
                )}
                {noteChips[room.areaId] && (
                  <div className="sc-notechip">⚑ &ldquo;{noteChips[room.areaId]}&rdquo; — we&rsquo;ll confirm this area on the site visit</div>
                )}
                <div className="sc-inc">Includes filling minor cracks and sanding — allowances set by us</div>
                {room.allowances?.map((a) => <div className="sc-inc" key={a} data-testid="room-allowance">🔒 {a} — allowed for by us</div>)}
                {/* §4.3 — how this room compares, and where the damage is. */}
                {!chatMode && (
                  <RoomSpots
                    estimateId={estimateId}
                    areaId={room.areaId}
                    roomName={room.name}
                    side="interior"
                    spots={room.spots}
                    condition={room.condition}
                    busy={pendingCount > 0}
                    onAdd={(tag, extent, sourceId) => act(
                      { action: "add_spot", areaId: room.areaId, tag, extent, sourceId },
                      `spot:${room.areaId}:${tag}`,
                      () => `Noted in ${room.name} — your painter sees it before day one`,
                    )}
                    onRemove={(surfaceId) => act(
                      { action: "remove_spot", areaId: room.areaId, surfaceId },
                      `spotrm:${room.areaId}:${surfaceId}`,
                      () => "Spot removed",
                    )}
                    onCondition={(c) => act(
                      { action: "set_room_condition", areaId: room.areaId, condition: c },
                      `cond:${room.areaId}`,
                      () => c === "worse" ? `${room.name} flagged as worse — we'll allow for it`
                        : c === "better" ? `${room.name} noted as better than the rest`
                        : `${room.name} same as the rest`,
                    )}
                  />
                )}
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

        {/* §4.5 — named extras price from the card; unusual ones flag. */}
        {/* Shown even when the card carries no extras rows: the "something
            else" box is exactly what a rate card cannot cover. */}
        {!chatMode && (
          <JobExtras
            offer={initialExtras.offer}
            on={extras.on}
            colourHelp={extras.colourHelp}
            note={extras.note}
            busy={pendingCount > 0}
            onToggle={(code, on) => {
              setExtras((e) => ({ ...e, on: on ? [...e.on, code] : e.on.filter((c) => c !== code) }));
              act({ action: "toggle_job_extra", code, on }, `extra:${code}`,
                () => (on ? `${code} added` : `${code} removed`));
            }}
            onColourHelp={(want) => {
              setExtras((e) => ({ ...e, colourHelp: want }));
              act({ action: "set_colour_help", want }, "extra:colour",
                () => want ? "We'll help you choose the colours" : "Colour help removed");
            }}
            onNote={(text) => {
              setExtras((e) => ({ ...e, note: text }));
              act({ action: "extra_note", note: text }, "extra:note",
                () => text ? "Noted — one of our people will price that properly" : "Note cleared");
            }}
          />
        )}
        {/* §4.4 — the four allowance modifiers plus parking, the lift and pets. */}
        {!chatMode && (
          <SiteAccessCard
            answers={access}
            asksLift={initialAccess.asksLift}
            busy={pendingCount > 0}
            onAnswer={(field, value) => {
              // Optimistic, so the chip lights the moment it is tapped; the
              // server's answer replaces it on the next response.
              setAccess((a) => ({ ...a, [field]: value }));
              act(
                { action: "set_site_access", field, value },
                `access:${field}`,
                () => "Noted — that's in your setup allowance",
              );
            }}
          />
        )}
        {!chatMode && payload.confirmOnSite.length > 0 && (
          <p className="wz-note wz-confirmonsite" style={{ margin: "14px 0 0" }}>
            {payload.confirmOnSite.map((n, i) => <span key={i}>⚑ {n}<br /></span>)}
          </p>
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
                  {/* Named for ROOMS, not "anything": phase 5b's job-extras card is
                      already called "Anything we haven't listed", and two cards on
                      one screen saying the same sentence is a card nobody reads. */}
                  <b>Last check — any rooms we&rsquo;ve missed?</b>
                  <span className={`il-pill ${iloop.meta.done.sweep ? "done" : ""}`}>{iloop.meta.done.sweep ? "CONFIRMED ✓" : "CONFIRM THIS"}</span>
                </div>
                {openCard === "sweep" && (<>
                <div className={`il-q ${iloop.meta.sweepAns ? "ok" : ""}`}>
                  <p className="il-ql">
                    {docs.plan
                      ? <>Hallways are the ones floorplans miss most — and they make the biggest difference to the price. Laundries, toilets and studies go missing too.</>
                      : <>Hallways are the rooms people forget most — and they make the biggest difference to the price. Laundries, toilets, studies and garages go missing too.</>}
                    {" "}<span className="il-req">REQUIRED</span><span className="il-okc">✓</span>
                  </p>
                  <div className="sc-chips">
                    {sweepTypes.map((t) => (
                      <button key={t} className="sd-chip il-chip"
                        onClick={() => act({ action: "add_room", roomType: t }, `add:${t}`,
                          () => `${t.replace(/_/g, " ")} added and priced in — it appears above as a new orange room to confirm.`)}>
                        + {roomTypeLabel(t)}
                      </button>
                    ))}
                    {/* Tom, 31 Aug: "something else" opens a box to SAY what —
                        an amber flag with no name tells the estimator nothing. */}
                    {/* Tom, 7 Sep: the insides of the cupboards belong in the last check too. */}
                    <button className="sd-chip il-chip" data-testid="sweep-cup-interior"
                      onClick={() => act({ action: "iloop_sweep_cupboards", kind: "interior" }, "sweep:cupi", () => "Inside the cupboards added to every room where the cupboard doors are on — adjust any room above")}>
                      + Inside the cupboards
                    </button>
                    <button className="sd-chip il-chip" data-testid="sweep-cup-door-inside"
                      onClick={() => act({ action: "iloop_sweep_cupboards", kind: "door_inside" }, "sweep:cupd", () => "Inside of the robe doors added to every bedroom where the robe doors are on — adjust any room above")}>
                      + Inside of the cupboard doors
                    </button>
                    <button className={`sd-chip ${sweepOtherOpen ? "on" : ""}`} onClick={() => setSweepOtherOpen((v) => !v)}>
                      + Something else
                    </button>
                    <button className={`sd-chip ${sel("sweep:none", iloop.meta.sweepAns === "none") ? "on" : ""}`}
                      onClick={() => act({ action: "iloop_sweep", ans: "none" }, "sweepnone", undefined, ["sweep:none", "1"])}>
                      No — that&rsquo;s everything ✓
                    </button>
                  </div>
                  {sweepOtherOpen && (
                    <div className="sd-mrow" style={{ display: "flex", marginTop: 9, gap: 8 }}>
                      <input style={{ flex: 1, width: "auto", minWidth: 180 }} placeholder="What else needs painting? Name it — e.g. stairwell, bungalow" maxLength={60}
                        value={sweepOtherText} onChange={(e) => setSweepOtherText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") addSweepOther(); }} />
                      <button className="sd-chip" onClick={addSweepOther}>Add</button>
                    </div>
                  )}
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

      <div className="sc-stick" ref={stickRef}>
        <div className={`sc-tier ${selfServe && !booked ? "" : "visit"}`}><i />{tierLine}</div>
        {lastChange && <div className="sc-lastchange" data-testid="last-change">Last change: {lastChange}</div>}
        {combined != null && !combined.allDone && !booked && (
          <p className="sd-ctahint" data-testid="cta-hint">
            You don&rsquo;t have to finish first — {combined.done} of {combined.total} confirmed. Tap
            <b> Finalise my price</b> whenever you like and a person picks up the rest with you.
          </p>
        )}
        <div className="sc-row">
          <div className="sc-pr"><small>ESTIMATE · INCL. GST</small><span>{rangeText}</span></div>
          <div className="sc-sp" />
          {!booked && (
            <button
              className="sc-btn il-cta"
              /**
               * The FINISH LINE owns this moment (§3, prototype screen 10).
               * Accepting used to happen right here — one tap at the bottom
               * of a long scroll, with nothing in front of the customer to
               * check the number against.
               *
               * It goes there whatever state the loop is in, and R3's rule is
               * not weakened by that: "fix my price online" appears on the
               * finish screen ONLY when `payload.canAccept`, which is the
               * server's verdict, so a fixed price behind an unconfirmed
               * scope is still impossible. Gating the NAVIGATION as well
               * meant a half-finished job jumped straight to a contact form
               * without ever seeing its own summary — and it made the button
               * depend on a second reading of "is the loop done", which is
               * exactly the kind of duplicate judgement that drifts.
               *
               * Tom, 8 Sep: the button is never dead. It still isn't.
               */
              onClick={() => router.push(`/estimate/finish?id=${estimateId}`)}
            >
              {combined != null && !combined.allDone
                ? "Finalise my price"
                : selfServe ? "Accept estimate" : "Finalise my price"}
            </button>
          )}
        </div>
        {/* Tom, 5 Sep 2026: call us, ask for a call back, or request a site
            visit with the customer's own availability — a person books it. */}
        {slotsOpen && !booked && (
          <ContactCard companyPhone={companyPhone} phoneHours={phoneHours} defaultPhone={customerPhone} onSubmit={(req) => {
            setSlotsOpen(false);
            setBooked(req.how === "visit" ? "Site visit requested" : "Call back requested");
            act({ action: "request_contact", ...req }, "book");
            say(req.how === "visit" ? "Thanks — we'll ring you to lock in a visit time that suits. We're available Monday to Friday." : "Thanks — we'll call you back to finalise your price. We're available Monday to Friday.");
          }} />
        )}
        {/* Tom, 8 Sep: a person is reachable at ANY point of the walk — the
            confirm prompt above stays, this never waits for it. */}
        {!booked && !slotsOpen && (
          <ReachStrip companyPhone={companyPhone} phoneHours={phoneHours} defaultPhone={customerPhone} visitSlots={ladder.visitSlots} busy={busyKeys.has("book")}
            onBookSlot={(slot) => {
              setBooked(`Visit booked — ${slot}`);
              act({ action: "book_visit", slot }, "book");
              say(`Booked — ${slot}. A calendar invite is on its way, and we're available Monday to Friday if anything changes; keep confirming rooms if you like.`);
            }}
            onContact={(req) => {
              setBooked(req.how === "visit" ? "Site visit requested" : "Call back requested");
              act({ action: "request_contact", ...req }, "book");
              say(req.how === "visit" ? "Thanks — we'll ring you to lock in a visit time that suits. We're available Monday to Friday." : "Thanks — we'll call you back — we're available Monday to Friday. Keep confirming rooms if you like.");
            }} />
        )}
      </div>

      {toast && <div className="sc-toast">{toast}</div>}
    </div>
  );
}
