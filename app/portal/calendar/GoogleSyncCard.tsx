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
/** The callback's ?why= reason, as a sentence a painter can act on or read to the office. */
export function failureNote(why: string | undefined): string {
  const base = "Connecting to Google didn't work.";
  switch (why) {
    case "state_cookie":
      return `${base} Google sent you back to a different address from the one you started on. Open the portal from the link in your invite or text and try again; if it happens twice, tell the office "calendar: state cookie".`;
    case "state":
      return `${base} The sign-in took too long or was started twice. Try once more from this page.`;
    case "no_session":
      return `${base} You were signed out on the way back. Sign in and press Connect again.`;
    case "no_refresh":
      return `${base} Google didn't hand over a long-term key. Press Connect again and tick every box on the consent screen.`;
    case "exchange":
      return `${base} Google refused the handshake. Tell the office "calendar: exchange" and they'll check the setup.`;
    case "missing_env":
      return `${base} The office hasn't finished setting this up.`;
    default:
      if (why?.startsWith("google_")) return `${base} Google said: ${why.slice(7).replace(/_/g, " ")}. Tell the office that wording.`;
      return `${base} Give it another go, or let the office know.`;
  }
}

export default function GoogleSyncCard({ status, flash, flashWhy }: { status: GcalStatus; flash?: string; flashWhy?: string }) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(
    flash === "connected"
      ? "Google Calendar connected — your booked jobs are on their way over."
      : flash === "denied"
        ? "No worries — nothing was connected."
        : flash === "failed"
          ? failureNote(flashWhy)
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

      {note && <p className="hint" data-testid="gcal-note">{note}</p>}
    </div>
  );
}
