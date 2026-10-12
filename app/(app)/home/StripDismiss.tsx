"use client";

import { useState, useTransition } from "react";
import { dismissWorkItem } from "@/app/crm/actions";
import { dismissCard } from "@/app/pc/actions";
import type { StripCard } from "@/lib/reporting/strip";

/**
 * Tom, 12 Oct: "these are static and I am not able to update or delete them".
 * Each card closes off through its OWN source's dismissal, so Home, Today and
 * PC Command agree — nothing here stores a hide of its own.
 *
 *  - a customer / money / sales card (CRM work queue): "Not now" snoozes it
 *    (tomorrow, next week) or closes it for good, with the reason the
 *    dismissal log requires (`crm_dismiss_work_item`);
 *  - a job card (PC console): "Done" closes it off, permanent per card key,
 *    exactly as the cross on PC Command does (`wo_dismiss_card`).
 *
 * The actions revalidate /home, so the card leaves with the refresh.
 */
const SNOOZES = [
  { label: "Tomorrow", days: 1 },
  { label: "Next week", days: 7 },
  { label: "For good", days: null },
] as const;

export default function StripDismiss({ dismiss }: { dismiss: NonNullable<StripCard["dismiss"]> }) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<number | null>(1);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [pending, start] = useTransition();

  if (gone) return <span className="dmsg" data-testid="strip-dismissed">{message ?? "Done."}</span>;

  if (dismiss.source === "pc") {
    return (
      <>
        <button
          type="button"
          className="dbtn"
          disabled={pending}
          data-testid="strip-done"
          onClick={() =>
            start(async () => {
              const res = await dismissCard({ workOrderId: dismiss.workOrderId, cardKey: dismiss.cardKey });
              setMessage(res.message ?? null);
              if (res.ok) setGone(true);
            })
          }
        >
          {pending ? "…" : "Done"}
        </button>
        {message && !gone && <span className="dmsg">{message}</span>}
      </>
    );
  }

  if (!open) {
    return <button type="button" className="dbtn" onClick={() => setOpen(true)} data-testid="strip-not-now">Not now</button>;
  }

  return (
    <div className="dform" data-testid="strip-dismiss-form">
      <div className="dpre">
        {SNOOZES.map((s) => (
          <button key={s.label} type="button" className={days === s.days ? "on" : ""} aria-pressed={days === s.days} onClick={() => setDays(s.days)}>
            {s.label}
          </button>
        ))}
      </div>
      <input
        placeholder="Why? (required)"
        value={reason}
        maxLength={200}
        onChange={(e) => setReason(e.target.value)}
        data-testid="strip-dismiss-reason"
      />
      <div className="drow">
        <button
          type="button"
          className="dgo"
          disabled={pending || !reason.trim()}
          data-testid="strip-dismiss-go"
          onClick={() =>
            start(async () => {
              const res = await dismissWorkItem(dismiss.itemKey, dismiss.accountId, days, reason);
              setMessage(res.message);
              if (res.ok) setGone(true);
            })
          }
        >
          {pending ? "…" : "Close it"}
        </button>
        <button type="button" className="dbtn" onClick={() => { setOpen(false); setMessage(null); }}>Keep it</button>
      </div>
      {message && <span className="dmsg">{message}</span>}
    </div>
  );
}
