import { wizardStateShapeSchema, type WizardState } from "./state";
import { pageLabel } from "./journey";

/**
 * Save-and-return on the same device (Phase 1 of the 6 Sep estimator plan).
 *
 * The wizard's answers lived only in React state: a reload, the back button
 * or a phone locking for too long wiped every page. The browser now keeps a
 * copy of the answers as the customer goes, and the wizard puts them back on
 * the next visit — with a "Welcome back, you were at Surfaces" line and a
 * way to start again.
 *
 * This module is the pure part: the record, its freshness rule, and the
 * one judgement call — a visitor who arrives from the homepage with a
 * DIFFERENT address is starting a new job, not resuming the old one.
 */

export const RESUME_KEY = "pg-wizard-resume-v1";
/** After this long an unfinished walk is a memory, not a draft. */
export const RESUME_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
/**
 * "Start again" on this device. The browser copy is simply removed, but the
 * SERVER copy (any device) was written before the restart and would come
 * straight back on the next reload — the 7 Sep C1 run caught exactly that.
 * The restart moment is kept here, and a server copy saved at or before it
 * is not a resume; the open draft row is reset server-side as well.
 */
export const RESTART_KEY = "pg-wizard-restarted-v1";
export function restartedSince(savedAt: string, restartedAt: string | null | undefined): boolean {
  if (!restartedAt) return false;
  const r = new Date(restartedAt).getTime();
  const s = new Date(savedAt).getTime();
  return Number.isFinite(r) && Number.isFinite(s) && s <= r;
}

export type SafetyAnswered = { heritage: boolean; pre1970: boolean; asbestos: boolean };

export type ResumeRecord = {
  v: 1;
  savedAt: string;
  page: number;
  state: WizardState;
  answered: SafetyAnswered;
  /** The address as typed (the structured pick lives in state.address). */
  addressText: string;
  /**
   * C3 — the `wizard_drafts.version` this copy is based on, when it is known.
   *
   * Before C3 the browser copy and the server copy were reconciled by comparing
   * `savedAt` timestamps, which made the browser a THIRD truth: two devices with
   * skewed clocks would pick the wrong winner, and neither would notice. The
   * version is the server's own counter, so "who is ahead" stops being a
   * question about clocks.
   *
   * Absent means "written before C3, or written between a keystroke and the
   * first server confirmation" — the resume falls back to the timestamp rule for
   * those, which is what it always did.
   */
  version?: number;
  /**
   * C3 — `wizard_drafts.last_screen`, the screen they were actually on
   * ("quick:place", "page:surfaces").
   *
   * The resume used to infer the screen from the state alone, via
   * `entryFromState`, which keys on `state.quickLook`. That key only appears
   * once the customer ANSWERS a quick-look question — so someone who typed an
   * address, pressed Continue and closed the tab came back to the page set,
   * with the banner cheerfully saying "you were at The place". The screen they
   * were on is not something to infer when the server can simply record it.
   */
  lastScreen?: string | null;
};

export function encodeResume(r: Omit<ResumeRecord, "v">): string {
  return JSON.stringify({ v: 1, ...r });
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * The stored record → what the wizard should put back, or null when there is
 * nothing worth resuming: missing, malformed, stale, still on page 1 with no
 * property typed, or for a different address than the one arriving now.
 */
export function decodeResume(
  raw: string | null | undefined,
  now: Date,
  opts: { incomingAddress?: string | null } = {},
): Omit<ResumeRecord, "v"> | null {
  if (!raw) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  const r = (parsed && typeof parsed === "object" ? parsed : {}) as Partial<ResumeRecord>;
  if (r.v !== 1 || typeof r.savedAt !== "string" || typeof r.page !== "number") return null;
  const savedAt = new Date(r.savedAt).getTime();
  if (!Number.isFinite(savedAt) || now.getTime() - savedAt > RESUME_MAX_AGE_MS) return null;
  const state = wizardStateShapeSchema.safeParse(r.state);
  if (!state.success) return null;
  const s = state.data as WizardState;
  const suburb = (s.customer?.suburb ?? "").trim();
  const addressText = typeof r.addressText === "string" ? r.addressText : (s.address?.formatted ?? "");
  if (r.page < 2 && !suburb && !addressText.trim()) return null;
  const incoming = (opts.incomingAddress ?? "").trim();
  if (incoming) {
    const inc = norm(incoming);
    const savedAddr = norm(addressText || s.address?.formatted || "");
    // A typed address compares as an address; a walk that only ever typed a
    // suburb compares by that suburb. Either way, a different place = new job.
    const same = savedAddr
      ? inc === savedAddr || savedAddr.startsWith(inc) || inc.startsWith(savedAddr)
      : suburb ? inc.includes(norm(suburb)) : true;
    if (!same) return null;
  }
  const a = (r.answered && typeof r.answered === "object" ? r.answered : {}) as Partial<SafetyAnswered>;
  return {
    savedAt: r.savedAt,
    page: Math.max(1, Math.min(6, Math.floor(r.page))),
    state: s,
    answered: { heritage: a.heritage === true, pre1970: a.pre1970 === true, asbestos: a.asbestos === true },
    addressText,
    // C3 — both of these must survive the round trip. This function rebuilds
    // the record field by field, so a new field that is not named here is
    // silently dropped: the cache kept its version and its screen, and the
    // decoder threw them away on the way back in. That is how the refresh test
    // failed with every other piece already in place.
    ...(typeof r.version === "number" ? { version: r.version } : {}),
    ...(typeof r.lastScreen === "string" && r.lastScreen ? { lastScreen: r.lastScreen } : {}),
  };
}

/** "you were at Surfaces" — the banner's line, in the wizard's own page names. */
export function resumeLine(page: number, jobType: string | null | undefined): string {
  return page <= 1 ? "your answers are back" : `you were at ${pageLabel(jobType, page)}`;
}

/**
 * The SERVER copy of a walk (Tom, 7 Sep 2026): the autosaved wizard_drafts row
 * for this signed-in or anonymous user — the way back into a half-finished
 * estimate from another device, or after the browser copy is gone. Same
 * freshness rule as the browser copy; the safety taps count as answered once
 * the walk got past the page that asked them.
 */
export type ServerDraftRow = {
  state: unknown;
  current_page?: number | null;
  furthest_page?: number | null;
  last_seen_at?: string | null;
  converted_at?: string | null;
  /** C3 — carried through so the client's first write has a predicate. */
  version?: number | null;
  /** C3 — the screen they were on, so the resume does not have to infer it. */
  last_screen?: string | null;
};

export function serverResumeFrom(row: ServerDraftRow | null | undefined, now: Date, maxAgeMs: number = RESUME_MAX_AGE_MS): Omit<ResumeRecord, "v"> | null {
  if (!row || row.converted_at) return null;
  const seen = row.last_seen_at ? new Date(row.last_seen_at).getTime() : NaN;
  if (!Number.isFinite(seen) || now.getTime() - seen > maxAgeMs) return null;
  const parsed = wizardStateShapeSchema.safeParse(row.state);
  if (!parsed.success) return null;
  const s = parsed.data as WizardState;
  const furthest = Math.max(1, Number(row.furthest_page) || Number(row.current_page) || 1);
  const page = Math.max(1, Math.min(6, Number(row.current_page) || furthest));
  const suburb = (s.customer?.suburb ?? "").trim();
  if (page < 2 && !suburb && !s.address) return null;
  return {
    savedAt: new Date(seen).toISOString(),
    page,
    state: s,
    answered: { heritage: furthest >= 2, pre1970: furthest >= 5, asbestos: furthest >= 5 },
    addressText: s.address?.formatted ?? "",
    ...(typeof row.version === "number" ? { version: row.version } : {}),
    ...(row.last_screen ? { lastScreen: row.last_screen } : {}),
  };
}

/**
 * Which copy resumes — C3.
 *
 * Before C3 this was `new Date(local.savedAt) >= new Date(server.savedAt)`:
 * two clocks, on two devices, deciding which half-finished quote a customer
 * gets back. Clock skew picked the loser silently and there was no way to tell
 * afterwards. `wizard_drafts.version` is the server's own counter, so the
 * question stops being about time.
 *
 *   · same version — the browser copy is the server's, plus whatever was typed
 *     in the seconds before the last autosave landed. It wins: it is a superset.
 *   · browser behind — the server has writes this device never saw (the other
 *     tab, the other phone, a staff member in an assisted session). The server
 *     wins. Anything typed here on the older ancestor is given up deliberately
 *     rather than merged blind, because there is no common ancestor to merge
 *     against at this point in the load and a wrong merge is worse than a
 *     resume the customer can see is behind.
 *   · no version on either side — a cache written before C3. Fall back to the
 *     old timestamp rule, which is what those copies were written under.
 *
 * Returns which one, so the caller can adopt its version for the next write.
 */
export function pickResume<T extends { savedAt: string; version?: number }>(
  local: T | null,
  server: T | null,
): { pick: T | null; from: "local" | "server" | "none"; why: string } {
  if (!local && !server) return { pick: null, from: "none", why: "nothing to resume" };
  if (!local) return { pick: server, from: "server", why: "no browser copy" };
  if (!server) return { pick: local, from: "local", why: "no server copy" };

  if (typeof local.version === "number" && typeof server.version === "number") {
    if (local.version === server.version) {
      return { pick: local, from: "local", why: "same version — the browser copy is the server's plus unsaved edits" };
    }
    if (local.version < server.version) {
      return { pick: server, from: "server", why: `browser copy is behind (v${local.version} < v${server.version})` };
    }
    // A client cannot invent a version ahead of the server; treat it as local.
    return { pick: local, from: "local", why: "browser copy claims a newer version" };
  }

  const newer = new Date(local.savedAt) >= new Date(server.savedAt);
  return newer
    ? { pick: local, from: "local", why: "pre-C3 copy, newer by timestamp" }
    : { pick: server, from: "server", why: "pre-C3 copy, older by timestamp" };
}

