"use client";

import { logCallbackAction } from "@/app/pc/callbackActions";
import { setNoWorkDayAction } from "@/app/pc/noWorkActions";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { pingGcalSync } from "@/lib/gcal/ping";
import { pingAppointmentConfirm } from "@/lib/workorder/appointmentPing";
import { msRemaining, isReschedule, formatDMY, type BookingOffer } from "@/lib/scheduling/offers";
import { addWorkingDays, dayDiff, workingDaysBetween, type WorkingWeek } from "@/lib/scheduling/dates";
import {
  sendOfferAction, reassignOfferAction, moveBookingAction, blockOutAction, addBookingNote, deleteBookingNote,
  assignJobAction, reassignDatesAction, setLeadPainterAction, releaseAssignmentAction,
  addAppointmentAction, moveAppointmentAction, removeAppointmentAction, holdDatesAction, moveHoldAction, releaseHoldAction,
  searchProjectsAction, setFinishDateAction, type ActionResult, type VisitProjectHit,
} from "./actions";
import type { Block, BoardWalkthrough, Lane, TrayJob } from "@/lib/scheduling/board";
import {
  Board, Tray, SavedViews, Paging, JumpTo, RangePresets, ZoomSlider, Scrim, Toast,
  useBoardDrag, useBoardZoom, dayLabel, type DropTarget, type SavedView as BoardSavedView,
} from "@/app/components/board";
import "./schedule.css";

const money = (c: number | null) => (c == null ? "—" : "$" + (c / 100).toLocaleString("en-AU", { maximumFractionDigits: 0 }));

/** "23h 41m" — the board doesn't need second-by-second precision, and not
 *  re-rendering every second keeps dragging smooth. */
function coarseCountdown(expiresAt: string): string {
  const ms = msRemaining(expiresAt);
  if (ms <= 0) return "EXPIRED";
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** The lane filters a saved view captures (persisted in settings.scheduling_views). */
type ScheduleFilters = { tiers: string[]; contractorIds: string[]; onlyOfferable: boolean };
type SavedView = BoardSavedView<ScheduleFilters>;

/** What a drag carries: a tray job, or a block already on the board. */
type DragPayload = { kind: "tray"; job: TrayJob } | { kind: "block"; block: Block };
/** What the ghost says about the cell under the pointer. */
type DropCheck = { blocked: boolean; held: boolean; start: string; end: string };

/**
 * The scheduling timeline: the board engine (app/components/board — lanes ×
 * days, drag, zoom, tray, saved views) with everything a BOOKING means laid
 * over it: working-day snapping, blocked/held spans, the offer / assign /
 * move sheets, the block detail, the empty-drag block-out / visit / hold
 * sheet, and every commit action. Nothing here draws a lane or hit-tests a
 * day — that is the engine's, and it is the only one (CLAUDE.md).
 */

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

  /**
   * Push the window into the URL so the SERVER refetches for it. Paging or
   * jumping used to move the columns while the blocks stayed behind, so a job
   * booked months out was invisible.
   * /pc/schedule, NOT the old /schedule — that path is now a redirect that
   * DROPS the query, so jumping or paging blanked the board (Tom, 30 Aug).
   */
  const zoom = useBoardZoom({
    from, rangeDays,
    onWindowChange: (s, r) => router.replace(`/pc/schedule?from=${s}&days=${r}`, { scroll: false }),
  });
  const { days, start, range } = zoom;
  // Tom, 1 Oct: the builder's top-left link says "Back to the schedule" and
  // returns to THIS window of dates. Validated on the way back in by
  // lib/navigation/backTo, so the query here is a plain same-site path.
  const fromHere = `&from=${encodeURIComponent(`/pc/schedule?from=${start}&days=${range}`)}`;

  // ---- filters + saved views (requirement 4) --------------------------------
  const [tiers, setTiers] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [onlyOfferable, setOnlyOfferable] = useState(false);
  const [views, setViews] = useState<SavedView[]>(savedViews);

  const allTiers = useMemo(
    () => [...new Set(lanes.map((l) => l.tier))].sort(),
    [lanes],
  );

  const filterLane = useCallback(
    (l: Lane) => {
      if (picked.length > 0) return picked.includes(l.contractorId);
      if (tiers.length > 0 && !tiers.includes(l.tier)) return false;
      // "Ready for work" is about being OFFERABLE, and an employee is never
      // offered — they are assigned. Filtering on the flag hid every employee
      // from the board, which is how Saulius went missing (Tom, 18 Sep).
      if (onlyOfferable && !l.offerable && l.employmentType !== "employee") return false;
      return true;
    },
    [picked, tiers, onlyOfferable],
  );
  const visibleLanes = useMemo(() => lanes.filter(filterLane), [lanes, filterLane]);

  async function persistViews(next: SavedView[]) {
    setViews(next);
    await supabase.from("settings").upsert({ key: "scheduling_views", value: next }, { onConflict: "key" });
  }

  // Dragging across EMPTY lane space marks a contractor unavailable for that
  // run of days — the engine's marquee; what it means is decided here.
  const [pendingBlock, setPendingBlock] = useState<null | { contractorId: string; start: string; end: string }>(null);
  // Tom, 1 Oct: the same drag across empty space can also add a SECOND VISIT
  // to a job this painter already has, or HOLD the days while the client
  // decides. Block-out stays the default so nothing about it changes.
  const [blockMode, setBlockMode] = useState<"block" | "visit" | "hold">("block");
  // Tom, 4 Oct: the visit's project comes from a SEARCH over every project,
  // any status — not a list of what this painter already has.
  const [visitPick, setVisitPick] = useState<VisitProjectHit | null>(null);
  const [visitQuery, setVisitQuery] = useState("");
  const [visitHits, setVisitHits] = useState<VisitProjectHit[]>([]);
  const [visitSearching, setVisitSearching] = useState(false);
  const [visitSearchErr, setVisitSearchErr] = useState("");
  const [visitNote, setVisitNote] = useState("");
  // Debounced; every state write happens inside the timer, never synchronously
  // in the effect (react-hooks/set-state-in-effect). Stale hits for a query
  // that has since been shortened are simply not rendered.
  useEffect(() => {
    const needle = visitQuery.trim();
    if (needle.length < 2) return;
    let live = true;
    const t = setTimeout(() => {
      setVisitSearching(true);
      searchProjectsAction({ q: needle }).then((r) => {
        if (!live) return;
        setVisitSearching(false);
        if (r.ok) { setVisitHits(r.hits); setVisitSearchErr(""); }
        else { setVisitHits([]); setVisitSearchErr(r.message); }
      });
    }, 220);
    return () => { live = false; clearTimeout(t); };
  }, [visitQuery]);
  const [holdWo, setHoldWo] = useState("");
  const [holdNote, setHoldNote] = useState("");

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

  /** Is a hold (another job's, or no job's) sitting on these days? The block being dragged doesn't count. */
  const spanHeld = useCallback(
    (contractorId: string, s: string, spanDays: number, ignoreId?: string) => {
      const e = endFor(contractorId, s, spanDays);
      return blocks.some(
        (b) => b.kind === "hold" && b.id !== ignoreId && b.contractorId === contractorId && b.start <= e && b.end >= s,
      );
    },
    [blocks, endFor],
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
    /** Tom, 1 Oct: a hold sits on these days — say so, don't refuse. */
    held?: boolean;
  }>(null);

  // The three callbacks below are plain functions on purpose: the engine keeps
  // the latest ones in a ref, so they need no memoisation to stay current.
  /** Working days a drag covers: a tray job's estimate, or a block's own span. */
  const spanOf = (p: DragPayload) =>
    p.kind === "tray" ? p.job.estimatedDays : workingDaysBetween(p.block.start, p.block.end, weekFor(p.block.contractorId));

  // Tom, 24 Sep: "show the date pop up while dragging so I know the drop is
  // for the correct date" — the day under the pointer (snapped to the
  // painter's working week) and the end it implies, drawn on the ghost. The
  // same arithmetic the drop uses, so what the ghost says IS the booking.
  // Tom, 1 Oct: the days under the pointer are HELD (pink). Not a refusal —
  // the drop goes ahead and a hold for this same job resolves itself.
  const checkDrop = (p: DragPayload, t: DropTarget): DropCheck => {
    const spanDays = spanOf(p);
    const blocked = spanBlocked(t.laneId, t.day, spanDays);
    const held = spanHeld(t.laneId, t.day, spanDays, p.kind === "block" ? p.block.id : undefined);
    const s = addWorkingDays(t.day, 1, weekFor(t.laneId));
    return { blocked, held, start: s, end: endFor(t.laneId, s, spanDays) };
  };

  const onDrop = (p: DragPayload, t: DropTarget) => {
    // Tom, 22 Sep: a drop on a day this painter does not work starts on their next working day.
    const startDate = addWorkingDays(t.day, 1, weekFor(t.laneId));
    const spanDays = spanOf(p);
    setPendingDrop({
      kind: p.kind,
      job: p.kind === "tray" ? p.job : undefined,
      block: p.kind === "block" ? p.block : undefined,
      contractorId: t.laneId,
      startDate,
      spanDays,
      blocked: spanBlocked(t.laneId, startDate, spanDays),
      held: spanHeld(t.laneId, startDate, spanDays, p.kind === "block" ? p.block.id : undefined),
    });
  };

  // Pointer capture and edge auto-scroll are OFF: the Schedule board never had
  // them (Session 0 item 9.9) and Session 2's rule is no behaviour change.
  // Turning either on is a deliberate decision for Tom's phone check.
  const drag = useBoardDrag<DragPayload, DropCheck>({
    days, dayW: zoom.dayW,
    check: checkDrop,
    onDrop,
    onRangeSelect: (contractorId, s, e) => setPendingBlock({ contractorId, start: s, end: e }),
    capturePointer: false,
    autoScroll: false,
    scroller: zoom.scrollerEl,
  });

  // ---- commit ---------------------------------------------------------------
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // Tom, 18 Sep: find a job in a long tray without scrolling it. Matches the
  // title, the reference and the suburb — the three things staff know a job by.
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
  // Tom, 26 Sep: a crew member's own days, editable — "sometimes the job
  // doesn't require 2 painters to be on at the same time". Seeded from the
  // block when the sheet opens; saved through reassign_dates, which re-spans
  // the job to the crew's earliest start and latest end.
  // Derived, not synced: the edit belongs to ONE block; another block opening
  // starts from its own dates.
  const [edit, setEdit] = useState<{ blockId: string; start: string; end: string } | null>(null);
  const editStart = edit && detail && edit.blockId === detail.id ? edit.start : (detail?.start ?? "");
  const editEnd = edit && detail && edit.blockId === detail.id ? edit.end : (detail?.end ?? "");
  const setEditStart = (v: string) => { if (detail) setEdit({ blockId: detail.id, start: v, end: editEnd }); };
  const setEditEnd = (v: string) => { if (detail) setEdit({ blockId: detail.id, start: editStart, end: v }); };
  // Tom, 8 Oct: the finish date of a booked or running job, from its sheet.
  // Same derived-per-block shape as `edit` above.
  const [finishEdit, setFinishEdit] = useState<{ blockId: string; end: string } | null>(null);
  const finishEnd = finishEdit && detail && finishEdit.blockId === detail.id ? finishEdit.end : (detail?.end ?? "");
  const [finishMsg, setFinishMsg] = useState<{ blockId: string; text: string; ok: boolean } | null>(null);
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

  /** Tom, 26 Sep: change ONE painter's start and end on a crew job, independently of the lead. */
  async function saveAssignmentDates(b: Block) {
    if (!b.assignmentId || !editStart || !editEnd || editEnd < editStart) return;
    setBusy(true);
    setErr("");
    const r = await reassignDatesAction({
      assignmentId: b.assignmentId, startDate: editStart, endDate: editEnd,
      overrideReason: overrideReason.trim() || null,
    });
    if (handle(r, "Days changed — they'll be asked to accept again.")) { setDetail(null); setEdit(null); setOverrideReason(""); }
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

  /** Tom, 1 Oct: drag a pink hold or an extra visit along its own row. */
  async function moveHeldOrVisit() {
    if (!pendingDrop?.block) return;
    const b = pendingDrop.block;
    if (b.contractorId !== pendingDrop.contractorId) {
      setErr(b.holdId
        ? "Drag moves the hold's days, not the painter. Release this one and hold the other painter's days instead."
        : "Drag moves the visit's days, not the painter. Remove this one and add a visit on the other painter's job.");
      return;
    }
    setBusy(true);
    setErr("");
    const endDate = endFor(pendingDrop.contractorId, pendingDrop.startDate, pendingDrop.spanDays);
    const r = b.holdId
      ? await moveHoldAction({ id: b.holdId, startDate: pendingDrop.startDate, endDate })
      : await moveAppointmentAction({ id: b.appointmentId!, startDate: pendingDrop.startDate, endDate });
    if (handle(r, b.holdId ? "Hold moved." : "Visit moved — it's in their calendar on the new days.")) setPendingDrop(null);
    setBusy(false);
  }

  /** The jobs this painter already has on the board — what an extra visit can be added to. */
  const bookedJobsFor = useCallback((contractorId: string) => {
    const seen = new Map<string, Block>();
    for (const b of blocks) {
      if (b.contractorId !== contractorId || !b.workOrderId) continue;
      if (b.kind !== "accepted" && b.kind !== "in_progress" && b.kind !== "assigned" && b.kind !== "offered" && b.kind !== "proposed") continue;
      if (!seen.has(b.workOrderId)) seen.set(b.workOrderId, b);
    }
    return [...seen.values()].sort((a, b) => a.start.localeCompare(b.start));
  }, [blocks]);

  // Call backs Step 3, route 4 (ruling C2): the visit IS a call back on a
  // finished job. One record — on a job with a call back already open the
  // visit joins it, never a second record.
  const [visitCallback, setVisitCallback] = useState(false);
  // R10 (Step 4): "No work today" from the block detail.
  const todayMelb = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [noWorkDay, setNoWorkDay] = useState(todayMelb());
  const [noWorkReason, setNoWorkReason] = useState("");

  /** Tom, 1 Oct: a second run of days on a job this painter already has. */
  async function saveVisit() {
    if (!pendingBlock) return;
    if (!visitPick) { setErr("Search for the project the visit is for, then pick it."); return; }
    setBusy(true);
    setErr("");
    const r = visitCallback
      ? await logCallbackAction({
          workOrderId: visitPick.workOrderId, source: "scheduler", reason: "workmanship", description: visitNote,
          returnStart: pendingBlock.start, returnEnd: pendingBlock.end, fixedBy: pendingBlock.contractorId,
        }).then((x) => (x.ok ? { ok: true as const, state: "ok" as const, message: x.message } : { ok: false as const, kind: "error" as const, message: x.message }))
      : await addAppointmentAction({
          workOrderId: visitPick.workOrderId, contractorId: pendingBlock.contractorId,
          startDate: pendingBlock.start, endDate: pendingBlock.end, note: visitNote,
        });
    if (handle(r, visitCallback ? "Call back booked — it's on the board, in their calendar, and the customer's invoice chasing is paused until it is closed." : "Visit added — it's on the board and in their calendar.")) {
      setPendingBlock(null); setVisitPick(null); setVisitQuery(""); setVisitHits([]); setVisitNote(""); setBlockMode("block"); setVisitCallback(false);
    }
    setBusy(false);
  }

  /** Tom, 1 Oct: hold the days (pink) while the client decides. */
  async function hold(contractorId: string, start: string, end: string, workOrderId: string | null, note: string) {
    setBusy(true);
    setErr("");
    const ok = handle(
      await holdDatesAction({ contractorId, startDate: start, endDate: end, workOrderId, note }),
      "Held — pink on the board until you book it or let it go.",
    );
    setBusy(false);
    return ok;
  }

  async function saveHold() {
    if (!pendingBlock) return;
    if (await hold(pendingBlock.contractorId, pendingBlock.start, pendingBlock.end, holdWo || null, holdNote)) {
      setPendingBlock(null); setHoldWo(""); setHoldNote(""); setBlockMode("block");
    }
  }

  /** From the drop sheet: reserve the dates for this job instead of sending the offer yet. */
  async function holdFromDrop() {
    if (!pendingDrop?.job) return;
    const end = endFor(pendingDrop.contractorId, pendingDrop.startDate, pendingDrop.spanDays);
    if (await hold(pendingDrop.contractorId, pendingDrop.startDate, end, pendingDrop.job.workOrderId, offerNote.trim())) {
      setPendingDrop(null); setOfferNote(""); setOfferQa(false); setOfferNoWalk(false); setWalkDate(""); setWalkTime("");
    }
  }

  async function releaseHold(holdId: string, reason: string) {
    setBusy(true);
    setErr("");
    if (handle(await releaseHoldAction({ id: holdId, reason }), "Hold released — the days are free again.")) {
      setDetail(null); setCancelReason("");
    }
    setBusy(false);
  }

  async function removeVisit(appointmentId: string) {
    setBusy(true);
    setErr("");
    if (handle(await removeAppointmentAction({ id: appointmentId }), "Visit removed.")) setDetail(null);
    setBusy(false);
  }

  /** A hold's "book it": the tray job, dropped on the held days, through the usual sheet. */
  function bookHeld(b: Block) {
    const job = b.workOrderId ? tray.find((j) => j.workOrderId === b.workOrderId) : undefined;
    if (!job) return;
    setDetail(null);
    setPendingDrop({
      kind: "tray", job, contractorId: b.contractorId, startDate: b.start,
      spanDays: Math.max(1, workingDaysBetween(b.start, b.end, weekFor(b.contractorId))),
      blocked: spanBlocked(b.contractorId, b.start, 1), held: false,
    });
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
  const header = (
    <header className="top">
      <div>
        <div className="crumb">Scheduling</div>
        <h1>Timeline</h1>
      </div>

      <div className="ctrls">
        <Paging zoom={zoom} />
        <JumpTo zoom={zoom} />
        <RangePresets zoom={zoom} />
        <ZoomSlider zoom={zoom} />

        {/* Requirement 4 — who appears in the board. */}
        <SavedViews<ScheduleFilters>
          label={<>Contractors · {visibleLanes.length}/{lanes.length}</>}
          filtered={visibleLanes.length !== lanes.length}
          views={views}
          onPersist={persistViews}
          current={{ tiers, contractorIds: picked, onlyOfferable }}
          onApply={(v) => { setTiers(v.tiers); setPicked(v.contractorIds); setOnlyOfferable(v.onlyOfferable); }}
          onClear={() => { setTiers([]); setPicked([]); setOnlyOfferable(false); }}
          promptText="Name this view (e.g. Tier 1)"
        >
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
        </SavedViews>
      </div>

      <div className="legend">
        <span><i style={{ background: "var(--emerald)" }} />Accepted</span>
        <span><i style={{ border: "1px dashed var(--emerald)", background: "transparent" }} />Assigned · not yet seen</span>
        <span><i style={{ background: "var(--cyan)" }} />In progress</span>
        <span><i style={{ background: "repeating-linear-gradient(45deg,var(--amber) 0 3px,transparent 3px 6px)" }} />Offered (24h)</span>
        <span><i style={{ background: "repeating-linear-gradient(45deg,#8C959D 0 3px,transparent 3px 6px)" }} />Unavailable</span>
        <span><i style={{ background: "var(--hold)" }} />Held · waiting on the client</span>
      </div>
    </header>
  );

  const trayPrelude = (
    <>
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

    </>
  );

  const trayNode = (
    <Tray<TrayJob>
      items={tray}
      itemKey={(j) => j.workOrderId}
      // Tom, 18 Sep: find a job in a long tray without scrolling it. Matches the
      // title, the reference and the suburb — the three things staff know a job by.
      searchText={(j) => `${j.title} ${j.woRef} ${j.suburb}`}
      searchPlaceholder="Search job, reference or suburb"
      searchLabel="Search the unscheduled jobs"
      title="Unscheduled"
      sub="Accepted jobs awaiting dates · longest wait first · drag onto the timeline"
      emptyText="Nothing waiting. Issue a work order and it appears here."
      noMatch={(q, n) => <>Nothing matches &ldquo;{q}&rdquo;. {n} job{n === 1 ? "" : "s"} waiting.</>}
      prelude={trayPrelude}
      onDragStart={(e, j) => drag.beginDrag(e, { kind: "tray", job: j })}
      renderItem={(j, bind) =>
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
                  <a className="btn gh" style={{ marginTop: 10, padding: 9, fontSize: 12.5 }} href={`/quote?id=${j.estimateId}&view=workorder${fromHere}`}>
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
                  onPointerDown={bind.onPointerDown}
                >
                  <div className="r1">
                    <span className="ref">{j.woRef}</span>
                    {j.finishCode && <span className="fin">{j.finishCode}</span>}
                  </div>
                  <h3>{j.title}</h3>
                  {/* Tom, 22 Sep: a link to the estimate from the tray. Pointer-down stops here so the link never starts a drag. */}
                  <a
                    href={`/quote?id=${j.estimateId}${fromHere}`}
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
              )
      }
      hint={
        <>
          Drag a job onto a contractor&rsquo;s row — nothing is sent until you confirm,
          and the row turns red if they&rsquo;ve blocked those days out. Drag across
          empty space on a row to block that contractor out. Drag an existing
          booking to another row to reassign it.
        </>
      }
    />
  );

  return (
    <Board<Lane, Block, DragPayload, DropCheck>
      zoom={zoom}
      drag={drag}
      lanes={lanes}
      laneId={(l) => l.contractorId}
      filterLane={filterLane}
      blocks={blocks}
      blockId={(b) => b.id}
      blockLane={(b) => b.contractorId}
      blockStart={(b) => b.start}
      blockEnd={(b) => b.end}
      // Busiest single day, counting real work only — a blocked-out day isn't a job.
      countsTowardLoad={(b) => b.kind !== "unavailable" && b.kind !== "hold"}
      blockPayload={(b) => ({ kind: "block", block: b })}
      isMovable={(b) => b.kind === "accepted" || b.kind === "offered" || b.kind === "proposed" || b.kind === "assigned" || b.kind === "hold" || Boolean(b.appointmentId)}
      storageKey="pc-schedule:scroll"
      laneHeadTitle="Contractor"
      laneData={(l) => ({ "data-contractor-id": l.contractorId, "data-contractor-company": l.company ?? undefined })}
      renderLaneHead={(l, lay) => {
        const over = lay.peak > l.crewSize;
        return (
          <>
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
                          {/* Painter status Step 7 (⚑7, R19): the light, in words, on every lane. */}
                          {l.statusColour && (
                            <span className={`stl stl-${l.statusColour}`} data-testid={`lane-status-${l.contractorId}`} data-colour={l.statusColour}
                              title={l.offersBlocked ? "Red — no new offers until Tom records the clearance" : `Status: ${l.statusColour}`}>
                              {l.offersBlocked ? "RED · NO OFFERS" : l.statusColour.toUpperCase()}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="tg">TIER {l.tier}{l.company ? ` · ${l.company.toUpperCase()}` : ""}</div>
                      <div className="bd">
                        <span className={over ? "no" : ""} title={`${l.crewSize} painter${l.crewSize === 1 ? "" : "s"}; busiest day has ${lay.peak} job${lay.peak === 1 ? "" : "s"} on`}>
                          {lay.peak}/{l.crewSize} {over ? "OVER" : "ON"}
                        </span>
                      </div>
          </>
        );
      }}
      renderLaneOverlay={(l) => (
        <>
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
        </>
      )}
      renderBlock={(b, bind) => (
        <div
          className={`blk ${b.kind}${b.assignmentId && !b.acceptedAt ? " hollow" : ""}${b.appointmentId ? " visit" : ""}`}
          data-testid={b.assignmentId ? "assignment-block" : b.holdId ? "hold-block" : b.appointmentId ? "visit-block" : undefined}
          data-assignment-id={b.assignmentId}
          data-hold-id={b.holdId}
          data-appointment-id={b.appointmentId}
          data-work-order-id={b.workOrderId ?? undefined}
          data-start={b.start}
          data-end={b.end}
          data-lead={b.isLead ? "1" : undefined}
          data-accepted={b.acceptedAt ? "1" : undefined}
          style={bind.style}
          onPointerDown={bind.onPointerDown}
          onClick={() => setDetail(b)}
          title={b.title}
        >
                            <div className="t">{b.isLead && <span className="lead" title="Lead painter">★</span>}{b.title}</div>
                            <div className="m">
                              {b.kind === "unavailable"
                                ? (b.source === "staff" ? "BLOCKED BY OFFICE" : "UNAVAILABLE")
                                : b.kind === "hold"
                                  ? `HELD · WAITING ON CLIENT${b.woRef ? ` · ${b.woRef}` : ""}`
                                  : b.appointmentId
                                    ? `${b.woRef} · EXTRA VISIT`
                                    : b.woRef}
                              {b.assignmentId && (b.crewSize ?? 1) > 1 && (
                                <span className="crew">{b.crewIndex} OF {b.crewSize}</span>
                              )}
                              {b.assignmentId && !b.acceptedAt && <span className="crew">NOT YET SEEN</span>}
                            </div>
                            {b.expiresAt && <div className="cd">{coarseCountdown(b.expiresAt)}</div>}
        </div>
      )}
      renderGhost={(p, check, target) => {
        const title = p.kind === "tray" ? p.job.title : p.block.title;
        const n = spanOf(p);
        const sub = p.kind === "tray"
          ? `${p.job.woRef} · ${n} day${n === 1 ? "" : "s"}`
          : p.block.holdId ? "move hold" : p.block.appointmentId ? `${p.block.woRef} · move visit` : `${p.block.woRef} · move booking`;
        return (
          <>
            <div className="g1">{title}</div>
            <div className="g2">{check?.blocked ? "BLOCKED OUT — DROP TO OVERRIDE" : check?.held ? "DAYS HELD — DROP TO BOOK OVER THE HOLD" : sub}</div>
            {check && target && (
              <div className="g3" data-testid="ghost-dates" data-start={check.start} data-end={check.end}>
                {check.start === check.end ? `Starts ${dayLabel(check.start)}` : `${dayLabel(check.start)} → ${dayLabel(check.end)}`}
              </div>
            )}
          </>
        );
      }}
      emptyMessage={
        // An empty board because a query failed looks identical to an
        // empty board because there's no work — so distinguish them.
        errors.length > 0
          ? `Couldn't load the board — ${errors.join("; ")}`
          : lanes.length === 0
            ? "No contractors set up yet."
            : "No contractors match this view."
      }
      header={header}
      tray={trayNode}
    >
      {/* confirm a drop */}
      <Scrim
        on={Boolean(pendingDrop || detail || pendingBlock)}
        onClick={() => { setPendingDrop(null); setDetail(null); setPendingBlock(null); setErr(""); setOfferNote(""); }}
      />

      <div className={`sheet ${pendingDrop ? "open" : ""}`}>
        {pendingDrop && (
          <>
            <h3>
              {pendingDrop.block?.holdId ? "Move this hold?"
                : pendingDrop.block?.appointmentId ? "Move this visit?"
                : isEmployeeLane(pendingDrop.contractorId) || pendingDrop.block?.assignmentId
                  ? (pendingDrop.kind === "tray" ? "Assign this job?" : "Move these days?")
                  : (pendingDrop.kind === "tray" ? "Send this offer?" : "Move this booking?")}
            </h3>
            <p className="slab">
              {pendingDrop.block?.holdId ? "Internal only — the painter never sees a hold"
                : pendingDrop.block?.appointmentId ? "More days on a job they already have — it moves in their calendar"
                : isEmployeeLane(pendingDrop.contractorId) || pendingDrop.block?.assignmentId
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
                {/* Tom, 24 Sep: the start is adjustable here — a drop one day
                    out is fixed in the sheet, not by dragging again. A date the
                    painter does not work snaps to their next working day. */}
                <input
                  type="date" value={pendingDrop.startDate} data-testid="booking-start"
                  onChange={(e) => {
                    if (!e.target.value) return;
                    const startDate = addWorkingDays(e.target.value, 1, weekFor(pendingDrop.contractorId));
                    setPendingDrop({ ...pendingDrop, startDate, blocked: spanBlocked(pendingDrop.contractorId, startDate, pendingDrop.spanDays) });
                  }}
                  style={{ marginRight: 6 }}
                />
                → {formatDMY(endFor(pendingDrop.contractorId, pendingDrop.startDate, pendingDrop.spanDays))}
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

            {pendingDrop.kind === "tray" && !isEmployeeLane(pendingDrop.contractorId)
              && lanes.find((l) => l.contractorId === pendingDrop.contractorId)?.standardsStatus === "blocked" && (
              <div className="err" data-testid="drop-standards-blocked">
                <b>Standards not signed.</b> This painter has not confirmed the finish standards and
                their grace period has ended — no new offers until they do. Send them a reminder from
                the Contractors page, or hold the dates instead.
              </div>
            )}
            {pendingDrop.blocked && (
              <div className="err">
                This contractor has blocked these days out. You can still send it, but
                they told you they&rsquo;re not available.
              </div>
            )}
            {pendingDrop.held && (
              <div className="held-note" data-testid="drop-held-note">
                These days are <b>held</b> (pink) on this row. Booking goes ahead; a hold for this
                same job clears itself, a hold for another job stays until you release it.
              </div>
            )}
            {err && <div className="err">{err}</div>}

            <button
              className="btn cy"
              disabled={busy || (pendingDrop.kind === "tray" && !isEmployeeLane(pendingDrop.contractorId)
                && lanes.find((l) => l.contractorId === pendingDrop.contractorId)?.standardsStatus === "blocked")}
              data-testid="drop-confirm"
              onClick={
                pendingDrop.kind === "tray"
                  ? (isEmployeeLane(pendingDrop.contractorId) ? assignJob : sendOffer)
                  : (pendingDrop.block?.holdId || pendingDrop.block?.appointmentId) ? moveHeldOrVisit
                  : (pendingDrop.block?.assignmentId ? moveAssignment : moveBooking)
              }
            >
              {busy ? "Working…"
                : pendingDrop.kind === "tray"
                  ? (isEmployeeLane(pendingDrop.contractorId) ? "Assign job" : "Send offer")
                  : pendingDrop.block?.holdId ? "Move hold"
                  : pendingDrop.block?.appointmentId ? "Move visit"
                  : (pendingDrop.block?.assignmentId ? "Move days" : "Move booking")}
            </button>
            {/* Tom, 1 Oct: "hold the date for the contractor while we are waiting
                for confirmation from the client" — same drop, no offer yet. */}
            {pendingDrop.kind === "tray" && (
              <button className="btn hold" disabled={busy} data-testid="drop-hold" onClick={holdFromDrop}>
                Hold these dates instead — waiting on the client
              </button>
            )}
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
            <p className="slab">
              {detail.holdId ? "held — waiting on the client" : detail.appointmentId ? `extra visit · ${detail.kind.replace("_", " ")}` : detail.kind.replace("_", " ")}
            </p>
            <div className="frow"><span className="l">Dates</span><span className="v">{formatDMY(detail.start)} → {formatDMY(detail.end)}</span></div>
            {detail.woRef && <div className="frow"><span className="l">Reference</span><span className="v">{detail.woRef}</span></div>}
            {/* Tom, 8 Oct: change the LAST day of a booked or running job. A
                running job can't be dragged — its start stays — so this is
                where its end moves. Crew jobs move per painter below. */}
            {detail.workOrderId && detail.offerId && (detail.kind === "in_progress" || detail.kind === "accepted")
              && !detail.assignmentId && !detail.holdId && !detail.appointmentId && (() => {
              const snapped = finishEnd ? addWorkingDays(finishEnd, 1, weekFor(detail.contractorId)) : "";
              const msg = finishMsg && finishMsg.blockId === detail.id ? finishMsg : null;
              return (
                <div className="frow" style={{ display: "block", marginTop: 10 }} data-testid="finish-date-row">
                  <span className="l" style={{ display: "block", marginBottom: 6 }}>
                    Finish date{detail.kind === "in_progress" ? " — the job has started, so the start stays" : ""}
                  </span>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <input type="date" value={finishEnd} min={detail.start} data-testid="finish-date"
                      onChange={(e) => { if (e.target.value) { setFinishEdit({ blockId: detail.id, end: e.target.value }); setFinishMsg(null); } }} />
                    <button className="btn dim" data-testid="finish-date-save"
                      disabled={busy || !finishEnd || snapped === detail.end}
                      onClick={async () => {
                        setBusy(true); setFinishMsg(null);
                        const r = await setFinishDateAction({ workOrderId: detail.workOrderId!, endDate: finishEnd });
                        if (r.ok) {
                          setDetail({ ...detail, end: r.endDate });
                          setFinishEdit(null);
                          setFinishMsg({ blockId: detail.id, ok: true, text: `Finish date moved to ${formatDMY(r.endDate)}. The final walkthrough moved with it.` });
                          router.refresh();
                        } else {
                          setFinishMsg({ blockId: detail.id, ok: false, text: r.message });
                        }
                        setBusy(false);
                      }}>
                      {busy ? "Saving…" : "Save finish date"}
                    </button>
                  </div>
                  {snapped && (
                    <span className="l" style={{ display: "block", marginTop: 6 }} data-testid="finish-date-snapped" data-end={snapped}>
                      Last day {formatDMY(snapped)}{snapped !== finishEnd ? " — the next day they work" : ""}. A booked final walkthrough moves to that day, same time.
                    </span>
                  )}
                  {msg && (
                    <span className="l" role="status" data-testid="finish-date-msg"
                      style={{ display: "block", marginTop: 6, color: msg.ok ? "var(--emerald)" : "var(--clay)" }}>
                      {msg.text}
                    </span>
                  )}
                </div>
              );
            })()}
            {/* R10 (Step 4): a rained-off day on a job under way — today, or a past day of the block. */}
            {detail.workOrderId && (detail.kind === "in_progress" || detail.kind === "accepted" || detail.kind === "assigned") && !detail.holdId && !detail.appointmentId && (
              <div className="frow" style={{ display: "block", marginTop: 10 }} data-testid="no-work-row">
                <span className="l" style={{ display: "block", marginBottom: 6 }}>No work on a day (rain, site locked) — its reminders are not counted</span>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <input type="date" value={noWorkDay} max={todayMelb()} data-testid="no-work-day" onChange={(e) => setNoWorkDay(e.target.value)} />
                  <input type="text" value={noWorkReason} data-testid="no-work-reason" placeholder="why" onChange={(e) => setNoWorkReason(e.target.value)} style={{ width: 160 }} />
                  <button className="btn dim" disabled={busy || !noWorkDay} data-testid="no-work-save" onClick={async () => {
                    setBusy(true); setErr("");
                    const r = await setNoWorkDayAction({ workOrderId: detail.workOrderId!, day: noWorkDay, reason: noWorkReason });
                    if (r.ok) { flash(r.message); setNoWorkReason(""); router.refresh(); } else setErr(r.message);
                    setBusy(false);
                  }}>No work that day</button>
                </div>
              </div>
            )}
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
              // Tom, 8 Oct: once the job is running and their first day has
              // passed, the start is history (reassign_dates says the same).
              const startLocked = detail.kind === "in_progress" && detail.start <= todayMelb();
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
                  <div className="frow" style={{ display: "block", marginTop: 10 }} data-testid="assignment-dates">
                    <span className="l" style={{ display: "block", marginBottom: 6 }}>
                      {nameOf(detail.contractorId)}&rsquo;s days on this job{crew.length > 1 ? " — they needn't match the rest of the crew" : ""}
                    </span>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <input type="date" value={editStart} max={editEnd || undefined} data-testid="assignment-start"
                        disabled={startLocked}
                        title={startLocked ? "The job has started — the start stays. Change the last day." : undefined}
                        onChange={(e) => e.target.value && setEditStart(e.target.value)} />
                      <span className="l">→</span>
                      <input type="date" value={editEnd} min={editStart || undefined} data-testid="assignment-end"
                        onChange={(e) => e.target.value && setEditEnd(e.target.value)} />
                      <button className="btn dim" data-testid="assignment-dates-save"
                        disabled={busy || !editStart || !editEnd || editEnd < editStart || (editStart === detail.start && editEnd === detail.end)}
                        onClick={() => saveAssignmentDates(detail)}>
                        {busy ? "Saving…" : "Save days"}
                      </button>
                    </div>
                    <span className="l" style={{ display: "block", marginTop: 6 }}>
                      The job&rsquo;s span follows the crew: earliest start to latest finish. They&rsquo;re asked to accept the new days.
                    </span>
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
            {/* Tom, 1 Oct: a hold — book it, or let the days go. */}
            {detail.holdId && (
              <div data-testid="hold-detail">
                {detail.holdNote && <div className="frow"><span className="l">Note</span><span className="v">{detail.holdNote}</span></div>}
                <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 12 }}>
                  The office is holding these days{detail.workOrderId ? " for this job" : ""} while the client decides.
                  The painter can&rsquo;t see it. {detail.workOrderId ? "Booking the job — to anyone — clears it on its own." : "Release it when the days are no longer needed."}
                </p>
                {detail.workOrderId && tray.some((j) => j.workOrderId === detail.workOrderId) && (
                  <button className="btn cy" disabled={busy} data-testid="hold-book" onClick={() => bookHeld(detail)}>
                    Book it now — {isEmployeeLane(detail.contractorId) ? "assign" : "send the offer"} for these dates
                  </button>
                )}
                <label className="ctrl-lab" style={{ display: "block", marginTop: 16, marginBottom: 6 }}>
                  Reason (optional, goes on the record)
                </label>
                <input type="text" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="e.g. client went elsewhere" style={{ width: "100%" }} />
                <button className="btn dim" disabled={busy} data-testid="hold-release" onClick={() => releaseHold(detail.holdId!, cancelReason)}>
                  Release this hold
                </button>
              </div>
            )}
            {/* Tom, 1 Oct: an extra visit — remove it; the job's own booking is untouched. */}
            {detail.appointmentId && (
              <div data-testid="visit-detail">
                {detail.reason && <div className="frow"><span className="l">Note</span><span className="v">{detail.reason}</span></div>}
                <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 12 }}>
                  A second run of days on this job. Drag it along the row to move it. Removing it leaves the job&rsquo;s own booking as it was.
                </p>
                <button className="btn dim" disabled={busy} data-testid="visit-remove" onClick={() => removeVisit(detail.appointmentId!)}>
                  Remove this visit
                </button>
              </div>
            )}
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
                href={`/quote?id=${detail.estimateId}&view=workorder${fromHere}`}
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
            <h3>
              {blockMode === "visit" ? "Add a visit on a booked job?" : blockMode === "hold" ? "Hold these days?" : "Block these days out?"}
            </h3>
            <p className="slab">
              {blockMode === "visit" ? "A second run of days on a job this painter already has"
                : blockMode === "hold" ? "Internal only — pink on the board until you book it or let it go"
                : "The contractor sees this in their calendar"}
            </p>
            {/* Tom, 1 Oct: the same drag across empty space does three things now. */}
            <div className="seg modes" data-testid="empty-drag-mode">
              <button className={blockMode === "block" ? "on" : ""} onClick={() => { setBlockMode("block"); setErr(""); }} data-testid="mode-block">Block out</button>
              <button className={blockMode === "visit" ? "on" : ""} onClick={() => { setBlockMode("visit"); setErr(""); }} data-testid="mode-visit">Extra visit</button>
              <button className={blockMode === "hold" ? "on" : ""} onClick={() => { setBlockMode("hold"); setErr(""); }} data-testid="mode-hold">Hold</button>
            </div>
            <div className="frow">
              <span className="l">Contractor</span>
              <span className="v">{lanes.find((l) => l.contractorId === pendingBlock.contractorId)?.name.toUpperCase()}</span>
            </div>
            <div className="frow">
              <span className="l">Days</span>
              <span className="v" data-testid="empty-drag-dates" data-start={pendingBlock.start} data-end={pendingBlock.end}>{formatDMY(pendingBlock.start)}{pendingBlock.end !== pendingBlock.start ? ` → ${formatDMY(pendingBlock.end)}` : ""}</span>
            </div>
            {blockMode === "visit" && (() => {
              const mine = bookedJobsFor(pendingBlock.contractorId);
              const stageWord = (st: string) => st === "closed" ? "FINISHED" : st.replace(/_/g, " ").toUpperCase();
              return (
                <>
                  <label className="ctrl-lab" style={{ display: "block", marginTop: 14, marginBottom: 6 }}>Which project</label>
                  {visitPick ? (
                    <div className="frow" data-testid="visit-picked" data-work-order-id={visitPick.workOrderId} style={{ alignItems: "center" }}>
                      <span className="v" style={{ flex: 1 }}>
                        {visitPick.title.toUpperCase()}
                        <span className="l" style={{ display: "block" }}>{visitPick.woRef}{visitPick.customer ? ` · ${visitPick.customer}` : ""}{visitPick.address ? ` · ${visitPick.address}` : ""} · {stageWord(visitPick.lifecycle)}</span>
                      </span>
                      <button className="btn dim" style={{ marginTop: 0, padding: "6px 10px", fontSize: 12, width: "auto" }} data-testid="visit-change"
                        onClick={() => { setVisitPick(null); setVisitQuery(""); }}>Change</button>
                    </div>
                  ) : (
                    <>
                      {/* Tom, 4 Oct: every project, any status — reference, job title, address or customer. */}
                      <input type="search" value={visitQuery} onChange={(e) => setVisitQuery(e.target.value)} data-testid="visit-search"
                        placeholder="Search any project — reference, title, address or customer" style={{ width: "100%" }} autoFocus />
                      <div className="visit-hits" data-testid="visit-hits">
                        {visitQuery.trim().length >= 2 ? (
                          visitSearchErr ? <div className="err" style={{ margin: 8 }}>{visitSearchErr}</div>
                          : visitSearching && visitHits.length === 0 ? <div className="l" style={{ padding: 8 }}>Searching…</div>
                          : visitHits.length === 0 ? <div className="l" style={{ padding: 8 }}>No project matches that.</div>
                          : visitHits.map((h) => (
                            <button key={h.workOrderId} type="button" className="hit" data-testid="visit-hit" data-work-order-id={h.workOrderId}
                              onClick={() => { setVisitPick(h); setErr(""); }}>
                              <span className="t">{h.title}</span>
                              <span className="m">{h.woRef}{h.customer ? ` · ${h.customer}` : ""}{h.address ? ` · ${h.address}` : ""} · {stageWord(h.lifecycle)}</span>
                            </button>
                          ))
                        ) : mine.length > 0 ? (
                          <>
                            <div className="l" style={{ padding: "6px 8px 2px" }}>On this row already</div>
                            {mine.map((j) => (
                              <button key={j.workOrderId!} type="button" className="hit" data-testid="visit-hit" data-work-order-id={j.workOrderId!}
                                onClick={() => { setVisitPick({ workOrderId: j.workOrderId!, woRef: j.woRef, title: j.title, address: "", lifecycle: j.kind, customer: "" }); setErr(""); }}>
                                <span className="t">{j.title}</span>
                                <span className="m">{j.woRef} · {formatDMY(j.start)}{j.end !== j.start ? `–${formatDMY(j.end)}` : ""}</span>
                              </button>
                            ))}
                          </>
                        ) : (
                          <div className="l" style={{ padding: 8 }}>Type two letters of a reference, title, address or customer. Finished jobs count too.</div>
                        )}
                      </div>
                    </>
                  )}
                  <label className="ctrl-lab" style={{ display: "block", marginTop: 14, marginBottom: 6 }}>{visitCallback ? "What is wrong" : "Note (optional)"}</label>
                  <input type="text" value={visitNote} onChange={(e) => setVisitNote(e.target.value)} data-testid="visit-note"
                    placeholder={visitCallback ? "e.g. paint on the lounge window glass" : "e.g. back to finish the ceilings"} style={{ width: "100%" }} maxLength={300} />
                  {/* Call backs Step 3, route 4 — beside "Walkthrough not required" in spirit: the
                      tray drop's box lives on the offer sheet, a visit's on this one. */}
                  <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 13, cursor: "pointer" }}>
                    <input type="checkbox" checked={visitCallback} onChange={(e) => setVisitCallback(e.target.checked)} data-testid="visit-callback" />
                    Call back — this visit fixes workmanship on a finished job
                  </label>
                  {visitCallback && (
                    <span style={{ fontSize: 11, color: "var(--muted)", display: "block", marginTop: 4 }} data-testid="visit-callback-note">
                      Logged against the painter who did the job. If a call back is already open there, this visit joins it — nothing is counted twice. Invoice chasing pauses until the office closes it.
                    </span>
                  )}
                  {err && <div className="err">{err}</div>}
                  <button className="btn cy" disabled={busy || !visitPick} data-testid="visit-save" onClick={saveVisit}>Add the visit</button>
                  <button className="btn gh" onClick={() => { setPendingBlock(null); setVisitPick(null); setVisitQuery(""); setVisitHits([]); setVisitNote(""); setErr(""); setBlockMode("block"); }}>Cancel</button>
                </>
              );
            })()}
            {blockMode === "hold" && (
              <>
                <label className="ctrl-lab" style={{ display: "block", marginTop: 14, marginBottom: 6 }}>Waiting on which job <span style={{ opacity: 0.6 }}>(optional)</span></label>
                <select value={holdWo} onChange={(e) => setHoldWo(e.target.value)} data-testid="hold-job" style={{ width: "100%" }}>
                  <option value="">No job yet — just hold the days</option>
                  {tray.map((j) => <option key={j.workOrderId} value={j.workOrderId}>{j.title} · {j.woRef}{j.suburb ? ` · ${j.suburb}` : ""}</option>)}
                </select>
                <label className="ctrl-lab" style={{ display: "block", marginTop: 14, marginBottom: 6 }}>Note (optional)</label>
                <input type="text" value={holdNote} onChange={(e) => setHoldNote(e.target.value)} data-testid="hold-note"
                  placeholder="e.g. Sarah confirming with her husband by Friday" style={{ width: "100%" }} maxLength={300} />
                <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
                  The painter never sees a hold. Book the job and the hold clears on its own; otherwise release it from the pink block.
                </p>
                {err && <div className="err">{err}</div>}
                <button className="btn hold" disabled={busy} data-testid="hold-save" onClick={saveHold}>Hold these days</button>
                <button className="btn gh" onClick={() => { setPendingBlock(null); setHoldWo(""); setHoldNote(""); setErr(""); setBlockMode("block"); }}>Cancel</button>
              </>
            )}
            {blockMode === "block" && isEmployeeLane(pendingBlock.contractorId) && (
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
            {blockMode === "block" && (
              <>
                <label className="ctrl-lab" style={{ display: "block", marginTop: 14, marginBottom: 6 }}>Reason (optional)</label>
                <input type="text" value={blockReason} onChange={(e) => setBlockReason(e.target.value)} placeholder="e.g. training, annual leave" style={{ width: "100%" }} />
                {err && <div className="err">{err}</div>}
                <button className="btn cy" disabled={busy} onClick={saveBlockOut}>Block them out</button>
                <button className="btn gh" onClick={() => { setPendingBlock(null); setBlockReason(""); }}>Cancel</button>
              </>
            )}
          </>
        )}
      </div>

      {/* staff blocking days out — requirement 2, office side */}
      <BlockOutBar lanes={lanes} onBlock={blockOut} busy={busy} />

      <Toast text={toast} />
    </Board>
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
