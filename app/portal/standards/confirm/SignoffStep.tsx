"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ackSectionAction } from "./actions";
import type { SignSectionKey } from "@/lib/standards/acks";

/**
 * The tick and the Next button under a sign-off section (mockup: one tick per
 * section, Next disabled until ticked, no typed name — ruling S4). Ticking
 * writes the row at once, so a painter who stops half way comes back to the
 * next section (resumable). The sixth tick reads "Confirm".
 */
export default function SignoffStep({ section, last, nextHref, doneHref }: {
  section: SignSectionKey; last: boolean; nextHref: string; doneHref: string;
}) {
  const router = useRouter();
  const [ticked, setTicked] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function next() {
    if (!ticked) return;
    setMessage(null);
    start(async () => {
      const r = await ackSectionAction({ section });
      if (!r.ok) { setMessage(r.message); return; }
      router.push(r.confirmed ? doneHref : nextHref);
    });
  }

  return (
    <div className="signoff-foot" data-testid="signoff-step">
      <button type="button" role="checkbox" aria-checked={ticked} className={`signoff-check ${ticked ? "on" : ""}`}
        onClick={() => setTicked((t) => !t)} data-testid="signoff-tick">
        <span className="box" aria-hidden>✓</span>
        <span>I have read and understand this</span>
      </button>
      {message && <p className="err" role="alert" data-testid="signoff-error">{message}</p>}
      <button type="button" className="btn cy" disabled={!ticked || pending} onClick={next} data-testid="signoff-next">
        {pending ? "Saving…" : last ? "Confirm" : "Next section"}
      </button>
    </div>
  );
}
