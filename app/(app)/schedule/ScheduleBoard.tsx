"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { expiryFromNow, msRemaining, isReschedule, formatDMY, type BookingOffer } from "@/lib/scheduling/offers";
import type { Block, Lane, TrayJob } from "@/lib/scheduling/board";
import "./schedule.css";

const money = (c: number | null) => (c == null ? "—" : "$" + (c / 100).toLocaleString("en-AU", { maximumFractionDigits: 0 }));

// Calendar dates are plain YYYY-MM-DD, never instants. Parsing them as local
// midnight and formatting back through toISOString() silently shifts the result
// by a day for anyone east of Greenwich — so all arithmetic below stays in UTC,
// and "today" is read from the local clock explicitly.
const addDays = (s: string, n: number) => {
  const d = new Date(s + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
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
  from,
  rangeDays,
  savedViews,
  approvals,
  errors,
}: {
  lanes: Lane[];
  blocks: Block[];
  tray: TrayJob[];
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
        if (onlyOfferable && !l.offerable) return false;
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
      router.replace(`/schedule?from=${start}&days=${range}`, { scroll: false });
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

  // Is this contractor blocked out across the proposed span?
  const spanBlocked = useCallback(
    (contractorId: string, s: string, spanDays: number) => {
      const e = addDays(s, spanDays - 1);
      return blocks.some(
        (b) => b.kind === "unavailable" && b.contractorId === contractorId && b.start <= e && b.end >= s,
      );
    },
    [blocks],
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

  /** Pure arithmetic against cached rects — no layout reads, safe per-move. */
  const updateTarget = useCallback(
    (x: number, y: number, spanDays: number) => {
      const hit = laneRects.current.find((l) => y >= l.rect.top && y <= l.rect.bottom);
      const idx = hit ? Math.floor((x - hit.rect.left) / dayW) : -1;
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
        const startDate = days[t.dayIndex];
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
    [days, spanBlocked],
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
        : Math.max(1, dayDiff(payload.block.start, payload.block.end) + 1);

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
  const [toast, setToast] = useState("");
  const [detail, setDetail] = useState<Block | null>(null);
  const [blockReason, setBlockReason] = useState("");
  const [cancelReason, setCancelReason] = useState("");

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3600);
  }

  async function sendOffer() {
    if (!pendingDrop?.job) return;
    setBusy(true);
    setErr("");
    try {
      const lane = lanes.find((l) => l.contractorId === pendingDrop.contractorId);
      if (lane && !lane.active) {
        throw new Error(`${lane.name}'s access is suspended — restore it on the Contractors page before offering work.`);
      }
      const end = addDays(pendingDrop.startDate, pendingDrop.spanDays - 1);
      // Assign first so the work order and the offer agree on who has it.
      await supabase.from("work_orders").update({ contractor_id: pendingDrop.contractorId }).eq("id", pendingDrop.job.workOrderId);
      const { error } = await supabase.from("booking_offers").insert({
        work_order_id: pendingDrop.job.workOrderId,
        contractor_id: pendingDrop.contractorId,
        start_date: pendingDrop.startDate,
        end_date: end,
        hours_allowance: pendingDrop.job.hours,
        payment_cents: pendingDrop.job.paymentCents,
        expires_at: expiryFromNow(),
      });
      if (error) {
        if (/booking_offers_one_live/.test(error.message)) throw new Error("That job already has a live offer out.");
        throw error;
      }
      setPendingDrop(null);
      flash("Offer sent — the contractor has 24 hours to respond.");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function moveBooking() {
    if (!pendingDrop?.block) return;
    setBusy(true);
    setErr("");
    try {
      const b = pendingDrop.block;

      // Dropped on a DIFFERENT contractor: that's a reassignment, not a nudge of
      // the dates. Cancel the existing offer first so the one-live-offer rule
      // holds, then send a fresh one to the new contractor.
      if (b.contractorId !== pendingDrop.contractorId) {
        if (b.offerId) {
          const { data } = await supabase.rpc("cancel_booking", { p_offer_id: b.offerId, p_reason: "Reassigned to another contractor" });
          if (String(data).startsWith("error:")) throw new Error(String(data).replace("error:", ""));
        }
        await supabase.from("work_orders").update({ contractor_id: pendingDrop.contractorId }).eq("id", b.workOrderId!);
        const { error: insErr } = await supabase.from("booking_offers").insert({
          work_order_id: b.workOrderId,
          contractor_id: pendingDrop.contractorId,
          start_date: pendingDrop.startDate,
          end_date: addDays(pendingDrop.startDate, pendingDrop.spanDays - 1),
          payment_cents: b.paymentCents,
          expires_at: expiryFromNow(),
        });
        if (insErr) throw insErr;
        setPendingDrop(null);
        flash("Reassigned — a fresh 24-hour offer has gone to the new contractor.");
        router.refresh();
        return;
      }
      if (b.workOrderId) {
        await supabase.from("work_orders").update({ start_date: pendingDrop.startDate, contractor_id: pendingDrop.contractorId }).eq("id", b.workOrderId);
      }
      if (b.offerId) {
        await supabase
          .from("booking_offers")
          .update({ start_date: pendingDrop.startDate, end_date: addDays(pendingDrop.startDate, pendingDrop.spanDays - 1) })
          .eq("id", b.offerId);
      }
      setPendingDrop(null);
      flash("Booking moved.");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function blockOut(contractorId: string, s: string, e: string, reason: string) {
    setBusy(true);
    const { error } = await supabase.from("contractor_unavailability").insert({
      contractor_id: contractorId, start_date: s, end_date: e, reason, source: "staff",
    });
    if (error) setErr(error.message);
    else {
      flash("Days blocked out.");
      router.refresh();
    }
    setBusy(false);
  }

  /** Approve or refuse a proposed / reschedule date. */
  async function resolve(offerId: string, approve: boolean) {
    setBusy(true);
    setErr("");
    const { data, error } = await supabase.rpc("resolve_proposed_offer", { p_offer_id: offerId, p_approve: approve });
    if (error) setErr(error.message);
    else if (String(data).startsWith("error:")) setErr(String(data).replace("error:", ""));
    else {
      const msg: Record<string, string> = {
        accepted: "Approved — the new date is locked in.",
        kept_original: "Refused — the job stays on its original date.",
        declined: "Refused — the job is back in the unscheduled tray.",
      };
      flash(msg[String(data)] ?? "Done.");
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
      router.refresh();
    }
    setBusy(false);
  }

  async function saveBlockOut() {
    if (!pendingBlock) return;
    await blockOut(pendingBlock.contractorId, pendingBlock.start, pendingBlock.end, blockReason);
    setPendingBlock(null);
    setBlockReason("");
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
    <div className="sb" style={styleVars}>
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
            <button className="seg" style={{ padding: "7px 10px", background: "none", border: "1px solid var(--line)", color: visibleLanes.length === lanes.length ? "var(--muted)" : "var(--cyan)", borderRadius: 8, cursor: "pointer", fontFamily: "var(--mono)", fontSize: 9, letterSpacing: ".06em", textTransform: "uppercase" }} onClick={() => setShowFilters((s) => !s)}>
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
                  <input type="checkbox" checked={onlyOfferable} onChange={(e) => setOnlyOfferable(e.target.checked)} />
                  Ready for work only
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
                      <button className="btn cy" style={{ marginTop: 0, padding: 8, fontSize: 12 }} disabled={busy} onClick={() => resolve(a.offer.id, true)}>
                        Approve
                      </button>
                      <button className="btn gh" style={{ marginTop: 0, padding: 8, fontSize: 12 }} disabled={busy} onClick={() => resolve(a.offer.id, false)}>
                        {resched ? "Keep original" : "Reject"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <h2>Unscheduled</h2>
          <p className="sub">Issued jobs awaiting dates · drag onto the timeline</p>
          {tray.length === 0 ? (
            <div className="empty">Nothing waiting. Issue a work order and it appears here.</div>
          ) : (
            tray.map((j) => (
              <div key={j.workOrderId} className="jcard" onPointerDown={(e) => beginDrag(e, { kind: "tray", job: j })}>
                <div className="r1">
                  <span className="ref">{j.woRef}</span>
                  {j.finishCode && <span className="fin">{j.finishCode}</span>}
                </div>
                <h3>{j.title}</h3>
                <div className="meta">
                  {j.suburb ? `${j.suburb.toUpperCase()} · ` : ""}
                  {j.estimatedDays} DAY{j.estimatedDays === 1 ? "" : "S"}
                  {j.hours ? ` · ${j.hours.toFixed(1)} H` : ""}
                </div>
                <div className="pay">{money(j.paymentCents)}</div>
                {j.lastDeclineReason && <div className="flagline">DECLINED — {j.lastDeclineReason.toUpperCase()}</div>}
              </div>
            ))
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
                    {dayW >= 44 ? `${p.short} ` : ""}
                    {p.num}
                  </div>
                );
              })}
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
                          {l.active ? (
                            <span className={l.offerable ? "q" : "no"}>{l.offerable ? "READY" : "NOT READY"}</span>
                          ) : (
                            <span className="no">SUSPENDED</span>
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
                      ref={(el) => { if (el) laneRefs.current.set(l.contractorId, el); }}
                      onPointerDown={(e) => beginBlockOut(e, l.contractorId)}
                    >
                      {days.map((d) => {
                        const dow = dayParts(d).dow;
                        return <div key={d} className={`bgc ${dow === 0 || dow === 6 ? "we" : ""}`} />;
                      })}

                      {lay.placed.map(({ block: b, row }) => {
                        const offset = Math.max(0, dayDiff(start, b.start));
                        const endIdx = Math.min(range - 1, dayDiff(start, b.end));
                        const span = Math.max(1, endIdx - offset + 1);
                        const movable = b.kind === "accepted" || b.kind === "offered" || b.kind === "proposed";
                        return (
                          <div
                            key={b.id}
                            className={`blk ${b.kind}`}
                            style={{
                              left: `calc(var(--day-w) * ${offset} + 3px)`,
                              width: `calc(var(--day-w) * ${span} - 6px)`,
                              top: `${7 + row * 52}px`,
                            }}
                            onPointerDown={movable ? (e) => beginDrag(e, { kind: "block", block: b }) : undefined}
                            onClick={() => setDetail(b)}
                            title={b.title}
                          >
                            <div className="t">{b.title}</div>
                            <div className="m">
                              {b.kind === "unavailable"
                                ? (b.source === "staff" ? "BLOCKED BY OFFICE" : "UNAVAILABLE")
                                : b.woRef}
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
        onClick={() => { setPendingDrop(null); setDetail(null); setPendingBlock(null); setErr(""); }}
      />

      <div className={`sheet ${pendingDrop ? "open" : ""}`}>
        {pendingDrop && (
          <>
            <h3>{pendingDrop.kind === "tray" ? "Send this offer?" : "Move this booking?"}</h3>
            <p className="slab">Nothing reaches the customer until the contractor accepts</p>
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
              <span className="v">
                {formatDMY(pendingDrop.startDate)} → {formatDMY(addDays(pendingDrop.startDate, pendingDrop.spanDays - 1))}
              </span>
            </div>
            <div className="frow">
              <span className="l">Length</span>
              <span className="v">
                <button onClick={() => setPendingDrop({ ...pendingDrop, spanDays: Math.max(1, pendingDrop.spanDays - 1) })} style={{ background: "none", border: "1px solid var(--line)", color: "var(--text)", borderRadius: 6, width: 24, height: 24, cursor: "pointer" }}>−</button>
                <span style={{ margin: "0 10px" }}>{pendingDrop.spanDays} d</span>
                <button onClick={() => setPendingDrop({ ...pendingDrop, spanDays: pendingDrop.spanDays + 1 })} style={{ background: "none", border: "1px solid var(--line)", color: "var(--text)", borderRadius: 6, width: 24, height: 24, cursor: "pointer" }}>+</button>
              </span>
            </div>
            {pendingDrop.job && (
              <div className="frow">
                <span className="l">Their price</span>
                <span className="v" style={{ color: "var(--cyan)" }}>{money(pendingDrop.job.paymentCents)}</span>
              </div>
            )}

            {pendingDrop.blocked && (
              <div className="err">
                This contractor has blocked these days out. You can still send it, but
                they told you they&rsquo;re not available.
              </div>
            )}
            {err && <div className="err">{err}</div>}

            <button className="btn cy" disabled={busy} onClick={pendingDrop.kind === "tray" ? sendOffer : moveBooking}>
              {busy ? "Working…" : pendingDrop.kind === "tray" ? "Send offer" : "Move booking"}
            </button>
            <button className="btn gh" onClick={() => { setPendingDrop(null); setErr(""); }}>Cancel</button>
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

            {detail.workOrderId && (
              <a className="btn gh" href={`/quote?wo=${detail.workOrderId}`} style={{ display: "block", textAlign: "center", textDecoration: "none" }}>
                Open the work order
              </a>
            )}
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
  onBlock: (contractorId: string, s: string, e: string, reason: string) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [cid, setCid] = useState("");
  const [s, setS] = useState("");
  const [e, setE] = useState("");
  const [reason, setReason] = useState("");

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
      <input type="text" placeholder="Reason (optional)" value={reason} onChange={(ev) => setReason(ev.target.value)} style={{ width: "100%", marginBottom: 8 }} />
      <button
        className="btn cy"
        style={{ marginTop: 0, padding: 9, fontSize: 13 }}
        disabled={busy || !cid || !s}
        onClick={() => { onBlock(cid, s, e || s, reason); setOpen(false); setCid(""); setS(""); setE(""); setReason(""); }}
      >
        Block these days
      </button>
      <button className="btn gh" style={{ padding: 9, fontSize: 13 }} onClick={() => setOpen(false)}>Cancel</button>
    </div>
  );
}
