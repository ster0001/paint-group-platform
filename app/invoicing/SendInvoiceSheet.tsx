"use client";

import { useState } from "react";

/**
 * The invoice send sheet (Tom, 25 Aug) — mirrors sending an estimate: a
 * personal note for the email/text, and the channel the customer receives it
 * on. The note is words only; every figure in the message is composed
 * server-side from the ledger.
 */
export default function SendInvoiceSheet({
  open, verb, onClose, onSend, busy,
}: {
  open: boolean;
  /** "Issue & send" for drafts, "Resend" for issued invoices. */
  verb: string;
  onClose: () => void;
  onSend: (opts: { message: string; via: "email" | "sms" | "both" }) => void;
  busy: boolean;
}) {
  const [message, setMessage] = useState("");
  const [via, setVia] = useState<"email" | "sms" | "both">("email");

  return (
    <>
      <div className="scrim" onClick={onClose} style={open ? { opacity: 1, pointerEvents: "auto" } : undefined} />
      <div className="sheet" role="dialog" aria-label="Send the invoice" style={open ? { transform: "none" } : undefined}>
        {open && (
          <>
            <h3>{verb}</h3>
            <div className="hint">
              Goes to the estimate&apos;s contact with the invoice link, the amount and our
              payment details. Add a personal note if you like — it leads the message.
            </div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="A personal note (optional) — e.g. Thanks for having us this week…"
              rows={3}
              maxLength={2000}
              data-testid="send-message"
              style={{
                width: "100%", marginTop: 12, background: "var(--ink)", color: "var(--text)",
                border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px",
                font: "inherit", fontSize: 13, resize: "vertical",
              }}
            />
            <div className="k" style={{ margin: "10px 0 6px" }}>How should they receive it?</div>
            <div className="chips">
              {([["email", "Email"], ["sms", "Text"], ["both", "Both"]] as const).map(([k, label]) => (
                <button key={k} className={`pchip ${via === k ? "on" : ""}`} onClick={() => setVia(k)}
                  data-testid={`send-via-${k}`}>
                  {label}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button className="btn ghost" onClick={onClose}>Cancel</button>
              <button className="btn primary" disabled={busy} data-testid="send-invoice-go"
                onClick={() => onSend({ message: message.trim(), via })}>
                {busy ? "Sending…" : verb}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
