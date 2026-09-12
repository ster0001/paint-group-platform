/**
 * C9 — "What we'll do", read-only (prototype: the `.do` panel on the reveal,
 * the tighten screen and the finish line).
 *
 * The plain-English lines the ENGINE derived per surface group — coats,
 * undercoat, the painter's sentence — shown back with no controls. Tom, 10
 * Sep: the customer never referees a paint system; what changes these lines
 * is what they told us on the job screen and the details screen. One "tell
 * us" link for anything that reads wrong.
 */
export type WhatWeDoLine = {
  group: string;
  title: string;
  sentence: string;
  coats: number;
  undercoat: boolean;
  review: boolean;
};

export default function WhatWeDo({ lines, tellUsHref, compact = false }: {
  lines: WhatWeDoLine[];
  /** Where "something not right?" goes — the reach strip, the thread, or a tel: link. */
  tellUsHref?: string | null;
  compact?: boolean;
}) {
  if (lines.length === 0) return null;
  return (
    <section className={`wz-do ${compact ? "wz-do-compact" : ""}`} data-testid="what-we-do">
      <div className="wz-do-head">
        <h2>What we&rsquo;ll do</h2>
        <span className="wz-opt">PLAIN ENGLISH</span>
      </div>
      <ul className="wz-do-list">
        {/* C8b: the exterior derivation gives several lines one group, so the
            key carries the position; a "Not included" line has no coats to show. */}
        {lines.map((l, i) => (
          <li key={`${l.group}-${i}`} data-testid={`what-we-do-${l.group}`} data-coats={l.coats} data-undercoat={l.undercoat ? "1" : "0"}>
            <b>{l.title}</b>
            {l.coats > 0 && <span className="wz-do-coats">{l.coats} coat{l.coats === 1 ? "" : "s"}{l.undercoat ? " + undercoat" : ""}</span>}
            <p>{l.sentence}</p>
            {l.review && <em>A person confirms this one before your price is fixed.</em>}
          </li>
        ))}
      </ul>
      {tellUsHref && (
        <a className="wz-linkish" href={tellUsHref} data-testid="what-we-do-tell-us">Something not right? Tell us</a>
      )}
    </section>
  );
}

/** The derived lines, trimmed to what a customer reads — never the chips. */
export function whatWeDoLines(lines: ReadonlyArray<{ group: string; title: string; sentence: string; coats: number; undercoat: boolean; review: boolean }>): WhatWeDoLine[] {
  return lines.map((l) => ({ group: l.group, title: l.title, sentence: l.sentence, coats: l.coats, undercoat: l.undercoat, review: l.review }));
}
