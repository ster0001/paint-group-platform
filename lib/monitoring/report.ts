/**
 * One place errors are reported from.
 *
 * The standard asks for Sentry. There is no Sentry account yet, so rather than
 * half-install one behind a missing DSN this is the seam it will plug into:
 * every non-fatal failure in the app calls `reportError`, and wiring a real
 * monitor later is a change to THIS FILE only, not to twenty call sites.
 *
 * To wire Sentry up: install `@sentry/nextjs`, add the DSN to the environment,
 * and call `Sentry.captureException(error, { extra })` in the marked spot below.
 *
 * Why this exists at all: the audit found nine silent catches. Most were
 * deliberately best-effort — view tracking, expiry sweeps — and those are fine
 * to swallow, but swallowing them SILENTLY means a permission change or a
 * missing migration can break a feature for weeks with nothing to see. A
 * best-effort call should still leave a trace.
 */

export type ErrorContext = {
  /** Where it happened, in words a person can search for: "estimate.signature". */
  where: string;
  /** True when the user's work was not affected and nothing needs saying. */
  bestEffort?: boolean;
  /** Anything that helps diagnose it. Never put customer PII or money in here. */
  extra?: Record<string, unknown>;
};

/** The message on an Error, a Supabase error object, or anything else. */
export function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === "string" && m) return m;
  }
  return typeof error === "string" && error ? error : "Something went wrong.";
}

/**
 * Report a failure. Never throws and never returns anything the caller has to
 * handle — reporting must not be able to break the thing it is reporting on.
 */
export function reportError(error: unknown, context: ErrorContext): void {
  try {
    const line = `[${context.where}]${context.bestEffort ? " (best-effort)" : ""} ${errorMessage(error)}`;
    if (context.bestEffort) console.warn(line, context.extra ?? "");
    else console.error(line, context.extra ?? "", error);

    // ---- wire the error monitor in here -----------------------------------
    // Sentry.captureException(error, { tags: { where: context.where }, extra: context.extra });
  } catch {
    // Reporting failed. There is nowhere left to report that to.
  }
}

/**
 * Supabase's client returns `{ data, error }` and does NOT throw, so a
 * `try/catch` around it catches nothing and the error is dropped on the floor —
 * which is exactly how three real failures went unnoticed. Pass the result
 * through here instead.
 *
 * Returns true when the call succeeded, so callers can branch without repeating
 * the null check.
 */
export function reportIfError(result: { error: unknown } | null | undefined, context: ErrorContext): boolean {
  if (result?.error) {
    reportError(result.error, context);
    return false;
  }
  return true;
}
