"use client";

import { useState, useTransition } from "react";
import { logActivity, setFollowup, setTemperature, snooze, type CrmResult, type LoggableAction } from "./actions";

/**
 * "Log something" — the mockup's chips, the note box, the reminder and the
 * temperature. Every one is a server action: the browser never writes to a
 * table, and each action leaves an event behind.
 *
 * The buttons disable while the write is in flight, because a double-tapped
 * "Called — no answer" is two calls in the record that never happened.
 */
export default function CustomerPanel({ accountId, temperature }: {
  accountId: string;
  temperature: string | null;
}) {
  const [note, setNote] = useState("");
  const [days, setDays] = useState("3");
  const [said, setSaid] = useState<CrmResult | null>(null);
  const [busy, startTransition] = useTransition();
  // Optimistic only for the thing you can SEE change: the temperature chips.
  const [temp, setTemp] = useState(temperature);

  const run = (work: () => Promise<CrmResult>) => {
    startTransition(async () => {
      const result = await work();
      setSaid(result);
    });
  };

  const chip = (action: LoggableAction, label: string) => (
    <button className="chip" disabled={busy} onClick={() => run(async () => {
      const r = await logActivity(accountId, action, note);
      if (r.ok) setNote("");
      return r;
    })}>
      {label}
    </button>
  );

  const tempChip = (v: "hot" | "warm" | "cold") => (
    <button
      className={`chip ${v} ${temp === v ? "on" : ""}`}
      disabled={busy}
      onClick={() => run(async () => {
        const before = temp;
        setTemp(v);
        const r = await setTemperature(accountId, v);
        if (!r.ok) setTemp(before);
        return r;
      })}
    >
      {v[0].toUpperCase() + v.slice(1)}
    </button>
  );

  const dayCount = () => {
    const n = Number(days.replace(/[^0-9]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : 3;
  };

  return (
    <div className="panel">
      <p className="plabel">Log something</p>
      <div className="chips">
        {chip("call_no_answer", "Called — no answer")}
        {chip("message_left", "Left message")}
        {chip("call_connected", "Spoke to customer")}
      </div>

      <div className="row">
        <input
          className="field"
          placeholder="Add a note — or a line about the call above"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && note.trim() && !busy) {
              run(async () => { const r = await logActivity(accountId, "note_added", note); if (r.ok) setNote(""); return r; });
            }
          }}
        />
        <button className="go" disabled={busy || !note.trim()} onClick={() => run(async () => {
          const r = await logActivity(accountId, "note_added", note);
          if (r.ok) setNote("");
          return r;
        })}>
          {busy ? "Saving…" : "Save note"}
        </button>
      </div>

      <p className="plabel" style={{ marginTop: 16 }}>Mark hot / warm / cold</p>
      <div className="chips">{tempChip("hot")}{tempChip("warm")}{tempChip("cold")}</div>

      <p className="plabel" style={{ marginTop: 16 }}>Come back to this</p>
      <div className="row">
        <input
          className="field"
          style={{ maxWidth: 120, minWidth: 90 }}
          inputMode="numeric"
          value={days}
          onChange={(e) => setDays(e.target.value)}
          aria-label="days"
        />
        <button className="chip" disabled={busy} onClick={() => run(() => setFollowup(accountId, dayCount(), note))}>
          Follow up in {dayCount()} days
        </button>
        <button className="chip" disabled={busy} onClick={() => run(() => snooze(accountId, dayCount(), note))}>
          Snooze {dayCount()} days
        </button>
      </div>

      {said && <p className={`said ${said.ok ? "" : "bad"}`}>{said.message}</p>}
    </div>
  );
}
