"use client";

import { money } from "@/lib/format/money";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The customer's card-payment corner of the invoice page.
 *
 * Two jobs: the "Pay now" click (a plain form POST — the server mints a
 * fresh Checkout Session and redirects), and the §5.3 return state:
 * "Confirming your payment…" POLLS the read-only status route and never
 * claims success the database can't back. If the webhook hasn't landed in
 * 60 seconds, it says the payment is processing and the receipt will
 * arrive by email — it does not guess.
 */


export default function PayPanel({
  token, balanceCents, surchargeCents, payState, initialPaidCents,
}: {
  token: string;
  balanceCents: number;
  surchargeCents: number;
  payState: "success" | "cancelled" | null;
  initialPaidCents: number;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<"checking" | "confirmed" | "processing" | null>(
    payState === "success" ? "checking" : null,
  );
  const started = useRef<number | null>(null);

  useEffect(() => {
    if (confirm !== "checking") return;
    started.current ??= Date.now();
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/i/${token}/status`, { cache: "no-store" });
        if (res.ok) {
          const s = (await res.json()) as { status: string; paidCents: number };
          if (s.status === "paid" || s.paidCents > initialPaidCents) {
            setConfirm("confirmed");
            clearInterval(timer);
            router.refresh();
            return;
          }
        }
      } catch {
        // keep polling — the timeout below is the answer for a dead network
      }
      if (Date.now() - (started.current ?? Date.now()) > 60_000) {
        setConfirm("processing");
        clearInterval(timer);
      }
    }, 2_500);
    return () => clearInterval(timer);
  }, [confirm, token, initialPaidCents, router]);

  if (confirm === "checking") {
    return (
      <div className="paycard no-print" data-testid="pay-confirming">
        <h3>Confirming your payment…</h3>
        <p>One moment — we&rsquo;re waiting for the bank to confirm. This page will update by itself.</p>
      </div>
    );
  }
  if (confirm === "confirmed") {
    return (
      <div className="paycard ok no-print" data-testid="pay-confirmed">
        <h3>Payment received — thank you</h3>
        <p>Your receipt is on its way by email, and the invoice above now shows the payment.</p>
      </div>
    );
  }
  if (confirm === "processing") {
    return (
      <div className="paycard no-print" data-testid="pay-processing">
        <h3>Your payment is processing</h3>
        <p>It can take a little while to confirm. Your receipt will arrive by email — there&rsquo;s no need to pay again.</p>
      </div>
    );
  }

  if (balanceCents <= 0) return null;
  return (
    <div className="paycard no-print" data-testid="pay-panel">
      <h3>Pay online by card</h3>
      {payState === "cancelled" && (
        <p>No payment was taken. You can try again below, or use the bank transfer details — whichever suits.</p>
      )}
      <form method="post" action={`/i/${token}/checkout`}>
        <button type="submit" className="paybtn">Pay {money(balanceCents + surchargeCents)} by card</button>
      </form>
      <p className="fine">
        Includes a card surcharge of {money(surchargeCents)} — avoid it by paying the
        bank-transfer amount of {money(balanceCents)} instead.
      </p>
    </div>
  );
}
