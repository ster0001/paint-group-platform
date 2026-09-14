"use client";

import WhatWeDo from "@/app/wizard/WhatWeDo";
import type { PaintSystemLine } from "@/lib/wizard/systems-view";
type RoomExtrasView = { featureWalls: number; wallpaper: boolean; other: string };

import FinalisePrompt from "./FinalisePrompt";
import AllDoneBanner from "./AllDoneBanner";
import Paginated, { type PaginatedStep } from "./Paginated";
import { DoorTiles, WindowTiles } from "./StyleTiles";
import { alreadySentFrom, useAutoSend } from "./useAutoSend";
import { afterLayout, scrollCardToTop } from "./scrollCard";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { CustomerPayload } from "@/lib/wizard/view";
import { assertCustomerShape } from "@/lib/wizard/contract";
import type { CustomerExteriorView, CustomerScopeRoom } from "@/lib/wizard/scope-editor";
import RoomSpots from "./RoomSpots";
import RoomExtras from "./RoomExtras";
import EstimatorStrip from "@/app/wizard/EstimatorStrip";
import Offer from "@/app/wizard/Offer";
import JobExtras from "./JobExtras";
import type { JobExtra } from "@/lib/wizard/extras";
import type { SiteAccess } from "@/lib/wizard/site-access";
import type { SidesView } from "@/lib/wizard/sides";
import SidesEditor from "./SidesEditor";
import PlanPanel from "./PlanPanel";
import { useCoalesced } from "./useCoalesced";
import { useStickyRoom } from "./useStickyRoom";
import type { EstimateDocuments } from "@/lib/wizard/documents";

import { TIER_LABEL, type Ladder } from "@/lib/wizard/ladder";

/**
 * The surfaces a customer can say are going dark → light, in their words.
 * Substrate keys, so the answer means the same thing to the engine as every
 * other surface answer does.
 */
const DARK_TO_LIGHT_SURFACES: Array<[string, string]> = [
  ["walls", "All walls"],
  ["doors", "Doors"],
  ["architraves", "Architraves"],
  ["skirting", "Skirting boards"],
  ["windows", "Window frames"],
];

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
  /** Sent on every response — the derivation recomputed from the tree the
   *  request just changed. C9 renders it read-only as "What we'll do". */
  paintSystems?: PaintSystemLine[];
  roomExtras?: Record<string, RoomExtrasView>;
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

const fmtMoney = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-AU")}`;

export default function ScopeEditor({ estimateId, initial, initialRooms, initialExterior = null, initialSides = null, initialLadder, initialInteriorLoop = null, initialDarkToLight = { asked: false, surfaces: [], someWalls: false, ceilings: null, ceilingRooms: [] }, initialColourTier = "change", initialSystems = [], initialRoomExtras = {}, estimator = null, customerSuburb = null, initialAccess = { answers: {}, asksLift: false }, initialWindowsPainted = null, initialExtras = { offer: [], on: [], colourHelp: false, note: "" }, roomTypes, liveRange, docs = { plan: null, photos: [] }, logoUrl = null, companyPhone = null, chatMode = false }: {
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
  /** C7 (v2.4) — the estimator this goes to, for the CTA. Null keeps the old label. */
  sendTo?: string | null;
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
  initialDarkToLight?: {
    asked: boolean; surfaces: string[]; someWalls: boolean;
    ceilings: "all" | "some" | null; ceilingRooms: number[];
  };
  initialColourTier?: "fresh" | "change" | "dark_to_light";
  /** C9 — the derived "What we'll do" lines, read-only; re-sent on every reprice. */
  initialSystems?: PaintSystemLine[];
  /** C10 — each room's extras row (feature walls, wallpaper, other), read off the deferrals. */
  initialRoomExtras?: Record<string, RoomExtrasView>;
  /** C11 — the resolved estimator record, for the strip, the human line and the offers. */
  estimator?: { name: string | null; phone: string | null; covers: boolean } | null;
  customerSuburb?: string | null;
  /** C11 — the whole-house condition band, for the human line. */
  initialCondition?: "good" | "wear" | "work";
  /** §4.4 — the site and access answers, and whether a lift applies. */
  initialAccess?: { answers: SiteAccess; asksLift: boolean };
  /** Tom, 14 Sep (item 15). */
  initialWindowsPainted?: "yes" | "no" | null;
  /** §4.5 — the extras on offer, which are on, the colour tick and the note. */
  initialExtras?: { offer: JobExtra[]; on: string[]; colourHelp: boolean; note: string };
}) {
  const [payload, setPayload] = useState<CustomerPayload>(initial);
  const [rooms, setRooms] = useState<CustomerScopeRoom[]>(initialRooms);
  /** C9 — "What we'll do": the derivation, shown back with no controls. */
  const [systems, setSystems] = useState<PaintSystemLine[]>(initialSystems);
  /** C10 — extras in each room, as review lines the estimator prices. */
  const [roomExtras, setRoomExtras] = useState<Record<string, RoomExtrasView>>(initialRoomExtras);
  const [iloop, setIloop] = useState<InteriorLoopView | null>(initialInteriorLoop);
  /**
   * ⚑ The derived paint systems no longer have a screen (Tom, 10 Sep), so the
   * editor no longer holds them. `paintSystems` still rides every response —
   * the DERIVATION is untouched and the work order still reads it — it simply
   * has no card to render into. Keeping the state would be a list nothing shows.
   */
  /**
   * ⚑ Tom, 10 Sep. The one job-wide coat question that survived the systems
   * card: which surfaces are going dark → light, and therefore take three
   * coats. Job-wide and not per room is Tom's own ruling — prep varies room to
   * room, a colour change does not.
   */
  const darkToLightAsked = initialDarkToLight.asked;
  const [darkToLight, setDarkToLight] = useState<string[]>(initialDarkToLight.surfaces);
  /** "Some walls" — an answer we record and a person prices; never a guess. */
  const [someWalls, setSomeWalls] = useState(initialDarkToLight.someWalls);
  /**
   * CEILINGS — the one surface where "some" is answerable (Tom, 11 Sep: *"it
   * isn't typical for a ceiling to go from dark to light… ceilings some rooms,
   * or all ceilings — if it's some rooms, then it adds an option to choose the
   * rooms in the room builder"*).
   *
   * "Some walls" has to stay a note because we cannot know which walls. The
   * rooms, by contrast, are right there on the screen — so this one earns a real
   * price instead of an estimator's follow-up.
   */
  const [ceilingScope, setCeilingScope] = useState<"all" | "some" | null>(initialDarkToLight.ceilings);
  const [ceilingRooms, setCeilingRooms] = useState<number[]>(initialDarkToLight.ceilingRooms);
  const [access, setAccess] = useState<SiteAccess>(initialAccess.answers);
  const [windowsPainted, setWindowsPainted] = useState<"yes" | "no" | null>(initialWindowsPainted);
  /** Tom, 14 Sep (item 19): the room whose measurements are being read back before its confirm. */
  const [sizeConfirm, setSizeConfirm] = useState<number | null>(null);
  const [addRoom, setAddRoom] = useState<{ open: boolean; type: string | null; name: string; L: string; W: string }>({ open: false, type: null, name: "", L: "", W: "" });
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
  /**
   * C10 — deep links from the reveal's assume list (`#rooms`, `#details`,
   * `#access`, `#missed`, `#systems`). A hash names a card; the card opens and
   * lands its heading in view, the same way a tap on it would.
   */
  useEffect(() => {
    if (typeof window === "undefined" || chatMode) return;
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return;
    const firstOpen = iloop?.rooms.find((r) => !r.confirmed)?.areaId;
    const key = hash === "rooms" ? (firstOpen != null ? `room:${firstOpen}` : "")
      : hash === "missed" ? "sweep"
      : hash === "systems" ? "details"
      : hash;
    if (!key) return;
    const t = setTimeout(() => {
      const el = document.querySelector(`[data-card="${key}"]`) ?? document.getElementById(hash);
      if (!el) return;
      setOpenCard(key);
      afterLayout(() => scrollCardToTop(el));
    }, 250);
    return () => clearTimeout(t);
    // Mount only: the hash is where they ARRIVED, not something to follow later.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** C11 — every "book" on this screen goes to the one reach strip (`#reach`). */
  /** Tom, 14 Sep (item 3): every "book" / "reach a person" tap leaves for the booking page. */
  function scrollToReach() {
    router.push(`/estimate/book?id=${estimateId}`);
  }

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
  const [ladder, setLadder] = useState<Ladder>(initialLadder ?? { tier: "guide", selfServe: false, reason: null, visitSlots: [], nextUnlock: null });
  const [prompt, setPrompt] = useState(false);
  const [sweepOtherOpen, setSweepOtherOpen] = useState(false);
  const [sweepOtherText, setSweepOtherText] = useState("");
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
  const trimsLine = systems.find((l) => (l.group === "trims" || l.group === "doors") && l.intent !== "same") ?? null;
  const styleOpen = {
    doors: payload.confirmOnSite.some((n) => /door style to confirm/.test(n)),
    windows: payload.confirmOnSite.some((n) => /window style to confirm/.test(n)),
    // Tom, 14 Sep — the paint questions replace "shiny?": what the trims are
    // painted WITH, then (for water-based or not sure) what is underneath.
    paintBase: trimsLine != null && trimsLine.paintBase == null,
    trimsCurrent: trimsLine != null && trimsLine.paintBase != null && trimsLine.paintBase !== "oil" && trimsLine.trimsCurrent == null,
  };
  const trimsUnsure = trimsLine != null && trimsLine.paintBase != null && trimsLine.paintBase !== "oil" && trimsLine.trimsCurrent === "unsure";

  const styleChip = (label: string, body: Record<string, unknown>, said: string, also?: () => void) => (
    <button key={label} className="sd-chip il-chip" onClick={() => { also?.(); act(body, `style:${label}`, () => said); }}>{label}</button>
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
        if (Array.isArray(j.paintSystems)) setSystems(j.paintSystems);
        if (j.roomExtras) setRoomExtras(j.roomExtras);
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
        if (Array.isArray(j.paintSystems)) setSystems(j.paintSystems);
        if (j.roomExtras) setRoomExtras(j.roomExtras);
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

  // ---- Tom, 14 Sep (items 5, 14, 15): the details, one question at a time ----
  const hasWindows = rooms.some((r) => r.tiles.some((t) => String(t.key) === "windows" && t.on));
  const windowsAnswered = windowsPainted != null || hasWindows || styleOpen.windows;
  const detailSteps: PaginatedStep[] = [];
  if (styleOpen.doors) detailSteps.push({
    key: "doors", label: "Door type", answered: false,
    question: "The doors — mostly panelled, or flat?",
    body: <DoorTiles busy={pendingCount > 0} onPick={(style) => act({ action: "set_door_style", style }, `style:${style}`, () => style === "panel" ? "Panel doors — every door is priced at the panel rate now" : "Flat doors — every door is priced at the flat rate now")} />,
  });
  if (!windowsAnswered || windowsPainted != null) detailSteps.push({
    key: "windows_painted", label: "Window frames", answered: windowsAnswered,
    question: "Are we painting the window frames?",
    hint: "Say yes and every room gets its window frames; then we ask the type.",
    body: (
      <div className="sc-chips" data-testid="details-windows-painted">
        {styleChip(windowsPainted === "yes" ? "Yes ✓" : "Yes", { action: "set_windows_painted", on: true }, "Window frames added to every room — pick the type next", () => setWindowsPainted("yes"))}
        {styleChip(windowsPainted === "no" ? "No ✓" : "No", { action: "set_windows_painted", on: false }, "No window frames — noted", () => setWindowsPainted("no"))}
      </div>
    ),
  });
  if (styleOpen.windows) detailSteps.push({
    key: "windows", label: "Window type", answered: false,
    question: "The windows — which type, mostly?",
    body: <WindowTiles busy={pendingCount > 0} onPick={(style) => act({ action: "set_window_style", style }, `style:${style}`, () => `${style[0].toUpperCase()}${style.slice(1)} windows — priced at that rate now`)} />,
  });
  if (styleOpen.paintBase) detailSteps.push({
    key: "paint_base", label: "Paint on the trims", answered: false,
    question: "Water based or oil based paint on the trims?",
    hint: "Skirtings, doors and trims are two coats as standard. If the woodwork was last painted in oil and you want water based, an undercoat goes on first.",
    body: (
      <div className="sc-chips" data-testid="details-paint-base">
        {styleChip("Water based", { action: "set_paint_system", field: "paintBase", value: "water" }, "Water-based enamel on the trims")}
        {styleChip("Oil based", { action: "set_paint_system", field: "paintBase", value: "oil" }, "Oil-based enamel on the trims — two coats over anything")}
        {styleChip("Not sure", { action: "set_paint_system", field: "paintBase", value: "unsure" }, "We'll help you choose — priced as water-based for now")}
      </div>
    ),
  });
  if (styleOpen.trimsCurrent) detailSteps.push({
    key: "trims_current", label: "What's underneath", answered: false,
    question: "Do you know what the woodwork was last painted in?",
    hint: "If it was oil, extra coats will apply. Oil-based paint is generally shinier than water-based and has more of a rubbery feel.",
    body: (
      <div className="sc-chips" data-testid="details-trims-current">
        {styleChip("Currently oil based", { action: "set_paint_system", field: "glossTrims", value: "yes" }, "Oil underneath — an undercoat and two coats on the trims")}
        {styleChip("Currently water based", { action: "set_paint_system", field: "glossTrims", value: "no" }, "Water underneath — two coats on the trims")}
        {styleChip("Not sure", { action: "set_paint_system", field: "glossTrims", value: "unsure" }, "We'll get our estimator to check the woodwork")}
      </div>
    ),
  });
  if (payload.heightUnconfirmed) detailSteps.push({
    key: "height", label: "Ceiling height", answered: false,
    question: "Ceiling height — approximate is fine.",
    body: (
      <div className="sc-chips" data-testid="details-height">
        {styleChip("2.4 m", { action: "confirm_height", heightM: 2.4 }, "Ceilings at 2.4 m — every room repriced at that height")}
        {styleChip("2.7 m", { action: "confirm_height", heightM: 2.7 }, "Ceilings at 2.7 m — every room repriced at that height")}
        {styleChip("3 m+", { action: "confirm_height", heightM: 3 }, "Ceilings at 3 m — every room repriced at that height")}
      </div>
    ),
  });
  // A card with only answered steps stays for "change an answer"; an empty list hides it.
  const detailsOpen = detailSteps.some((st) => !st.answered);

  // ---- Tom, 14 Sep (items 23, 24, 27, 28, 29): the last checks, one at a time ----
  const garages = rooms.filter((r) => r.garagePending === true);
  const lastSteps: PaginatedStep[] = [];
  for (const g of garages) lastSteps.push({
    key: `garage-${g.areaId}`, label: g.name, answered: false,
    question: `The plan shows a ${g.name.toLowerCase()} — are we painting it?`,
    body: (
      <div className="sc-chips" data-testid={`garage-${g.areaId}`}>
        {styleChip("Yes — paint it", { action: "set_garage", areaId: g.areaId, on: true }, `${g.name} added — it appears above as a room to confirm`)}
        {styleChip("No — leave it out", { action: "set_garage", areaId: g.areaId, on: false }, `${g.name} left out of the price`)}
      </div>
    ),
  });
  if (iloop) {
    lastSteps.push({
      key: "dw", label: "Doors and windows", answered: iloop.meta.done.dw,
      question: <>We make it {iloop.dw.doors} doors and {iloop.dw.windows} windows across the house — is that right?</>,
      body: (
        <div className="sc-chips" data-check="dw">
          <button type="button" className="sd-chip il-chip" data-testid="check-dw-ok" disabled={optimistic["confirm:dw"] != null}
            onClick={() => confirmAct({ action: "iloop_check_done", item: "dw" }, "dw", "Counts confirmed ✓")}>Nothing missed ✓</button>
          <button type="button" className="sd-chip" data-testid="check-dw-off" onClick={() => { act({ action: "iloop_dw", ok: false }, "dwno"); say("Use the − / + on any room's door or window tile, then come back and tap “Nothing missed”."); }}>
            Something&rsquo;s off — I&rsquo;ll adjust
          </button>
        </div>
      ),
    });
    lastSteps.push({
      key: "sweep", label: "Rooms", answered: iloop.meta.done.sweep,
      question: "Please check all rooms have been listed above.",
      hint: docs.plan
        ? "Hallways are the ones floorplans miss most — and they make the biggest difference to the price. Laundries, toilets and studies go missing too."
        : "Hallways are the rooms people forget most — and they make the biggest difference to the price. Laundries, toilets, studies and garages go missing too.",
      body: (
        <div data-check="sweep">
          <div className="sc-chips">
            <button type="button" className="sd-chip il-chip" data-testid="check-rooms-ok" disabled={optimistic["confirm:sweep"] != null}
              onClick={() => confirmAct({ action: "iloop_check_done", item: "sweep" }, "sweep", "Everything's blue — your estimate is confirmed. Nice work.")}>Confirm — nothing missing</button>
            <button type="button" className={`sd-chip ${addRoom.open ? "on" : ""}`} data-testid="check-rooms-add" onClick={() => setAddRoom((a) => ({ ...a, open: !a.open }))}>Add room</button>
          </div>
          {addRoom.open && (
            <div className="sc-addroom" data-testid="add-room-form">
              <p className="il-hint">Which kind of room?</p>
              <div className="sc-chips">
                {sweepTypes.map((t) => (
                  <button key={t} type="button" className={`sd-chip il-chip ${addRoom.type === t ? "on" : ""}`} aria-pressed={addRoom.type === t} data-testid={`add-room-type-${t}`}
                    onClick={() => setAddRoom((a) => ({ ...a, type: t, name: a.name || roomTypeLabel(t) }))}>{roomTypeLabel(t)}</button>
                ))}
              </div>
              <div className="sd-mrow" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 9 }}>
                <input style={{ flex: "1 1 160px", width: "auto" }} placeholder="Name it — e.g. Dining" maxLength={60} value={addRoom.name} data-testid="add-room-name"
                  onChange={(e) => setAddRoom((a) => ({ ...a, name: e.target.value }))} />
                <input placeholder="length m" inputMode="decimal" value={addRoom.L} data-testid="add-room-length" onChange={(e) => setAddRoom((a) => ({ ...a, L: e.target.value }))} />
                <span>×</span>
                <input placeholder="width m" inputMode="decimal" value={addRoom.W} data-testid="add-room-width" onChange={(e) => setAddRoom((a) => ({ ...a, W: e.target.value }))} />
                <button type="button" className="sd-chip il-chip" data-testid="add-room-go" disabled={!addRoom.type}
                  onClick={() => {
                    if (!addRoom.type) return;
                    const L = Number(addRoom.L), W = Number(addRoom.W);
                    const dims = L >= 1 && L <= 15 && W >= 1 && W <= 15 ? { lengthM: Math.round(L * 10) / 10, widthM: Math.round(W * 10) / 10 } : {};
                    const name = addRoom.name.trim() || undefined;
                    act({ action: "add_room", roomType: addRoom.type, name, ...dims }, `add:${addRoom.type}`,
                      () => `${name ?? roomTypeLabel(addRoom.type!)} added and priced in — it appears above as a new orange room to confirm.`);
                    setAddRoom({ open: false, type: null, name: "", L: "", W: "" });
                  }}>Add it</button>
              </div>
              <p className="il-hint">Measurements are optional — leave them out and it starts at a typical size.</p>
              <div className="sc-chips" style={{ marginTop: 8 }}>
                <button type="button" className="sd-chip il-chip" data-testid="sweep-cup-interior"
                  onClick={() => act({ action: "iloop_sweep_cupboards", kind: "interior" }, "sweep:cupi", () => "Inside the cupboards added to every room where the cupboard doors are on — adjust any room above")}>
                  + Inside the cupboards
                </button>
                <button type="button" className="sd-chip il-chip" data-testid="sweep-cup-door-inside"
                  onClick={() => act({ action: "iloop_sweep_cupboards", kind: "door_inside" }, "sweep:cupd", () => "Inside of the robe doors added to every bedroom where the robe doors are on — adjust any room above")}>
                  + Inside of the cupboard doors
                </button>
                <button type="button" className={`sd-chip ${sweepOtherOpen ? "on" : ""}`} onClick={() => setSweepOtherOpen((v) => !v)}>+ Something else</button>
              </div>
              {sweepOtherOpen && (
                <div className="sd-mrow" style={{ display: "flex", marginTop: 9, gap: 8 }}>
                  <input style={{ flex: 1, width: "auto", minWidth: 180 }} placeholder="What else needs painting? Name it — e.g. stairwell, bungalow" maxLength={60}
                    value={sweepOtherText} onChange={(e) => setSweepOtherText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") addSweepOther(); }} />
                  <button type="button" className="sd-chip" onClick={addSweepOther}>Add</button>
                </div>
              )}
            </div>
          )}
        </div>
      ),
    });
  }
  const accessQuestions: Array<{ field: keyof SiteAccess; label: string; hint?: string; options: Array<{ value: string; label: string }> }> = [
    { field: "cleared", label: "Will the rooms be cleared before we start?", options: [{ value: "yes", label: "Yes" }, { value: "some", label: "Mostly" }, { value: "no", label: "Furniture stays" }] },
    { field: "stairwell", label: "A stairwell or void with high walls?", hint: "So your painter arrives with the right gear.", options: [{ value: "no", label: "No" }, { value: "yes", label: "Yes" }] },
    { field: "parking", label: "Where can we park?", options: [{ value: "drive", label: "Driveway" }, { value: "street", label: "Street" }, { value: "hard", label: "Tricky" }] },
    ...(initialAccess.asksLift ? [{ field: "lift" as keyof SiteAccess, label: "Does the building need a lift booking?", hint: "We book the lift and work to the building's hours.", options: [{ value: "no", label: "No" }, { value: "yes", label: "Yes" }] }] : []),
  ];
  for (const q of accessQuestions) lastSteps.push({
    key: `access-${q.field}`, label: q.field === "cleared" ? "Furniture" : q.field === "stairwell" ? "Stairwell" : q.field === "parking" ? "Parking" : "Lift", answered: access[q.field] != null,
    question: q.label, hint: q.hint,
    body: (
      <div className="sc-chips" data-testid={`access-${q.field}`}>
        {q.options.map((o) => {
          const on = access[q.field] === o.value;
          return (
            <button key={o.value} type="button" className={`sd-chip il-chip ${on ? "on" : ""}`} aria-pressed={on} disabled={pendingCount > 0} data-testid={`access-${q.field}-${o.value}`}
              onClick={() => {
                setAccess((a) => ({ ...a, [q.field]: o.value }));
                act({ action: "set_site_access", field: q.field, value: o.value }, `access:${q.field}`, () => "Noted — that's in your setup allowance");
              }}>{o.label}</button>
          );
        })}
      </div>
    ),
  });
  const lastOpen = lastSteps.some((st) => !st.answered);

  /**
   * Tom, 14 Sep (items 2, 31): "everything answered" = every room and both
   * checks confirmed, and nothing left open on the details card. Finalise
   * before that prompts them to finish; reaching it sends the estimate by
   * itself and lights the page up.
   */
  const complete = (combined?.allDone ?? false) && !detailsOpen && !lastOpen;
  const autoSend = useAutoSend(estimateId, complete, ready && pendingCount === 0, alreadySentFrom(payload.confirmOnSite));
  const sentHref = `/estimate/sent?id=${estimateId}`;
  function nextOpen(): string {
    if (detailsOpen) return "details";
    if (iloop) { const n = nextUnconfirmed(iloop); if (n) return n; }
    if (lastOpen) return "sweep";
    return "";
  }
  function onFinalise() {
    if (autoSend === "sent") { router.push(sentHref); return; }
    if (!complete) { setPrompt(true); return; }
    router.push(`/estimate/finish?id=${estimateId}`);
  }
  function answerRemaining() {
    setPrompt(false);
    const key = nextOpen();
    if (key) { openAndScroll(key); return; }
    // Inside is done but a side is not (a "both" job): the first orange side card.
    afterLayout(() => scrollCardToTop(document.querySelector(".sd-card:not(.done)")));
  }

  return (
    <div className={`${ready ? "" : "wz-waking"} ${autoSend === "sent" ? "sc-lit" : ""}`.trim() || undefined} data-ready={ready ? "1" : undefined} data-sent={autoSend === "sent" ? "1" : undefined}>
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
        {/* Tom, 14 Sep (item 4): the estimator — and the Call button — live in the frozen header. */}
        {!chatMode && (
          <div className="sc-estwrap">
            <EstimatorStrip estimator={estimator} suburb={customerSuburb} companyPhone={companyPhone} onBook={() => scrollToReach()} compact />
          </div>
        )}
        <div className="sc-scorewrap">
          <div className="sc-scorebar">
            <div className="sc-score">
              <div className={`sc-ring ${pendingCount > 0 ? "live" : ""}`} data-live={pendingCount > 0 ? "1" : "0"}>
                <svg width="48" height="48" style={{ transform: "rotate(-90deg)" }}>
                  <circle cx="24" cy="24" r="20" fill="none" stroke="#242B32" strokeWidth="4" />
                  <circle cx="24" cy="24" r="20" fill="none" stroke={payload.accuracyPct >= 90 ? "#2FA46B" : "#E0A83C"}
                    strokeWidth="4" strokeLinecap="round" strokeDasharray="125.6"
                    strokeDashoffset={(125.6 * Math.max(0, Math.min(1, (payload.bandPct - (payload.tightPct ?? 4)) / Math.max(1, (payload.widePct ?? 15) - (payload.tightPct ?? 4))))).toFixed(1)} />
                </svg>
                <div className="sc-num" data-testid="range-width">±{payload.bandPct}%</div>
              </div>
              <div className="sc-lbl">
                <b>Your range <span className={`tier-chip ${ladder.tier}`} data-testid="tier-chip">{TIER_LABEL[ladder.tier].toUpperCase()}</span></b>
                {/* PR 1 of the tiers plan: the next unlock never names a target this
                    road can't reach — a no-plan job is shown Detailed as its goal and
                    Confirmed as "upload your floorplan". */}
                <span data-testid="tier-next">{ladder.nextUnlock
                  ? `${ladder.nextUnlock.needs.length === 1 ? "One step" : `${ladder.nextUnlock.needs.length} steps`} to ${TIER_LABEL[ladder.nextUnlock.tier]}: ${ladder.nextUnlock.needs.join(" · ")}`
                  : combined?.allDone
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
        {complete && autoSend !== "idle" && <AllDoneBanner estimator={estimator?.name ?? null} sentHref={sentHref} state={autoSend === "sending" ? "sending" : autoSend === "sent" ? "sent" : "failed"} />}
        {/* R1.3 lives HERE now the interstitial result screen is gone
            (Tom, 28 Aug): anything the reads couldn't settle is an amber
            trace the customer sees — never silence. */}
        {chatMode && payload.confirmOnSite.length > 0 && (
          <p className="wz-note" style={{ margin: "14px 0 0" }} data-testid="chat-quiet-note">
            {payload.confirmOnSite.length} {payload.confirmOnSite.length === 1 ? "detail" : "details"} still to settle — I&rsquo;ll ask as we go, or tap any room to answer them yourself.{" "}
            <button type="button" className="wz-linkish" style={{ display: "inline", margin: 0 }} onClick={() => router.push(`/estimate/scope?id=${estimateId}`)} data-testid="chat-open-editor">Open the full editor →</button>
          </p>
        )}
        {/* Tom, 14 Sep (item 4): the estimator strip moved into the frozen header. */}
        {/* Tom, 14 Sep (items 5, 14, 15): the details to settle, one question at a time. */}
        {!chatMode && detailSteps.length > 0 && (
          <Paginated
            testid="details-card" dataCard="details" id="details" cardClass="sc-details"
            title="A few details to settle" pill="TIGHTENS YOUR RANGE"
            lead={Object.values(payload.openClosesCents ?? {}).some((v) => v > 0) ? (
              <p className="il-hint" data-testid="details-closes">
                Answering these closes about {fmtMoney(Object.values(payload.openClosesCents ?? {}).reduce((n, v) => n + v, 0))} of your range.
              </p>
            ) : null}
            steps={detailSteps}
            settledText="All settled — every detail here is answered."
            after={trimsUnsure ? (
              <p className="il-hint" data-testid="details-trims-check">
                We&rsquo;ll get our estimator to check whether the woodwork is oil or water based. It&rsquo;s priced at two coats for now; an undercoat and a third coat apply if it&rsquo;s oil.
              </p>
            ) : null}
          />
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
        {/*
          ⚑ "HOW WE'LL PAINT EACH SURFACE" IS GONE (Tom, 10 Sep).

          *"It doesn't provide a great deal of value — the client has already
          confirmed if they want a colour change, colour match or dark to
          light."* He is right, and the card was answering a question nobody
          had asked twice: it restated a derivation from answers already given,
          then offered corrections most people never made. What actually
          decides the price is the EXCEPTIONS, and those are per room.

          What replaced it:
            · the one job-wide question that genuinely changes coats — which
              surfaces are going dark to light — asked here, once (below)
            · everything else per room, in the room's own prep question

          The derivation itself is untouched. lib/pricing/systems.ts still
          works the coats out per surface group; it is the SCREEN that has gone,
          not the thinking behind it.
        */}
        {!chatMode && darkToLightAsked && (
          <section className="sc-rc il-card sc-darklight" data-card="darklight" data-testid="darklight-card">
            <div className="sc-hd il-hd">
              <b>Which surfaces are going from dark to light?</b>
              <span className="il-pill">THREE COATS</span>
            </div>
            <p className="wz-note" style={{ margin: "2px 0 12px" }}>
              Covering a dark colour with a light one takes a third coat. Tick everything that applies —
              anything you don&rsquo;t tick is quoted at two coats as standard.
            </p>
            <div className="sc-chips">
              {DARK_TO_LIGHT_SURFACES.map(([key, label]) => {
                const on = darkToLight.includes(key);
                return (
                  <button
                    key={key}
                    className={`sd-chip il-chip ${sel(`d2l:${key}`, on, on ? "on" : "off") ? "on" : ""}`}
                    aria-pressed={on}
                    data-testid={`darklight-${key}`}
                    onClick={() => {
                      setDarkToLight((cur) => (on ? cur.filter((k) => k !== key) : [...cur, key]));
                      act(
                      { action: "set_paint_system", field: "darkToLight", group: key, value: !on },
                      `d2l:${key}`,
                      (d) => `${label} ${!on ? "in three coats" : "back to two"}${liveRange && Math.abs(d) >= 100 ? ` — about ${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}` : ""}`,
                      [`d2l:${key}`, !on ? "on" : "off"],
                      );
                    }}
                  >{label}</button>
                );
              })}
              {/*
                ⚑ "SOME WALLS" IS NOT A QUANTITY, so it must not become one.
                Ticking every wall for a third coat when one feature wall is
                changing over-quotes a whole house; leaving it at two
                under-quotes the wall that is. Neither is a number we know, so
                this records the answer, prices the standard, and puts it in
                front of a person — the same rule the rest of the estimate
                follows when a customer tells us something we cannot measure.
              */}
              <button
                className={`sd-chip il-chip ${someWalls ? "on" : ""}`}
                aria-pressed={someWalls}
                data-testid="darklight-some-walls"
                onClick={() => {
                  setSomeWalls((v) => !v);
                  act(
                    { action: "set_paint_system", field: "surfaceFlag", group: "walls", flag: "some_dark_to_light", value: !someWalls },
                    "d2l:some",
                    () => !someWalls
                      ? "Noted — your estimator confirms which walls need the third coat before your price is fixed"
                      : "Removed",
                    ["d2l:some", !someWalls ? "on" : "off"],
                  );
                }}
              >Some walls</button>
            </div>
            {someWalls && (
              <p className="wz-note" data-testid="darklight-some-note">
                We&rsquo;ve quoted the walls at the standard two coats. Your estimator confirms which ones are
                going dark to light and adds the third coat to those — you&rsquo;ll see it before the price is fixed.
              </p>
            )}
            {/*
              ⚑ CEILINGS GET THEIR OWN ROW, and Tom's reason is the right one:
              *"it isn't typical for a ceiling to go from dark to light."* A plain
              chip alongside the walls and doors would invite a tap that adds a
              third coat to every ceiling in the house — so the question is asked
              as the two answers that are actually true, and the unusual one
              (some rooms) hands the choice to the room cards where the rooms are.
            */}
            <div className="sc-d2lceil" data-testid="darklight-ceilings-row">
              <p className="il-ql">The ceilings — any of them going dark to light?</p>
              {/*
                ⚑ Says "the extra coat", NOT "three coats". The ceilings row of
                the paint-system table reads "a new ceiling colour — two coats of
                flat ceiling paint", where a wall going dark to light is three.
                That row is Tom's to set in Settings, so the card describes what
                it does rather than quoting a number the table might not agree
                with. Promising three and charging two is how a quote and an
                estimate stop matching.
              */}
              <p className="wz-note" style={{ margin: "2px 0 8px" }}>
                Not common — a ceiling is usually white over white. Where one is going lighter we allow the
                extra coat it needs.
              </p>
              <div className="sc-chips">
                {([["all", "All ceilings"], ["some", "Some rooms"]] as const).map(([v, label]) => {
                  const on = ceilingScope === v;
                  return (
                    <button
                      key={v}
                      className={`sd-chip il-chip ${on ? "on" : ""}`}
                      aria-pressed={on}
                      data-testid={`darklight-ceilings-${v}`}
                      onClick={() => {
                        // Tapping the chip that is already on turns it OFF —
                        // the usual answer is "none", and it must be reachable
                        // without a third chip that says nothing.
                        const value = on ? null : v;
                        setCeilingScope(value);
                        if (value !== "some") setCeilingRooms([]);
                        act(
                          { action: "set_paint_system", field: "darkToLightCeilings", value },
                          "d2l:ceilings",
                          (d) => value === "all"
                            ? `Every ceiling gets the extra coat${liveRange && Math.abs(d) >= 100 ? ` — about ${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}` : ""}`
                            : value === "some"
                              ? "Pick the rooms on the cards below — the rest stay at the standard"
                              : "Ceilings back to the standard",
                          ["d2l:ceilings", value ?? "off"],
                        );
                      }}
                    >{label}</button>
                  );
                })}
              </div>
              {ceilingScope === "some" && (
                <p className="wz-note" data-testid="darklight-ceilings-some-note">
                  {ceilingRooms.length === 0
                    ? "Tick the ceiling on each room below. Until you do, every ceiling is quoted at the standard — we'd rather ask than add a coat you didn't."
                    : `${ceilingRooms.length} ${ceilingRooms.length === 1 ? "ceiling" : "ceilings"} with the extra coat; the rest at the standard.`}
                </p>
              )}
            </div>
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
          {rooms.filter((r) => r.garagePending !== true).map((room) => {
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
                    {/* C16 (b): a reader's size proposal beside a confirmed size — offered, never applied. */}
                    {room.proposed && room.proposed.L != null && room.proposed.W != null && (
                      <div className="wz-proposal" data-testid={`proposal-${room.areaId}`}>
                        <span>We read about {room.proposed.L} × {room.proposed.W} m from your {room.proposed.by === "brief" ? "description" : "photo"} — use that instead?</span>
                        <button type="button" onClick={() => act({ action: "room_dims", areaId: room.areaId, lengthM: room.proposed!.L!, widthM: room.proposed!.W! }, `dims:${room.areaId}`, () => `${room.name} updated to ${room.proposed!.L} × ${room.proposed!.W} m — repriced.`)}>Use it</button>
                        <button type="button" onClick={() => act({ action: "room_size_ok", areaId: room.areaId }, `sz:${room.areaId}`, undefined, [`sz:${room.areaId}`, "yes"])}>Keep mine</button>
                      </div>
                    )}
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
                {/*
                  ⚑ Tom, 11 Sep — the per-room half of the ceilings answer.
                  It appears ONLY when the job-wide card says "some rooms", and
                  only on a room whose ceiling is actually being painted. On every
                  other job it costs nothing and is not on the screen: a tick that
                  cannot change a price is noise on a card somebody is trying to
                  read.
                */}
                {!chatMode && ceilingScope === "some" && room.tiles.some((t) => t.key === "ceilings" && t.on) && (() => {
                  const on = ceilingRooms.includes(room.areaId);
                  return (
                    <div className={`il-q ${on ? "ok" : ""}`} data-testid={`room-ceiling-d2l-${room.areaId}`}>
                      <p className="il-ql">Is this ceiling going from dark to light?</p>
                      <div className="sc-chips">
                        <button
                          className={`sd-chip il-chip ${on ? "on" : ""}`}
                          aria-pressed={on}
                          data-testid={`room-ceiling-d2l-btn-${room.areaId}`}
                          onClick={() => {
                            setCeilingRooms((cur) => on ? cur.filter((r) => r !== room.areaId) : [...cur, room.areaId]);
                            act(
                              { action: "set_paint_system", field: "darkToLightCeilingRoom", areaId: room.areaId, value: !on },
                              `d2lc:${room.areaId}`,
                              (d) => `${room.name}'s ceiling ${!on ? "gets the extra coat" : "back to the standard"}${liveRange && Math.abs(d) >= 100 ? ` — about ${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}` : ""}`,
                              [`d2lc:${room.areaId}`, !on ? "on" : "off"],
                            );
                          }}
                        >{on ? "Yes — the extra coat is in" : "Yes, this one"}</button>
                      </div>
                    </div>
                  );
                })()}
                <div className="sc-inc">Includes filling minor cracks and sanding — allowances set by us</div>
                {room.allowances?.map((a) => <div className="sc-inc" key={a} data-testid="room-allowance">🔒 {a} — allowed for by us</div>)}
                {/* C10 — extras in this room: feature walls counted, wallpaper, something else. */}
                {!chatMode && (
                  <RoomExtras
                    areaId={room.areaId}
                    view={roomExtras[String(room.areaId)] ?? { featureWalls: 0, wallpaper: false, other: "" }}
                    busy={pendingCount > 0}
                    onExtra={(kind, value) => {
                      setRoomExtras((cur) => ({ ...cur, [String(room.areaId)]: {
                        featureWalls: kind === "feature_wall" ? (value.count ?? 0) : (cur[String(room.areaId)]?.featureWalls ?? 0),
                        wallpaper: kind === "wallpaper" ? value.on === true : (cur[String(room.areaId)]?.wallpaper ?? false),
                        other: kind === "other" ? (value.text ?? "") : (cur[String(room.areaId)]?.other ?? ""),
                      } }));
                      act({ action: "room_extra", areaId: room.areaId, kind, ...value }, `extra:${room.areaId}:${kind}`,
                        () => kind === "feature_wall" ? `${value.count ?? 0} feature wall${(value.count ?? 0) === 1 ? "" : "s"} in ${room.name} — priced as its own colour by a person`
                          : kind === "wallpaper" ? (value.on ? `Wallpaper in ${room.name} — stripping goes on the estimate for a person to price` : `No wallpaper in ${room.name}`)
                          : (value.text?.trim() ? `Noted in ${room.name} — a person prices that` : "Cleared"));
                    }}
                  />
                )}
                {/* §4.3 — where the damage is (the per-room condition question is gone, C10). */}
                {!chatMode && (
                  <RoomSpots
                    estimateId={estimateId}
                    areaId={room.areaId}
                    roomName={room.name}
                    side="interior"
                    spots={room.spots}
                    condition={room.condition}
                    colourTier={initialColourTier}
                    busy={pendingCount > 0}
                    onAdd={(tag, extent, severity, sourceId) => act(
                      { action: "add_spot", areaId: room.areaId, tag, extent, severity, sourceId },
                      `spot:${room.areaId}:${tag}`,
                      () => `Noted in ${room.name} — your painter sees it before day one`,
                    )}
                    onRemove={(surfaceId) => act(
                      { action: "remove_spot", areaId: room.areaId, surfaceId },
                      `spotrm:${room.areaId}:${surfaceId}`,
                      () => "Spot removed",
                    )}
                    offer={<Offer kind="damage" estimator={estimator?.name ?? null} onBook={() => scrollToReach()} />}
                  />
                )}
                {/* Tom, 14 Sep (item 19): Confirm on an unconfirmed size reads the measurements back first. */}
                {loop && sizeConfirm === room.areaId && !loop.confirmed && (
                  <div className="sc-sizeconfirm" data-testid={`size-confirm-${room.areaId}`} role="dialog" aria-label="Confirm the room measurements">
                    <p className="il-ql">Confirming the room measurements are <b className="sc-sizeconfirm-size">{loop.sizeLabel}</b>.</p>
                    <div className="sc-chips">
                      <button type="button" className="sd-chip il-chip on" data-testid={`size-confirm-ok-${room.areaId}`}
                        onClick={() => { setSizeConfirm(null); confirmAct({ action: "confirm_room_loop", areaId: room.areaId, sizeOk: true }, `room:${room.areaId}`, `${room.name} confirmed ✓`); }}>Confirm</button>
                      <button type="button" className="sd-chip" data-testid={`size-confirm-change-${room.areaId}`}
                        onClick={() => { setSizeConfirm(null); setSizeDrafts((d) => ({ ...d, [room.areaId]: { L: "", W: "", open: true } })); afterLayout(() => scrollCardToTop(document.querySelector(`[data-card="room:${room.areaId}"]`))); }}>Change it</button>
                    </div>
                  </div>
                )}
                {loop && (
                  <button
                    className={`sd-confirm il-confirm ${loop.confirmed ? "done" : ""}`}
                    disabled={optimistic[`confirm:room:${room.areaId}`] != null}
                    onClick={() => {
                      if (!loop.confirmed && loop.size == null && !sel(`sz:${room.areaId}`, false, "yes")) { setSizeConfirm(room.areaId); return; }
                      confirmAct({ action: "confirm_room_loop", areaId: room.areaId }, `room:${room.areaId}`, `${room.name} confirmed ✓`);
                    }}
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
        {/* Tom, 14 Sep (item 26): the ⚑ deferral list is the estimator's (the pack), not the customer's. */}
          {/* Tom, 14 Sep (items 23, 24, 27, 28, 29): the last checks, one at a time — the
              garage the plan showed, the door and window count, the rooms, and site & access. */}
          {!chatMode && lastSteps.length > 0 && (
            <Paginated
              testid="missed-card" dataCard="sweep" id="missed"
              title="A few last checks" pill="CONFIRM THESE"
              steps={lastSteps}
              settledText="All checked — nothing missing, and your setup is noted."
              attrs={{ "data-dw-done": iloop?.meta.done.dw ? "1" : "0", "data-sweep-done": iloop?.meta.done.sweep ? "1" : "0" }}
            />
          )}
          {/* Tom, 14 Sep (item 8): What we'll do sits at the very bottom of the page. */}
          {!chatMode && <WhatWeDo lines={systems} tellUsHref="#reach" />}
        </div>
        <PlanPanel docs={docs} variant="column" />
        </div>
      </main>

      {/* Tom, 14 Sep (item 1): the bottom strip is two buttons — nothing else. The
          price, the tier and the estimator live in the frozen header above. */}
      <div className="sc-stick sc-stick-two" ref={stickRef}>
        <div className="sr-only" data-testid="last-change" aria-live="polite">{lastChange ? `Last change: ${lastChange}` : ""}</div>
        <div className="sc-two">
          <button type="button" className="sc-btn il-cta" data-testid="scope-finalise" onClick={onFinalise}>
            {autoSend === "sent" ? "See what happens next" : "Finalise my price"}
          </button>
          <button type="button" className="sc-btn sc-btn2" data-testid="scope-book" onClick={() => scrollToReach()}>Book a time</button>
        </div>
      </div>
      <FinalisePrompt open={prompt} onAnswer={answerRemaining} onBook={() => scrollToReach()} onClose={() => setPrompt(false)} />
      {toast && <div className="sc-toast">{toast}</div>}
    </div>
  );
}
