import { initialsOf } from "@/lib/wizard/estimator";

/**
 * "Talk it through" (visit booking addendum A, R3; UI refresh S2, brief §7.2)
 * — on every step before the range: request a visit, call, or send a message.
 * A visit asked for here is a request for staff, never a booking. The test
 * ids are the ones the box has always had (`ql-talk`, `ql-book`, `ql-call`,
 * `ql-message`), and it is rendered ONCE: in the right-hand column on a
 * laptop, at the foot of the step on a phone (CSS moves it, never a copy).
 *
 * The estimator is whoever the wizard already resolves (⚑ 23,
 * `resolveEstimator` — Settings → Estimator until an address names a patch);
 * with nobody on record the card names nobody (⚑ 3: initials, no photo).
 */
export default function TalkCard({ estimatorName, phone, onBook, onMessage }: {
  estimatorName: string | null;
  phone: string | null;
  onBook: () => void;
  onMessage: () => void;
}) {
  const name = estimatorName?.trim() || null;
  return (
    <div className="wz-talk" data-testid="ql-talk">
      <div className="wz-talk-who">
        <span className="wz-talk-av" aria-hidden="true">{name ? initialsOf(name) : "PG"}</span>
        <p className="wz-talk-head">
          <b>Would you rather talk it through?</b>
          <small>{name ? `${name} is your estimator.` : "One of our estimators will help."}</small>
        </p>
      </div>
      <div className="wz-talk-row">
        <button type="button" className="wz-btn wz-bs2" onClick={onBook} data-testid="ql-book">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M8 3v4M16 3v4" /></svg>
          Request a site visit
        </button>
        {phone && (
          <a className="wz-btn wz-bs2" href={`tel:${phone.replace(/\s+/g, "")}`} data-testid="ql-call">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" /></svg>
            Call us
          </a>
        )}
        <button type="button" className="wz-btn wz-bs2" onClick={onMessage} data-testid="ql-message">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" /></svg>
          Send a message
        </button>
      </div>
    </div>
  );
}
