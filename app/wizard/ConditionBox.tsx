"use client";

import { useMemo } from "react";
import { photoAsk, readConditionBrief } from "@/lib/wizard/condition-brief";

/**
 * The condition box — ⚑14, as Tom dissolved it (9 Sep).
 *
 * *"Describe the condition overall and tell us if there is anything which
 * needs extra work — then it could come back asking for photos?"*
 *
 * Narrower than "describe the whole job" on purpose: the condition is the part
 * a floorplan cannot answer and the part that decides the preparation. It
 * reads as they type (`readConditionBrief` is a matcher, not a model call — no
 * cost, cannot invent a defect) and comes back asking for a photo of whatever
 * it heard.
 *
 * ⚑ EXTRACTED because phase 2 moved the ground under it. It lived inside the
 * property page, which the quick look replaced for every customer — so the one
 * feature Tom asked for by name became unreachable on the default route. It now
 * sits on the quick look's CONDITION screen, which is where it always belonged:
 * right under "how's it looking?", extending the question rather than arriving
 * beside an address field.
 */
export default function ConditionBox({
  brief, setBrief, heading, sessionReady, startingChat, onChat,
}: {
  brief: string;
  setBrief: (v: string) => void;
  /** The quick look's screen already asks "how's it looking?" — don't ask twice. */
  heading: string;
  sessionReady: boolean;
  startingChat: boolean;
  onChat: () => void;
}) {
  const read = useMemo(() => readConditionBrief(brief), [brief]);

  return (
    <div className="wz-follow wz-alt" data-testid="condition-box">
      <p className="wz-q">
        {heading} <span className="wz-opt">OPTIONAL</span>
      </p>
      <p className="wz-chint" style={{ marginTop: 0, marginBottom: 8 }}>
        In your own words — the condition overall, and anything that needs more than a coat of paint.
        It&rsquo;s the part a floorplan can&rsquo;t tell us, and it&rsquo;s what decides the preparation.
      </p>
      <textarea
        className="wz-brief" data-testid="describe-condition" rows={3} value={brief}
        onChange={(e) => setBrief(e.target.value)}
        placeholder="e.g. generally sound, but the paint is peeling above the shower and there's a water mark on the hall ceiling…"
      />
      {read.findings.length > 0 && (
        <p className="wz-q" style={{ marginTop: 10 }} data-testid="condition-photo-ask">{photoAsk(read)}</p>
      )}
      {read.notes.map((n) => (
        <p className="wz-chint" style={{ marginTop: 6 }} key={n} data-testid="condition-note">Noted — {n}.</p>
      ))}
      {read.readAndClear && (
        <p className="wz-chint" style={{ marginTop: 8 }} data-testid="condition-clear">
          Thanks — nothing there needs extra preparation, so we&rsquo;ll price it as a straightforward repaint.
        </p>
      )}
      <p style={{ marginTop: 8 }}>
        <button
          type="button" className="wz-linkbtn" data-testid="chat-condition"
          disabled={!sessionReady || startingChat} onClick={onChat}
        >
          {startingChat ? "Opening the assistant…" : "Rather talk it through? Chat it with our assistant →"}
        </button>
      </p>
    </div>
  );
}
