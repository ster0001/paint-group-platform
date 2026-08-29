/**
 * Capturing the touch, in the browser (session 2.4).
 *
 * Runs on any page a customer can arrive at. The first touch is written once
 * and kept — a repaint is thought about for weeks, so the arrival that started
 * it is usually not the arrival that finishes it.
 *
 * Storage is localStorage, deliberately: a cookie would ride on every request
 * to every route for a value only the wizard submit needs, and this is not
 * personal data — it is which advert they clicked.
 */

import { attributionSchema, recordTouch, touchFromLocation, type Attribution } from "./attribution";

const KEY = "pg_attribution_v1";

/** Read what is stored, tolerating anything a browser or a person did to it. */
export function readAttribution(): Attribution | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = attributionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;   // private mode, a full disk, a hand-edited value
  }
}

/**
 * Record this arrival and return the updated pair. Safe to call on every page
 * load: the first touch only ever writes itself once.
 */
export function captureTouch(now: Date = new Date()): Attribution | null {
  if (typeof window === "undefined") return null;
  try {
    const touch = touchFromLocation(now, window.location, document.referrer || null);
    const next = recordTouch(readAttribution(), touch);
    window.localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  } catch {
    return null;   // never let a marketing tag break a customer's estimate
  }
}
