/**
 * One `track(name, props)` for the marketing site (brief §5).
 *
 * Session 1 ships the API and the event names; session 7 attaches the
 * providers (Microsoft Clarity after consent, and the platform's crm_events
 * table regardless). Until then every call is observable two ways so the
 * e2e can assert on it: a `pg:track` DOM event on window, and a console
 * line outside production.
 *
 * Privacy rule (§5): no event carries the typed address except `see_price`.
 * Callers pass `where`/`mode`/indexes — never the field's text.
 */
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
  | "call_tap";

export type TrackProps = Record<string, string | number | boolean | null | undefined>;

export const TRACK_DOM_EVENT = "pg:track";

export type TrackDetail = { name: MarketingEventName; props: TrackProps; at: number };

export function track(name: MarketingEventName, props: TrackProps = {}): void {
  if (typeof window === "undefined") return;
  const detail: TrackDetail = { name, props, at: Date.now() };
  window.dispatchEvent(new CustomEvent<TrackDetail>(TRACK_DOM_EVENT, { detail }));
  if (process.env.NODE_ENV !== "production") console.debug("[track]", name, props);
}
