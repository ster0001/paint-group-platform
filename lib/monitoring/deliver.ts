/**
 * A4-03 · Getting an error to a human.
 *
 * `reportError` has been the one reporting seam since the first audit, adopted
 * by 37 files — and it wrote to `console` and stopped. On Vercel that is a log
 * nobody reads. The August 2026 audit's §7 asks for monitoring that ALERTS A
 * HUMAN; nothing alerted anyone.
 *
 * §8.6 (provider and budget) is Tom's decision and is still open, so this does
 * not pick a vendor. It posts a compact JSON payload to whatever URL is in
 * `ERROR_WEBHOOK_URL` — a Slack or Discord incoming webhook, a collector, an
 * n8n hook, anything that speaks HTTP. Five minutes to point somewhere real,
 * no dependency, no lock-in, and it satisfies the criterion today. When a
 * provider IS chosen, this file is where it plugs in.
 *
 * Three properties this must have, because a monitor that breaks the thing it
 * is monitoring is worse than none:
 *
 *   - it never throws;
 *   - it never blocks the request (fire-and-forget, with a short timeout);
 *   - it never carries PII or money. `ErrorContext.extra` already documents
 *     that rule; this strips known-dangerous keys as a second line, because a
 *     documented rule and an enforced one are different things (A4's own
 *     finding: the PII contract is written down and nothing checks it).
 */

/** Keys that must never leave the process, whatever a caller put in `extra`. */
const FORBIDDEN = /email|phone|mobile|address|name|token|password|secret|key|bsb|acc(ount)?|card|abn|amount|cents|price|total/i;

function scrub(extra: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!extra) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(extra)) {
    if (FORBIDDEN.test(k)) { out[k] = "[redacted]"; continue; }
    // Values are stringified and capped: an object of unknown depth is how a
    // customer record ends up in a log by accident.
    const s = typeof v === "string" ? v : JSON.stringify(v);
    out[k] = typeof s === "string" && s.length > 200 ? s.slice(0, 200) + "…" : s;
  }
  return out;
}

export type Delivery = { where: string; message: string; bestEffort: boolean; extra: Record<string, unknown> };

/**
 * Post the report. Returns immediately; failures are swallowed by design —
 * there is nowhere left to report a reporting failure to.
 */
export function deliver(report: Delivery): void {
  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url) return;                     // not configured: console only, as before
  if (typeof fetch !== "function") return;

  const body = JSON.stringify({
    // `text` so a Slack/Discord incoming webhook renders something useful with
    // no mapping; the structured fields ride alongside for anything smarter.
    text: `${report.bestEffort ? "⚠️" : "🚨"} [${report.where}] ${report.message}`,
    where: report.where,
    message: report.message,
    bestEffort: report.bestEffort,
    extra: scrub(report.extra),
    env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
    at: new Date().toISOString(),
  });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    }).catch(() => {}).finally(() => clearTimeout(timer));
  } catch {
    // Never let reporting break the thing it is reporting on.
  }
}
