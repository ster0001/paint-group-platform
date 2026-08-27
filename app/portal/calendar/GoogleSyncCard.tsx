"use client";

import { useState, useTransition } from "react";
import type { GcalStatus } from "@/lib/gcal/config";
import { disconnectGoogleCalendar, syncGoogleCalendarNow } from "./gcalActions";

/**
 * The "Connect Google Calendar" card on the portal Calendar tab.
 *
 * Connect is a plain link to /api/gcal/connect (the OAuth dance is redirects,
 * not fetch). Disconnect and Sync-now are server actions. `flash` carries the
 * ?gcal= query param the OAuth callback redirects back with.
 */
export default function GoogleSyncCard({ status, flash }: { status: GcalStatus; flash?: string }) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(
    flash === "connected"
      ? "Google Calendar connected — your booked jobs are on their way over."
      : flash === "denied"
        ? "No worries — nothing was connected."
        : flash === "failed"
          ? "Connecting to Google didn't work. Give it another go, or let the office know."
          : null,
  );

  if (status.kind === "unconfigured") return null;

  const syncNow = () =>
    startTransition(async () => {
      const r = await syncGoogleCalendarNow();
      setNote(r === "ok" ? "Synced — your Google Calendar is up to date." : "Sync hit a snag; it will retry overnight.");
    });

  const disconnect = () =>
    startTransition(async () => {
      await disconnectGoogleCalendar();
      setNote("Disconnected. The Paint Group Jobs calendar is still in your Google account — delete it there if you don't want it.");
    });

  return (
    <div className={`card ${status.kind === "connected" ? "greenish" : status.kind === "error" ? "amberish" : ""}`}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <strong>Google Calendar</strong>
        {status.kind === "connected" && <span className="chip grn">Connected</span>}
        {status.kind === "error" && <span className="chip amb">Needs attention</span>}
      </div>

      {status.kind === "not_connected" && (
        <>
          <p className="hint">
            Accepted jobs land in a separate &ldquo;Paint Group Jobs&rdquo; calendar in your own Google
            Calendar — added when you accept, moved when a booking moves, removed if it&rsquo;s
            cancelled. We can&rsquo;t see anything already in your calendar.
          </p>
          <a className="btn cy narrow" href="/api/gcal/connect">
            Connect Google Calendar
          </a>
        </>
      )}

      {status.kind === "connected" && (
        <>
          <p className="hint">
            {status.email ? <>Connected as <strong>{status.email}</strong>. </> : null}
            Your accepted bookings appear in the &ldquo;Paint Group Jobs&rdquo; calendar automatically.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn dim narrow" onClick={syncNow} disabled={pending}>
              {pending ? "Working…" : "Sync now"}
            </button>
            <button className="btn dim narrow" onClick={disconnect} disabled={pending}>
              Disconnect
            </button>
          </div>
        </>
      )}

      {status.kind === "error" && (
        <>
          <p className="hint">{status.message}</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a className="btn cy narrow" href="/api/gcal/connect">
              Reconnect
            </a>
            <button className="btn dim narrow" onClick={disconnect} disabled={pending}>
              Disconnect
            </button>
          </div>
        </>
      )}

      {note && <p className="hint">{note}</p>}
    </div>
  );
}
