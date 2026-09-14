"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Tom, 14 Sep (tighten batch, item 31): the moment everything is answered the
 * estimate SENDS ITSELF to the estimator — the same `accept_intent` the finish
 * line posts, so the confirmation request, the pack and the CRM event are the
 * ones every other path makes (C6 makes a repeat harmless). Never fires while
 * a reprice is still in flight, and never twice.
 */
export type AutoSendState = "idle" | "sending" | "sent" | "failed";

export function useAutoSend(estimateId: string, complete: boolean, quiet: boolean, alreadySent: boolean): AutoSendState {
  const [state, setState] = useState<AutoSendState>(alreadySent ? "sent" : "idle");
  const firing = useRef(false);
  useEffect(() => {
    if (!complete || !quiet || state !== "idle" || firing.current) return;
    firing.current = true;
    setState("sending");
    fetch(`/api/estimates/${estimateId}/wizard-edit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "accept_intent", view: "customer" }),
    })
      .then((r) => setState(r.ok ? "sent" : "failed"))
      .catch(() => setState("failed"))
      .finally(() => { firing.current = false; });
  }, [complete, quiet, state, estimateId]);
  return state;
}

/** The customer payload says an estimate was already sent: the "customer accepted online" deferral rides `confirmOnSite`. */
export function alreadySentFrom(confirmOnSite: readonly string[]): boolean {
  return confirmOnSite.some((n) => /customer accepted online/i.test(n));
}
