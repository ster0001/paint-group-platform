import { cache } from "react";

/**
 * The clock, read ONCE per request and stable for the whole render.
 *
 * Why this exists (F1, audit finding F0-01): server components were calling
 * `Date.now()` inline while deciding what to show — whether an offer had
 * expired, whether a MYOB token was still fresh. `react-hooks/purity` flags
 * that, and it is right to: a value that changes between two reads inside one
 * render can make a component disagree with itself.
 *
 * `cache()` is per-request in the React server runtime, so every caller in a
 * single render sees the SAME instant. That makes the read genuinely stable
 * rather than merely hidden from the linter — an offer cannot be live at the
 * top of the page and expired at the bottom.
 *
 * Server components and route handlers only. Client components should take the
 * time as a prop, so the server stays the one clock.
 *
 * Dates: this returns an instant, not a calendar day. For a Melbourne calendar
 * day use the Intl formatters — CLAUDE.md's rule stands, `toISOString()`
 * .slice(0,10) is the UTC date and is wrong before 10am here.
 */
export const requestNow = cache((): Date => new Date());

/** The same instant as `requestNow()`, in epoch milliseconds. */
export const requestNowMs = cache((): number => requestNow().getTime());
