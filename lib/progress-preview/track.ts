/**
 * Tracking for the live-progress phone (brief v4 §8). Four events, each
 * once per type per page load — except `replayed`, which is every press.
 * Fire-and-forget through the estimate's own token route; a failed ping is
 * never the customer's problem. Safe to import from client and server (no
 * DOM at module scope).
 */
export const PROGRESS_PREVIEW_EVENTS = ["started", "completed", "replayed", "cta_clicked"] as const;
export type ProgressPreviewEvent = (typeof PROGRESS_PREVIEW_EVENTS)[number];

const sent = new Set<string>();

export function trackProgressPreview(token: string | null | undefined, event: ProgressPreviewEvent, set: "residential" | "commercial"): void {
  if (!token || typeof fetch !== "function") return;
  const key = `${token}:${event}`;
  if (event !== "replayed") {
    if (sent.has(key)) return;
    sent.add(key);
  }
  try {
    void fetch("/api/estimates/progress-preview", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, event, set }), keepalive: true,
    }).catch(() => undefined);
  } catch { /* tracking must never interrupt the page */ }
}

/** Test seam: forget what was sent (a new "page load"). */
export function resetProgressTracking(): void { sent.clear(); }
