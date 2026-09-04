/**
 * One `track(name, props)` for the marketing site (brief §5).
 *
 * Three listeners, in this order:
 *  1. a `pg:track` DOM event on window (what the e2e asserts on);
 *  2. the platform's own events table, ALWAYS — first-party, no consent
 *     needed — via POST /api/events (sendBeacon so navigation never loses
 *     one), carrying the visitor cookie so lead-source attribution can join
 *     a later wizard draft;
 *  3. Microsoft Clarity as a custom tag + event, ONLY when the visitor has
 *     allowed analytics and the tag has loaded (lib/marketing/clarity).
 *
 * Privacy rule (§5): the typed address leaves the browser on `see_price`
 * only. `address` is stripped from every other event here, and the sink
 * strips it again server-side.
 */
import { VISITOR_COOKIE, VISITOR_ID_RE, newVisitorId, readCookie, visitorCookie } from "./marketing/consent";

export type MarketingEventName =
  | "nav_cta"
  | "address_typed"
  | "address_selected"
  | "see_price"
  | "mode_home"
  | "mode_business"
  | "ghost_stopped"
  | "job_card"
  | "job_get_price"
  | "promise_0" | "promise_1" | "promise_2" | "promise_3"
  | "progress_story_start"
  | "progress_story_complete"
  | "progress_story_replay"
  | "painter_card"
  | "trade_walkthrough"
  | "trade_account"
  | "faq_open"
  | "call_tap"
  | "consent_choice";

export const MARKETING_EVENT_NAMES: readonly MarketingEventName[] = [
  "nav_cta", "address_typed", "address_selected", "see_price", "mode_home", "mode_business", "ghost_stopped",
  "job_card", "job_get_price", "promise_0", "promise_1", "promise_2", "promise_3",
  "progress_story_start", "progress_story_complete", "progress_story_replay",
  "painter_card", "trade_walkthrough", "trade_account", "faq_open", "call_tap", "consent_choice",
];

export type TrackProps = Record<string, string | number | boolean | null | undefined>;

export const TRACK_DOM_EVENT = "pg:track";
export const EVENTS_ENDPOINT = "/api/events";

export type TrackDetail = { name: MarketingEventName; props: TrackProps; at: number };

/** Only see_price may carry the address anywhere. */
export function scrubProps(name: MarketingEventName, props: TrackProps): TrackProps {
  const out: TrackProps = {};
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue;
    if (k === "address" && name !== "see_price") continue;
    out[k] = v;
  }
  return out;
}

/** The first-party visitor cookie, minted on first use. */
export function visitorId(): string | null {
  if (typeof document === "undefined") return null;
  try {
    const existing = readCookie(document.cookie, VISITOR_COOKIE);
    if (existing && VISITOR_ID_RE.test(existing)) return existing;
    const id = newVisitorId();
    document.cookie = visitorCookie(id, location.protocol === "https:");
    return id;
  } catch {
    return null;
  }
}

type ClarityFn = (cmd: "set" | "event" | "consent", ...args: unknown[]) => void;

export function track(name: MarketingEventName, rawProps: TrackProps = {}): void {
  if (typeof window === "undefined") return;
  const props = scrubProps(name, rawProps);
  const detail: TrackDetail = { name, props, at: Date.now() };
  window.dispatchEvent(new CustomEvent<TrackDetail>(TRACK_DOM_EVENT, { detail }));
  if (process.env.NODE_ENV !== "production") console.debug("[track]", name, props);

  // 2 · the platform's events table — always.
  try {
    const { address, ...rest } = props;
    const body = JSON.stringify({
      name, props: rest, path: location.pathname, visitorId: visitorId(),
      address: name === "see_price" && typeof address === "string" ? address : null,
    });
    const blob = new Blob([body], { type: "application/json" });
    if (!(navigator.sendBeacon && navigator.sendBeacon(EVENTS_ENDPOINT, blob))) {
      void fetch(EVENTS_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
    }
  } catch { /* logging never breaks the page */ }

  // 3 · Clarity — only present after consent (lib/marketing/clarity loads it).
  const clarity = (window as Window & { clarity?: ClarityFn }).clarity;
  if (typeof clarity === "function") {
    try {
      const { address: _a, ...safe } = props;
      void _a;
      clarity("event", name);
      clarity("set", name, JSON.stringify(safe));
    } catch { /* ditto */ }
  }
}
