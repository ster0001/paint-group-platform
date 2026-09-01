// Client-safe — the gcal ping's twin (Tom, 1 Sep). After a contractor accepts
// a booking in the browser, this asks the server to send the customer their
// appointment-confirmation email + the walkthrough calendar invites.
// Fire-and-forget: the sends are idempotent server-side and the nightly sweep
// backstops a lost ping.

export function pingAppointmentConfirm(workOrderId: string): void {
  try {
    void fetch("/api/appointments/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workOrderId }),
      keepalive: true, // survives the router.refresh() that usually follows
    }).catch(() => undefined);
  } catch {
    // Never let the confirmation email interfere with the accept flow.
  }
}
