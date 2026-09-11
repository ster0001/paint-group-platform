"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DeskCheckOutcome } from "@/lib/wizard/desk-check";

/**
 * C7b (brief 3.1) — the strip's three buttons: Fix the price and send · Ask a
 * question · Book a visit. Each POSTs to the C6 route
 * (`/api/confirmations/[id]`) UNCHANGED — the route holds the policy
 * (`canAct`), the conditional write, the measured-tree hand-back and the CRM
 * event. This component knows nothing except which button was pressed.
 *
 * The recommended one is highlighted and nothing more: an estimator can
 * always pick another. Whether fixing is eligible was decided on the server
 * (`pack.verdict`) and arrives as a prop; the button is still offered when it
 * is not, because overriding the rule is a person's call — the route still
 * refuses anything the row's status forbids.
 */
export default function StripActions({
  requestId, recommended, eligible,
}: {
  requestId: string;
  recommended: DeskCheckOutcome;
  eligible: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");

  async function post(action: "fix_price" | "ask_question" | "book_visit", extra: Record<string, unknown> = {}) {
    setBusy(action);
    setMsg(null);
    try {
      const r = await fetch(`/api/confirmations/${requestId}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string; repeated?: boolean; status?: string; fixedPriceCents?: number | null };
      if (!r.ok) { setMsg(j.error ?? "That didn't go through."); return; }
      setMsg(
        action === "fix_price" ? (j.repeated ? "Already fixed." : "Price fixed and sent.")
        : action === "ask_question" ? "Question sent — it's on their thread."
        : (j.repeated ? "Already booked." : "Visit booked — the diary has it."),
      );
      setAsking(false);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const btn = (key: DeskCheckOutcome, label: string, onClick: () => void, title?: string) => (
    <button
      type="button"
      onClick={onClick}
      disabled={busy != null}
      title={title}
      data-testid={`strip-${key}`}
      data-recommended={key === recommended ? "1" : undefined}
      className={`rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
        key === recommended ? "border-gray-900 bg-gray-900 text-white hover:bg-gray-800" : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
      }`}
    >
      {busy === (key === "fix" ? "fix_price" : key === "ask" ? "ask_question" : "book_visit") ? "…" : label}
    </button>
  );

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="strip-actions">
      {btn("fix", "Fix the price and send", () => post("fix_price"), eligible ? undefined : "Outside what we fix remotely — sending is an override")}
      {btn("ask", "Ask a question", () => setAsking((v) => !v))}
      {btn("visit", "Book a visit", () => post("book_visit"))}
      {asking && (
        <form
          className="flex w-full items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); if (question.trim()) void post("ask_question", { question: question.trim() }); }}
        >
          <input
            autoFocus
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="What do you need to know?"
            className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm"
            data-testid="strip-question"
            maxLength={2000}
          />
          <button type="submit" disabled={!question.trim() || busy != null} className="rounded-md bg-gray-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50">Send</button>
        </form>
      )}
      {msg && <span className="text-xs text-gray-600" data-testid="strip-msg">{msg}</span>}
    </div>
  );
}
