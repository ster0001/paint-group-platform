"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { GcalStatus } from "@/lib/gcal/config";

/**
 * The signed-in staff member's Google Calendar (P6): connect, sync, push jobs,
 * disconnect — and, since 8 Sep, whether the app may READ their own
 * calendars so the Diary shows what is really there. A connection made
 * before 8 Sep can only write; the card asks for a reconnect.
 */
export default function GcalCard({ status, flash, read = null }: {
  status: GcalStatus & { pushJobs?: boolean }; flash: string | null;
  read?: { kind: string; calendars: string[] } | null;
}) {
  const [said, setSaid] = useState<string | null>(
    flash === "connected" ? "Connected — your visits are in a “Paint Group Visits” calendar in your Google account."
    : flash === "denied" ? "No changes — you cancelled on Google's screen."
    : flash === "failed" ? "Google didn't complete the connection. Try again."
    : flash === "unconfigured" ? "Google Calendar isn't set up on this server yet." : null,
  );
  const [busy, start] = useTransition();
  const router = useRouter();
  const call = (init: RequestInit, done: string) => start(async () => {
    const res = await fetch("/api/gcal/staff", { ...init, headers: { "Content-Type": "application/json" } });
    const body = await res.json().catch(() => ({}));
    setSaid(res.ok ? (body.status === "synced" ? `${done} ${body.created} added, ${body.updated} updated, ${body.removed} removed.` : done) : (body.error ?? "Something went wrong."));
    router.refresh();
  });

  return (
    <div className="panel" id="gcal" data-testid="gcal-card">
      <p className="plabel">Your Google Calendar</p>
      {status.kind === "unconfigured" && <p className="bhint">Not set up on this server (GOOGLE_CLIENT_ID / SECRET).</p>}
      {status.kind === "not_connected" && (
        <>
          <p className="bhint" style={{ marginBottom: 8 }}>Your visits land in a calendar the app creates in your Google account, and the Diary reads your own Google calendars so a time that&rsquo;s taken never shows as free.</p>
          <a className="go" href="/api/gcal/connect?who=staff" style={{ display: "inline-block" }}>Connect Google Calendar</a>
        </>
      )}
      {(status.kind === "connected" || status.kind === "error") && (
        <>
          <p className="bhint" style={{ marginBottom: 8 }}>
            Connected as <b>{status.email ?? "your Google account"}</b>.
            {status.kind === "error" ? <span style={{ color: "var(--clay)" }}> Last sync failed: {status.message}</span> : null}
          </p>
          {status.canRead
            ? <p className="bhint" style={{ marginBottom: 8 }} data-testid="gcal-reads">
                {read?.kind === "ok"
                  ? <>Reading your Google calendars{read.calendars.length ? <>: <b>{read.calendars.join(", ")}</b></> : null} — their entries show in your lane above and count as busy.</>
                  : read?.kind === "needs_reconnect"
                    ? <span style={{ color: "var(--amber)" }}>Google refused to share your calendars — reconnect below.</span>
                    : <>Reading your Google calendars — Google didn&rsquo;t answer just now; the lanes show visits only until it does.</>}
              </p>
            : <p className="bhint" style={{ marginBottom: 8, color: "var(--amber)" }} data-testid="gcal-reconnect">
                This connection can only write. Reconnect once and the Diary will also <b>read</b> your own Google calendars, so a dentist appointment typed into Google shows here and is never offered to a customer.{" "}
                <a className="rlink" href="/api/gcal/connect?who=staff" style={{ color: "var(--cyan)" }}>Reconnect Google Calendar →</a>
              </p>}
          <label className="switch" style={{ marginBottom: 10 }}>
            <input type="checkbox" checked={status.pushJobs === true} disabled={busy} onChange={(e) => call({ method: "POST", body: JSON.stringify({ pushJobs: e.target.checked }) }, "Saved.")} />
            <span>Also put booked jobs in it (07:30–15:30 blocks, like the painters see)</span>
          </label>
          <div className="chips">
            <button className="chip" disabled={busy} onClick={() => call({ method: "POST", body: "{}" }, "Synced.")}>{busy ? "Working…" : "Sync now"}</button>
            <button className="chip" disabled={busy} onClick={() => { if (window.confirm("Disconnect Google Calendar? The Paint Group Visits calendar stays; nothing else changes.")) call({ method: "DELETE" }, "Disconnected."); }}>Disconnect</button>
          </div>
        </>
      )}
      {said && <p className="said">{said}</p>}
    </div>
  );
}
