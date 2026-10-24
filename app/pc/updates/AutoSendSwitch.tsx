"use client";

import { useState, useTransition } from "react";
import { setCustomerUpdatesAutoSend } from "../actions";

/**
 * The one switch at the top of the queue (brief §4.2, ruling R7): off, every
 * message waits here for a person; on, drafts go after the bundle window. It is
 * the registry's approve / auto mode for `customer_updates_queue` — the same
 * control Settings → Automations shows — not a second setting.
 */
export default function AutoSendSwitch({ on, sender }: { on: boolean; sender: string }) {
  const [state, setState] = useState(on);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function flip() {
    const next = !state;
    setMessage(null);
    startTransition(async () => {
      const r = await setCustomerUpdatesAutoSend({ on: next });
      if (r.ok) setState(next); else setMessage(r.message);
    });
  }

  return (
    <div className="card auto" data-testid="auto-send-card">
      <div>
        <b>Send customer updates automatically</b>
        <small data-testid="auto-send-state">
          {state
            ? `On. Drafts go to the customer on their own once the bundle window has passed, as ${sender}.`
            : `Off. Messages wait here for ${sender} until you’re happy with the wording.`}
        </small>
        {message && <small style={{ color: "var(--amber)" }}>{message}</small>}
      </div>
      <button type="button" role="switch" aria-checked={state} aria-label="Send customer updates automatically"
        className={`sw${state ? " on" : ""}`} disabled={pending} onClick={flip} data-testid="auto-send-switch" />
    </div>
  );
}
