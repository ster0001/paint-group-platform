"use client";

import { useState, useTransition } from "react";
import { dismissWorkItem } from "../actions";

/**
 * "Not this one" — dismissal per §3.7. The reason is required, always: the
 * dismissal log is how wrong thresholds get found, and an optional reason is
 * an empty column. ⚑7.6 — the presets are defaults, not ruled.
 */
const PRESETS = [
  { label: "Tomorrow", days: 1 },
  { label: "3 days", days: 3 },
  { label: "Next week", days: 7 },
  { label: "Next month", days: 30 },
  { label: "For good", days: null },
] as const;

/**
 * `oneTap` — Tom, 8 Oct: on "Fix the price without a visit", "Not this one"
 * just closes it. One tap dismisses for good with the given reason recorded
 * (the dismissal log keeps a reason; the person is not asked for one); the
 * action's revalidate takes the card off the screen.
 */
export default function DismissControl({ itemKey, accountId, oneTap }: {
  itemKey: string;
  accountId: string | null;
  oneTap?: { reason: string };
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [days, setDays] = useState<number | null>(1);
  const [message, setMessage] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const [pending, start] = useTransition();

  if (oneTap) {
    // The action revalidates /crm/today, so the card leaves with the refresh.
    if (closed) return null;
    return (
      <>
        <button
          type="button"
          className="qdismiss"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await dismissWorkItem(itemKey, accountId, null, oneTap.reason);
              if (res.ok) setClosed(true);
              else setMessage(res.message);
            })
          }
        >
          {pending ? "…" : "Not this one"}
        </button>
        {message && <span className="qdmsg">{message}</span>}
      </>
    );
  }

  if (!open) {
    return <button type="button" className="qdismiss" onClick={() => setOpen(true)}>Not this one</button>;
  }

  return (
    <span className="qdform">
      <span className="qdpresets">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            className={`qdpre ${days === p.days ? "on" : ""}`}
            onClick={() => setDays(p.days)}
          >
            {p.label}
          </button>
        ))}
      </span>
      <input
        className="qdreason"
        placeholder="Why? (required — it's how bad rules get found)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={200}
      />
      <span className="qdrow">
        <button
          type="button"
          className="qdgo"
          disabled={pending || !reason.trim()}
          onClick={() =>
            start(async () => {
              const res = await dismissWorkItem(itemKey, accountId, days, reason);
              setMessage(res.message);
              if (res.ok) setOpen(false);
            })
          }
        >
          {pending ? "…" : "Dismiss"}
        </button>
        <button type="button" className="qdcancel" onClick={() => { setOpen(false); setMessage(null); }}>Keep it</button>
      </span>
      {message && <span className="qdmsg">{message}</span>}
    </span>
  );
}

