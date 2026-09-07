"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTemperature, type CrmResult } from "./actions";
import { setFollowupOn, snoozeOn } from "./recordActions";
import { LogSheetBody } from "./LogSheet";

/**
 * The record's write panel (P2): the log sheet inline, temperature, and a
 * follow-up / snooze that take a DATE — tomorrow, three days, next week, or
 * one you pick — with a clear button. Every write is a server action; the
 * browser never touches a table, and each one leaves an event behind.
 */

const localDay = (offsetDays: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString("en-CA");
};

const fmt = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short" }).format(new Date(iso)) : null;

export default function CustomerPanel({ accountId, temperature, followupDueAt, followupNote, snoozedUntil }: {
  accountId: string;
  temperature: string | null;
  followupDueAt: string | null;
  followupNote: string | null;
  snoozedUntil: string | null;
}) {
  const [said, setSaid] = useState<CrmResult | null>(null);
  const [busy, startTransition] = useTransition();
  const [temp, setTemp] = useState(temperature);
  const [reason, setReason] = useState("");
  const [pickFollow, setPickFollow] = useState(localDay(1));
  const [pickSnooze, setPickSnooze] = useState(localDay(7));
  const router = useRouter();

  const run = (work: () => Promise<CrmResult>) => startTransition(async () => {
    const r = await work();
    setSaid(r);
    if (r.ok) router.refresh();
  });

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

  const snoozeLive = snoozedUntil != null && new Date(snoozedUntil) > new Date();

  return (
    <div className="panel">
      <p className="plabel">Log something</p>
      <LogSheetBody accountId={accountId} />

      <p className="plabel" style={{ marginTop: 16 }}>Mark hot / warm / cold</p>
      <div className="chips">{tempChip("hot")}{tempChip("warm")}{tempChip("cold")}</div>

      <p className="plabel" style={{ marginTop: 16 }}>Follow up on</p>
      <div className="chips">
        <button className="chip" disabled={busy} onClick={() => run(() => setFollowupOn(accountId, localDay(1), reason))}>Tomorrow</button>
        <button className="chip" disabled={busy} onClick={() => run(() => setFollowupOn(accountId, localDay(3), reason))}>3 days</button>
        <button className="chip" disabled={busy} onClick={() => run(() => setFollowupOn(accountId, localDay(7), reason))}>Next week</button>
        <input className="field datefield" type="date" value={pickFollow} min={localDay(0)} onChange={(e) => setPickFollow(e.target.value)} aria-label="Follow-up date" />
        <button className="chip" disabled={busy || !pickFollow} onClick={() => run(() => setFollowupOn(accountId, pickFollow, reason))}>Set date</button>
        {followupDueAt && (
          <button className="chip ghost" disabled={busy} onClick={() => run(() => setFollowupOn(accountId, null, ""))} data-testid="clear-followup">
            Clear ({fmt(followupDueAt)}{followupNote ? ` · ${followupNote}` : ""})
          </button>
        )}
      </div>

      <p className="plabel" style={{ marginTop: 16 }}>Snooze until</p>
      <div className="chips">
        <button className="chip" disabled={busy} onClick={() => run(() => snoozeOn(accountId, localDay(1), reason))}>Tomorrow</button>
        <button className="chip" disabled={busy} onClick={() => run(() => snoozeOn(accountId, localDay(7), reason))}>Next week</button>
        <button className="chip" disabled={busy} onClick={() => run(() => snoozeOn(accountId, localDay(30), reason))}>Next month</button>
        <input className="field datefield" type="date" value={pickSnooze} min={localDay(1)} onChange={(e) => setPickSnooze(e.target.value)} aria-label="Snooze date" />
        <button className="chip" disabled={busy || !pickSnooze} onClick={() => run(() => snoozeOn(accountId, pickSnooze, reason))}>Set date</button>
        {snoozeLive && (
          <button className="chip ghost" disabled={busy} onClick={() => run(() => snoozeOn(accountId, null, ""))} data-testid="clear-snooze">
            Clear (to {fmt(snoozedUntil)})
          </button>
        )}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <input className="field" placeholder="Why — rides with the reminder or the snooze" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>

      {said && <p className={`said ${said.ok ? "" : "bad"}`}>{said.message}</p>}
    </div>
  );
}
