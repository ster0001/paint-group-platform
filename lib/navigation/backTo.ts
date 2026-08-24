/**
 * "Take me back where I came from", without trusting the URL.
 *
 * The builder is reached from several places now — the estimates list, a job in
 * Projects, the schedule — and the top-left link used to always say
 * "← Estimates", which is a lie and a lost trail when you arrived from a job to
 * set its colours. Callers pass `?from=<path>` and this turns it into a label.
 *
 * `from` arrives in a URL, so it is untrusted input. Only a same-site path is
 * accepted: it must start with a single "/" — "//evil.com" and
 * "https://evil.com" are protocol-relative and absolute URLs a browser would
 * happily leave the site for — and it must carry no scheme or backslash.
 * Anything else returns null and the caller falls back to its own default.
 */
export type BackTo = { href: string; label: string };

/** Longest prefix wins, so /pc/schedule beats /pc. */
const LABELS: [string, string][] = [
  ["/pc/schedule", "Back to the schedule"],
  ["/pc/updates", "Back to updates"],
  ["/pc/flow", "Back to project progress"],
  ["/pc/wo/", "Back to the job"],
  ["/pc", "Back to the dashboard"],
  ["/estimates", "Back to estimates"],
  ["/contacts", "Back to contacts"],
  ["/invoices", "Back to invoicing"],
  ["/invoicing", "Back to invoicing"],
];

export function parseBackTo(from: string | undefined): BackTo | null {
  if (!from) return null;

  // One leading slash, and nothing that could steer off-site.
  if (!from.startsWith("/") || from.startsWith("//")) return null;
  if (from.includes("\\") || from.includes(":")) return null;

  // A path only — drop any fragment, and cap the length so a junk query string
  // can't be smuggled through into the markup.
  const href = from.split("#")[0];
  if (href.length > 300) return null;

  const path = href.split("?")[0];
  const match = LABELS.find(([prefix]) => path === prefix || path.startsWith(prefix));
  return { href, label: match ? match[1] : "Back" };
}
