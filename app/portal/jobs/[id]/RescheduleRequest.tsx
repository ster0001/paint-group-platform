"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import CalendarGrid, { type PortalBlock, type PortalJobDay } from "@/app/portal/calendar/CalendarGrid";
import { formatDMY } from "@/lib/scheduling/offers";

/**
 * "I'm running behind — can we start later?" on a job the contractor has
 * already accepted. It doesn't move anything on its own: the job goes to
 * pending approval and staff decide, because a booked date is a promise
 * somebody has made to a customer.
 */
export default function RescheduleRequest({
  offerId,
  currentStart,
  pending,
  proposedDate,
  blocks,
  jobDays,
}: {
  offerId: string;
  currentStart: string | null;
  /** Already waiting on staff — show the state rather than the form. */
  pending: boolean;
  proposedDate: string | null;
  blocks: PortalBlock[];
  jobDays: PortalJobDay[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (pending) {
    return (
      <div className="card amberish" style={{ margin: "0 16px 12px" }}>
        <span className="chip amb">Waiting on Paint Group</span>
        <div style={{ marginTop: 8, fontSize: "12.5px", color: "var(--muted)" }}>
          You&rsquo;ve asked to move this job to <b style={{ color: "var(--text)" }}>{formatDMY(proposedDate)}</b>.
          Paint Group have to check with the customer before it&rsquo;s confirmed — until
          they do, the original date still stands.
        </div>
      </div>
    );
  }

  async function submit() {
    setBusy(true);
    setErr("");
    try {
      const { data, error } = await supabase.rpc("request_reschedule", {
        p_offer_id: offerId,
        p_new_start: date,
        p_note: note,
      });
      if (error) throw error;
      const res = String(data ?? "");
      if (res.startsWith("error:")) {
        const map: Record<string, string> = {
          "error:no_date": "Pick the date you'd rather start.",
          "error:not_accepted": "This job isn't booked, so there's nothing to move.",
          "error:not_yours": "This job isn't yours.",
        };
        setErr(map[res] ?? res.replace("error:", ""));
        return;
      }
      setOpen(false);
      router.refresh();
    } catch (e) {
      setErr(typeof e === "object" && e !== null && "message" in e ? String((e as { message: string }).message) : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ margin: "0 16px 12px" }}>
      <button className="btn gh" onClick={() => setOpen(true)}>
        Request a new start date
      </button>

      {open && (
        <div className="sheetwrap on">
          <div className="scrim" onClick={() => setOpen(false)} />
          <div className="sheet">
            <h3>Request a new start date</h3>
            <p className="slab">
              Currently starting {formatDMY(currentStart)} · Paint Group have to agree it with the customer
            </p>
            <CalendarGrid
              blocks={blocks}
              jobDays={jobDays}
              mode="pick"
              selectedDate={date || null}
              onPickDate={setDate}
            />
            <textarea
              rows={2}
              placeholder="Why? e.g. running behind on the job before"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{ marginTop: 10 }}
            />
            {err && <div className="err">{err}</div>}
            <button className="btn cy" disabled={busy || !date} onClick={submit}>
              {busy ? "Sending…" : "Send request"}
            </button>
            <button className="btn gh" onClick={() => setOpen(false)}>Back</button>
          </div>
        </div>
      )}
    </div>
  );
}
