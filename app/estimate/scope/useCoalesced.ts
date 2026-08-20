"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * R5 (Tom, 20 Aug): "every click autosaves… can we speed this up or make it
 * feel more seamless."
 *
 * Two problems, one cause. Every tap on a +/− posted its own save, and the
 * saves run strictly in sequence (they read-modify-write one builder_state
 * row, so they must). Eight quick taps meant eight queued round trips —
 * measured at ~2.9s each on production, so roughly twenty seconds of
 * SAVING… for one impatient thumb. Worse, on the interior stepper each tap
 * computed its new count from the SERVER's count, which hadn't come back
 * yet, so the taps didn't just feel slow — they were silently lost.
 *
 * This coalesces a burst on one control into ONE save carrying the final
 * value. The UI still moves on every tap (the caller keeps an optimistic
 * value); only the network waits, and only briefly.
 *
 * `flush` exists because a debounce must never eat an answer: any action
 * that depends on the pending value — confirming a room, leaving the tab —
 * sends what is queued first, immediately.
 */
export function useCoalesced(delayMs = 400) {
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pending = useRef(new Map<string, () => void>());

  const flush = useCallback((key?: string) => {
    const keys = key != null ? [key] : [...pending.current.keys()];
    for (const k of keys) {
      const timer = timers.current.get(k);
      if (timer) clearTimeout(timer);
      timers.current.delete(k);
      const fire = pending.current.get(k);
      pending.current.delete(k);
      fire?.();
    }
  }, []);

  /** Queue `fire` for `key`; a later call on the same key replaces it, so
   * the LAST value in a burst is the one that reaches the server. */
  const queue = useCallback((key: string, fire: () => void) => {
    const existing = timers.current.get(key);
    if (existing) clearTimeout(existing);
    pending.current.set(key, fire);
    timers.current.set(key, setTimeout(() => {
      timers.current.delete(key);
      const f = pending.current.get(key);
      pending.current.delete(key);
      f?.();
    }, delayMs));
  }, [delayMs]);

  useEffect(() => {
    // Backgrounding a tab (or closing it on a phone) must not swallow a
    // queued change — send it the moment the page stops being visible.
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      for (const t of timers.current.values()) clearTimeout(t);
    };
  }, [flush]);

  return { queue, flush };
}
