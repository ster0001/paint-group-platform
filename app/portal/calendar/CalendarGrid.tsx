"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { localIso } from "@/lib/scheduling/dates";

export type PortalBlock = {
  id: string;
  start: string;
  end: string;
  reason: string;
  source: "contractor" | "staff";
};

/** `id` is the work order, so a booked day can open the job it belongs to. */
export type PortalJobDay = { date: string; label: string; status: string; id?: string };

// Local calendar date (lib/scheduling/dates.ts explains why this can never go
// through toISOString): the calendar would otherwise highlight the wrong
// "today" and block the wrong day.
const iso = localIso;
const formatShort = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short" });
const monthName = (y: number, m: number) =>
  new Date(y, m, 1).toLocaleDateString("en-AU", { month: "long", year: "numeric" });

/**
 * The contractor's own calendar. Tapping a free day blocks it out; tapping a
 * blocked day reopens it. Booked days can't be blocked — they'd have to talk to
 * the office first, which is the honest behaviour.
 */
export default function CalendarGrid({
  blocks,
  jobDays,
  mode = "block",
  onPickDate,
  selectedDate,
  initialMonth,
  minDate,
  highlight,
}: {
  blocks: PortalBlock[];
  jobDays: PortalJobDay[];
  /** "block" = tap/drag to mark unavailable. "pick" = choose one start date. */
  mode?: "block" | "pick";
  onPickDate?: (date: string) => void;
  selectedDate?: string | null;
  /** Open on this date's month — otherwise picking a date months out means
   *  paging forward from today, which is what made this feel broken. */
  initialMonth?: string | null;
  /** Days before this can't be picked. A start date in the past is meaningless. */
  minDate?: string | null;
  /** The dates currently on the table, drawn as a reference band. */
  highlight?: { from: string; to: string } | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const now = new Date();
  const opening = initialMonth ? new Date(initialMonth + "T00:00:00") : now;
  const [ym, setYm] = useState({ y: opening.getFullYear(), m: opening.getMonth() });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const jobByDate = useMemo(() => {
    const m = new Map<string, PortalJobDay>();
    for (const j of jobDays) m.set(j.date, j);
    return m;
  }, [jobDays]);

  // Expand each range into the days it covers. A day can be covered by MORE
  // THAN ONE block (overlapping ranges, or a repeated tap), so keep them all —
  // clearing a day has to remove every one of them or it stays stubbornly off.
  const blocksByDate = useMemo(() => {
    const m = new Map<string, PortalBlock[]>();
    for (const b of blocks) {
      const d = new Date(b.start + "T00:00:00");
      const end = new Date(b.end + "T00:00:00");
      while (d <= end) {
        const k = iso(d);
        if (!m.has(k)) m.set(k, []);
        m.get(k)!.push(b);
        d.setDate(d.getDate() + 1);
      }
    }
    return m;
  }, [blocks]);
  const blockByDate = useMemo(() => {
    const m = new Map<string, PortalBlock>();
    // Office blocks win for display, so the contractor sees who set the day off.
    for (const [k, list] of blocksByDate) m.set(k, list.find((b) => b.source === "staff") ?? list[0]);
    return m;
  }, [blocksByDate]);

  const cells = useMemo(() => {
    const first = new Date(ym.y, ym.m, 1);
    const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate();
    // Monday-first offset.
    const lead = (first.getDay() + 6) % 7;
    return [
      ...Array.from({ length: lead }, () => null),
      ...Array.from({ length: daysInMonth }, (_, i) => iso(new Date(ym.y, ym.m, i + 1))),
    ];
  }, [ym]);

  async function toggle(date: string) {
    if (jobByDate.has(date)) return; // booked — not the contractor's to block
    const existing = blockByDate.get(date);
    if (existing?.source === "staff") {
      setErr("Paint Group blocked this day out — give them a call to change it.");
      return;
    }
    setBusy(date);
    setErr("");
    try {
      if (existing) {
        // Remove EVERY block of theirs covering this day. Deleting just one
        // leaves the day stubbornly blocked when ranges overlap.
        const ids = (blocksByDate.get(date) ?? []).filter((b) => b.source === "contractor").map((b) => b.id);
        const { error } = await supabase.from("contractor_unavailability").delete().in("id", ids);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("contractor_unavailability").insert({
          start_date: date,
          end_date: date,
          source: "contractor",
          contractor_id: (await supabase.from("contractors").select("id").maybeSingle()).data?.id,
        });
        if (error) throw error;
      }
      router.refresh();
    } catch (e) {
      setErr(typeof e === "object" && e !== null && "message" in e ? String((e as { message: string }).message) : String(e));
    } finally {
      setBusy(null);
    }
  }

  // Drag across days to block a whole run at once — tapping one day at a time
  // is painful when you're away for a fortnight.
  const dragRef = useRef<null | { anchor: string; last: string }>(null);
  const [marquee, setMarquee] = useState<{ from: string; to: string } | null>(null);

  const inMarquee = useCallback(
    (d: string) => Boolean(marquee && d >= (marquee.from < marquee.to ? marquee.from : marquee.to) && d <= (marquee.from < marquee.to ? marquee.to : marquee.from)),
    [marquee],
  );

  function dayDown(date: string) {
    if (mode === "pick" || jobByDate.has(date)) return;
    dragRef.current = { anchor: date, last: date };
    setMarquee({ from: date, to: date });
  }
  function dayEnter(date: string) {
    if (!dragRef.current) return;
    dragRef.current.last = date;
    setMarquee({ from: dragRef.current.anchor, to: date });
  }
  async function dayUp() {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    const lo = d.anchor < d.last ? d.anchor : d.last;
    const hi = d.anchor < d.last ? d.last : d.anchor;
    setMarquee(null);
    if (lo === hi) await toggle(lo);
    else await blockRange(lo, hi);
  }

  async function blockRange(lo: string, hi: string) {
    setBusy(lo);
    setErr("");
    try {
      const { data: me } = await supabase.from("contractors").select("id").maybeSingle();
      // Drop any of their own blocks the new range covers, so dragging over an
      // existing block replaces it instead of piling a second one on top.
      const overlapping = blocks
        .filter((b) => b.source === "contractor" && b.start <= hi && b.end >= lo)
        .map((b) => b.id);
      if (overlapping.length) await supabase.from("contractor_unavailability").delete().in("id", overlapping);
      const { error } = await supabase.from("contractor_unavailability").insert({
        contractor_id: me?.id, start_date: lo, end_date: hi, source: "contractor",
      });
      if (error) throw error;
      router.refresh();
    } catch (e) {
      setErr(typeof e === "object" && e !== null && "message" in e ? String((e as { message: string }).message) : String(e));
    } finally {
      setBusy(null);
    }
  }

  const today = iso(new Date());
  const floor = minDate ?? null;
  const inHighlight = (d: string) => Boolean(highlight && d >= highlight.from && d <= highlight.to);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <button className="btn gh narrow" style={{ marginTop: 0 }} onClick={() => setYm(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))}>
          ‹
        </button>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{monthName(ym.y, ym.m)}</div>
        <button className="btn gh narrow" style={{ marginTop: 0 }} onClick={() => setYm(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))}>
          ›
        </button>
      </div>

      {err && <div className="err">{err}</div>}

      <div className="cal">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <div className="dow" key={i}>{d}</div>
        ))}
        {cells.map((date, i) => {
          if (!date) return <div key={`x${i}`} />;
          const day = Number(date.slice(8));
          const job = jobByDate.get(date);
          const blk = blockByDate.get(date);
          const tooEarly = Boolean(floor && date < floor);
          const cls = [
            job ? (job.status === "in_progress" ? "job" : "booked") : "",
            blk ? (blk.source === "staff" ? "blocked office" : "blocked") : "",
            inHighlight(date) ? "offered" : "",
            tooEarly ? "past" : "",
          ].filter(Boolean).join(" ");
          return (
            <button
              key={date}
              className={`cd2 ${cls} ${date === today ? "istoday" : ""} ${inMarquee(date) ? "marq" : ""} ${selectedDate === date ? "picked" : ""}`}
              onPointerDown={() => dayDown(date)}
              onPointerEnter={() => dayEnter(date)}
              onPointerUp={dayUp}
              onClick={() => {
                // A booked day belongs to a job; tapping it should open that job.
                if (job?.id) { router.push(`/portal/jobs/${job.id}`); return; }
                if (mode === "pick" && !tooEarly) onPickDate?.(date);
              }}
              disabled={busy === date || (mode === "pick" && tooEarly && !job?.id)}
              data-testid={job?.id ? `calendar-job-${date}` : undefined}
              title={
                tooEarly && !job ? "That date has passed"
                : job ? `${job.label} — tap to open the job`
                : blk ? (blk.source === "staff" ? "Blocked by Paint Group" : "You marked this unavailable")
                : mode === "pick" ? "Tap to start here"
                : "Tap, or drag across several days"
              }
            >
              {day}
              {job && <small>{job.label.slice(0, 8).toUpperCase()}</small>}
              {blk && !job && <small>{blk.source === "staff" ? "OFFICE" : "OFF"}</small>}
            </button>
          );
        })}
      </div>

      <div className="legend">
        {mode === "pick" && highlight && (
          <span><i style={{ background: "rgba(224,168,60,.45)" }} />DATES OFFERED</span>
        )}
        <span><i style={{ background: "rgba(47,164,107,.5)" }} />BOOKED</span>
        <span><i style={{ background: "repeating-linear-gradient(45deg,#8C959D 0 3px,transparent 3px 5px)" }} />BLOCKED BY YOU</span>
        <span><i style={{ background: "repeating-linear-gradient(45deg,#B3574A 0 3px,transparent 3px 5px)" }} />BLOCKED BY OFFICE</span>
      </div>

      {/* Picking a day you're not free on is allowed — you may have sorted it out
          since — but you shouldn't be able to do it without noticing. */}
      {mode === "pick" && selectedDate && blockByDate.get(selectedDate) && (
        <div className="err" style={{ marginTop: 10 }}>
          You&rsquo;ve marked {formatShort(selectedDate)} as unavailable
          {blockByDate.get(selectedDate)!.source === "staff" ? " (Paint Group blocked it)" : ""}.
          You can still propose it, but clear the day in your calendar if you can work it.
        </div>
      )}
      {mode === "pick" && selectedDate && jobByDate.get(selectedDate) && (
        <div style={{ marginTop: 10, fontSize: "12.5px", color: "var(--muted)" }}>
          You already have {jobByDate.get(selectedDate)!.label} starting that day. That&rsquo;s
          fine if your crew can cover both.
        </div>
      )}
    </>
  );
}
