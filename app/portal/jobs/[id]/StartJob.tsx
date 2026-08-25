"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Tom (25 Aug): the contractor starts their own job. One tap moves
 * pre_start → in_progress through the SAME gate the office uses — every
 * required pre-start item ticked — enforced again in SQL, so a stale page
 * can't start what isn't ready.
 */
export default function StartJob({ workOrderId, blockedCount }: {
  workOrderId: string;
  /** Required pre-start items still unticked (server-computed at render). */
  blockedCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function start() {
    setBusy(true);
    setErr("");
    try {
      const { data, error } = await createClient().rpc("wo_contractor_start", {
        p_work_order_id: workOrderId,
      });
      if (error) throw error;
      const result = String(data ?? "");
      if (result.startsWith("error:gate:")) {
        setErr(`Not quite ready — ${result.replace("error:gate:", "")}.`);
        router.refresh();
        return;
      }
      if (result.startsWith("error:")) {
        setErr("Couldn't start the job — refresh and try again, or call the office.");
        router.refresh();
        return;
      }
      router.refresh();
    } catch {
      setErr("Couldn't start the job — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const ready = blockedCount === 0;
  return (
    <div className="card" data-testid="start-job">
      <div className="tick-head"><b>Ready to start?</b></div>
      <p className="hint" style={{ padding: 0 }}>
        {ready
          ? "Everything on the pre-start list is ticked. Starting moves the job to In progress and tells the office you're on site."
          : `${blockedCount} pre-start item${blockedCount === 1 ? "" : "s"} still to be ticked by the office — the button unlocks when the list is done.`}
      </p>
      <button type="button" className="btn cy" disabled={busy || !ready}
        onClick={start} data-testid="start-job-button" style={{ width: "100%", marginTop: 8 }}>
        {busy ? "Starting…" : "Start the job"}
      </button>
      {err && <p className="hint" style={{ padding: 0, color: "var(--clay, #B3574A)" }}>{err}</p>}
    </div>
  );
}
