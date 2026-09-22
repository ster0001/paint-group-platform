"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { pingGcalSync } from "@/lib/gcal/ping";
import { pingAppointmentConfirm } from "@/lib/workorder/appointmentPing";
import { msRemaining, isReschedule, formatDMY, type BookingOffer } from "@/lib/scheduling/offers";
import { addDays, addWorkingDays, dayDiff, todayIso, workingDaysBetween, type WorkingWeek } from "@/lib/scheduling/dates";
import {
  sendOfferAction, reassignOfferAction, moveBookingAction, blockOutAction, addBookingNote, deleteBookingNote,
  assignJobAction, reassignDatesAction, setLeadPainterAction, releaseAssignmentAction, type ActionResult,
} from "./actions";
import type { Block, BoardWalkthrough, Lane, TrayJob } from "@/lib/scheduling/board";
import "./schedule.css";

const money = (c: number | null) => (c == null ? "—" : "$" + (c / 100).toLocaleString("en-AU", { maximumFractionDigits: 0 }));

// Calendar-date arithmetic lives in lib/scheduling/dates.ts — see the note there
// about the timezone bug these helpers exist to prevent.
/** Contiguous month runs across the visible days, for the month band. */
function monthRuns(days: string[]) {
  const out: { label: string; span: number }[] = [];
  for (const d of days) {
    const label = new Date(d + "T00:00:00Z").toLocaleDateString("en-AU", { month: "long", year: "numeric", timeZone: "UTC" });
    const last = out[out.length - 1];
    if (last && last.label === label) last.span += 1;
    else out.push({ label, span: 1 });
  }
  return out;
}

/** Render a date cell without letting the timezone move it. */
const dayParts = (s: string) => {
  const d = new Date(s + "T00:00:00Z");
  return {
    num: d.getUTCDate(),
    dow: d.getUTCDay(),
    short: d.toLocaleDateString("en-AU", { weekday: "short", timeZone: "UTC" }).toUpperCase(),
  };
};

/** "23h 41m" — the board doesn't need second-by-second precision, and not
 *  re-rendering every second keeps dragging smooth. */
function coarseCountdown(expiresAt: string): string {
  const ms = msRemaining(expiresAt);
  if (ms <= 0) return "EXPIRED";
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

type SavedView = { id: string; name: string; tiers: string[]; contractorIds: string[]; onlyOfferable: boolean };

type DropTarget = { contractorId: string; dayIndex: number } | null;

export default function ScheduleBoard({
  lanes,
  blocks,
  tray,
  walkthroughs = [],
  from,
  rangeDays,
  savedViews,
  approvals,
  errors,
}: {
  lanes: Lane[];
  blocks: Block[];
  tray: TrayJob[];
  walkthroughs?: BoardWalkthrough[];
  from: string;
  rangeDays: number;
  savedViews: SavedView[];
  approvals: { offer: BookingOffer; woRef: string; title: string; contractorName: string }[];
  errors: string[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [dayW, setDayW] = useState(64);
  const [range, setRange] = useState(rangeDays);
  const [start, setStart] = useState(from);
  const tlRef = useRef<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  /**
   * The board is a workspace, not a document (Tom, 18 Sep: "keep the month day
   * and date locked at the top of the screen, so you can still see when
   * dragging a job").
   *
   * The dates live INSIDE the horizontal scroller — they have to, they scroll
   * sideways with the columns — and a sticky element only ever pins to its own
   * scrollport, so pinning them to the page does nothing. The timeline has to
   * be the scroller instead, which means it has to end where the screen ends.
   *
   * That height is MEASURED, not guessed: what sits above it — the console's
   * tab rail, the board's own bar, the legend — changes height when it wraps,
   * and a guess that is 40px out either hides the bottom lane or leaves the
   * page scrolling the locked header off the top, which is the whole bug.
   */
  useEffect(() => {
    const root = rootRef.current;
    const tl = tlRef.current;
    if (!root || !tl) return;
    const fit = () => {
      // Document coordinates: the viewport-relative top moves as the page
      // scrolls, and sizing off that feeds itself.
      const top = tl.getBoundingClientRect().top + window.scrollY;
      root.style.setProperty("--sb-space", `${Math.max(260, window.innerHeight - top - 8)}px`);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(root);
    window.addEventListener("resize", fit);
    return () => { ro.disconnect(); window.removeEventListener("resize", fit); };
  }, []);

  /**
   * Picking 2W/4W/8W should CHANGE THE SIZE of the view, not just stretch the
   * board off the right-hand edge — so the day width is recomputed to fit the
   * whole range in the space available. The zoom slider still overrides it.
   */
  const fitRange = useCallback((n: number) => {
    setRange(n);
    const avail = (tlRef.current?.clientWidth ?? 0) - 32; // padding
    if (avail > 0) setDayW(Math.max(14, Math.min(140, Math.floor(avail / n))));
  }, []);

  // ---- filters + saved views (requirement 4) --------------------------------
  const [tiers, setTiers] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [onlyOfferable, setOnlyOfferable] = useState(false);
  const [views, setViews] = useState<SavedView[]>(savedViews);
  const [showFilters, setShowFilters] = useState(false);

  const allTiers = useMemo(
    () => [...new Set(lanes.map((l) => l.tier))].sort(),
    [lanes],
  );

  const visibleLanes = useMemo(
    () =>
      lanes.filter((l) => {
        if (picked.length > 0) return picked.includes(l.contractorId);
        if (tiers.length > 0 && !tiers.includes(l.tier)) return false;
        // "Ready for work" is about being OFFERABLE, and an employee is never
        // offered — they are assigned. Filtering on the flag hid every employee
        // from the board, which is how Saulius went missing (Tom, 18 Sep).
        if (onlyOfferable && !l.offerable && l.employmentType !== "employee") return false;
        return true;
      }),
    [lanes, picked, tiers, onlyOfferable],
  );

  async function persistViews(next: SavedView[]) {
    setViews(next);
    await supabase.from("settings").upsert({ key: "scheduling_views", value: next }, { onConflict: "key" });
  }

  const days = useMemo(() => Array.from({ length: range }, (_, i) => addDays(start, i)), [start, range]);
  const today = todayIso();

  /**
   * Push the window into the URL so the SERVER refetches for it. Paging or
   * jumping used to move the columns while the blocks stayed behind, so a job
   * booked months out was invisible.
   */
  useEffect(() => {
    if (start === from && range === rangeDays) return;
    const t = setTimeout(() => {
      // /pc/schedule, NOT the old /schedule — that path is now a redirect that
      // DROPS the query, so jumping or paging blanked the board (Tom, 30 Aug).
      router.replace(`/pc/schedule?from=${start}&days=${range}`, { scroll: false });
    }, 250); // debounce: dragging the range buttons shouldn't fire a fetch each time
    return () => clearTimeout(t);
  }, [start, range, from, rangeDays, router]);

  // ---- drag (requirement 1) -------------------------------------------------
  // Everything below writes to the DOM directly. React does not re-render during
  // a drag: the ghost moves on the compositor via transform, and the drop-target
  // highlight is a single class toggle. That is what keeps it smooth.
  const laneRefs = useRef(new Map<string, HTMLDivElement>());
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const hotCell = useRef<HTMLElement | null>(null);
  const rafId = useRef<number | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const laneRects = useRef<{ id: string; rect: DOMRect; el: HTMLDivElement }[]>([]);
  const target = useRef<DropTarget>(null);
  const dragAbort = useRef<AbortController | null>(null);

  const drag = useRef<null | {
    kind: "tray" | "block";
    job?: TrayJob;
    block?: Block;
    spanDays: number;
    el: HTMLElement;
    startX: number;
    startY: number;
    moved: boolean;
    pointerId: number;
  }>(null);

  const [ghost, setGhost] = useState<null | { title: string; sub: string }>(null);
  const [ghostBlocked, setGhostBlocked] = useState(false);

  // Dragging across EMPTY lane space marks a contractor unavailable for that
  // run of days — far quicker than a form, and it reads the same as the drag
  // used to place a job.
  const marquee = useRef<null | { contractorId: string; anchor: number; laneEl: HTMLElement; pointerId: number; moved: boolean }>(null);
  const [pendingBlock, setPendingBlock] = useState<null | { contractorId: string; start: string; end: string }>(null);

  const cacheLaneRects = useCallback(() => {
    laneRects.current = [...laneRefs.current.entries()]
      .filter(([, el]) => el?.isConnected)
      .map(([id, el]) => ({ id, rect: el.getBoundingClientRect(), el }));
  }, []);

  const clearHot = () => {
    if (hotCell.current) {
      hotCell.current.classList.remove("hot");
      hotCell.current.parentElement?.classList.remove("blocked");
      hotCell.current = null;
    }
  };

  // Tom, 22 Sep: a span is WORKING days. Weekends are skipped unless this
  // painter has ticked them on their profile; the end date lands accordingly.
  const weekFor = useCallback((contractorId: string): WorkingWeek => {
    const lane = lanes.find((l) => l.contractorId === contractorId);
    return { saturday: Boolean(lane?.worksSaturday), sunday: Boolean(lane?.worksSunday) };
  }, [lanes]);
  const endFor = useCallback((contractorId: string, start: string, spanDays: number) => addWorkingDays(start, spanDays, weekFor(contractorId)), [weekFor]);

  // Is this contractor blocked out across the proposed span?
  const spanBlocked = useCallback(
    (contractorId: string, s: string, spanDays: number) => {
      const e = endFor(contractorId, s, spanDays);
      return blocks.some(
        (b) => b.kind === "unavailable" && b.contractorId === contractorId && b.start <= e && b.end >= s,
      );
    },
    [blocks, endFor],
  );

  // Only the visual follow lives in rAF. Painting the ghost is the one thing
  // worth coalescing to a frame; correctness must not depend on a frame ever
  // firing (it doesn't in a background tab), so the hit-test happens below in
  // the pointer handler instead.
  const frame = useCallback(() => {
    rafId.current = null;
    if (!drag.current || !ghostRef.current) return;
    const { x, y } = pointer.current;
    ghostRef.current.style.transform = `translate3d(${x + 14}px, ${y + 14}px, 0)`;
  }, []);

  /**
   * The day under the pointer. Tom, 22 Sep: "the calendar days don't line up
   * when dragging and dropping" — the lane rects are cached when the drag
   * starts, so any scroll of the page or the timeline during the drag (and a
   * zoom that lands between cell widths) put the arithmetic one or more days
   * off. Ask the browser which day cell is under the pointer instead; the
   * cached rects remain the fallback when nothing is hit (the ghost, a gap).
   */
  const updateTarget = useCallback(
    (x: number, y: number, spanDays: number) => {
      let hit = laneRects.current.find((l) => y >= l.rect.top && y <= l.rect.bottom);
      let idx = hit ? Math.floor((x - hit.rect.left) / dayW) : -1;
      if (typeof document !== "undefined" && typeof document.elementsFromPoint === "function") {
        const under = document.elementsFromPoint(x, y).find((el) => el.classList.contains("bgc") && el.parentElement?.classList.contains("lane")) as HTMLElement | undefined;
        const laneEl = under?.parentElement ?? null;
        const lane = laneEl ? laneRects.current.find((l) => l.el === laneEl) : undefined;
        if (under && lane) { hit = lane; idx = Array.prototype.indexOf.call(laneEl!.children, under); }
      }
      if (!hit || idx < 0 || idx >= range) {
        clearHot();
        target.current = null;
        return;
      }
      const cell = hit.el.children[idx] as HTMLElement | undefined;
      if (cell && cell !== hotCell.current) {
        clearHot();
        cell.classList.add("hot");
        const blocked = spanBlocked(hit.id, days[idx], spanDays);
        hit.el.classList.toggle("blocked", blocked);
        setGhostBlocked((prev) => (prev === blocked ? prev : blocked));
        hotCell.current = cell;
      }
      target.current = { contractorId: hit.id, dayIndex: idx };
    },
    [dayW, range, days, spanBlocked],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointerId) return;
      pointer.current = { x: e.clientX, y: e.clientY };

      if (!d.moved) {
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 5) return; // let clicks be clicks
        d.moved = true;
        d.el.classList.add("dragging");
        cacheLaneRects();
      }
      updateTarget(e.clientX, e.clientY, d.spanDays);
      if (rafId.current == null) rafId.current = requestAnimationFrame(frame);
    },
    [frame, cacheLaneRects, updateTarget],
  );

  // Final walkthrough, CONFIRMED WITH THE CLIENT at booking (Tom, 25 Aug) —
  // date defaults to the last day on site; the time is theirs to agree.
  const [walkDate, setWalkDate] = useState("");
  const [walkTime, setWalkTime] = useState("");
  const [pendingDrop, setPendingDrop] = useState<null | {
    kind: "tray" | "block";
    job?: TrayJob;
    block?: Block;
    contractorId: string;
    startDate: string;
    spanDays: number;
    blocked: boolean;
  }>(null);

  const onPointerUp = useCallback(
    (e: PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointerId) return;

      if (rafId.current != null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
      d.el.classList.remove("dragging");

      const t = target.current;
      if (d.moved && t) {
        // Tom, 22 Sep: a drop on a day this painter does not work starts on their next working day.
        const startDate = addWorkingDays(days[t.dayIndex], 1, weekFor(t.contractorId));
        setPendingDrop({
          kind: d.kind,
          job: d.job,
          block: d.block,
          contractorId: t.contractorId,
          startDate,
          spanDays: d.spanDays,
          blocked: spanBlocked(t.contractorId, startDate, d.spanDays),
        });
      }

      clearHot();
      target.current = null;
      drag.current = null;
      setGhost(null);
      setGhostBlocked(false);
      // One abort tears down both listeners, so neither handler has to reference
      // the other to unsubscribe.
      dragAbort.current?.abort();
      dragAbort.current = null;
    },
    [days, spanBlocked, weekFor],
  );

  const paintMarquee = useCallback((laneEl: HTMLElement, a: number, b: number) => {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    for (let i = 0; i < range; i++) {
      (laneEl.children[i] as HTMLElement | undefined)?.classList.toggle("marq", i >= lo && i <= hi);
    }
  }, [range]);

  const clearMarquee = useCallback((laneEl: HTMLElement) => {
    for (let i = 0; i < range; i++) (laneEl.children[i] as HTMLElement | undefined)?.classList.remove("marq");
  }, [range]);

  function beginBlockOut(e: React.PointerEvent, contractorId: string) {
    // Only on bare background cells — never steal a drag from a job block.
    const el = e.target as HTMLElement;
    if (!el.classList.contains("bgc") || e.button !== 0) return;
    const laneEl = e.currentTarget as HTMLElement;
    const idx = Array.prototype.indexOf.call(laneEl.children, el);
    if (idx < 0 || idx >= range) return;

    marquee.current = { contractorId, anchor: idx, laneEl, pointerId: e.pointerId, moved: false };
    paintMarquee(laneEl, idx, idx);

    const ac = new AbortController();
    const move = (ev: PointerEvent) => {
      const m = marquee.current;
      if (!m || ev.pointerId !== m.pointerId) return;
      const r = m.laneEl.getBoundingClientRect();
      const i = Math.max(0, Math.min(range - 1, Math.floor((ev.clientX - r.left) / dayW)));
      m.moved = true;
      paintMarquee(m.laneEl, m.anchor, i);
    };
    const up = (ev: PointerEvent) => {
      const m = marquee.current;
      ac.abort();
      if (!m || ev.pointerId !== m.pointerId) return;
      const r = m.laneEl.getBoundingClientRect();
      const i = Math.max(0, Math.min(range - 1, Math.floor((ev.clientX - r.left) / dayW)));
      clearMarquee(m.laneEl);
      marquee.current = null;
      const lo = Math.min(m.anchor, i), hi = Math.max(m.anchor, i);
      setPendingBlock({ contractorId: m.contractorId, start: days[lo], end: days[hi] });
    };
    window.addEventListener("pointermove", move, { signal: ac.signal });
    window.addEventListener("pointerup", up, { signal: ac.signal });
    window.addEventListener("pointercancel", up, { signal: ac.signal });
  }

  function beginDrag(
    e: React.PointerEvent,
    payload: { kind: "tray"; job: TrayJob } | { kind: "block"; block: Block },
  ) {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    const spanDays =
      payload.kind === "tray"
        ? payload.job.estimatedDays
        : workingDaysBetween(payload.block.start, payload.block.end, weekFor(payload.block.contractorId));

    drag.current = {
      kind: payload.kind,
      job: payload.kind === "tray" ? payload.job : undefined,
      block: payload.kind === "block" ? payload.block : undefined,
      spanDays,
      el,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      pointerId: e.pointerId,
    };
    pointer.current = { x: e.clientX, y: e.clientY };
    setGhost(
      payload.kind === "tray"
        ? { title: payload.job.title, sub: `${payload.job.woRef} · ${spanDays} day${spanDays === 1 ? "" : "s"}` }
        : { title: payload.block.title, sub: `${payload.block.woRef} · move booking` },
    );
    dragAbort.current?.abort();
    const ac = new AbortController();
    dragAbort.current = ac;
    window.addEventListener("pointermove", onPointerMove, { signal: ac.signal });
    window.addEventListener("pointerup", onPointerUp, { signal: ac.signal });
    window.addEventListener("pointercancel", onPointerUp, { signal: ac.signal });
  }

  useEffect(() => {
    const onScroll = () => {
      if (drag.current?.moved) cacheLaneRects();
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [cacheLaneRects]);

  // ---- commit ---------------------------------------------------------------
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // Tom, 18 Sep: find a job in a long tray without scrolling it. Matches the
  // title, the reference and the suburb — the three things staff know a job by.
  const [traySearch, setTraySearch] = useState("");
  const trayQuery = traySearch.trim().toLowerCase();
  const shownTray = trayQuery
    ? tray.filter((j) => `${j.title} ${j.woRef} ${j.suburb}`.toLowerCase().includes(trayQuery))
    : tray;
  const lapsedJobs = tray.filter((j) => j.lapsed);
  // The chase log composer. Keyed by work order so two cards can't share a
  // draft, and closed by default — the tray is a drag surface first.
  const [noteOpen, setNoteOpen] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteErr, setNoteErr] = useState("");

  async function saveNote(workOrderId: string) {
    if (!noteText.trim()) { setNoteErr("Write the note first."); return; }
    setNoteBusy(true); setNoteErr("");
    const r = await addBookingNote({ workOrderId, note: noteText });
    setNoteBusy(false);
    if (r.ok) { setNoteText(""); setNoteOpen(null); router.refresh(); }
    else setNoteErr(r.message);
  }

  async function removeNote(noteId: string) {
    setNoteBusy(true); setNoteErr("");
    const r = await deleteBookingNote({ noteId });
    setNoteBusy(false);
    if (r.ok) router.refresh(); else setNoteErr(r.message);
  }
  // A note that rides along with the offer — the scheduling context a date and
  // a price can't carry ("client's on a tight schedule, needs to start Monday").
  // It reaches the contractor on their offer card as `staff_note`.
  const [offerNote, setOfferNote] = useState("");
  const [offerQa, setOfferQa] = useState(false);
  const [offerNoWalk, setOfferNoWalk] = useState(false);
  const [toast, setToast] = useState("");
  const [detail, setDetail] = useState<Block | null>(null);
  // Employed painters (S2): the detail sheet's "add a painter" picker.
  const [addPainterId, setAddPainterId] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  /** An employee lane takes ASSIGNMENTS; a contractor lane takes OFFERS. */
  const isEmployeeLane = useCallback(
    (contractorId: string) => lanes.find((l) => l.contractorId === contractorId)?.employmentType === "employee",
    [lanes],
  );
  const [blockReason, setBlockReason] = useState("");
  /** S7b: what kind of day the office is marking on an employee's lane. */
  const [blockKind, setBlockKind] = useState<"other" | "leave" | "rdo" | "sick">("other");
  const [cancelReason, setCancelReason] = useState("");

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3600);
  }

  /** Surface a typed action result; a conflict is a refresh prompt, not a crash. */
  function handle(r: ActionResult, successMsg: string): boolean {
    if (r.ok) { flash(successMsg); router.refresh(); return true; }
    setErr(r.message);
    if (r.kind === "conflict") router.refresh(); // pull the real state back in
    return false;
  }

  async function sendOffer() {
    if (!pendingDrop?.job) return;
    // The gate (Tom, 1 Sep): an offer doesn't go until the final walkthrough
    // is confirmed with the client — a DATE AND TIME typed in — or the
    // walkthrough-not-required box is ticked. The field starts empty on
    // purpose; the suggested date is written beside it, not into it.
    if (!offerNoWalk && (!walkDate || !walkTime)) {
      setErr("Confirm the final walkthrough with the client first — enter its date and time, or tick walkthrough not required.");
      return;
    }
    setBusy(true);
    setErr("");
    // No amount crosses the wire. The server derives the contractor's payment
    // from the work order's stored pricing — the client couldn't forge it.
    // The confirmed walkthrough rides the same action and is booked
    // server-side after the offer succeeds.
    const r = await sendOfferAction({
      workOrderId: pendingDrop.job.workOrderId,
      contractorId: pendingDrop.contractorId,
      startDate: pendingDrop.startDate,
      endDate: endFor(pendingDrop.contractorId, pendingDrop.startDate, pendingDrop.spanDays),
      note: offerNote.trim(),
      qaRequired: offerQa,
      walkthroughRequired: !offerNoWalk,
      walkthroughDate: offerNoWalk ? null : walkDate,
      walkthroughTime: offerNoWalk ? null : walkTime,
    });
    if (handle(r, "Offer sent — the contractor has 24 hours to respond.")) {
      setPendingDrop(null);
      setOfferNote("");   // never carry one job's note onto the next offer
      setOfferQa(false);
      setOfferNoWalk(false);
      setWalkDate("");
      setWalkTime("");
    }
    setBusy(false);
  }

  /**
   * Employed painters (S2): a tray job dropped on an EMPLOYEE lane is assigned,
   * not offered. It lands in their calendar now; the first painter dropped is
   * the lead (changeable from the block's detail sheet). The same walkthrough
   * gate as an offer applies — booking still means someone spoke to the client.
   */
  async function assignJob() {
    if (!pendingDrop?.job) return;
    if (!offerNoWalk && (!walkDate || !walkTime)) {
      setErr("Confirm the final walkthrough with the client first — enter its date and time, or tick walkthrough not required.");
      return;
    }
    setBusy(true);
    setErr("");
    const r = await assignJobAction({
      workOrderId: pendingDrop.job.workOrderId,
      painters: [{
        contractorId: pendingDrop.contractorId,
        startDate: pendingDrop.startDate,
        endDate: endFor(pendingDrop.contractorId, pendingDrop.startDate, pendingDrop.spanDays),
      }],
      leadContractorId: pendingDrop.contractorId,
      overrideReason: overrideReason.trim() || null,
      qaRequired: offerQa,
      walkthroughRequired: !offerNoWalk,
      walkthroughDate: offerNoWalk ? null : walkDate,
      walkthroughTime: offerNoWalk ? null : walkTime,
    });
    if (handle(r, "Assigned — it's in their calendar, and the customer has their confirmation.")) {
      setPendingDrop(null);
      setOfferNote(""); setOfferQa(false); setOfferNoWalk(false); setWalkDate(""); setWalkTime(""); setOverrideReason("");
    }
    setBusy(false);
  }

  /** Move one painter's days. Their Accept is cleared and they are told to accept again. */
  async function moveAssignment() {
    if (!pendingDrop?.block?.assignmentId) return;
    const b = pendingDrop.block;
    if (b.contractorId !== pendingDrop.contractorId) {
      setErr("Drag changes a painter's days, not the painter. Open the block to add someone else or take this painter off.");
      return;
    }
    setBusy(true);
    setErr("");
    const r = await reassignDatesAction({
      assignmentId: b.assignmentId,
      startDate: pendingDrop.startDate,
      endDate: endFor(pendingDrop.contractorId, pendingDrop.startDate, pendingDrop.spanDays),
      overrideReason: overrideReason.trim() || null,
    });
    if (handle(r, "Days moved — they'll be asked to accept again.")) { setPendingDrop(null); setOverrideReason(""); }
    setBusy(false);
  }

  async function addPainter(workOrderId: string, contractorId: string, start: string, end: string, lead: string) {
    setBusy(true);
    setErr("");
    const r = await assignJobAction({
      workOrderId,
      painters: [{ contractorId, startDate: start, endDate: end }],
      leadContractorId: lead,
      overrideReason: overrideReason.trim() || null,
      addingToBookedJob: true, // the walkthrough was settled when the job was first assigned
    });
    if (handle(r, "Added to the job.")) { setAddPainterId(""); setOverrideReason(""); setDetail(null); }
    setBusy(false);
  }

  async function makeLead(workOrderId: string, contractorId: string) {
    setBusy(true);
    setErr("");
    if (handle(await setLeadPainterAction({ workOrderId, contractorId }), "Lead painter changed.")) setDetail(null);
    setBusy(false);
  }

  async function releasePainter(assignmentId: string, reason: string) {
    setBusy(true);
    setErr("");
    if (handle(await releaseAssignmentAction({ assignmentId, reason }), "Taken off the job — future days only, their ticks stay.")) {
      setDetail(null); setCancelReason("");
    }
    setBusy(false);
  }

  async function moveBooking() {
    if (!pendingDrop?.block) return;
    const b = pendingDrop.block;
    setBusy(true);
    setErr("");
    const endDate = endFor(pendingDrop.contractorId, pendingDrop.startDate, pendingDrop.spanDays);
    const expectedState = b.kind === "accepted" ? "accepted" : b.kind === "proposed" ? "proposed" : "offered";
    const reassigning = b.contractorId !== pendingDrop.contractorId;

    // Reassigning is cancel-then-re-offer, which must be ONE transaction — a
    // half-done reassignment leaves a job belonging to nobody.
    const r = reassigning
      ? await reassignOfferAction({
          offerId: b.offerId!,
          newContractorId: pendingDrop.contractorId,
          startDate: pendingDrop.startDate,
          endDate,
          expectedState,
        })
      : await moveBookingAction({
          offerId: b.offerId!,
          startDate: pendingDrop.startDate,
          endDate,
          expectedState,
        });

    if (handle(r, reassigning
      ? "Reassigned — a fresh 24-hour offer has gone to the new contractor."
      : "Booking moved.")) setPendingDrop(null);
    setBusy(false);
  }

  const KIND_DONE: Record<string, string> = {
    other: "Days blocked out.", sick: "Marked sick — any booked day is on Today to reassign.",
    leave: "Leave recorded — it's on the board as time off.", rdo: "RDO recorded — it's on the board as time off.",
  };
  async function blockOut(contractorId: string, from: string, to: string, reason: string, kind: "other" | "leave" | "rdo" | "sick" = "other") {
    setBusy(true);
    setErr("");
    handle(await blockOutAction({ contractorId, startDate: from, endDate: to, reason, kind }), KIND_DONE[kind]);
    setBusy(false);
  }

  /** Approve or refuse a proposed / reschedule date. */
  async function resolve(offer: BookingOffer, approve: boolean) {
    setBusy(true);
    setErr("");
    const { data, error } = await supabase.rpc("resolve_proposed_offer", { p_offer_id: offer.id, p_approve: approve });
    if (error) setErr(error.message);
    else if (String(data).startsWith("error:")) setErr(String(data).replace("error:", ""));
    else {
      const msg: Record<string, string> = {
        accepted: "Approved — the new date is locked in.",
        kept_original: "Refused — the job stays on its original date.",
        declined: "Refused — the job is back in the unscheduled tray.",
      };
      flash(msg[String(data)] ?? "Done.");
      pingGcalSync({ offerId: offer.id }); // date moved / booking released → contractor's Google Calendar
      // Approving IS the booking (or a re-booking on new dates): the customer's
      // confirmation email + the walkthrough invite go out now, not at the
      // nightly sweep. Before 6 Sep only the contractor's Accept button pinged
      // this, so a proposal approved here left the customer unconfirmed all day.
      // Idempotent per start date server-side, so a re-approve is a no-op.
      if (String(data) === "accepted") pingAppointmentConfirm(offer.work_order_id);
      router.refresh();
    }
    setBusy(false);
  }

  async function cancelBooking(offerId: string, reason: string) {
    setBusy(true);
    setErr("");
    const { data, error } = await supabase.rpc("cancel_booking", { p_offer_id: offerId, p_reason: reason });
    if (error) setErr(error.message);
    else if (String(data).startsWith("error:")) setErr(String(data).replace("error:", ""));
    else {
      setDetail(null);
      flash("Cancelled — the job is back in the unscheduled tray.");
      pingGcalSync({ offerId }); // remove the event from the contractor's Google Calendar
      router.refresh();
    }
    setBusy(false);
  }

  async function saveBlockOut() {
    if (!pendingBlock) return;
    await blockOut(pendingBlock.contractorId, pendingBlock.start, pendingBlock.end, blockReason, isEmployeeLane(pendingBlock.contractorId) ? blockKind : "other");
    setPendingBlock(null);
    setBlockReason("");
    setBlockKind("other");
  }

  async function removeBlock(id: string) {
    setBusy(true);
    await supabase.from("contractor_unavailability").delete().eq("id", id.replace("unav-", ""));
    setDetail(null);
    flash("Block removed.");
    router.refresh();
    setBusy(false);
  }

  // ---- render ---------------------------------------------------------------
  /**
   * Lay each lane out in sub-rows.
   *
   * A contractor can take several jobs starting the same day — that's allowed on
   * purpose. Drawn naively they'd sit on top of each other and the office would
   * see one job where there are three, so overlapping blocks are packed into
   * stacked rows and the lane grows to fit.
   */
  const laneLayout = useMemo(() => {
    const last = addDays(start, range - 1);
    const m = new Map<string, { placed: { block: Block; row: number }[]; rows: number; peak: number }>();

    for (const l of lanes) {
      const mine = blocks
        .filter((b) => b.contractorId === l.contractorId && b.end >= start && b.start <= last)
        .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));

      // Greedy interval packing: first row whose last block has already finished.
      const rowEnds: string[] = [];
      const placed = mine.map((block) => {
        let row = rowEnds.findIndex((end) => end < block.start);
        if (row === -1) { row = rowEnds.length; rowEnds.push(block.end); }
        else rowEnds[row] = block.end;
        return { block, row };
      });

      // Busiest single day, counting real work only — a blocked-out day isn't a job.
      let peak = 0;
      for (let i = 0; i < range; i++) {
        const day = days[i];
        const n = mine.filter((b) => b.kind !== "unavailable" && b.start <= day && b.end >= day).length;
        if (n > peak) peak = n;
      }

      m.set(l.contractorId, { placed, rows: Math.max(1, rowEnds.length), peak });
    }
    return m;
  }, [blocks, lanes, start, range, days]);

  const styleVars = { ["--day-w" as string]: `${dayW}px`, ["--days" as string]: String(range) } as React.CSSProperties;

  return (
    <div className="sb" style={styleVars} ref={rootRef}>
      <header className="top">
        <div>
          <div className="crumb">Scheduling</div>
          <h1>Timeline</h1>
        </div>

        <div className="ctrls">
          <div className="seg">
            <button onClick={() => setStart(addDays(start, -range))}>‹ Back</button>
            <button onClick={() => setStart(todayIso())}>Today</button>
            <button onClick={() => setStart(addDays(start, range))}>Next ›</button>
          </div>

          {/* Jump anywhere — Back/Next alone can't reach a job three months out. */}
          <label className="ctrl-lab" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            Jump to
            <input type="date" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} />
          </label>

          <div className="seg">
            {[14, 28, 56].map((n) => (
              <button key={n} className={range === n ? "on" : ""} onClick={() => fitRange(n)}>
                {n / 7}w
              </button>
            ))}
          </div>

          {/* Requirement 3 — zoom. Blocks animate because they're positioned
              off --day-w rather than laid out by the grid. */}
          <div className="zoom">
            <span className="ctrl-lab">Zoom</span>
            <button className="seg" style={{ padding: "4px 8px", background: "none", border: "1px solid var(--line)", color: "var(--muted)", borderRadius: 8, cursor: "pointer" }} onClick={() => setDayW((w) => Math.max(24, w - 12))}>−</button>
            <input type="range" min={24} max={140} step={4} value={dayW} onChange={(e) => setDayW(Number(e.target.value))} />
            <button className="seg" style={{ padding: "4px 8px", background: "none", border: "1px solid var(--line)", color: "var(--muted)", borderRadius: 8, cursor: "pointer" }} onClick={() => setDayW((w) => Math.min(140, w + 12))}>+</button>
          </div>

          {/* Requirement 4 — who appears in the board. */}
          <div className="filters">
            <button className="seg" style={{ padding: "7px 10px", background: "none", border: "1px solid var(--line)", color: visibleLanes.length === lanes.length ? "var(--muted)" : "var(--cyan)", borderRadius: 8, cursor: "pointer", fontFamily: "var(--mono)", fontSize: 9, letterSpacing: ".06em", textTransform: "uppercase" }} onClick={() => setShowFilters((s) => !s)} data-testid="filters-open">
              Contractors · {visibleLanes.length}/{lanes.length}
            </button>
            {showFilters && (
              <div className="fpop">
                <div className="lab">Saved views</div>
                {views.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)" }}>None yet.</div>}
                {views.map((v) => (
                  <div className="viewrow" key={v.id}>
                    <button className="pick" onClick={() => { setTiers(v.tiers); setPicked(v.contractorIds); setOnlyOfferable(v.onlyOfferable); }}>
                      {v.name}
                    </button>
                    <button className="del" onClick={() => persistViews(views.filter((x) => x.id !== v.id))} aria-label={`Delete ${v.name}`}>✕</button>
                  </div>
                ))}
                <button
                  className="btn gh"
                  style={{ marginTop: 8, padding: 8, fontSize: 12 }}
                  onClick={() => {
                    const name = window.prompt("Name this view (e.g. Tier 1)");
                    if (!name?.trim()) return;
                    persistViews([...views, { id: crypto.randomUUID(), name: name.trim(), tiers, contractorIds: picked, onlyOfferable }]);
                  }}
                >
                  Save current as a view
                </button>

                <div className="lab">Tier</div>
                {allTiers.map((t) => (
                  <label className="crow2" key={t}>
                    <input type="checkbox" checked={tiers.includes(t)} onChange={(e) => setTiers(e.target.checked ? [...tiers, t] : tiers.filter((x) => x !== t))} />
                    Tier {t}
                  </label>
                ))}

                <label className="crow2" style={{ marginTop: 8 }}>
                  <input type="checkbox" checked={onlyOfferable} onChange={(e) => setOnlyOfferable(e.target.checked)} data-testid="filter-offerable" />
                  Ready for work only <span className="lab" style={{ marginLeft: 6 }}>(employees always shown)</span>
                </label>

                <div className="lab">Pick individually</div>
                {lanes.map((l) => (
                  <label className="crow2" key={l.contractorId}>
                    <input type="checkbox" checked={picked.includes(l.contractorId)} onChange={(e) => setPicked(e.target.checked ? [...picked, l.contractorId] : picked.filter((x) => x !== l.contractorId))} />
                    {l.name}
                  </label>
                ))}

                <button className="btn dim" style={{ padding: 8, fontSize: 12 }} onClick={() => { setTiers([]); setPicked([]); setOnlyOfferable(false); }}>
                  Clear filters
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="legend">
          <span><i style={{ background: "var(--emerald)" }} />Accepted</span>
          <span><i style={{ border: "1px dashed var(--emerald)", background: "transparent" }} />Assigned · not yet seen</span>
          <span><i style={{ background: "var(--cyan)" }} />In progress</span>
          <span><i style={{ background: "repeating-linear-gradient(45deg,var(--amber) 0 3px,transparent 3px 6px)" }} />Offered (24h)</span>
          <span><i style={{ background: "repeating-linear-gradient(45deg,#8C959D 0 3px,transparent 3px 6px)" }} />Unavailable</span>
        </div>
      </header>

      <div className="layout">
        <aside className="tray">
          {/* Anything waiting on a staff decision comes FIRST — these have a
              customer on the other end of them. */}
          {approvals.length > 0 && (
            <div style={{ marginBottom: 22 }}>
              <h2>Needs your decision</h2>
              <p className="sub">Ring the customer, then approve or reject</p>
              {approvals.map((a) => {
                const resched = isReschedule(a.offer);
                const due = a.offer.approval_due_at;
                const late = due ? msRemaining(due) <= 0 : false;
                return (
                  <div className="jcard" key={a.offer.id} style={{ cursor: "default", borderColor: late ? "rgba(179,87,74,.6)" : "rgba(224,168,60,.55)" }}>
                    <div className="r1">
                      <span className="ref">{a.woRef}</span>
                      <span className="fin" style={{ color: late ? "var(--clay)" : "var(--amber)", borderColor: "currentColor" }}>
                        {due ? (late ? "OVERDUE" : coarseCountdown(due)) : "WAITING"}
                      </span>
                    </div>
                    <h3>{a.title}</h3>
                    <div className="meta">
                      {a.contractorName.toUpperCase()} · {resched ? "WANTS TO MOVE THE JOB" : "PROPOSED A NEW DATE"}
                    </div>
                    <div className="pay">
                      {resched && a.offer.prior_start_date ? `${formatDMY(a.offer.prior_start_date)} → ` : ""}
                      {formatDMY(a.offer.proposed_start_date)}
                    </div>
                    {a.offer.response_note && (
                      <div className="meta" style={{ marginTop: 6, color: "var(--text)" }}>&ldquo;{a.offer.response_note}&rdquo;</div>
                    )}
                    <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                      <button className="btn cy" style={{ marginTop: 0, padding: 8, fontSize: 12 }} disabled={busy} onClick={() => resolve(a.offer, true)}>
                        Approve
                      </button>
                      <button className="btn gh" style={{ marginTop: 0, padding: 8, fontSize: 12 }} disabled={busy} onClick={() => resolve(a.offer, false)}>
                        {resched ? "Keep original" : "Reject"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Nobody withdrew these — the 24-hour clock did, and the job landed
              back here on its own. Without saying so, a job reappearing in the
              tray looks like a bug. */}
          {lapsedJobs.length > 0 && (
            <div className="lapsed-banner" data-testid="lapsed-banner">
              <b>{lapsedJobs.length} offer{lapsedJobs.length === 1 ? "" : "s"} came back to you</b>
              <span>
                Not accepted within 24 hours, so {lapsedJobs.length === 1 ? "it was" : "they were"}{" "}
                withdrawn automatically and moved back to Unscheduled. Offer{lapsedJobs.length === 1 ? " it" : " them"} to someone else.
              </span>
            </div>
          )}

          <h2>Unscheduled</h2>
          <p className="sub">Accepted jobs awaiting dates · longest wait first · drag onto the timeline</p>
          {tray.length > 0 && (
            <input
              type="search"
              className="traysearch"
              placeholder="Search job, reference or suburb"
              aria-label="Search the unscheduled jobs"
              value={traySearch}
              onChange={(e) => setTraySearch(e.target.value)}
              data-testid="tray-search"
            />
          )}
          {tray.length === 0 ? (
            <div className="empty">Nothing waiting. Issue a work order and it appears here.</div>
          ) : shownTray.length === 0 ? (
            <div className="empty" data-testid="tray-no-match">
              Nothing matches &ldquo;{traySearch.trim()}&rdquo;. {tray.length} job{tray.length === 1 ? "" : "s"} waiting.
            </div>
          ) : (
            shownTray.map((j) =>
              j.needsIssuing ? (
                // Accepted but not issued: visible here so it can't be forgotten,
                // but it can't be dragged until the work order exists to send.
                <div key={j.workOrderId} className="jcard needsissue">
                  <div className="r1">
                    <span className="ref">{j.woRef}</span>
                    <span className="fin" style={{ color: "var(--amber)", borderColor: "currentColor" }}>
                      NEEDS ISSUING
                    </span>
                  </div>
                  <h3>{j.title}</h3>
                  <div className="meta">ACCEPTED BEFORE WORK ORDERS WERE AUTOMATIC</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6, lineHeight: 1.5 }}>
                    Open it once and it fixes itself — no need to press anything. Jobs
                    accepted from now on arrive here ready to drag.
                  </div>
                  <a className="btn gh" style={{ marginTop: 10, padding: 9, fontSize: 12.5 }} href={`/quote?id=${j.estimateId}&view=workorder`}>
                    Open it once
                  </a>
                </div>
              ) : (
                // data-testid so the e2e smoke test isn't pinned to styling
                // classes, which change for cosmetic reasons.
                <div
                  key={j.workOrderId}
                  className="jcard"
                  data-testid="tray-job"
                  data-wo-ref={j.woRef}
                  onPointerDown={(e) => beginDrag(e, { kind: "tray", job: j })}
                >
                  <div className="r1">
                    <span className="ref">{j.woRef}</span>
                    {j.finishCode && <span className="fin">{j.finishCode}</span>}
                  </div>
                  <h3>{j.title}</h3>
                  {/* Tom, 22 Sep: a link to the estimate from the tray. Pointer-down stops here so the link never starts a drag. */}
                  <a
                    href={`/quote?id=${j.estimateId}`}
                    className="jlink"
                    data-testid="tray-view-estimate"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  >
                    View estimate ›
                  </a>
                  <div className="meta">
                    {j.suburb ? `${j.suburb.toUpperCase()} · ` : ""}
                    {j.estimatedDays} DAY{j.estimatedDays === 1 ? "" : "S"}
                    {j.hours ? ` · ${j.hours.toFixed(1)} H` : ""}
                    {j.idealPainters ? ` · ${j.idealPainters} PAINTER${j.idealPainters === 1 ? "" : "S"}` : ""}
                  </div>
                  <div className="pay">{money(j.paymentCents)}</div>
                  {j.lastDeclineReason && <div className="flagline">DECLINED — {j.lastDeclineReason.toUpperCase()}</div>}
                  {/* Why WE pulled it. Written in the cancel dialog and, until
                      now, never shown anywhere afterwards. */}
                  {j.cancelledReason && (
                    <div className="flagline" data-testid="tray-cancelled">
                      WE CANCELLED — {j.cancelledReason.toUpperCase()}
                    </div>
                  )}
                  {j.lapsed && (
                    <div className="lapsedline" data-testid="tray-lapsed">
                      {j.lapsed.contractorName.toUpperCase()} DIDN&rsquo;T ACCEPT WITHIN 24 HOURS — MOVED BACK
                    </div>
                  )}

                  {/* The chase log. onPointerDown is stopped throughout: this
                      card is a drag handle, and typing a note must not start
                      dragging the job onto a contractor's row. */}
                  <div className="notes" onPointerDown={(e) => e.stopPropagation()}>
                    {j.notes.length > 0 && (
                      <ul data-testid={`notes-${j.woRef}`}>
                        {j.notes.map((n) => (
                          <li key={n.id}>
                            <span className="when">
                              {new Date(n.at).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}
                              {n.author ? ` · ${n.author.split(/\s+/)[0]}` : ""}
                            </span>
                            <span className="what">{n.note}</span>
                            <button type="button" title="Delete this note" disabled={noteBusy}
                              onClick={() => removeNote(n.id)} data-testid={`note-del-${n.id}`}>×</button>
                          </li>
                        ))}
                      </ul>
                    )}

                    {noteOpen === j.workOrderId ? (
                      <>
                        <textarea
                          rows={2}
                          autoFocus
                          maxLength={2000}
                          value={noteText}
                          placeholder="e.g. Left a voicemail — no answer. Trying again Thursday."
                          onChange={(e) => setNoteText(e.target.value)}
                          data-testid="note-input"
                        />
                        {noteErr && <span className="noteerr">{noteErr}</span>}
                        <span className="noterow">
                          <button type="button" className="save" disabled={noteBusy}
                            onClick={() => saveNote(j.workOrderId)} data-testid="note-save">
                            {noteBusy ? "Saving…" : "Save note"}
                          </button>
                          <button type="button" disabled={noteBusy}
                            onClick={() => { setNoteOpen(null); setNoteText(""); setNoteErr(""); }}>
                            Cancel
                          </button>
                        </span>
                      </>
                    ) : (
                      <button type="button" className="addnote" data-testid={`add-note-${j.woRef}`}
                        onClick={() => { setNoteOpen(j.workOrderId); setNoteText(""); setNoteErr(""); }}>
                        {j.notes.length ? "+ Add another note" : "+ Add a note"}
                      </button>
                    )}
                  </div>
                </div>
              ),
            )
          )}
          <p className="hint">
            Drag a job onto a contractor&rsquo;s row — nothing is sent until you confirm,
            and the row turns red if they&rsquo;ve blocked those days out. Drag across
            empty space on a row to block that contractor out. Drag an existing
            booking to another row to reassign it.
          </p>
        </aside>

        <main className="tl" ref={tlRef}>
          <div className="grid">
            {/* Tom, 18 Sep: the month, the day and the date stay locked at the
                top while you scroll down through the contractors, so you can
                always see which day you are dragging a job onto. One wrapper
                rather than pinning the two rows separately, so nothing depends
                on knowing how tall the month bar is. */}
            <div className="hdr" data-testid="board-header">
            <div className="mb">
              <div className="mcell spacer" />
              {monthRuns(days).map((m, i) => (
                <div key={i} className="mcell" style={{ gridColumn: `span ${m.span}` }}>
                  {m.label}
                </div>
              ))}
            </div>
            <div className="dh">
              <div className="cell lanehead">Contractor</div>
              {days.map((d) => {
                const p = dayParts(d);
                const we = p.dow === 0 || p.dow === 6;
                return (
                  <div key={d} className={`cell ${we ? "we" : ""} ${d === today ? "today" : ""}`}>
                    {/* Day name AND number, always — a column of bare numbers
                        gives no sense of where the weekends fall. Zoomed right
                        out there is only room for the initial. */}
                    <span className="dw">{dayW >= 34 ? p.short : p.short.slice(0, 1)}</span>
                    <span className="dn">{p.num}</span>
                  </div>
                );
              })}
            </div>
            </div>

            <div>
              {visibleLanes.map((l) => {
                const lay = laneLayout.get(l.contractorId) ?? { placed: [], rows: 1, peak: 0 };
                const over = lay.peak > l.crewSize;
                return (
                  <div
                    className="crow"
                    key={l.contractorId}
                    style={{ height: `${Math.max(1, lay.rows) * 52 + 14}px` }}
                  >
                    <div className="cinfo">
                      <div className="nmrow">
                        <div className="nm">{l.name}</div>
                        <div className="bd">
                          {!l.active ? (
                            <span className="no">SUSPENDED</span>
                          ) : l.employmentType === "employee" ? (
                            <span className="emp" data-testid="lane-employee">EMPLOYEE</span>
                          ) : (
                            <span className={l.offerable ? "q" : "no"}>{l.offerable ? "READY" : "NOT READY"}</span>
                          )}
                        </div>
                      </div>
                      <div className="tg">TIER {l.tier}{l.company ? ` · ${l.company.toUpperCase()}` : ""}</div>
                      <div className="bd">
                        <span className={over ? "no" : ""} title={`${l.crewSize} painter${l.crewSize === 1 ? "" : "s"}; busiest day has ${lay.peak} job${lay.peak === 1 ? "" : "s"} on`}>
                          {lay.peak}/{l.crewSize} {over ? "OVER" : "ON"}
                        </span>
                      </div>
                    </div>

                    <div
                      className="lane"
                      data-testid="lane"
                      data-contractor-id={l.contractorId}
                      data-contractor-company={l.company}
                      ref={(el) => { if (el) laneRefs.current.set(l.contractorId, el); }}
                      onPointerDown={(e) => beginBlockOut(e, l.contractorId)}
                    >
                      {days.map((d) => {
                        const dow = dayParts(d).dow;
                        return <div key={d} className={`bgc ${dow === 0 || dow === 6 ? "we" : ""}`} />;
                      })}

                      {/* §4b: walkthrough pins — the sign-off visit, on the
                          day it is booked. Not draggable (rebooking happens on
                          the job page, where the Mode B gate lives beside it);
                          tap-through to the work order. The bottom strip keeps
                          them clear of the booking blocks. */}
                      {walkthroughs.filter((w) => w.contractorId === l.contractorId).map((w) => {
                        const off = dayDiff(start, w.date);
                        if (off < 0 || off >= range) return null;
                        return (
                          <a
                            key={w.id}
                            className="wtpin"
                            href={`/pc/wo/${w.workOrderId}`}
                            style={{ left: `calc(var(--day-w) * ${off} + 3px)` }}
                            title={`${w.kind === "final" ? "Final" : "Pre"} walkthrough${w.time ? ` ${w.time}` : ""} · ${w.title} · ${w.woRef}`}
                            onPointerDown={(e) => e.stopPropagation()}
                            data-testid={`walkthrough-pin-${w.id}`}
                          >
                            {w.kind === "final" ? `WALK${w.time ? ` ${w.time}` : " ✓"}` : "PRE"}
                          </a>
                        );
                      })}

                      {lay.placed.map(({ block: b, row }) => {
                        const offset = Math.max(0, dayDiff(start, b.start));
                        const endIdx = Math.min(range - 1, dayDiff(start, b.end));
                        const span = Math.max(1, endIdx - offset + 1);
                        const movable = b.kind === "accepted" || b.kind === "offered" || b.kind === "proposed" || b.kind === "assigned";
                        return (
                          <div
                            key={b.id}
                            className={`blk ${b.kind}${b.assignmentId && !b.acceptedAt ? " hollow" : ""}`}
                            data-testid={b.assignmentId ? "assignment-block" : undefined}
                            data-assignment-id={b.assignmentId}
                            data-lead={b.isLead ? "1" : undefined}
                            data-accepted={b.acceptedAt ? "1" : undefined}
                            style={{
                              left: `calc(var(--day-w) * ${offset} + 3px)`,
                              width: `calc(var(--day-w) * ${span} - 6px)`,
                              top: `${7 + row * 52}px`,
                            }}
                            onPointerDown={movable ? (e) => beginDrag(e, { kind: "block", block: b }) : undefined}
                            onClick={() => setDetail(b)}
                            title={b.title}
                          >
                            <div className="t">{b.isLead && <span className="lead" title="Lead painter">★</span>}{b.title}</div>
                            <div className="m">
                              {b.kind === "unavailable"
                                ? (b.source === "staff" ? "BLOCKED BY OFFICE" : "UNAVAILABLE")
                                : b.woRef}
                              {b.assignmentId && (b.crewSize ?? 1) > 1 && (
                                <span className="crew">{b.crewIndex} OF {b.crewSize}</span>
                              )}
                              {b.assignmentId && !b.acceptedAt && <span className="crew">NOT YET SEEN</span>}
                            </div>
                            {b.expiresAt && <div className="cd">{coarseCountdown(b.expiresAt)}</div>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {visibleLanes.length === 0 && (
                <div className="empty" style={{ margin: 20 }}>
                  {/* An empty board because a query failed looks identical to an
                      empty board because there's no work — so distinguish them. */}
                  {errors.length > 0
                    ? `Couldn't load the board — ${errors.join("; ")}`
                    : lanes.length === 0
                      ? "No contractors set up yet."
                      : "No contractors match this view."}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* drag ghost — moved by transform only */}
      {ghost && (
        <div ref={ghostRef} className={`ghost ${ghostBlocked ? "blocked" : ""}`}>
          <div className="g1">{ghost.title}</div>
          <div className="g2">{ghostBlocked ? "BLOCKED OUT — DROP TO OVERRIDE" : ghost.sub}</div>
        </div>
      )}

      {/* confirm a drop */}
      <div
        className={`scrim ${pendingDrop || detail || pendingBlock ? "on" : ""}`}
        onClick={() => { setPendingDrop(null); setDetail(null); setPendingBlock(null); setErr(""); setOfferNote(""); }}
      />

      <div className={`sheet ${pendingDrop ? "open" : ""}`}>
        {pendingDrop && (
          <>
            <h3>
              {isEmployeeLane(pendingDrop.contractorId) || pendingDrop.block?.assignmentId
                ? (pendingDrop.kind === "tray" ? "Assign this job?" : "Move these days?")
                : (pendingDrop.kind === "tray" ? "Send this offer?" : "Move this booking?")}
            </h3>
            <p className="slab">
              {isEmployeeLane(pendingDrop.contractorId) || pendingDrop.block?.assignmentId
                ? "Straight into their calendar — they tap Accept when they've seen it"
                : "Nothing reaches the customer until the contractor accepts"}
            </p>
            <div className="frow">
              <span className="l">Job</span>
              <span className="v">{(pendingDrop.job?.title ?? pendingDrop.block?.title ?? "").toUpperCase()}</span>
            </div>
            <div className="frow">
              <span className="l">Contractor</span>
              <span className="v">{lanes.find((l) => l.contractorId === pendingDrop.contractorId)?.name.toUpperCase()}</span>
            </div>
            <div className="frow">
              <span className="l">Dates</span>
              <span className="v" data-testid="booking-dates" data-start={pendingDrop.startDate} data-end={endFor(pendingDrop.contractorId, pendingDrop.startDate, pendingDrop.spanDays)}>
                {formatDMY(pendingDrop.startDate)} → {formatDMY(endFor(pendingDrop.contractorId, pendingDrop.startDate, pendingDrop.spanDays))}
                <span style={{ color: "var(--muted)", marginLeft: 6, fontSize: 11 }}>working days · weekends skipped{weekFor(pendingDrop.contractorId).saturday || weekFor(pendingDrop.contractorId).sunday ? " except the days this painter works" : ""}</span>
              </span>
            </div>
            <div className="frow">
              <span className="l">Length</span>
              <span className="v">
                <button onClick={() => setPendingDrop({ ...pendingDrop, spanDays: Math.max(1, pendingDrop.spanDays - 1) })} style={{ background: "none", border: "1px solid var(--line)", color: "var(--text)", borderRadius: 6, width: 24, height: 24, cursor: "pointer" }}>−</button>
                <span style={{ margin: "0 10px" }} data-testid="booking-span-days" data-days={pendingDrop.spanDays}>{pendingDrop.spanDays} d</span>
                <button onClick={() => setPendingDrop({ ...pendingDrop, spanDays: pendingDrop.spanDays + 1 })} style={{ background: "none", border: "1px solid var(--line)", color: "var(--text)", borderRadius: 6, width: 24, height: 24, cursor: "pointer" }}>+</button>
              </span>
            </div>
            {pendingDrop.job && !isEmployeeLane(pendingDrop.contractorId) && (
              <div className="frow">
                <span className="l">Their price</span>
                <span className="v" style={{ color: "var(--cyan)" }}>{money(pendingDrop.job.paymentCents)}</span>
              </div>
            )}
            {pendingDrop.job && isEmployeeLane(pendingDrop.contractorId) && pendingDrop.job.hours != null && (
              <div className="frow">
                <span className="l">Time budget</span>
                <span className="v">{pendingDrop.job.estimatedDays} d · {pendingDrop.job.hours.toFixed(1)} h</span>
              </div>
            )}
            {(isEmployeeLane(pendingDrop.contractorId) || pendingDrop.block?.assignmentId) && (
              <div className="frow" style={{ display: "block" }}>
                <span className="l" style={{ display: "block", marginBottom: 6 }}>
                  Override reason <span style={{ opacity: 0.6 }}>(only if they&rsquo;re already booked or away those days)</span>
                </span>
                <input type="text" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)}
                  data-testid="assign-override" placeholder="e.g. agreed with Marco — he'll split the days"
                  style={{ width: "100%" }} />
              </div>
            )}

            {pendingDrop.kind === "tray" && (
              <div className="frow" style={{ display: "block" }}>
                <span className="l" style={{ display: "block", marginBottom: 6 }}>
                  Note for the contractor <span style={{ opacity: 0.6 }}>(optional)</span>
                </span>
                <textarea
                  rows={3}
                  maxLength={500}
                  value={offerNote}
                  onChange={(e) => setOfferNote(e.target.value)}
                  data-testid="offer-note"
                  placeholder="e.g. Client is on a tight schedule — this needs to start on the date shown."
                  style={{
                    width: "100%", background: "var(--panel, #11151c)", color: "var(--text)",
                    border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px",
                    fontSize: 13, lineHeight: 1.45, fontFamily: "inherit", resize: "vertical",
                  }}
                />
                <span style={{ fontSize: 11, color: "var(--muted)" }}>
                  They see this on the offer, before they accept. {500 - offerNote.length} left.
                </span>
                {/* Tom, 23 Aug: flag a quality check when booking the job in —
                    new painters get one regardless; this widens it to any job. */}
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={offerQa} onChange={(e) => setOfferQa(e.target.checked)}
                    data-testid="offer-qa-required" />
                  Quality check required on this job
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={offerNoWalk} onChange={(e) => setOfferNoWalk(e.target.checked)}
                    data-testid="offer-no-walkthrough" />
                  Walkthrough not required — closes straight after the job (and any quality check)
                </label>
                {!offerNoWalk && (
                  <div style={{ marginTop: 10 }}>
                    <span className="l" style={{ display: "block", marginBottom: 6 }}>
                      Final walkthrough — confirm the date &amp; time with the client
                    </span>
                    {/* The date field starts EMPTY on purpose (Tom, 1 Sep):
                        booking means someone actually spoke to the client, so
                        the suggested date is written beside the field, one tap
                        away, never silently pre-filled into it. */}
                    <div style={{ display: "flex", gap: 8 }}>
                      <input type="date" data-testid="walkthrough-date"
                        value={walkDate}
                        onChange={(e) => setWalkDate(e.target.value)}
                        style={{ flex: 1, background: "var(--panel, #11151c)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontSize: 13 }} />
                      <input type="time" data-testid="walkthrough-time"
                        value={walkTime}
                        onChange={(e) => setWalkTime(e.target.value)}
                        style={{ width: 110, background: "var(--panel, #11151c)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontSize: 13 }} />
                    </div>
                    <span style={{ fontSize: 11, color: "var(--muted)", display: "block", marginTop: 4 }}>
                      Estimated final walkthrough:{" "}
                      <button type="button" data-testid="use-suggested-walkthrough"
                        onClick={() => setWalkDate(endFor(pendingDrop.contractorId, pendingDrop.startDate, pendingDrop.spanDays))}
                        style={{ background: "none", border: "none", padding: 0, color: "var(--cyan, #22d3ee)", cursor: "pointer", fontSize: 11, textDecoration: "underline" }}>
                        {formatDMY(endFor(pendingDrop.contractorId, pendingDrop.startDate, pendingDrop.spanDays))}
                      </button>
                      {" "}(last day on site). Both the date and a time are needed to send —
                      or tick walkthrough not required.
                    </span>
                  </div>
                )}
              </div>
            )}

            {pendingDrop.blocked && (
              <div className="err">
                This contractor has blocked these days out. You can still send it, but
                they told you they&rsquo;re not available.
              </div>
            )}
            {err && <div className="err">{err}</div>}

            <button
              className="btn cy"
              disabled={busy}
              data-testid="drop-confirm"
              onClick={
                pendingDrop.kind === "tray"
                  ? (isEmployeeLane(pendingDrop.contractorId) ? assignJob : sendOffer)
                  : (pendingDrop.block?.assignmentId ? moveAssignment : moveBooking)
              }
            >
              {busy ? "Working…"
                : pendingDrop.kind === "tray"
                  ? (isEmployeeLane(pendingDrop.contractorId) ? "Assign job" : "Send offer")
                  : (pendingDrop.block?.assignmentId ? "Move days" : "Move booking")}
            </button>
            <button className="btn gh" onClick={() => {
              // Reset EVERYTHING — a cancelled sheet must not leak one job's
              // walkthrough date or ticks onto the next drop.
              setPendingDrop(null); setErr(""); setOfferNote("");
              setOfferQa(false); setOfferNoWalk(false); setWalkDate(""); setWalkTime("");
            }}>Cancel</button>
          </>
        )}
      </div>

      {/* block detail */}
      <div className={`sheet ${detail && !pendingDrop && !pendingBlock ? "open" : ""}`}>
        {detail && (
          <>
            <h3>{detail.title}</h3>
            <p className="slab">{detail.kind.replace("_", " ")}</p>
            <div className="frow"><span className="l">Dates</span><span className="v">{formatDMY(detail.start)} → {formatDMY(detail.end)}</span></div>
            {detail.woRef && <div className="frow"><span className="l">Reference</span><span className="v">{detail.woRef}</span></div>}
            {detail.paymentCents != null && <div className="frow"><span className="l">Their price</span><span className="v">{money(detail.paymentCents)}</span></div>}
            {detail.finishCode && <div className="frow"><span className="l">Finish</span><span className="v">{detail.finishCode}</span></div>}
            {detail.expiresAt && <div className="frow"><span className="l">Expires in</span><span className="v" style={{ color: "var(--amber)" }}>{coarseCountdown(detail.expiresAt)}</span></div>}

            {/* Employed painters (S2): the crew on this job, the Lead painter
                button, add a painter, take this one off. */}
            {detail.assignmentId && detail.workOrderId && (() => {
              const crew = blocks.filter((b) => b.assignmentId && b.workOrderId === detail.workOrderId);
              const lead = crew.find((b) => b.isLead);
              const onJob = new Set(crew.map((b) => b.contractorId));
              const spare = lanes.filter((l) => l.employmentType === "employee" && l.active && !onJob.has(l.contractorId));
              const nameOf = (id: string) => lanes.find((l) => l.contractorId === id)?.name ?? "Painter";
              return (
                <div data-testid="assignment-detail">
                  <div className="frow">
                    <span className="l">Painter</span>
                    <span className="v">{nameOf(detail.contractorId).toUpperCase()}{detail.isLead ? " · LEAD" : ""}</span>
                  </div>
                  <div className="frow">
                    <span className="l">Seen it</span>
                    <span className="v" style={{ color: detail.acceptedAt ? "var(--emerald)" : "var(--amber)" }}>
                      {detail.acceptedAt ? `ACCEPTED ${formatDMY(detail.acceptedAt.slice(0, 10))}` : "NOT YET — HOLLOW ON THE BOARD"}
                    </span>
                  </div>
                  <div className="frow">
                    <span className="l">Crew</span>
                    <span className="v">{crew.map((b) => `${b.isLead ? "★ " : ""}${nameOf(b.contractorId)}`).join(" · ").toUpperCase()}</span>
                  </div>
                  {!detail.isLead && (
                    <button className="btn dim" disabled={busy} data-testid="make-lead"
                      onClick={() => makeLead(detail.workOrderId!, detail.contractorId)}>
                      Make {nameOf(detail.contractorId)} the lead painter
                    </button>
                  )}
                  {spare.length > 0 && (
                    <div className="frow" style={{ display: "block", marginTop: 10 }}>
                      <span className="l" style={{ display: "block", marginBottom: 6 }}>Add a painter — same days as {nameOf(detail.contractorId)}</span>
                      <div style={{ display: "flex", gap: 8 }}>
                        <select value={addPainterId} onChange={(e) => setAddPainterId(e.target.value)} data-testid="add-painter"
                          style={{ flex: 1 }}>
                          <option value="">Pick an employee…</option>
                          {spare.map((l) => <option key={l.contractorId} value={l.contractorId}>{l.name}</option>)}
                        </select>
                        <button className="btn dim" disabled={busy || !addPainterId} data-testid="add-painter-go"
                          onClick={() => addPainter(detail.workOrderId!, addPainterId, detail.start, detail.end, lead?.contractorId ?? detail.contractorId)}>
                          Add
                        </button>
                      </div>
                      <input type="text" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)}
                        placeholder="Override reason, only if they're booked or away those days" style={{ width: "100%", marginTop: 6 }} />
                    </div>
                  )}
                  <label className="ctrl-lab" style={{ display: "block", marginTop: 16, marginBottom: 6 }}>
                    Reason (goes on the record)
                  </label>
                  <input type="text" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="e.g. needed on the Elm St job" style={{ width: "100%" }} />
                  <button className="btn dim" disabled={busy} data-testid="release-painter"
                    onClick={() => releasePainter(detail.assignmentId!, cancelReason)}>
                    Take {nameOf(detail.contractorId)} off this job
                  </button>
                  <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
                    Future days only — anything they have already ticked stays on the job.
                    {detail.isLead && crew.length > 1 ? " They're the lead, so name another lead painter first." : ""}
                    {crew.length === 1 ? " They're the only painter, so the job goes back to the unscheduled tray." : ""}
                  </p>
                </div>
              );
            })()}
            {detail.kind === "unavailable" && (
              <>
                <div className="frow"><span className="l">Set by</span><span className="v">{detail.source === "staff" ? "THE OFFICE" : "THE CONTRACTOR"}</span></div>
                {detail.source === "staff" ? (
                  <button className="btn dim" disabled={busy} onClick={() => removeBlock(detail.id)}>Remove this block</button>
                ) : (
                  <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 12 }}>
                    The contractor set this themselves, so it can only be cleared from their end.
                  </p>
                )}
              </>
            )}
            {/* Cancelling: works on a pending offer OR an already-booked job. */}
            {detail.offerId && detail.kind !== "unavailable" && (
              <>
                <label className="ctrl-lab" style={{ display: "block", marginTop: 16, marginBottom: 6 }}>
                  Reason (goes on the record)
                </label>
                <input
                  type="text"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder={detail.kind === "accepted" ? "e.g. customer postponed" : "e.g. offering someone closer"}
                  style={{ width: "100%" }}
                />
                <button className="btn dim" disabled={busy} onClick={() => cancelBooking(detail.offerId!, cancelReason)}>
                  {detail.kind === "accepted" ? "Cancel this booking" : "Cancel this offer"}
                </button>
                <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
                  The job goes back to the unscheduled tray, ready to send to someone else.
                  {detail.kind === "accepted" ? " The contractor loses the booking, so give them a call too." : ""}
                </p>
              </>
            )}

            {/* Tom (25 Aug): open the job WHERE IT IS — the PC stage view,
                not the builder's work-order tab. */}
            {detail.workOrderId ? (
              <a
                className="btn gh"
                href={`/pc/wo/${detail.workOrderId}`}
                style={{ display: "block", textAlign: "center", textDecoration: "none" }}
                data-testid="open-pc-job"
              >
                Open the job — stage view
              </a>
            ) : detail.estimateId ? (
              <a
                className="btn gh"
                href={`/quote?id=${detail.estimateId}&view=workorder`}
                style={{ display: "block", textAlign: "center", textDecoration: "none" }}
              >
                Open the work order
              </a>
            ) : null}
            <button className="btn gh" onClick={() => setDetail(null)}>Close</button>
          </>
        )}
      </div>

      {/* dragged-out block range */}
      <div className={`sheet ${pendingBlock ? "open" : ""}`}>
        {pendingBlock && (
          <>
            <h3>Block these days out?</h3>
            <p className="slab">The contractor sees this in their calendar</p>
            <div className="frow">
              <span className="l">Contractor</span>
              <span className="v">{lanes.find((l) => l.contractorId === pendingBlock.contractorId)?.name.toUpperCase()}</span>
            </div>
            <div className="frow">
              <span className="l">Days</span>
              <span className="v">{formatDMY(pendingBlock.start)}{pendingBlock.end !== pendingBlock.start ? ` → ${formatDMY(pendingBlock.end)}` : ""}</span>
            </div>
            {isEmployeeLane(pendingBlock.contractorId) && (
              <>
                <label className="ctrl-lab" style={{ display: "block", marginTop: 14, marginBottom: 6 }}>What kind of day</label>
                <select value={blockKind} onChange={(e) => setBlockKind(e.target.value as typeof blockKind)} data-testid="block-kind" style={{ width: "100%" }}>
                  <option value="sick">Sick — counts now, Reassign on any booked day</option>
                  <option value="leave">Leave — approved by you</option>
                  <option value="rdo">RDO — approved by you</option>
                  <option value="other">Blocked out (other)</option>
                </select>
              </>
            )}
            <label className="ctrl-lab" style={{ display: "block", marginTop: 14, marginBottom: 6 }}>Reason (optional)</label>
            <input type="text" value={blockReason} onChange={(e) => setBlockReason(e.target.value)} placeholder="e.g. training, annual leave" style={{ width: "100%" }} />
            {err && <div className="err">{err}</div>}
            <button className="btn cy" disabled={busy} onClick={saveBlockOut}>Block them out</button>
            <button className="btn gh" onClick={() => { setPendingBlock(null); setBlockReason(""); }}>Cancel</button>
          </>
        )}
      </div>

      {/* staff blocking days out — requirement 2, office side */}
      <BlockOutBar lanes={lanes} onBlock={blockOut} busy={busy} />

      <div className={`toast ${toast ? "show" : ""}`}><b>{toast}</b></div>
    </div>
  );
}

/** Small always-available control for marking a contractor unavailable. */
function BlockOutBar({
  lanes,
  onBlock,
  busy,
}: {
  lanes: Lane[];
  onBlock: (contractorId: string, s: string, e: string, reason: string, kind?: "other" | "leave" | "rdo" | "sick") => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [cid, setCid] = useState("");
  const [s, setS] = useState("");
  const [e, setE] = useState("");
  const [reason, setReason] = useState("");
  const [kind, setKind] = useState<"other" | "leave" | "rdo" | "sick">("other");
  const employee = lanes.find((l) => l.contractorId === cid)?.employmentType === "employee";

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{ position: "fixed", left: 18, bottom: 18, zIndex: 50, background: "var(--raised)", border: "1px solid var(--line)", color: "var(--muted)", borderRadius: 10, padding: "9px 14px", fontSize: 12.5, cursor: "pointer" }}
      >
        + Block out days
      </button>
    );
  }
  return (
    <div style={{ position: "fixed", left: 18, bottom: 18, zIndex: 50, background: "var(--raised)", border: "1px solid var(--line)", borderRadius: 12, padding: 14, width: 300 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Block out days</div>
      <select value={cid} onChange={(ev) => setCid(ev.target.value)} style={{ width: "100%", marginBottom: 6 }}>
        <option value="">— contractor —</option>
        {lanes.map((l) => <option key={l.contractorId} value={l.contractorId}>{l.name}</option>)}
      </select>
      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        <input type="date" value={s} onChange={(ev) => setS(ev.target.value)} style={{ flex: 1 }} />
        <input type="date" value={e} onChange={(ev) => setE(ev.target.value)} style={{ flex: 1 }} />
      </div>
      {employee && (
        <select value={kind} onChange={(ev) => setKind(ev.target.value as typeof kind)} data-testid="blockbar-kind" style={{ width: "100%", marginBottom: 6 }}>
          <option value="sick">Sick</option>
          <option value="leave">Leave (approved)</option>
          <option value="rdo">RDO (approved)</option>
          <option value="other">Blocked out (other)</option>
        </select>
      )}
      <input type="text" placeholder="Reason (optional)" value={reason} onChange={(ev) => setReason(ev.target.value)} style={{ width: "100%", marginBottom: 8 }} />
      <button
        className="btn cy"
        style={{ marginTop: 0, padding: 9, fontSize: 13 }}
        disabled={busy || !cid || !s}
        onClick={() => { onBlock(cid, s, e || s, reason, employee ? kind : "other"); setOpen(false); setCid(""); setS(""); setE(""); setReason(""); setKind("other"); }}
      >
        {employee && kind !== "other" ? `Mark ${kind === "sick" ? "sick" : kind === "rdo" ? "an RDO" : "leave"}` : "Block these days"}
      </button>
      <button className="btn gh" style={{ padding: 9, fontSize: 13 }} onClick={() => setOpen(false)}>Cancel</button>
    </div>
  );
}
