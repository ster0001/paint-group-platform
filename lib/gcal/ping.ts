// Client-safe. Booking transitions happen as browser → Postgres RPC calls, so
// after a successful RPC the component fires this ping and the server
// reconciles the contractor's Google Calendar. Fire-and-forget by design: the
// booking is already recorded, and a lost ping is healed by the next one or
// by the nightly cron — so no await, no error surface, no retry.

/** Contractors ping with no argument (the server syncs the caller); staff pass
 *  the contractor — or the booking offer — they just changed. */
export function pingGcalSync(target?: { contractorId?: string; offerId?: string }): void {
  try {
    void fetch("/api/gcal/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(target ?? {}),
      keepalive: true, // survives the router.refresh() that usually follows
    }).catch(() => undefined);
  } catch {
    // Never let calendar sync interfere with the booking flow.
  }
}
