"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ackModuleAction } from "./actions";

/**
 * The tick under a module (ruling I1: one tick per module, Next disabled
 * until ticked, no typed name — the standards sign-off pattern). Ticking
 * writes the row at once, so a painter who stops half way comes back to the
 * next module. The last tick reads "Finish" and lands on the completion screen.
 */
export default function TickStep({ module, section, statement, lang, dir, last, nextHref, doneHref }: {
  module: string; section?: string; statement: string; lang: string; dir: "ltr" | "rtl"; last: boolean; nextHref: string; doneHref: string;
}) {
  const router = useRouter();
  const [ticked, setTicked] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function next() {
    if (!ticked) return;
    setMessage(null);
    start(async () => {
      const r = await ackModuleAction({ module, section });
      if (!r.ok) { setMessage(r.message); return; }
      router.push(r.complete ? doneHref : nextHref);
      router.refresh();
    });
  }

  return (
    <div className="signoff-foot" data-testid="induction-step" data-module={module} data-section={section ?? ""}>
      <button type="button" role="checkbox" aria-checked={ticked} className={`signoff-check ${ticked ? "on" : ""}`}
        onClick={() => setTicked((t) => !t)} data-testid="induction-tick">
        <span className="box" aria-hidden>✓</span>
        <span lang={lang} dir={dir}>{statement}</span>
      </button>
      {message && <p className="err" role="alert" data-testid="induction-error">{message}</p>}
      <button type="button" className="btn cy" disabled={!ticked || pending} onClick={next} data-testid="induction-next">
        {pending ? "Saving…" : last ? "Finish" : "Next module"}
      </button>
    </div>
  );
}
