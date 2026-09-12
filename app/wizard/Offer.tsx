/**
 * C11 (v2.4, prototype `.offer`) — an inline offer at the exact moment a
 * person is genuinely easier: flagging damage, adjusting a size, the second
 * not-sure. Appears in place, never at the bottom; never a block.
 */
export default function Offer({ kind, estimator, onBook, onCall, onPhoto }: {
  kind: "measure" | "damage" | "not_sures";
  estimator: string | null;
  onBook: () => void;
  onCall?: (() => void) | string | null;
  onPhoto?: () => void;
}) {
  const first = estimator?.trim().split(/\s+/)[0] || null;
  const who = first ?? "we";
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const copy = kind === "measure"
    ? { title: `Want ${first ?? "us"} to measure it instead?`, body: `${first ? `${first}'s` : "We're"} out your way this week. Everything you've entered comes with ${first ? "her or him" : "us"}, and you can stop here.`.replace("her or him", "them") }
    : kind === "damage"
      ? { title: "Damage is easier to price in person", body: `Send a photo and ${who} price${first ? "s" : ""} it from that — or book ${first ? `${first} in and ${first}'ll` : "us in and we'll"} look at it properly. Either way, no guessing.` }
      : { title: "A few not-sures is completely fine", body: `${cap(who)} check${first ? "s" : ""} these in a minute ${first ? "when they're" : "when we're"} there — or on a quick call. Nothing here has to be right for you to send it.` };
  const tel = typeof onCall === "string" ? onCall : null;
  return (
    <div className="wz-offer" data-testid={`offer-${kind}`}>
      <b>{copy.title}</b>
      <p>{copy.body}</p>
      <div className="wz-offer-actions">
        <button type="button" className="wz-btn wz-bs2" onClick={onBook} data-testid={`offer-${kind}-book`}>Book a time</button>
        {kind === "damage" && onPhoto && (
          <button type="button" className="wz-btn wz-bs2" onClick={onPhoto} data-testid={`offer-${kind}-photo`}>I&rsquo;ll add a photo</button>
        )}
        {kind !== "damage" && tel && (
          <a className="wz-btn wz-bs2" href={`tel:${tel.replace(/[^0-9+]/g, "")}`} data-testid={`offer-${kind}-call`}>{first ? `Call ${first}` : "Call us"}</a>
        )}
      </div>
    </div>
  );
}
