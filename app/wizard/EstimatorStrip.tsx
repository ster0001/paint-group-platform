import { initialsOf } from "@/lib/wizard/estimator";

/**
 * C11 (v2.4, prototype `.est`) — the estimator strip: the person is in the
 * screen. Initials, name, where they cover, and the two ways to reach them.
 * With no record it names nobody — "your estimator" and the office number —
 * rather than an invented person (C7's rule, kept).
 */
export default function EstimatorStrip({
  estimator, suburb, companyPhone, onBook, bookHref, compact = false,
}: {
  estimator: { name: string | null; phone: string | null; covers: boolean } | null;
  /** The customer's suburb, said only when the estimator covers it. */
  suburb?: string | null;
  companyPhone: string | null;
  /** A handler when the screen owns the booking form; else a link. */
  onBook?: () => void;
  bookHref?: string;
  compact?: boolean;
}) {
  const name = estimator?.name?.trim() || null;
  const phone = estimator?.phone || companyPhone;
  const first = name?.split(/\s+/)[0] ?? null;
  const where = estimator?.covers && suburb?.trim()
    ? `looks after ${suburb.trim()} · usually replies same day`
    : "confirms your price — with or without a visit";
  return (
    <div className={`wz-est ${compact ? "wz-est-compact" : ""}`} data-testid="estimator-strip" data-named={name ? "1" : "0"}>
      <span className="wz-est-avatar" aria-hidden="true">{name ? initialsOf(name) : "PG"}</span>
      <div className="wz-est-text">
        <b data-testid="estimator-name">{name ? `${name} — your estimator` : "Your estimator"}</b>
        <span>{name ? where : "One of our estimators confirms your price — with or without a visit."}</span>
      </div>
      <div className="wz-est-actions">
        {onBook ? (
          <button type="button" className="wz-btn wz-bs2" onClick={onBook} data-testid="estimator-book">Book a time</button>
        ) : bookHref ? (
          <a className="wz-btn wz-bs2" href={bookHref} data-testid="estimator-book">Book a time</a>
        ) : null}
        {phone && (
          <a className="wz-btn wz-bs2" href={`tel:${phone.replace(/[^0-9+]/g, "")}`} data-testid="estimator-call">
            {first ? `Call ${first}` : `Call ${phone}`}
          </a>
        )}
      </div>
    </div>
  );
}
