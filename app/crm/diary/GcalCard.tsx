"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { GcalStatus } from "@/lib/gcal/config";

/** The signed-in staff member's Google Calendar (P6): connect, sync, push jobs, disconnect. */
export default function GcalCard({ status, flash }: { status: GcalStatus & { pushJobs?: boolean }; flash: string | null }) {
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
    <div className="panel" data-testid="gcal-card">
      <p className="plabel">Your Google Calendar</p>
      {status.kind === "unconfigured" && <p className="bhint">Not set up on this server (GOOGLE_CLIENT_ID / SECRET).</p>}
      {status.kind === "not_connected" && (
        <>
          <p className="bhint" style={{ marginBottom: 8 }}>Your visits land in a calendar the app creates in your Google account. It can never see your own events.</p>
          <a className="go" href="/api/gcal/connect?who=staff" style={{ display: "inline-block" }}>Connect Google Calendar</a>
        </>
      )}
      {(status.kind === "connected" || status.kind === "error") && (
        <>
          <p className="bhint" style={{ marginBottom: 8 }}>
            Connected as <b>{status.email ?? "your Google account"}</b>.
            {status.kind === "error" ? <span style={{ color: "var(--clay)" }}> Last sync failed: {status.message}</span> : null}
          </p>
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
