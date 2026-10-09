"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The customer's "Pay" button and the box it opens (Tom, 4 Oct 2026).
 *
 * One button on the invoice; press it and a box shows the amount due for
 * THIS document (deposit, payment or final balance), the bank details and
 * the invoice number to use as the reference — the three things a customer
 * needs in front of them when they open their banking app. Card payments
 * appear as a second choice inside the same box only when the office has
 * switched them on in Settings (and the server holds a key); otherwise the
 * box is bank transfer alone. The printed invoice keeps the static
 * "How to pay" box — a PDF has nothing to press.
 */

const money = (cents: number) =>
  "$" + (cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const DUE_LABEL: Record<string, string> = {
  deposit: "Deposit due",
  progress: "Payment due",
  final: "Final balance due",
  variation: "Variation payment due",
  standalone: "Amount due",
};

export default function PayBox({
  token, kind, number, balanceCents, bank, card, cancelled,
}: {
  token: string;
  kind: string;
  number: string | null;
  balanceCents: number;
  bank: Record<string, string>;
  /** Card option, present only when card payments are on. */
  card: { surchargeCents: number } | null;
  /** The customer came back from a cancelled card checkout. */
  cancelled: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);
  const reference = number ?? "your invoice number";

  // Back from a cancelled checkout: open straight onto the box so the bank
  // details are in front of them without another press.
  useEffect(() => {
    if (cancelled && ref.current && !ref.current.open) ref.current.showModal();
  }, [cancelled]);

  const open = () => ref.current?.showModal();
  const close = () => ref.current?.close();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reference);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked (http, permissions): the reference is still on screen.
    }
  };

  return (
    <div className="paybox paybox-cta no-print" data-testid="pay-cta">
      <h3>How to pay</h3>
      <button type="button" className="paybtn" onClick={open} data-testid="pay-button">
        Pay {money(balanceCents)}
      </button>
      <p className="fine">Opens our bank details and the reference to use.</p>

      <dialog ref={ref} className="paydialog" data-testid="pay-dialog" aria-labelledby="paydialog-title"
        onClick={(e) => { if (e.target === ref.current) close(); }}>
        <div className="paydialog-inner">
          <button type="button" className="paydialog-close" onClick={close} aria-label="Close">×</button>
          <div className="paydialog-due">
            <span id="paydialog-title">{DUE_LABEL[kind] ?? "Amount due"}</span>
            <b data-testid="pay-dialog-amount">{money(balanceCents)}</b>
          </div>
          {cancelled && (
            <p className="paydialog-note" data-testid="pay-cancelled">
              No card payment was taken. Pay by bank transfer below, or try the card again — whichever suits.
            </p>
          )}

          <h4>Bank transfer</h4>
          <div className="row"><span>Account name</span><b>{bank.accountName}</b></div>
          <div className="row"><span>Bank</span><b>{bank.bank}</b></div>
          {bank.bsb && <div className="row"><span>BSB</span><b>{bank.bsb}</b></div>}
          {bank.acc && <div className="row"><span>Account</span><b>{bank.acc}</b></div>}
          <div className="row ref-row">
            <span>Reference</span>
            <b data-testid="pay-dialog-reference">{reference}</b>
            {number && (
              <button type="button" className="copybtn" onClick={copy} data-testid="pay-copy-reference">
                {copied ? "Copied ✓" : "Copy"}
              </button>
            )}
          </div>
          <p className="fine">Please use the invoice number as the payment reference so we can match it straight away.</p>

          {card && (
            <div className="paydialog-card" data-testid="pay-panel">
              <h4>Or pay online by card</h4>
              <form method="post" action={`/i/${token}/checkout`}>
                <button type="submit" className="paybtn secondary">Pay {money(balanceCents + card.surchargeCents)} by card</button>
              </form>
              <p className="fine">
                Includes a card surcharge of {money(card.surchargeCents)} — avoid it by paying the
                bank-transfer amount of {money(balanceCents)} instead.
              </p>
            </div>
          )}

          <button type="button" className="paydialog-done" onClick={close}>Done</button>
        </div>
      </dialog>
    </div>
  );
}
