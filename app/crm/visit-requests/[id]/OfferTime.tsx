"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { StaffSlotDay } from "@/lib/visits/requests";
import { markAnsweredAction, offerTimeAction } from "./actions";

/**
 * The free slots staff may offer, and the "answered another way" box. On
 * success there is no client-side "done" line: the action revalidates the
 * page, which swaps this for the server's answered summary (what was booked
 * and whether the customer was told). The buttons stay disabled until then.
 */
export default function OfferTime({ requestId, kind, days, slotsError }: { requestId: string; kind: "time" | "visit" | "call"; days: StaffSlotDay[]; slotsError: string | null }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [answer, setAnswer] = useState("");
  const router = useRouter();

  async function offer(estimatorId: string, startsAt: string) {
    setBusy(true); setMsg("");
    const r = await offerTimeAction({ requestId, estimatorId, startsAt });
    if (!r.ok) { setBusy(false); setMsg(r.message); return; }
    router.refresh();
  }
  async function markDone() {
    setBusy(true); setMsg("");
    const r = await markAnsweredAction({ requestId, answer });
    if (!r.ok) { setBusy(false); setMsg(r.message); return; }
    router.refresh();
  }

  return (
    <div className="mt-5 space-y-5">
      {kind !== "call" && (
        <div>
          <p className="text-sm font-medium text-gray-900">Offer a time</p>
          <p className="text-xs text-gray-500">Any free slot, whatever its zone list. Booking it sends the customer the details and the calendar invitation; no text code is needed.</p>
          {slotsError && <p className="mt-2 text-sm text-red-700" data-testid="request-slots-error">The free times could not be loaded: {slotsError}</p>}
          {!slotsError && !days.length && <p className="mt-2 text-sm text-gray-600" data-testid="request-no-slots">Nothing free in the booking window. Arrange it by phone and mark the request answered below.</p>}
          <div className="mt-2 space-y-2" data-testid="request-slots">
            {days.map((d) => (
              <div key={`${d.estimatorId}-${d.date}`} className="rounded-md border border-gray-200 p-2">
                <p className="text-xs text-gray-600">{d.dayWords} · {d.estimatorName}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {d.slots.map((s) => (
                    <button key={s.startsAt} type="button" disabled={busy} data-testid="request-slot" data-starts-at={s.startsAt}
                      className="rounded-md border border-gray-300 px-2 py-1 text-sm hover:bg-gray-50 disabled:opacity-50"
                      onClick={() => void offer(d.estimatorId, s.startsAt)}>{s.timeWords}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div>
        <p className="text-sm font-medium text-gray-900">{kind === "call" ? "Called them?" : "Answered another way?"}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <input className="w-72 rounded-md border border-gray-300 px-2 py-1 text-sm" placeholder={kind === "call" ? "e.g. Spoke to them, booking confirmed" : "e.g. Phoned, visit arranged for next week"} value={answer} onChange={(e) => setAnswer(e.target.value)} data-testid="request-answer" />
          <button type="button" className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50" disabled={busy} onClick={() => void markDone()} data-testid="request-mark-answered">Mark as answered</button>
        </div>
      </div>
      {msg && <p className="text-sm text-red-700" data-testid="request-msg">{msg}</p>}
    </div>
  );
}
