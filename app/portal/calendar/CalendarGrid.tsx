"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export type PortalBlock = {
  id: string;
  start: string;
  end: string;
  reason: string;
  source: "contractor" | "staff";
};

export type PortalJobDay = { date: string; label: string; status: string };

// Local calendar date. toISOString() would report the UTC day, which is
// yesterday for most of a Melbourne evening — the calendar would highlight the
// wrong "today" and block the wrong day.
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
}: {
  blocks: PortalBlock[];
  jobDays: PortalJobDay[];
  /** "block" = tap/drag to mark unavailable. "pick" = choose one start date. */
  mode?: "block" | "pick";
  onPickDate?: (date: string) => void;
  selectedDate?: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const jobByDate = useMemo(() => {
    const m = new Map<string, PortalJobDay>();
    for (const j of jobDays) m.set(j.date, j);
    return m;
  }, [jobDays]);

  // Expand each block range into the individual days it covers.
  const blockByDate = useMemo(() => {
    const m = new Map<string, PortalBlock>();
    for (const b of blocks) {
      const d = new Date(b.start + "T00:00:00");
      const end = new Date(b.end + "T00:00:00");
      while (d <= end) {
        m.set(iso(d), b);
        d.setDate(d.getDate() + 1);
      }
    }
    return m;
  }, [blocks]);

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
        // Ranges are stored whole, so reopening one day means removing the range.
        const { error } = await supabase.from("contractor_unavailability").delete().eq("id", existing.id);
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
          const cls = job
            ? job.status === "in_progress" ? "job" : "booked"
            : blk
              ? blk.source === "staff" ? "blocked office" : "blocked"
              : "";
          return (
            <button
              key={date}
              className={`cd2 ${cls} ${date === today ? "istoday" : ""} ${inMarquee(date) ? "marq" : ""} ${selectedDate === date ? "picked" : ""}`}
              onPointerDown={() => dayDown(date)}
              onPointerEnter={() => dayEnter(date)}
              onPointerUp={dayUp}
              onClick={() => { if (mode === "pick") { if (!job) onPickDate?.(date); } }}
              disabled={busy === date || (mode === "block" && Boolean(job))}
              title={job ? job.label : blk ? (blk.source === "staff" ? "Blocked by Paint Group" : "You marked this unavailable") : mode === "pick" ? "Tap to start here" : "Tap, or drag across several days"}
            >
              {day}
              {job && <small>{job.label.slice(0, 8).toUpperCase()}</small>}
              {blk && !job && <small>{blk.source === "staff" ? "OFFICE" : "OFF"}</small>}
            </button>
          );
        })}
      </div>

      <div className="legend">
        <span><i style={{ background: "rgba(59,216,233,.5)" }} />ON THE TOOLS</span>
        <span><i style={{ background: "rgba(47,164,107,.5)" }} />BOOKED</span>
        <span><i style={{ background: "repeating-linear-gradient(45deg,#8C959D 0 3px,transparent 3px 5px)" }} />BLOCKED BY YOU</span>
        <span><i style={{ background: "repeating-linear-gradient(45deg,#B3574A 0 3px,transparent 3px 5px)" }} />BLOCKED BY OFFICE</span>
      </div>
    </>
  );
}
