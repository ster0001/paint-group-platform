"use client";

/**
 * Tom, 14 Sep (tighten batch, item 31): when everything is answered the page
 * lights up and says the estimate has gone to the estimator by itself — the
 * reward for finishing, and the promise of what happens next.
 */
export default function AllDoneBanner({ estimator, sentHref, state }: {
  estimator: string | null;
  sentHref: string;
  state: "sending" | "sent" | "failed";
}) {
  const who = estimator?.trim() ? estimator.trim().split(/\s+/)[0] : "our estimator";
  return (
    <div className={`sc-done-banner ${state}`} data-testid="all-done-banner" data-state={state} role="status" aria-live="polite">
      <b>Everything&rsquo;s answered ✓</b>
      {state === "sent" && <span>Your estimate is with {who}. We&rsquo;ll be in touch soon to finalise your booking. <a className="wz-linkish" href={sentHref} data-testid="all-done-next">See what happens next</a></span>}
      {state === "sending" && <span>Sending it to {who}&hellip;</span>}
      {state === "failed" && <span>We couldn&rsquo;t send it just now — tap Finalise my price and we&rsquo;ll try again.</span>}
    </div>
  );
}
