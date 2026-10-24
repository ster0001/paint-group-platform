/**
 * The public switch for the online estimator (Settings → Estimates → Online
 * estimates). One settings row, `wizard_public`, read by /estimate:
 *
 *   enabled       false = the public sees the holding page; staff previews
 *                 and signed-in members always get the wizard (B4 ruling).
 *   holdingTitle  the holding page's headline
 *   holdingBody   the line under it — the callback form sits below both
 *
 * Before 7 Sep 2026 the row was `{ enabled }` alone and only SQL could flip
 * it. Missing fields fall back to the wording the page has always shown, so
 * an old row keeps reading exactly as it did.
 */

export const WIZARD_PUBLIC_KEY = "wizard_public";

export type OnlineEstimates = {
  enabled: boolean;
  /** Paint Home brief + Tom, 25 Oct 2026: the Paint Home door has its own switch — LIVE unless switched off; Paint Group keeps `enabled`. */
  enabledPaintHome: boolean;
  holdingTitle: string;
  holdingBody: string;
};

export const DEFAULT_ONLINE_ESTIMATES: OnlineEstimates = {
  enabled: false,
  enabledPaintHome: true,
  holdingTitle: "Online estimates are nearly here",
  holdingBody:
    "We’re putting the finishing coats on. Leave your details below and we’ll call you with a price the old-fashioned way — quickly.",
};

const MAX_TITLE = 120;
const MAX_BODY = 600;

/** The settings value → a complete object; anything unusable falls back. */
export function onlineEstimatesFrom(value: unknown): OnlineEstimates {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const title = typeof v.holdingTitle === "string" ? v.holdingTitle.trim().slice(0, MAX_TITLE) : "";
  const body = typeof v.holdingBody === "string" ? v.holdingBody.trim().slice(0, MAX_BODY) : "";
  return {
    enabled: v.enabled === true,
    enabledPaintHome: v.enabledPaintHome !== false,
    holdingTitle: title || DEFAULT_ONLINE_ESTIMATES.holdingTitle,
    holdingBody: body || DEFAULT_ONLINE_ESTIMATES.holdingBody,
  };
}

/** Is the public wizard open for this shopfront? Paint Home and Paint Group are switched separately (Tom, 25 Oct 2026). */
export function wizardOpenFor(o: OnlineEstimates, brand: "paintgroup" | "painthome"): boolean {
  return brand === "painthome" ? o.enabledPaintHome : o.enabled;
}
