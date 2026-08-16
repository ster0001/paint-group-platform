"use client";

import { useMemo, useState } from "react";
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

const iso = (d: Date) => d.toISOString().slice(0, 10);
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
}: {
  blocks: PortalBlock[];
  jobDays: PortalJobDay[];
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
              className={`cd2 ${cls} ${date === today ? "istoday" : ""}`}
              onClick={() => toggle(date)}
              disabled={busy === date || Boolean(job)}
              title={job ? job.label : blk ? (blk.source === "staff" ? "Blocked by Paint Group" : "You marked this unavailable") : "Tap to block out"}
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
