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

/** After a tap on a tel: link — the dialler has opened; count the call. */
export function afterTelTap(back: string = here()): void {
  if (typeof window === "undefined") return;
  window.setTimeout(() => goThanks("call-tap", back), 700);
}

/** A tap on a phone link inside the wizard or an estimate page: counted behind the page (leaving would lose their place). */
export function countCallTap(): void {
  countInBackground("call-tap", String(Date.now()));
}
