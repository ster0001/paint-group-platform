"use client";

import { useState, useTransition } from "react";
import { askExternalQuestion, decideExternalApproval } from "./actions";

/** Session 5 · Approve (type-to-sign) / Decline / Ask — the §5.5 strip. */
export default function ExternalDecision({ token, approverName }: { token: string; approverName: string }) {
  const [pending, start] = useTransition();
  const [panel, setPanel] = useState<"approve" | "decline" | "ask" | null>(null);
  const [name, setName] = useState(approverName);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState<"approved" | "declined" | "asked" | null>(null);

  function decide(decision: "approved" | "declined") {
    setMsg(null);
    start(async () => {
      const r = await decideExternalApproval({ token, decision, signerName: name, note });
      if (r.ok) setDone(r.decision);
      else setMsg(r.message);
    });
  }
  function ask() {
    setMsg(null);
    start(async () => {
      const r = await askExternalQuestion({ token, body: note });
      if (r.ok) { setDone("asked"); setNote(""); }
      else setMsg(r.message ?? "Couldn't send that.");
    });
  }

  if (done === "approved") {
    return (
      <div className="card" data-testid="external-approved">
        <span className="chip emerald nodot">Approved</span>
        <p className="sub" style={{ marginTop: 8 }}>Signed and recorded — thank you. Everyone involved has been told, and the work can be booked in.</p>
      </div>
    );
  }
  if (done === "declined") {
    return (
      <div className="card" data-testid="external-declined">
        <span className="chip mut nodot">Declined</span>
        <p className="sub" style={{ marginTop: 8 }}>Recorded — the sender has been told.</p>
      </div>
    );
  }

  return (
    <div>
      {done === "asked" && (
        <div className="card"><p className="sub" style={{ margin: 0 }}>Question sent — the team will come back to you.</p></div>
      )}

      {panel === "approve" ? (
        <div className="card">
          <label>Sign with your full name
            <input className="field" value={name} onChange={(e) => setName(e.target.value)}
              style={{ marginTop: 6, marginBottom: 10 }} data-testid="sign-name" />
          </label>
          <button className="btn btn-cyan" disabled={pending} onClick={() => decide("approved")} data-testid="sign-approve">
            Approve this estimate
          </button>
          <p className="sub" style={{ fontSize: 12, marginTop: 8 }}>Typing your name here is your signature on the approval.</p>
        </div>
      ) : panel === "decline" ? (
        <div className="card">
          <label>Anything we should know? <span className="sub" style={{ fontSize: 12 }}>(optional)</span>
            <textarea className="field" value={note} onChange={(e) => setNote(e.target.value)}
              style={{ marginTop: 6, marginBottom: 10 }} data-testid="decline-note" />
          </label>
          <button className="btn" disabled={pending} onClick={() => decide("declined")} data-testid="decline-go">
            Decline this estimate
          </button>
        </div>
      ) : panel === "ask" ? (
        <div className="card">
          <label>Your question
            <textarea className="field" value={note} onChange={(e) => setNote(e.target.value)}
              style={{ marginTop: 6, marginBottom: 10 }} data-testid="ask-body" />
          </label>
          <button className="btn btn-cyan" disabled={pending} onClick={ask} data-testid="ask-go">Send the question</button>
        </div>
      ) : null}

      {panel !== "approve" && (
        <button className="btn btn-cyan" style={{ marginBottom: 8 }} onClick={() => setPanel("approve")} data-testid="open-approve">
          Approve
        </button>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <button className="btn btn-ghost" onClick={() => setPanel("decline")} data-testid="open-decline">Decline</button>
        <button className="btn btn-ghost" onClick={() => setPanel("ask")} data-testid="open-ask">Ask a question</button>
      </div>

      {msg && <p className="note" style={{ color: "var(--amber)" }} role="status">{msg}</p>}
    </div>
  );
}
