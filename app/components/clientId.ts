/**
 * A random id for the browser — a Places session token, a page-view session.
 *
 * `crypto.randomUUID()` exists only in a SECURE context (https or localhost)
 * and only from iOS Safari 15.4. Called bare, it threw "crypto.randomUUID is
 * not a function" on an older iPhone, and over the wifi address a phone check
 * uses (plain http), and the estimate page crashed to "This page couldn't
 * load" before its first screen (10 Oct 2026). `getRandomValues` is available
 * everywhere, secure or not, so it is the fallback.
 */
export function clientId(): string {
  const c: Crypto | undefined = typeof crypto !== "undefined" ? crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
