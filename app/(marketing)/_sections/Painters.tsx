import PainterCard from "../_components/PainterCard";
import type { Painter } from "@/lib/marketing/siteContent";

/**
 * §4.9 — the trusted-network paragraph (verbatim), three painter cards and
 * the four statements. Painters come from Settings → Company → Website —
 * entering one there is the ⚑9.3 decision; until then the three cards are
 * visible placeholders.
 */
const PLACEHOLDERS = [1, 2, 3].map((n) => ({ n, name: `[Painter ${n}]`, meta: "[Specialty] · with Paint Group since [YYYY]", quote: "[One line in their own words]", photoPath: null as string | null, placeholder: true }));

export default function Painters({ painters = [] }: { painters?: Painter[] }) {
  const cards = painters.length
    ? painters.map((p, i) => ({
        n: i + 1, name: p.name, photoPath: p.photoPath, quote: p.quote, placeholder: false,
        meta: [p.specialty, p.since ? `with Paint Group since ${p.since}` : ""].filter(Boolean).join(" · "),
      }))
    : PLACEHOLDERS;
  return (
    <section className="sec light warm" id="painters">
      <div className="wrap">
        <h2>Who&rsquo;ll be painting.</h2>
        <p className="lead" style={{ marginTop: 14 }}>Our trusted network of painters. Every one is quality-checked, fully insured, and the kind of person you&rsquo;ll be comfortable having in your home or on your premises. You&rsquo;ll know who&rsquo;s coming before the date is locked in.</p>
        <div className="painters">
          {cards.map((c) => <PainterCard key={c.n} {...c} />)}
        </div>
        <div className="rules">
          <div className="rule"><i aria-hidden="true" />Your expectations are documented for your painter before day one. No nasty surprises, for you or for them.</div>
          <div className="rule"><i aria-hidden="true" />The finish you&rsquo;re paying for is written on the work order, room by room.</div>
          <div className="rule"><i aria-hidden="true" />Photos from the site, so you never have to wonder how it&rsquo;s going.</div>
          <div className="rule"><i aria-hidden="true" />Nothing is finished until you&rsquo;ve walked it with us and said so.</div>
        </div>
      </div>
    </section>
  );
}
