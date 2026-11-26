/**
 * Success URLs for paid marketing (Tom, 17 Nov 2026). Client-safe.
 *
 * Every success moment has its own page, /thanks/<moment>, so an ad
 * platform's "URL contains" rule can count it as a conversion. Two ways in:
 *
 *   goThanks(moment)            the page loads, says thank you, and returns
 *                               the customer to where they were — the deposit
 *                               paid (on the way back from Stripe) and a call
 *                               tap on the marketing site
 *   countInBackground(moment)   the page loads in a hidden same-site frame and
 *                               the customer never leaves — everywhere the
 *                               page they are on holds its own result (Tom,
 *                               17 Nov: the range — the wizard cannot come back
 *                               to the price; and by the same reason a visit,
 *                               a call or a message asked for in the wizard or
 *                               the visit page, the chat, a phone tap there,
 *                               and the estimate just signed, whose "download
 *                               what you signed" would be lost). Once per key
 *                               in a session.
 *
 * A tap on our phone number dials first, always; `afterTelTap` then moves the
 * page through /thanks/call-tap a moment later, so the call is never at risk.
 * The page records the moment in our own events (no consent needed) and
 * loads the Meta pixel / Google tag only after "Allow analytics"
 * (lib/marketing/adTags.ts).
 */
export const SUCCESS_MOMENTS = {
  range: { title: "Your price range is ready", line: "Thanks — your range is saved." },
  visit: { title: "Thanks — we have your visit", line: "We'll confirm the time with you shortly." },
  call: { title: "Thanks — we'll call you", line: "Someone from the team will ring you back." },
  "call-tap": { title: "Calling us now", line: "If the call didn't start, you can ring us from the button below." },
  message: { title: "Thanks — your message is in", line: "We'll get back to you as soon as we can." },
  accepted: { title: "Thank you — your estimate is accepted", line: "We'll be in touch about your start date and your painter." },
  "deposit-paid": { title: "Thank you — your deposit is paid", line: "Your start date is held." },
  // Tom, 18 Nov 2026: every trigger has one — the details given (a lead), the estimate saved for later, the quote
  // range settled, the estimate sent to the estimator, the price fixed online. All counted behind the page.
  lead: { title: "Thanks — we have your details", line: "Your price range is on its way." },
  saved: { title: "Your estimate is saved", line: "We've emailed you the link back to it." },
  quote: { title: "Your quote range is ready", line: "Thanks — it's saved with your estimate." },
  sent: { title: "Thanks — your estimate is with your estimator", line: "They'll check it and come back to you." },
  fixed: { title: "Your price is fixed", line: "Nothing to pay now — we'll be in touch about a start." },
} as const;
export type SuccessMoment = keyof typeof SUCCESS_MOMENTS;
export const SUCCESS_MOMENT_KEYS = Object.keys(SUCCESS_MOMENTS) as SuccessMoment[];
export const isSuccessMoment = (v: unknown): v is SuccessMoment => typeof v === "string" && Object.prototype.hasOwnProperty.call(SUCCESS_MOMENTS, v);

/** Only a path on this site — never another site (an open redirect). */
export function safeBack(back: string | null | undefined): string {
  const b = (back ?? "").trim();
  return b.startsWith("/") && !b.startsWith("//") && !b.startsWith("/\\") && !/^\/+[a-z]+:/i.test(b) ? b : "/";
}

export function thanksHref(moment: SuccessMoment, back: string): string {
  return `/thanks/${moment}?back=${encodeURIComponent(safeBack(back))}`;
}

const here = () => (typeof window === "undefined" ? "/" : `${window.location.pathname}${window.location.search}${window.location.hash}`);

/** The page, then back to `back` (default: where they are now). */
export function goThanks(moment: SuccessMoment, back: string = here()): void {
  if (typeof window === "undefined") return;
  window.location.assign(thanksHref(moment, back));
}

/** The page in a hidden same-site frame; the customer stays. Once per `onceKey` per browser session. */
export function countInBackground(moment: SuccessMoment, onceKey: string): void {
  if (typeof document === "undefined") return;
  const key = `pg-thanks:${moment}:${onceKey}`;
  try { if (window.sessionStorage.getItem(key)) return; window.sessionStorage.setItem(key, "1"); } catch { /* storage blocked: count anyway */ }
  const f = document.createElement("iframe");
  f.src = `/thanks/${moment}?bg=1`;
  f.title = "";
  f.setAttribute("aria-hidden", "true");
  f.tabIndex = -1;
  f.style.cssText = "position:absolute;width:1px;height:1px;border:0;left:-9999px;top:-9999px;";
  f.dataset.testid = `thanks-bg-${moment}`;
  document.body.appendChild(f);
  // The tags have fired well within this; the frame goes so it never lingers.
  window.setTimeout(() => f.remove(), 15_000);
}

/**
 * A lead (26 Nov 2026, the GTM tracking brief): contact details the server has
 * ACCEPTED — the wizard's verified mobile, the talk-to-us sheet, a call-back
 * box, the visit booking's details. One `pg_success` / `success_moment: lead`
 * per mobile number per browser, ever: the key lives in localStorage, so a
 * refresh, a second form, or the same person coming back never counts twice.
 * The number itself goes nowhere — the key is a hash, and the data layer
 * carries only the moment. Null for anything that is not a phone number.
 */
export function leadKey(mobile: string | null | undefined): string | null {
  let d = (mobile ?? "").replace(/\D/g, "");
  if (d.startsWith("61") && d.length === 11) d = `0${d.slice(2)}`;
  if (d.length < 8 || d.length > 15) return null;
  let h = 0x811c9dc5; // FNV-1a, 32-bit: a fingerprint, not a secret
  for (let i = 0; i < d.length; i++) { h ^= d.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `m${h.toString(36)}`;
}

/** Call only AFTER the server said yes. Counts the lead once per mobile per browser (see leadKey). */
export function countLead(mobile: string | null | undefined): void {
  countLeadKey(leadKey(mobile));
}

/** The same, from a key the server computed (the website chat hands back `lead`, never the number). */
export function countLeadKey(k: string | null | undefined): void {
  if (!k || !/^m[a-z0-9]{1,13}$/.test(k) || typeof window === "undefined") return;
  try { if (window.localStorage.getItem(`pg-lead:${k}`)) return; window.localStorage.setItem(`pg-lead:${k}`, "1"); } catch { /* storage blocked: the session guard below still holds */ }
  countInBackground("lead", k);
}

/** After a tap on a tel: link — the dialler has opened; count the call. */
export function afterTelTap(back: string = here()): void {
  if (typeof window === "undefined") return;
  window.setTimeout(() => goThanks("call-tap", back), 700);
}

/** A tap on a phone link inside the wizard or an estimate page: counted behind the page (leaving would lose their place). */
export function countCallTap(): void {
  countInBackground("call-tap", String(Date.now()));
}
