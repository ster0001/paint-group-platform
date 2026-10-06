"use client";

import { useState } from "react";
import type { StaffSlotDay } from "@/lib/visits/requests";
import { markAnsweredAction, offerTimeAction } from "./actions";

/** The free slots staff may offer, and the "answered another way" box. */
export default function OfferTime({ requestId, kind, days, slotsError }: { requestId: string; kind: "time" | "visit" | "call"; days: StaffSlotDay[]; slotsError: string | null }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [answer, setAnswer] = useState("");
  const [done, setDone] = useState<string | null>(null);

  async function offer(estimatorId: string, startsAt: string, label: string) {
    setBusy(true); setMsg("");
    const r = await offerTimeAction({ requestId, estimatorId, startsAt });
    setBusy(false);
    if (!r.ok) { setMsg(r.message); return; }
    setDone(`Booked ${label}. The customer has been sent the details and the invitation.`);
  }
  async function markDone() {
    setBusy(true); setMsg("");
    const r = await markAnsweredAction({ requestId, answer });
    setBusy(false);
    if (!r.ok) { setMsg(r.message); return; }
    setDone("Marked as answered.");
  }

  if (done) return <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900" data-testid="request-done">{done}</p>;

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
                      onClick={() => void offer(d.estimatorId, s.startsAt, `${d.dayWords}, ${s.timeWords}`)}>{s.timeWords}</button>
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
