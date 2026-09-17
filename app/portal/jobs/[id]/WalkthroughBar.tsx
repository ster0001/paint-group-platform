"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { completeAfterRectification, contractorFinish, startWalkthroughMode } from "./tickActions";

/**
 * Tom (17 Sep): "once all of the check boxes have been done, a Start
 * walkthrough button fixed to the top of the page — currently I can't get to
 * the walkthrough." The Walkthrough & sign-off card lives a long scroll down
 * a finished job, under the ticks, photos, finishing-up list, colours, dates
 * and the crew link — and before the finish press it isn't there at all.
 *
 * This bar pins under the portal header from the moment every working surface
 * is done, and stays through the finish, the quality check and the walkthrough
 * stage. One press does whatever is NEXT for this job:
 *
 *   phase "finish"      — the painter's finish (the same server routing as
 *                         "All done — next step": a quality check first when
 *                         one is due, otherwise straight on) and, when that
 *                         lands the job at walkthrough, the walkthrough itself.
 *   phase "walkthrough" — the walkthrough, in the customer's own view on this
 *                         phone (§4b Mode A, same as WalkthroughStart).
 *   phase "rectified"   — the customer flagged areas at their walkthrough and
 *                         the painter has put them right (Tom, 17 Sep): one
 *                         press completes the job, and the completion report
 *                         — flagged areas and all — goes to the customer.
 *                         Never a second walkthrough.
 *
 * Nothing here decides anything: the finishing-up gate, the QA routing and the
 * walkthrough-stage check are all the RPCs', and a refusal is shown in the
 * server's own words. The cards below stay — this is a second door to the same
 * two actions, not a fork of them.
 */
export default function WalkthroughBar({ workOrderId, phase, prepLeft, flaggedAreas = [] }: {
  workOrderId: string;
  phase: "finish" | "walkthrough" | "rectified";
  /** Required finishing-up items still open (server-computed at render). */
  prepLeft: number;
  /** Areas the customer flagged that are not yet marked put right. */
  flaggedAreas?: readonly string[];
}) {
  const router = useRouter();
  const barRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Sit directly under the sticky portal header, whatever height the logo and
  // the contractor's name give it. Measured once; the header does not resize.
  useEffect(() => {
    const header = document.querySelector<HTMLElement>(".pt .hd");
    if (header && barRef.current) barRef.current.style.top = `${header.offsetHeight}px`;
  }, []);

  async function openWalkthrough(): Promise<boolean> {
    const r = await startWalkthroughMode({ workOrderId });
    if (!r.ok) { setMessage(r.message); return false; }
    // The device comes back HERE after the customer signs.
    router.push(`${r.url}?back=${encodeURIComponent(`/portal/jobs/${workOrderId}`)}`);
    return true;
  }

  async function press() {
    setBusy(true);
    setMessage(null);
    try {
      if (phase === "walkthrough") { await openWalkthrough(); return; }
      if (phase === "rectified") {
        const r = await completeAfterRectification({ workOrderId });
        setMessage(r.ok
          ? "Done — the job is complete. The customer has their completion report, with the areas they flagged and what was put right."
          : r.message);
        if (r.ok) router.refresh();
        return;
      }
      const r = await contractorFinish({ workOrderId });
      if (!r.ok) { setMessage(r.message); return; }
      if (r.to === "walkthrough") {
        if (await openWalkthrough()) return;
      } else if (r.to === "qa") {
        setMessage("Nice work. Paint Group will quality check the job now — the walkthrough opens here the moment it passes.");
      } else {
        setMessage("Nice work — no walkthrough on this job, so it's complete. Paint Group will invoice the customer.");
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const hint = phase === "walkthrough"
    ? "With the customer beside you, hand them your phone to approve each area and sign."
    : phase === "rectified"
      ? `The customer flagged ${flaggedAreas.join(", ")}. Once put right and ticked, this completes the job and sends them the report — no second walkthrough.`
      : prepLeft > 0
      ? `${prepLeft} finishing-up item${prepLeft === 1 ? "" : "s"} still to tick below — then this sends the job on.`
      : "Every surface is done. This finishes the job and opens the walkthrough — after a quality check, if one is due.";

  return (
    <div ref={barRef} data-testid="walkthrough-bar" data-phase={phase}
      style={{
        position: "sticky", top: 0, zIndex: 30, margin: "0 0 10px",
        background: "rgba(10, 11, 13, 0.96)", backdropFilter: "blur(12px)",
        borderBottom: "1px solid var(--line, #242B32)", padding: "10px 16px 12px",
      }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--cyan, #3BD8E9)" }}>
            {phase === "walkthrough" ? "Ready to sign off" : phase === "rectified" ? "Flagged areas put right" : "All surfaces done"}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted, #8C959D)", marginTop: 2 }}>{hint}</div>
        </div>
        <button type="button" className="btn cy" disabled={busy} onClick={() => void press()}
          data-testid="walkthrough-bar-start"
          style={{ width: "auto", marginTop: 0, padding: "11px 14px", whiteSpace: "nowrap", flexShrink: 0 }}>
          {busy ? (phase === "rectified" ? "Finishing…" : "Opening…") : phase === "rectified" ? "Fixed — send the report" : "Start the walkthrough"}
        </button>
      </div>
      {message && (
        <p role="status" data-testid="walkthrough-bar-msg"
          style={{ margin: "8px 0 0", fontSize: 12.5, color: "var(--text, #EDF0F2)" }}>
          {message}
        </p>
      )}
    </div>
  );
}
