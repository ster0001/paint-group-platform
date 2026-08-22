/**
 * S0: the customer's anonymous session, lifted out of the effect body so the
 * two ways it fails are testable rather than only reachable on a real phone.
 *
 * Three faults this module exists to close (workflow audit, 23 Aug 2026):
 *
 *  1. A failed `signInAnonymously` used to leave the wizard "not ready" for
 *     ever — no retry, no way back short of reloading the page. Sign-in now
 *     gets a bounded set of attempts, and a failure is a state the UI can
 *     offer a "Try again" control against.
 *  2. The call had no deadline. A stalled request on a phone is the NORMAL
 *     case on site (see `lib/capture/draft-store.ts`), not an exception, so an
 *     un-timed promise meant the customer sat on a spinner that could never
 *     resolve. Every attempt now races a deadline and a stall becomes a
 *     visible error like any other failure.
 *  3. Page 1 was handed `uploading || !sessionReady` as one boolean, so its
 *     upload button said "Uploading…" when the real reason it was disabled
 *     was the session and no file had been chosen. `busyReason` keeps the two
 *     apart, and the labels below read from it rather than from a conflation.
 */

export type SessionPhase = "connecting" | "ready" | "failed";

/** Why a failed attempt failed — worth distinguishing because a stall and a
 *  refusal look identical to the customer but not to us. */
export type SessionFailure = "timeout" | "error";

export type SessionOutcome =
  | { phase: "ready" }
  | { phase: "failed"; reason: SessionFailure; attempts: number };

/** Generous enough for a slow 3G handshake, short enough that a stalled
 *  request becomes an error the customer can act on rather than a spinner. */
export const SESSION_TIMEOUT_MS = 8_000;

/** Total attempts per run, including the first. */
export const SESSION_ATTEMPTS = 3;

/** Backoff before attempt 2 and 3. The last value repeats if attempts grow. */
export const SESSION_RETRY_MS = [600, 1_800] as const;

const realDelay = (ms: number) => new Promise<void>((r) => { setTimeout(r, ms); });

/** A private sentinel, so a genuine `false` from `attempt` can never be
 *  mistaken for the deadline firing. */
const TIMED_OUT = Symbol("session-timeout");

/** What the caller is told after each failed attempt, so a long wait can say
 *  it is still going rather than looking frozen. */
export type AttemptFailure = {
  /** 1-based. */
  attempt: number;
  reason: SessionFailure;
  /** False on the last attempt — the outcome is about to arrive instead. */
  willRetry: boolean;
};

export type EstablishOptions = {
  attempts?: number;
  timeoutMs?: number;
  retryDelaysMs?: readonly number[];
  /** Injected so tests need no real clock. */
  delay?: (ms: number) => Promise<void>;
  /**
   * Called as soon as an attempt fails, BEFORE the backoff and the next try.
   * Three stalled attempts is ~26 seconds of nothing; on a phone that reads as
   * frozen and the customer leaves before the error and its "Try again" ever
   * render. This is how the screen gets to speak at ~8 seconds instead.
   */
  onAttemptFailed?: (info: AttemptFailure) => void;
};

/**
 * Run `attempt` until it reports a usable session or the attempts run out.
 * `attempt` resolves true when there is a session; false or a throw is a
 * failure worth retrying. Never rejects — the caller gets an outcome.
 */
export async function establishSession(
  attempt: () => Promise<boolean>,
  options: EstablishOptions = {},
): Promise<SessionOutcome> {
  const attempts = options.attempts ?? SESSION_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? SESSION_TIMEOUT_MS;
  const retries = options.retryDelaysMs ?? SESSION_RETRY_MS;
  const delay = options.delay ?? realDelay;

  let reason: SessionFailure = "error";

  for (let i = 0; i < attempts; i++) {
    if (i > 0) {
      const back = retries.length ? retries[Math.min(i - 1, retries.length - 1)] : 0;
      await delay(back);
    }

    let failed = false;
    try {
      const settled = await Promise.race([
        attempt(),
        delay(timeoutMs).then(() => TIMED_OUT as typeof TIMED_OUT),
      ]);
      if (settled === TIMED_OUT) { reason = "timeout"; failed = true; }
      else if (settled) return { phase: "ready" };
      else { reason = "error"; failed = true; }
    } catch {
      reason = "error";
      failed = true;
    }

    if (failed) {
      options.onAttemptFailed?.({ attempt: i + 1, reason, willRetry: i + 1 < attempts });
    }
  }

  return { phase: "failed", reason, attempts };
}

// ---- what a disabled control is allowed to say ------------------------------

/** The real reason a page-1 control is unavailable. A genuine upload wins,
 *  because it is the one the customer actually started. */
export type BusyReason = "uploading" | "session" | null;

export function busyReason(x: { uploading: boolean; sessionPhase: SessionPhase }): BusyReason {
  if (x.uploading) return "uploading";
  if (x.sessionPhase !== "ready") return "session";
  return null;
}

/**
 * The floorplan button's label. It may only say "Uploading…" for a file the
 * customer chose — never for a session that has not landed yet.
 */
export function planUploadLabel(x: { planFileCount: number; uploading: boolean }): string {
  if (x.planFileCount) return "✓ Floorplan uploaded — reading in the background. Replace it?";
  if (x.uploading) return "Uploading…";
  return "📐 Upload a floorplan — photo or PDF";
}

export type ContinueState = {
  disabled: boolean;
  /** The honest reason, shown beside the button. Null when it is usable. */
  note: string | null;
};

/**
 * Continue stays disabled while a file is going up or the session has not
 * landed — but it now says which, and a failed session says nothing here
 * because the error and its "Try again" are already on screen.
 */
export function continueState(x: { uploading: boolean; sessionPhase: SessionPhase }): ContinueState {
  const reason = busyReason(x);
  if (reason === "uploading") return { disabled: true, note: "Uploading…" };
  if (reason === "session") {
    return x.sessionPhase === "failed"
      ? { disabled: true, note: null }
      : { disabled: true, note: "Connecting…" };
  }
  return { disabled: false, note: null };
}

/**
 * Shown once the first attempt has failed and another is running — plain
 * English, and it answers the question the customer is actually asking, which
 * is whether the last five minutes of typing is about to vanish — which
 * `retrySession` guarantees by leaving the wizard state alone.
 */
export const SESSION_SLOW_TEXT =
  "Still connecting — this can take a moment on a slow connection. Nothing you've entered will be lost.";

/** The one place the customer-facing wording for a lost session lives. */
export const SESSION_ERROR_TEXT =
  "We couldn't connect just now — please check your internet and try again, or give us a call.";
