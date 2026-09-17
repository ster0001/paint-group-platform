"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { acknowledgeAssignmentAction, cantMakeItAction } from "./assignmentActions";
import type { EmployeeAssignment } from "@/lib/contractor/jobs";

const dmy = (iso: string) =>
  new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "Australia/Melbourne" })
    .format(new Date(iso + "T00:00:00"));

/**
 * Employed painters (Session 3): the top of an ASSIGNED job.
 *
 * "You're on this job" with their days, a time budget (days and hours — never
 * a rate), the lead marker, and the one-tap Accept (ruling 2: an
 * acknowledgement, not approval; no decline, no clock). Under it, the
 * "can't make it" flag (ruling 11): a reason goes to the office as a Reassign
 * item and the assignment stays exactly as it was.
 */
export default function AssignmentCard({ assignment, flagged }: {
  assignment: EmployeeAssignment;
  /** True when a can't-make-it flag is already on the record for these dates. */
  flagged: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showFlag, setShowFlag] = useState(false);
  const [reason, setReason] = useState("");
  const [flaggedNow, setFlaggedNow] = useState(flagged);
  const a = assignment;
  const accepted = a.acceptedAt !== null;
  const span = a.myStart === a.myEnd ? dmy(a.myStart) : `${dmy(a.myStart)} → ${dmy(a.myEnd)}`;

  async function accept() {
    setBusy(true); setErr("");
    const r = await acknowledgeAssignmentAction({ assignmentId: a.assignmentId });
    if (!r.ok) setErr(r.message);
    router.refresh();
    setBusy(false);
  }

  async function flag() {
    setBusy(true); setErr("");
    const r = await cantMakeItAction({ assignmentId: a.assignmentId, reason });
    if (!r.ok) setErr(r.message);
    else { setFlaggedNow(true); setShowFlag(false); setReason(""); }
    router.refresh();
    setBusy(false);
  }

  return (
    <div className={`card ${accepted ? "" : "amberish"}`} data-testid="assignment-card" data-accepted={accepted ? "1" : "0"}>
      <div className="tick-head">
        <b>You&rsquo;re on this job</b>
        <span className="tick-count">{a.isLead ? "Lead painter" : `${a.crewSize} painter${a.crewSize === 1 ? "" : "s"}`}</span>
      </div>
      <div className="frow"><span className="l">Your days</span><span className="v" data-testid="assignment-days">{span}</span></div>
      <div className="frow">
        <span className="l">Time budget</span>
        <span className="v" data-testid="time-budget">{a.timeBudget.days} DAY{a.timeBudget.days === 1 ? "" : "S"} · {a.timeBudget.hours.toFixed(1)} H</span>
      </div>
      {a.crewSize > 1 && (
        <p className="hint" style={{ padding: 0, marginTop: 6 }}>
          {a.isLead
            ? "You're the lead painter — the customer has your name, and the walkthrough prompt comes to you."
            : "Everyone on the job can tick, add photos and raise a variation; the lead painter's name is the one the customer sees."}
        </p>
      )}

      {accepted ? (
        <p className="hint" style={{ padding: 0, marginTop: 8 }} data-testid="assignment-accepted">
          Accepted {new Date(a.acceptedAt!).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Melbourne" })}. Nothing else to do until the day.
        </p>
      ) : (
        <>
          <p className="hint" style={{ padding: 0, marginTop: 8 }}>
            Tap Accept so the office knows you&rsquo;ve seen it. It isn&rsquo;t a yes-or-no — the job is already in your calendar.
          </p>
          <button type="button" className="btn cy" disabled={busy} onClick={accept}
            data-testid="accept-assignment" style={{ width: "100%", marginTop: 8 }}>
            {busy ? "Saving…" : "Accept — I've seen it"}
          </button>
        </>
      )}

      {flaggedNow ? (
        <p className="note" style={{ marginTop: 10 }} data-testid="cant-make-it-flagged">
          You&rsquo;ve told the office you can&rsquo;t make these days. They&rsquo;ll sort it and be in touch — nothing changes until they do.
        </p>
      ) : showFlag ? (
        <div style={{ marginTop: 10 }} data-testid="cant-make-it-form">
          <label className="ctrl-lab" style={{ display: "block", marginBottom: 6 }}>Why can&rsquo;t you make it?</label>
          <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300}
            placeholder="e.g. medical appointment Tuesday" style={{ width: "100%" }} data-testid="cant-make-it-reason" />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="button" className="btn dim" disabled={busy || !reason.trim()} onClick={flag} data-testid="cant-make-it-send">
              Tell the office
            </button>
            <button type="button" className="btn gh" disabled={busy} onClick={() => { setShowFlag(false); setReason(""); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn gh" disabled={busy} onClick={() => setShowFlag(true)}
          data-testid="cant-make-it" style={{ marginTop: 8 }}>
          I can&rsquo;t make these days
        </button>
      )}
      {err && <div className="err" style={{ marginTop: 8 }}>{err}</div>}
    </div>
  );
}
