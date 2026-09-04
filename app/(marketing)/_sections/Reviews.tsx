/** §4.11 — three white cards, five amber stars. ⚑9.6 supplies the three; visible placeholders until then. */
const PLACEHOLDERS = [
  "[Real review — pick one that mentions the price being what was quoted]",
  "[Real review — one that mentions daily updates or the painter by name]",
  "[Real review — one that mentions the finish or the prep]",
];

export default function Reviews() {
  return (
    <section className="sec light" id="reviews">
      <div className="wrap">
        <div className="mono" style={{ color: "var(--color-tmut)", marginBottom: 12 }}>5.0 from 85+ Google reviews</div>
        <h2>What people say once the tape comes off.</h2>
        <div className="revs">
          {PLACEHOLDERS.map((p) => (
            <div className="rev" key={p} data-todo="9.6">
              <span className="stars" aria-label="Five stars">★★★★★</span><p>{p}</p><small>Name · suburb · job type</small>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
