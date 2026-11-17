"use client";

import { useState } from "react";

/** E11: the one tap that records the reason (a POST, so an email scanner opening the link records nothing). */
export default function ReasonConfirm({ token, code, chip }: { token: string; code: string; chip: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const send = async () => {
    setState("busy");
    try {
      const res = await fetch("/api/estimates/decline-reason", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, code }) });
      setState(res.ok ? "done" : "error");
    } catch { setState("error"); }
  };
  if (state === "done") return <p className="viewnote" data-testid="reason-done">Thank you — that helps us improve.</p>;
  return (
    <div>
      <button type="button" className="btn btn-primary" disabled={state === "busy"} onClick={() => void send()} data-testid="reason-confirm">Yes — {chip}</button>
      {state === "error" && <p className="viewnote" role="alert" style={{ color: "var(--amber)" }}>That didn&apos;t save — please try again.</p>}
    </div>
  );
}
